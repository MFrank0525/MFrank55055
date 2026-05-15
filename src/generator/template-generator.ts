import type { AnalysisResult, GeneratedTitle, ProductInput } from "../types/index.js";
import { compactText } from "../utils/text.js";

const MAX_TITLE_LENGTH = 60;
const MIN_TITLE_LENGTH = 48;

const TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/^家庭日常监测$/g, "家庭监测"],
  [/^中老年监测$/g, "中老年适用"],
  [/^大屏读数$/g, "大屏读数清晰"],
  [/^精准监测$/g, "精准测量"],
  [/^日常测量$/g, "日常使用"],
  [/^家用款$/g, "家用"],
  [/^居家监测$/g, "居家使用"]
];

function cleanSegment(term?: string): string {
  let text = compactText(term || "").replace(/[#]/g, "");
  for (const [pattern, replacement] of TERM_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function uniqTerms(terms: Array<string | undefined>): string[] {
  const output: string[] = [];
  for (const raw of terms) {
    const term = cleanSegment(raw);
    if (!term) continue;
    if (/^(告别|自己|绑带|老爸|评测|水银|血压|测血压|什么|哪个|最好|排名|推荐|原理|方法|校准)$/.test(term)) {
      continue;
    }
    if (output.some((item) => item === term || item.includes(term) || term.includes(item))) continue;
    output.push(term);
  }
  return output;
}

function pick(terms: string[], fallback = ""): string {
  return uniqTerms(terms)[0] || fallback;
}

function buildTitleByBuckets(buckets: Array<Array<string | undefined>>): string {
  const titleTerms: string[] = [];

  for (const bucket of buckets) {
    for (const term of uniqTerms(bucket)) {
      if (titleTerms.some((item) => item === term || item.includes(term) || term.includes(item))) continue;
      if (`${titleTerms.join("")}${term}`.length > MAX_TITLE_LENGTH) continue;
      titleTerms.push(term);
      break;
    }
  }

  const flattenedFallback = uniqTerms(buckets.flat());
  for (const term of flattenedFallback) {
    if (titleTerms.some((item) => item === term || item.includes(term) || term.includes(item))) continue;
    if (`${titleTerms.join("")}${term}`.length > MAX_TITLE_LENGTH) continue;
    titleTerms.push(term);
    if (titleTerms.join("").length >= MIN_TITLE_LENGTH) break;
  }

  return titleTerms.join("").slice(0, MAX_TITLE_LENGTH);
}

function createTitle(
  title: string,
  type: GeneratedTitle["type"],
  usedTerms: string[],
  explanation: string,
  score: number
): GeneratedTitle {
  return {
    title: compactText(title).slice(0, MAX_TITLE_LENGTH),
    type,
    score,
    usedTerms: uniqTerms(usedTerms),
    riskFlags: [],
    explanation
  };
}

export function generateTitlesByTemplate(product: ProductInput, analysis: AnalysisResult): GeneratedTitle[] {
  const classified = analysis.classifiedTerms || {};
  const core = cleanSegment(product.productName);
  const coreTerms = uniqTerms([core, ...(classified.core || [])]);
  const featureTerms = uniqTerms([...(product.coreFeatures || []), ...(classified.function || [])]);
  const peopleTerms = uniqTerms([...(product.targetPeople || []), ...(classified.people || [])]);
  const sceneTerms = uniqTerms([...(product.usageScenarios || []), ...(classified.scene || [])]);
  const specTerms = uniqTerms([...(product.specs || []), ...(classified.spec || [])]);
  const preferredTerms = uniqTerms([...(product.preferredTerms || []), ...analysis.highFreqTerms]);
  const suggestionTerms = uniqTerms(analysis.suggestionTerms || []);
  const promotionTerms = uniqTerms([...(analysis.promotionTerms || []), ...(product.imageSearchHotTerms || [])]);
  const primaryCore = pick(coreTerms, core);
  const primaryFeature = pick(featureTerms, pick(preferredTerms));
  const secondaryFeature = pick(featureTerms.slice(1), pick(preferredTerms.slice(1)));
  const primaryPeople = pick(peopleTerms, pick(preferredTerms.slice(2)));
  const primaryScene = pick(sceneTerms, pick(preferredTerms.slice(3), "居家"));
  const primarySpec = pick(specTerms);
  const longTailA = pick(suggestionTerms, pick(promotionTerms));
  const longTailB = pick(suggestionTerms.slice(1), pick(promotionTerms.slice(1)));
  const longTailC = pick(promotionTerms.slice(2), pick(preferredTerms.slice(4)));
  const extraTailTerms = uniqTerms([
    ...promotionTerms,
    ...suggestionTerms,
    ...(product.imageSearchHotTerms || []),
    ...featureTerms.slice(2),
    ...peopleTerms.slice(1),
    ...sceneTerms.slice(1),
    ...specTerms.slice(1)
  ]).filter((term) => term && term !== primaryCore);

  return [
    createTitle(
      buildTitleByBuckets([
        [primaryCore],
        [primarySpec, "家用"],
        [primaryPeople, "爸妈适用", "中老年适用"],
        [primaryFeature, "大屏显示"],
        [secondaryFeature, "语音播报"],
        [primaryScene, "居家使用"],
        [longTailA, "家庭常备"],
        [longTailB, "精准测量"],
        extraTailTerms
      ]),
      "search",
      [primarySpec, primaryPeople, primaryFeature, secondaryFeature, primaryScene, longTailA, longTailB, ...extraTailTerms],
      "品类词前置，叠加规格、人群、功能和搜索联想词",
      86
    ),
    createTitle(
      buildTitleByBuckets([
        [primaryPeople, "爸妈适用", "中老年适用"],
        [primaryScene, "居家使用"],
        [primaryCore],
        [primarySpec, "家用"],
        [primaryFeature, "大屏显示"],
        [secondaryFeature, "语音播报"],
        [longTailA, "家庭常备"],
        [longTailC, "精准测量"],
        extraTailTerms
      ]),
      "search",
      [primaryPeople, primaryScene, primaryFeature, secondaryFeature, longTailA, longTailC, ...extraTailTerms],
      "贴近抖音搜索习惯，融合宣传热词和场景词",
      83
    ),
    createTitle(
      buildTitleByBuckets([
        [primaryCore],
        [primaryScene, "居家使用"],
        [primaryPeople, "爸妈适用"],
        [primaryFeature, "大屏显示"],
        [secondaryFeature, "语音播报"],
        [primarySpec, "家用"],
        [longTailA, "家庭常备"],
        [longTailB, "精准测量"],
        extraTailTerms
      ]),
      "balanced",
      [primaryScene, primaryFeature, secondaryFeature, primaryPeople, longTailA, longTailB, ...extraTailTerms],
      "兼顾搜索覆盖、卖点完整度和长尾热词",
      80
    ),
    createTitle(
      buildTitleByBuckets([
        [primaryCore],
        [primaryPeople, "爸妈适用"],
        [primaryScene, "居家使用"],
        [primarySpec, "家用"],
        [primaryFeature, "大屏显示"],
        [secondaryFeature, "语音播报"],
        [longTailA, "家庭常备"],
        [longTailC, "精准测量"],
        extraTailTerms
      ]),
      "conversion",
      [primaryPeople, primaryScene, primaryFeature, secondaryFeature, longTailA, longTailC, ...extraTailTerms],
      "强化目标人群、购买场景和高频宣传词",
      78
    ),
    createTitle(
      buildTitleByBuckets([
        [primaryCore],
        [primarySpec, "家用"],
        [primaryScene, "居家使用"],
        [primaryPeople, "爸妈适用"],
        [primaryFeature, "大屏显示"],
        [secondaryFeature, "语音播报"],
        [longTailA, "家庭常备"],
        ["精准测量"],
        extraTailTerms
      ]),
      "compliance",
      [primarySpec, primaryScene, primaryFeature, secondaryFeature, longTailA, ...extraTailTerms],
      "使用客观描述，保留规格、场景和热搜长尾词",
      76
    ),
    createTitle(
      buildTitleByBuckets([
        [primaryCore],
        [pick(preferredTerms.slice(0, 2)), primarySpec, "家用"],
        [primaryPeople, "爸妈适用"],
        [primaryFeature, "大屏显示"],
        [secondaryFeature, "语音播报"],
        [longTailA, "家庭常备"],
        [longTailB, "中老年适用"],
        [longTailC, "精准测量"],
        extraTailTerms
      ]),
      "search",
      [pick(preferredTerms.slice(0, 2)), primaryFeature, primaryPeople, longTailA, longTailB, longTailC, ...extraTailTerms],
      "吸收竞品高频检索词，尽量把标题拉长到接近 60 字",
      74
    )
  ];
}
