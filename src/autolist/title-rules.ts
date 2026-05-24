export const DOUDIAN_TITLE_MAX_CHARACTERS = 60;

export type TitleNormalizationResult = {
  title: string;
  changed: boolean;
  originalLength: number;
  maxLength: number;
};

export function countTitleCharacters(title: string): number {
  return Array.from(title).length;
}

export function normalizeDoubaoGeneratedTitleForDoudian(
  title: string,
  maxLength = DOUDIAN_TITLE_MAX_CHARACTERS
): TitleNormalizationResult {
  const characters = Array.from(title);
  const originalLength = characters.length;
  if (originalLength <= maxLength) {
    return {
      title,
      changed: false,
      originalLength,
      maxLength
    };
  }

  return {
    title: characters.slice(originalLength - maxLength).join(""),
    changed: true,
    originalLength,
    maxLength
  };
}
