export function buildFeishuSellingPointText(input: {
  userCognitionName?: string;
  brandedGenericName?: string;
  sellingPointText: string;
}): string {
  return input.sellingPointText.trim();
}
