export interface FeishuAssetRecordLike {
  recordId?: string;
  spu?: string;
  brand?: string;
  userCognitionName?: string;
  genericName?: string;
  shortTitle?: string;
  whiteBackgroundImages?: Array<{ name?: string; localFile?: string }>;
  qualificationImages?: Array<{ name?: string; localFile?: string }>;
}

export interface FeishuAssetRecordMatchDecision {
  record?: FeishuAssetRecordLike;
  issue: string;
}

export function normalizeAssetRuleText(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，,。、“”"'`·\-_/\\|:：;；()（）[\]【】.]/g, "").toLowerCase();
}

function basenameLike(value: string): string {
  return value.split(/[\\/]/).pop() || value;
}

function localFileNames(items: Array<{ name?: string; localFile?: string }> | undefined): string[] {
  return Array.isArray(items)
    ? items.flatMap((item) => [item.name || "", basenameLike(item.localFile || "")]).filter(Boolean)
    : [];
}

function strongKeys(record: FeishuAssetRecordLike): string[] {
  return [
    record.recordId || "",
    record.userCognitionName || "",
    record.shortTitle || "",
    ...localFileNames(record.whiteBackgroundImages),
    ...localFileNames(record.qualificationImages)
  ]
    .map(normalizeAssetRuleText)
    .filter(Boolean);
}

function broadKeys(record: FeishuAssetRecordLike): string[] {
  return [record.spu || "", record.genericName || "", `${record.brand || ""}${record.genericName || ""}`]
    .map(normalizeAssetRuleText)
    .filter(Boolean);
}

function bestUniqueMatch(
  records: FeishuAssetRecordLike[],
  searchText: string,
  keyBuilder: (record: FeishuAssetRecordLike) => string[]
): FeishuAssetRecordMatchDecision {
  const matches = records
    .map((record) => ({
      record,
      score: keyBuilder(record).reduce((best, key) => (searchText.includes(key) ? Math.max(best, key.length) : best), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const bestScore = matches[0]?.score || 0;
  const bestMatches = matches.filter((item) => item.score === bestScore);
  if (bestMatches.length === 1) {
    return { record: bestMatches[0].record, issue: "" };
  }
  if (bestMatches.length > 1) {
    return {
      issue: bestMatches.map((item) => item.record.recordId || item.record.userCognitionName || item.record.spu || "unknown").join(", ")
    };
  }
  return { issue: "" };
}

export function resolveFeishuAssetRecordForFolder(input: {
  folderSearchParts: string[];
  records: FeishuAssetRecordLike[];
}): FeishuAssetRecordMatchDecision {
  const searchText = normalizeAssetRuleText(input.folderSearchParts.join(" "));
  if (!searchText) {
    return { issue: "Product folder search text is empty." };
  }

  const strongMatch = bestUniqueMatch(input.records, searchText, strongKeys);
  if (strongMatch.record) {
    return strongMatch;
  }
  if (strongMatch.issue) {
    return { issue: `Multiple Feishu product records match product folder with strong keys: ${strongMatch.issue}` };
  }

  const broadMatch = bestUniqueMatch(input.records, searchText, broadKeys);
  if (broadMatch.record) {
    return broadMatch;
  }
  if (broadMatch.issue) {
    return { issue: `Multiple Feishu product records match product folder with broad keys: ${broadMatch.issue}` };
  }

  return { issue: "No Feishu product record matched product folder." };
}
