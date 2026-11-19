function stripOperatorWorkflowProductPrefix(value: string): string {
  return value
    .replace(/^(?:申诉|反馈)\s*(?:--+|[-—_:：]+)\s*/u, "")
    .replace(/^[-—_:：]+\s*/u, "")
    .trim();
}

export function normalizeAutoListingControllerDisplayProductName(name?: string): string {
  const base = (name || "").split(/[\\/]/).pop() || "";
  const withoutExtension = base.replace(/\.(png|jpe?g|webp)$/i, "");
  const directWorkflowName = stripOperatorWorkflowProductPrefix(withoutExtension);
  if (directWorkflowName !== withoutExtension) {
    return directWorkflowName || "未知商品";
  }
  const productFolderMatch = withoutExtension.match(/^(.+?)-rec[a-zA-Z0-9]+-水印\d+$/i);
  if (productFolderMatch?.[1]) {
    return stripOperatorWorkflowProductPrefix(productFolderMatch[1]) || "未知商品";
  }
  const normalized = withoutExtension
    .replace(/^[^-]+-/, "")
    .replace(/-白底图-\d+$/i, "")
    .replace(/水印\d+$/i, "")
    .trim();
  return stripOperatorWorkflowProductPrefix(normalized) || "未知商品";
}
