export type PlatformSpuSpecificationMatchPolicy = "ignore" | "require_exact";

export interface PlatformBrandCandidate {
  brandName: string;
  optionIdentity: string;
}

export interface PlatformSpuPublishCandidateInput {
  rowId: string;
  rowText?: string;
  exactSpuCell: boolean;
  exactBrandCell: boolean;
  rowHasSpu: boolean;
  rowHasBrand: boolean;
  publishControlActionable: boolean;
}

export interface PlatformSpuPublishSelectionPolicy {
  specificationMatch: PlatformSpuSpecificationMatchPolicy;
  expectedSpecification?: string;
}

function normalizeIdentityText(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

export function normalizePlatformSpuSpecification(value: string): string {
  return normalizeIdentityText(value)
    .replace(/[×xX＊]/g, "*")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")");
}

export function resolveExactPlatformBrandCandidateSequence(
  expectedBrand: string,
  candidates: PlatformBrandCandidate[]
): string[] {
  const expected = normalizeIdentityText(expectedBrand);
  const seen = new Set<string>();
  const sequence: string[] = [];
  for (const candidate of candidates) {
    const identity = candidate.optionIdentity.trim();
    if (!identity || normalizeIdentityText(candidate.brandName) !== expected || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    sequence.push(identity);
  }
  return sequence;
}

export function extractPlatformSpuRowSpecifications(rowText: string): string[] {
  const values: string[] = [];
  const boundaryLabels = [
    "品牌",
    "生产企业名称",
    "药品通用名",
    "药品批准文号",
    "是否处方药",
    "条码",
    "ID",
    "操作时间",
    "状态"
  ].join("|");
  const pattern = new RegExp(`(?:^|\\s)规格[:：]\\s*(.+?)(?=\\s(?:${boundaryLabels})[:：]|$)`, "g");
  for (const match of rowText.replace(/\s+/g, " ").trim().matchAll(pattern)) {
    const value = match[1]?.trim() || "";
    if (value && !values.some((item) => normalizePlatformSpuSpecification(item) === normalizePlatformSpuSpecification(value))) {
      values.push(value);
    }
  }
  return values;
}

function rankedActionableCandidateGroups(candidates: PlatformSpuPublishCandidateInput[]) {
  const indexed = candidates.map((candidate, index) => ({ candidate, index }));
  return [
    indexed.filter(({ candidate }) =>
      candidate.rowHasSpu && candidate.rowHasBrand && candidate.exactSpuCell && candidate.exactBrandCell && candidate.publishControlActionable
    ),
    indexed.filter(({ candidate }) =>
      candidate.rowHasSpu && candidate.rowHasBrand && candidate.exactSpuCell && candidate.publishControlActionable
    ),
    indexed.filter(({ candidate }) => candidate.rowHasSpu && candidate.rowHasBrand && candidate.publishControlActionable)
  ];
}

export function selectPlatformSpuPublishCandidate(
  candidates: PlatformSpuPublishCandidateInput[],
  policy: PlatformSpuPublishSelectionPolicy
): { candidateIndex: number; issue: string } {
  let eligibleCandidates = candidates;
  if (policy.specificationMatch === "require_exact") {
    const expected = normalizePlatformSpuSpecification(policy.expectedSpecification || "");
    if (!expected) {
      return {
        candidateIndex: -1,
        issue: "Platform SPU query requires a non-empty Feishu specification for exact OTC matching."
      };
    }
    eligibleCandidates = candidates.filter((candidate) =>
      extractPlatformSpuRowSpecifications(candidate.rowText || "")
        .some((value) => normalizePlatformSpuSpecification(value) === expected)
    );
    if (!eligibleCandidates.length) {
      const actual = candidates
        .flatMap((candidate) => extractPlatformSpuRowSpecifications(candidate.rowText || ""))
        .filter((value, index, values) =>
          values.findIndex((item) => normalizePlatformSpuSpecification(item) === normalizePlatformSpuSpecification(value)) === index
        );
      const exactRows = candidates.filter((candidate) => candidate.rowHasSpu && candidate.rowHasBrand);
      return {
        candidateIndex: -1,
        issue: exactRows.length
          ? `Platform SPU query found exact brand/SPU rows but none matched Feishu specification exactly: expected=${policy.expectedSpecification}; actual=${actual.join(" | ") || "<none>"}`
          : ""
      };
    }
  }

  for (const group of rankedActionableCandidateGroups(eligibleCandidates)) {
    if (group.length === 1) {
      return { candidateIndex: candidates.indexOf(group[0].candidate), issue: "" };
    }
    if (group.length > 1) {
      return {
        candidateIndex: -1,
        issue: `Platform SPU publish navigation failed before click: ${group.length} actionable exact publish rows are ambiguous.`
      };
    }
  }
  const exactRows = eligibleCandidates.filter((candidate) => candidate.rowHasSpu && candidate.rowHasBrand);
  return {
    candidateIndex: -1,
    issue: exactRows.length
      ? `Platform SPU publish navigation failed before click: ${exactRows.length} exact rows were found but none had an actionable publish control.`
      : ""
  };
}
