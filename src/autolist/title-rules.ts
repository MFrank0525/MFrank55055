export const DOUDIAN_TITLE_MAX_CHARACTERS = 120;
export const DOUDIAN_SHORT_TITLE_MAX_CHARACTERS = 24;

export type TitleNormalizationResult = {
  title: string;
  changed: boolean;
  originalLength: number;
  maxLength: number;
};

export type ShortTitleNormalizationResult = TitleNormalizationResult & {
  strategy: "unchanged" | "drop_ascii_prefix";
};

export function countTitleCharacters(title: string): number {
  return Array.from(title).reduce((total, character) => total + (/^[\x00-\x7F]$/.test(character) ? 1 : 2), 0);
}

export function countShortTitleCharacters(title: string): number {
  return Array.from(title).reduce(
    (total, character) => total + (/\p{Script=Han}/u.test(character) ? 2 : 1),
    0
  );
}

export function normalizeShortTitleForDoudian(
  value: string,
  maxLength = DOUDIAN_SHORT_TITLE_MAX_CHARACTERS
): ShortTitleNormalizationResult {
  const title = value.replace(/\s+/g, "").trim();
  const originalLength = countShortTitleCharacters(title);
  if (originalLength <= maxLength) {
    return { title, changed: title !== value, originalLength, maxLength, strategy: "unchanged" };
  }
  const asciiPrefix = /^([A-Za-z0-9]{2,8})(?=\p{Script=Han})/u.exec(title)?.[1] || "";
  const withoutPrefix = asciiPrefix ? title.slice(asciiPrefix.length) : "";
  if (withoutPrefix && countShortTitleCharacters(withoutPrefix) <= maxLength) {
    return {
      title: withoutPrefix,
      changed: true,
      originalLength,
      maxLength,
      strategy: "drop_ascii_prefix"
    };
  }
  throw new Error(
    `Feishu shortTitle exceeds ${maxLength} Doudian characters and cannot be normalized without truncating source terms: ${title}`
  );
}

export function normalizeFeishuTitleFixedSuffix(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function assertTitlePreservesFeishuFixedSuffix(options: {
  title: string;
  fixedSuffixText: string;
  productCategory?: string;
}): void {
  if (options.productCategory === "保健食品") {
    return;
  }
  const suffix = normalizeFeishuTitleFixedSuffix(options.fixedSuffixText);
  if (!suffix) {
    throw new Error("Feishu 标题固定后缀 is required.");
  }
  if (!options.title.endsWith(suffix)) {
    const asteriskRule = options.productCategory === "非处方药" && suffix.includes("*")
      ? " OTC dosage separator * must be preserved."
      : "";
    throw new Error(`Generated title must preserve the exact Feishu fixed suffix: ${suffix}.${asteriskRule}`);
  }
}

function truncateTitleToCharacterLimit(title: string, maxLength: number): string {
  let currentLength = 0;
  const kept: string[] = [];
  for (const character of Array.from(title)) {
    const characterLength = /^[\x00-\x7F]$/.test(character) ? 1 : 2;
    if (currentLength + characterLength > maxLength) {
      break;
    }
    kept.push(character);
    currentLength += characterLength;
  }
  return kept.join("");
}

export function normalizeTitleForDoudian(
  title: string,
  maxLength = DOUDIAN_TITLE_MAX_CHARACTERS
): TitleNormalizationResult {
  const originalLength = countTitleCharacters(title);
  if (originalLength <= maxLength) {
    return {
      title,
      changed: false,
      originalLength,
      maxLength
    };
  }

  return {
    title: truncateTitleToCharacterLimit(title, maxLength),
    changed: true,
    originalLength,
    maxLength
  };
}

function normalizeTitleContextText(value: string): string {
  return Array.from(value.replace(/\s+/g, "").trim())
    .filter((char) => /[\p{Script=Han}\p{L}\p{N}]/u.test(char))
    .join("");
}

export function assertGeneratedTitlesBelongToProduct(options: {
  titles: string[];
  genericName: string;
  productCategory?: string;
}): void {
  const genericName = normalizeTitleContextText(options.genericName);
  if (!genericName) {
    throw new Error("Title product-context audit requires genericName.");
  }

  const category = normalizeTitleContextText(options.productCategory || "医疗器械");
  if (category.includes("保健食品")) {
    return;
  }

  const mismatches = options.titles
    .map((title, index) => ({
      index: index + 1,
      title: normalizeTitleContextText(title)
    }))
    .filter((item) => !item.title.includes(genericName));

  if (mismatches.length > 0) {
    throw new Error(
      `Generated titles do not match current product genericName=${genericName}: ${mismatches
        .slice(0, 5)
        .map((item) => `${String(item.index).padStart(2, "0")}=${item.title}`)
        .join(" | ")}`
    );
  }
}
