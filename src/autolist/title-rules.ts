export const DOUDIAN_TITLE_MAX_CHARACTERS = 120;

export type TitleNormalizationResult = {
  title: string;
  changed: boolean;
  originalLength: number;
  maxLength: number;
};

export function countTitleCharacters(title: string): number {
  return Array.from(title).reduce((total, character) => total + (/^[\x00-\x7F]$/.test(character) ? 1 : 2), 0);
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

export function normalizeDoubaoGeneratedTitleForDoudian(
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
