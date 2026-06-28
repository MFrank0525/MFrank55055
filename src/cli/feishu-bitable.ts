import fs from "node:fs";
import path from "node:path";
import { buildFeishuBatchFingerprint } from "../autolist/feishu-batch-rules.js";
import { assertFeishuAuthConfigReady, getTenantAccessToken } from "../feishu/auth.js";
import { downloadFeishuProductAssets } from "../feishu/assets.js";
import { FEISHU_CACHE_SCHEMA_VERSION, FEISHU_FIELD_MAP_VERSION } from "../feishu/cache-contract.js";
import { listBitableFields, resolveWikiNode, searchBitableRecords } from "../feishu/client.js";
import { assertFeishuBitableConfigReady, loadFeishuBitableConfig } from "../feishu/config.js";
import {
  isEmptyFeishuProductRecord,
  normalizeFeishuProductRecord,
  sanitizeFeishuProductRecord,
  validateFeishuProductRecord
} from "../feishu/product-records.js";

type Mode = "check" | "fields" | "records" | "dump" | "assets";

interface CliArgs {
  mode: Mode;
  configFile: string;
  limit: number;
  outFile: string;
  whiteBackgroundDir: string;
  qualificationDir: string;
  cleanupStaleAssets: boolean;
}

interface LocalFeishuAuthConfig {
  auth?: {
    appId?: string;
    appSecret?: string;
    tenantAccessToken?: string;
  };
}

function getArg(argv: string[], name: string, defaultValue = ""): string {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] || defaultValue : defaultValue;
}

function parseMode(value: string): Mode {
  if (value === "check" || value === "fields" || value === "records" || value === "dump" || value === "assets") {
    return value;
  }
  throw new Error("Usage: --mode <check|fields|records|dump|assets> --config <feishu-bitable.config.json>");
}

function defaultConfigFile(): string {
  return fs.existsSync(path.resolve("input/feishu-bitable.config.json"))
    ? "input/feishu-bitable.config.json"
    : "input/feishu-bitable.config.example.json";
}

function parseArgs(argv: string[]): CliArgs {
  const mode = parseMode(getArg(argv, "mode", "check"));
  const configFile = getArg(argv, "config", defaultConfigFile());
  const limit = Number(getArg(argv, "limit", mode === "records" ? "5" : "0"));
  const outFile = getArg(argv, "out", "data/feishu/products.json");
  const whiteBackgroundDir = getArg(argv, "white-background-dir", "input/auto-listing/feishu-images");
  const qualificationDir = getArg(argv, "qualification-dir", "input/auto-listing/qualifications");
  const cleanupStaleAssets = argv.includes("--cleanup-stale-assets");
  return {
    mode,
    configFile,
    limit: Number.isFinite(limit) ? limit : 0,
    outFile,
    whiteBackgroundDir,
    qualificationDir,
    cleanupStaleAssets
  };
}

function validateMappedFields(configFieldNames: string[], actualFieldNames: Set<string>): string[] {
  return configFieldNames.filter((fieldName) => !actualFieldNames.has(fieldName));
}

function redactIdentifier(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.length <= 8 ? "[redacted]" : `${value.slice(0, 4)}...[redacted]...${value.slice(-4)}`;
}

function loadLocalAuthEnv(configFile: string): void {
  const resolved = path.resolve(configFile);
  if (!fs.existsSync(resolved)) {
    return;
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as LocalFeishuAuthConfig;
  if (!parsed.auth) {
    return;
  }
  if (parsed.auth.appId?.trim()) {
    process.env.FEISHU_APP_ID = parsed.auth.appId.trim();
  }
  if (parsed.auth.appSecret?.trim()) {
    process.env.FEISHU_APP_SECRET = parsed.auth.appSecret.trim();
  }
  if (parsed.auth.tenantAccessToken?.trim()) {
    process.env.FEISHU_TENANT_ACCESS_TOKEN = parsed.auth.tenantAccessToken.trim();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadLocalAuthEnv(args.configFile);
  const config = loadFeishuBitableConfig(args.configFile);
  assertFeishuAuthConfigReady();

  const token = await getTenantAccessToken();
  if (!config.appToken && config.wikiNodeToken) {
    const node = await resolveWikiNode(config.wikiNodeToken, token);
    if (node.objType && node.objType !== "bitable") {
      throw new Error(`Feishu wiki node is not a bitable. obj_type=${node.objType}`);
    }
    config.appToken = node.objToken;
  }
  assertFeishuBitableConfigReady(config);
  const fields = await listBitableFields(config, token);
  const actualFieldNames = new Set(fields.map((field) => field.fieldName).filter(Boolean));
  const mappedFieldNames = [...new Set(Object.values(config.fieldMap).filter(Boolean))];
  const missingMappedFields = validateMappedFields(mappedFieldNames, actualFieldNames);

  if (args.mode === "fields") {
    console.log(JSON.stringify(fields, null, 2));
    return;
  }

  if (missingMappedFields.length && args.mode === "check") {
    throw new Error(`Feishu field mapping has missing fields: ${missingMappedFields.join(", ")}`);
  }

  if (args.mode === "check") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          appToken: redactIdentifier(config.appToken),
          tableId: redactIdentifier(config.tableId),
          viewId: redactIdentifier(config.viewId),
          mappedFields: mappedFieldNames,
          fieldCount: fields.length
        },
        null,
        2
      )
    );
    return;
  }

  const queryConfig = {
    ...config,
    fieldMap: {
      ...config.fieldMap,
      ...Object.fromEntries(
        Object.entries(config.fieldMap)
          .filter(([, fieldName]) => missingMappedFields.includes(fieldName))
          .map(([key]) => [key, ""])
      )
    }
  };
  const rawRecords = await searchBitableRecords(queryConfig, token, args.limit);
  const allRecords = rawRecords.map((record) => normalizeFeishuProductRecord(record, config));
  const records = allRecords.filter((record) => !isEmptyFeishuProductRecord(record));
  const invalidRecords = records
    .map((record) => ({ recordId: record.recordId, missing: validateFeishuProductRecord(record) }))
    .filter((item) => item.missing.length > 0);

  const sanitizedRecords = records.map((record) => sanitizeFeishuProductRecord(record));
  const payload = {
    schemaVersion: FEISHU_CACHE_SCHEMA_VERSION,
    fieldMapVersion: FEISHU_FIELD_MAP_VERSION,
    batchFingerprint: buildFeishuBatchFingerprint(records),
    ok: missingMappedFields.length === 0 && invalidRecords.length === 0,
    count: records.length,
    skippedEmptyCount: allRecords.length - records.length,
    missingMappedFields,
    invalidRecords,
    records: sanitizedRecords
  };

  if (args.mode === "assets") {
    if (!payload.ok) {
      const outFile = path.resolve(args.outFile);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, `${JSON.stringify({ ...payload, downloadedFiles: [], removedStaleFiles: [] }, null, 2)}\n`, "utf8");
      console.log(JSON.stringify({ ok: false, count: payload.count, downloadedFileCount: 0, removedStaleFileCount: 0, outFile, invalidRecords }, null, 2));
      process.exitCode = 1;
      return;
    }
    const downloadResult = await downloadFeishuProductAssets({
      token,
      records,
      whiteBackgroundDir: args.whiteBackgroundDir,
      qualificationDir: args.qualificationDir,
      cleanupStaleAssets: args.cleanupStaleAssets
    });
    const outFile = path.resolve(args.outFile);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const assetRecords = downloadResult.records.map((record) => sanitizeFeishuProductRecord(record));
    const assetPayload = {
      ...payload,
      batchFingerprint: buildFeishuBatchFingerprint(assetRecords),
      records: assetRecords,
      downloadedFiles: downloadResult.downloadedFiles,
      removedStaleFiles: downloadResult.removedStaleFiles
    };
    fs.writeFileSync(outFile, `${JSON.stringify(assetPayload, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify(
        {
          ok: assetPayload.ok,
          count: assetPayload.count,
          downloadedFileCount: downloadResult.downloadedFiles.length,
          removedStaleFileCount: downloadResult.removedStaleFiles.length,
          outFile,
          invalidRecords
        },
        null,
        2
      )
    );
    if (!assetPayload.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.mode === "dump") {
    const outFile = path.resolve(args.outFile);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ok: payload.ok, count: payload.count, outFile, invalidRecords }, null, 2));
    if (!payload.ok) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
