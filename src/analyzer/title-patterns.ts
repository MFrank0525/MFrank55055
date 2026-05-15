import { compactText } from "../utils/text.js";

export function extractTitlePatterns(titles: string[]): string[] {
  const patterns = new Set<string>();
  for (const title of titles.slice(0, 20)) {
    const text = compactText(title);
    if (/(家用|居家|家庭).*(血压计|凝胶|喷雾|理疗仪).*(大屏|语音|便携|远红外|精准)/.test(text)) {
      patterns.add("核心品类词 + 场景词 + 功能词");
    }
    if (/(老人|中老年|爸妈|成人).*(血压计|凝胶|喷雾|理疗仪).*(便携|大屏|语音|热敷|精准)/.test(text)) {
      patterns.add("核心品类词 + 人群词 + 卖点词");
    }
    if (/(上臂式|腕式|20g|30g|60g).*(血压计|凝胶|喷雾|理疗仪).*(家用|居家|随身|日常)/.test(text)) {
      patterns.add("核心品类词 + 规格词 + 场景词");
    }
  }
  if (!patterns.size) {
    patterns.add("核心品类词 + 功能词 + 人群词");
  }
  return [...patterns];
}
