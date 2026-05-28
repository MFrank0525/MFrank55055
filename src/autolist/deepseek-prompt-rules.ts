export interface DeepSeekPromptValidationContextInput {
  sellingPointText: string;
  userCognitionName?: string;
  brandedGenericName?: string;
  genericName?: string;
}

export interface DeepSeekPromptValidationContext {
  sellingPointText: string;
  userCognitionName: string;
  brandedGenericName: string;
  genericName: string;
  anchors: string[];
  strongAnchors: string[];
  forbiddenTerms: string[];
}

export interface DeepSeekPromptParagraphClassification {
  ok: boolean;
  matchedAnchors: string[];
  reason: string;
}

const GENERIC_ANCHOR_STOP_WORDS = new Set([
  "医用",
  "医疗",
  "产品",
  "商品",
  "官方",
  "正品",
  "保证",
  "护理",
  "适用",
  "使用",
  "电商",
  "海报",
  "主图",
  "场景",
  "科技",
  "安全",
  "承诺",
  "标签",
  "包装",
  "品牌",
  "二类",
  "器械",
  "认证",
  "不添加",
  "科技狠活",
  "匠心",
  "甄选"
]);

const WEAK_ANCHORS = new Set(["凝胶", "敷料", "喷剂", "贴膏", "乳膏", "液体", "产品", "医用"]);

const COPIED_RULE_TEXT_MARKERS = [
  "海报视觉设计生成规则",
  "输出格式",
  "数量要求",
  "每次需设计",
  "场景关联",
  "内容细节",
  "必须融入产品卖点",
  "禁止展示内容",
  "文字风格",
  "创新性",
  "必须直接输出",
  "不要解释",
  "不要分析",
  "不要标题",
  "不再限定行业",
  "如持续发热渗透",
  "如膝盖",
  "每段单独换行"
];

const CROSS_PRODUCT_TERMS = [
  "重组胶原蛋白",
  "胶原蛋白",
  "细胞外基质",
  "面部抽象模型",
  "面部模型",
  "面部",
  "远红外",
  "陶瓷粉",
  "缓解疼痛",
  "持续发热",
  "发热渗透",
  "膝盖",
  "关节",
  "贴膏",
  "穴位",
  "疼痛部位",
  "骨骼"
];

function normalizeComparableText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s\-_.，。、；;：:“”"'‘’（）()【】[\]<>《》/\\|+*#?!！?]/g, "")
    .trim();
}

function extractCandidateTerms(input: string): string[] {
  const normalized = input.replace(/[A-Za-z0-9]+/g, " $& ").replace(/[，。、；;：:“”"'‘’（）()【】[\]<>《》/\\|+*#?!！?\s]/g, " ");
  const spans = normalized.match(/[\u4e00-\u9fffA-Za-z0-9]{2,}/g) || [];
  const terms = new Set<string>();
  for (const span of spans) {
    const comparable = normalizeComparableText(span);
    if (comparable.length < 2) {
      continue;
    }
    if (comparable.length <= 8) {
      terms.add(comparable);
    }
    if (/[\u4e00-\u9fff]/.test(comparable)) {
      for (let length = 2; length <= Math.min(6, comparable.length); length += 1) {
        for (let index = 0; index <= comparable.length - length; index += 1) {
          terms.add(comparable.slice(index, index + length));
        }
      }
    }
  }
  return Array.from(terms).filter((term) => !GENERIC_ANCHOR_STOP_WORDS.has(term));
}

function uniqueSortedTerms(terms: string[]): string[] {
  return Array.from(new Set(terms.map((term) => normalizeComparableText(term)).filter(Boolean))).sort((a, b) => {
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    return a.localeCompare(b, "zh-CN");
  });
}

function resolveForbiddenTerms(contextText: string): string[] {
  const normalizedContext = normalizeComparableText(contextText);
  return CROSS_PRODUCT_TERMS.filter((term) => {
    const normalizedTerm = normalizeComparableText(term);
    return normalizedTerm && !normalizedContext.includes(normalizedTerm);
  });
}

export function resolveDeepSeekPromptRetryPolicy(): { maxAttempts: number } {
  return { maxAttempts: 3 };
}

export function shouldRetryDeepSeekPromptSubmission(input: { extractedPromptCount: number }): boolean {
  return input.extractedPromptCount <= 0;
}

export function selectDeepSeekLatestReplyPromptBlock(candidates: string[], promptCount: number): string[] {
  if (candidates.length <= promptCount) {
    return candidates;
  }
  return candidates.slice(0, promptCount);
}

export function buildDeepSeekPromptValidationContext(
  input: DeepSeekPromptValidationContextInput
): DeepSeekPromptValidationContext {
  const userCognitionName = input.userCognitionName?.trim() || "";
  const brandedGenericName = input.brandedGenericName?.trim() || "";
  const genericName = input.genericName?.trim() || "";
  const sellingPointText = input.sellingPointText.trim();
  const productText = [userCognitionName, brandedGenericName, genericName].filter(Boolean).join(" ");
  const allText = [productText, sellingPointText].filter(Boolean).join(" ");
  const productAnchors = extractCandidateTerms(productText);
  const sellingPointAnchors = extractCandidateTerms(sellingPointText);
  const anchors = uniqueSortedTerms([...productAnchors, ...sellingPointAnchors]);
  const strongAnchors = uniqueSortedTerms(
    anchors.filter((anchor) => !WEAK_ANCHORS.has(anchor) && !GENERIC_ANCHOR_STOP_WORDS.has(anchor))
  );
  return {
    sellingPointText,
    userCognitionName,
    brandedGenericName,
    genericName,
    anchors,
    strongAnchors,
    forbiddenTerms: resolveForbiddenTerms(allText)
  };
}

export function classifyDeepSeekPromptParagraph(
  prompt: string,
  context: DeepSeekPromptValidationContext
): DeepSeekPromptParagraphClassification {
  const normalizedPrompt = normalizeComparableText(prompt);
  if (!normalizedPrompt) {
    return { ok: false, matchedAnchors: [], reason: "DeepSeek paragraph is empty." };
  }
  const copiedMarker = COPIED_RULE_TEXT_MARKERS.find((marker) => normalizedPrompt.includes(normalizeComparableText(marker)));
  if (copiedMarker) {
    return { ok: false, matchedAnchors: [], reason: `DeepSeek paragraph copied rule text: ${copiedMarker}` };
  }
  const matchedAnchors = context.anchors.filter((anchor) => normalizedPrompt.includes(anchor));
  const matchedStrongAnchors = context.strongAnchors.filter((anchor) => normalizedPrompt.includes(anchor));
  if (!matchedStrongAnchors.length) {
    return {
      ok: false,
      matchedAnchors,
      reason: `DeepSeek paragraph does not match current product anchors: ${context.strongAnchors.slice(0, 8).join(", ")}`
    };
  }
  return { ok: true, matchedAnchors, reason: "" };
}

export function assertDeepSeekPromptsBelongToCurrentProduct(
  prompts: string[],
  context: DeepSeekPromptValidationContext,
  promptCount: number
): string[] {
  if (prompts.length !== promptCount) {
    throw new Error(`DeepSeek must return ${promptCount} keyword paragraphs, got ${prompts.length}.`);
  }
  const classifications = prompts.map((prompt) => ({
    prompt,
    classification: classifyDeepSeekPromptParagraph(prompt, context)
  }));
  const matched = classifications.find((item) => item.classification.ok);
  if (!matched) {
    const reasons = classifications
      .map((item, index) => `paragraph ${index + 1}: ${item.classification.reason}`)
      .join(" | ");
    throw new Error(`DeepSeek prompt set does not match current product: ${reasons}`);
  }
  return prompts;
}
