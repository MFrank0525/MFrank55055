import type { FeishuBitableConfig, FeishuBitableField } from "./types.js";

interface FeishuApiResponse<T> {
  code: number;
  msg?: string;
  data?: T;
}

interface ListFieldsData {
  items?: Array<{
    field_id?: string;
    field_name?: string;
    type?: number;
    [key: string]: unknown;
  }>;
  has_more?: boolean;
  page_token?: string;
}

interface SearchRecordsData {
  items?: Array<{
    record_id?: string;
    fields?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  has_more?: boolean;
  page_token?: string;
}

export interface FeishuBitableRecord {
  recordId: string;
  fields: Record<string, unknown>;
  raw: unknown;
}

export interface FeishuWikiNode {
  nodeToken: string;
  objToken: string;
  objType: string;
  raw: unknown;
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

async function requestFeishu<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });
  const payload = (await response.json()) as FeishuApiResponse<T>;
  if (!response.ok || payload.code !== 0 || payload.data === undefined) {
    throw new Error(`Feishu API failed: ${path}; code=${payload.code}; msg=${payload.msg || response.statusText}`);
  }
  return payload.data;
}

export async function downloadFeishuMedia(token: string, fileToken: string, downloadUrl = ""): Promise<Buffer> {
  const url =
    downloadUrl.trim() ||
    `https://open.feishu.cn/open-apis/drive/v1/medias/${encodePath(fileToken)}/download`;
  const response = await fetch(url.startsWith("http") ? url : `https://open.feishu.cn/open-apis${url}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new Error(`Feishu media download failed: ${fileToken}; status=${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function listBitableFields(config: FeishuBitableConfig, token: string): Promise<FeishuBitableField[]> {
  const fields: FeishuBitableField[] = [];
  let pageToken = "";

  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (pageToken) {
      query.set("page_token", pageToken);
    }
    const data = await requestFeishu<ListFieldsData>(
      token,
      `/bitable/v1/apps/${encodePath(config.appToken)}/tables/${encodePath(config.tableId)}/fields?${query.toString()}`
    );

    for (const item of data.items || []) {
      fields.push({
        fieldId: item.field_id || "",
        fieldName: item.field_name || "",
        type: item.type,
        raw: item
      });
    }
    pageToken = data.has_more ? data.page_token || "" : "";
  } while (pageToken);

  return fields;
}

export async function resolveWikiNode(token: string, tenantAccessToken: string): Promise<FeishuWikiNode> {
  const query = new URLSearchParams({ token });
  const data = await requestFeishu<{
    node?: {
      node_token?: string;
      obj_token?: string;
      obj_type?: string;
      [key: string]: unknown;
    };
  }>(tenantAccessToken, `/wiki/v2/spaces/get_node?${query.toString()}`);
  const node = data.node;
  if (!node?.obj_token) {
    throw new Error(`Feishu wiki node did not return obj_token for token=${token}`);
  }
  return {
    nodeToken: node.node_token || token,
    objToken: node.obj_token,
    objType: node.obj_type || "",
    raw: node
  };
}

export async function searchBitableRecords(
  config: FeishuBitableConfig,
  token: string,
  limit = 0
): Promise<FeishuBitableRecord[]> {
  const records: FeishuBitableRecord[] = [];
  let pageToken = "";
  const pageSize = Math.max(1, Math.min(config.pageSize || 100, 500));

  do {
    const query = new URLSearchParams({ page_size: String(pageSize) });
    if (pageToken) {
      query.set("page_token", pageToken);
    }

    const body: Record<string, unknown> = {
      field_names: [...new Set(Object.values(config.fieldMap).filter(Boolean))]
    };
    if (config.viewId) {
      body.view_id = config.viewId;
    }

    const data = await requestFeishu<SearchRecordsData>(
      token,
      `/bitable/v1/apps/${encodePath(config.appToken)}/tables/${encodePath(config.tableId)}/records/search?${query.toString()}`,
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    );

    for (const item of data.items || []) {
      records.push({
        recordId: item.record_id || "",
        fields: item.fields || {},
        raw: item
      });
      if (limit > 0 && records.length >= limit) {
        return records;
      }
    }
    pageToken = data.has_more ? data.page_token || "" : "";
  } while (pageToken);

  return records;
}
