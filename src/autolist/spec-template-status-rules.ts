export const MISSING_SPEC_TEMPLATE_HERMES_MESSAGE = "没有对应的规格模板可选";

export function resolveMissingSpecTemplateHermesMessage(message: string | undefined): string | undefined {
  return /No spec template option exactly matched Feishu value/i.test(String(message || ""))
    ? MISSING_SPEC_TEMPLATE_HERMES_MESSAGE
    : undefined;
}
