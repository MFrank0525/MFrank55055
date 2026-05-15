import nodejieba from "nodejieba";
import { normalizeTitleText } from "../utils/text.js";

const STOPWORDS = new Set([
  "官方",
  "旗舰",
  "旗舰店",
  "店",
  "款",
  "这个",
  "那个",
  "真的",
  "可以",
  "安排",
  "需要",
  "推荐",
  "首选",
  "在家",
  "出门",
  "方便",
  "便宜",
  "简单",
  "操作",
  "结果",
  "准确",
  "关键",
  "日常",
  "必备",
  "健康",
  "医疗器械",
  "测量方法",
  "携带方便",
  "孝敬父母",
  "爷爷奶奶",
  "高血压",
  "使用",
  "适用",
  "可用",
  "家里",
  "一个人",
  "赶紧"
]);

export function tokenizeTitles(titles: string[]): string[][] {
  return titles.map((title) =>
    nodejieba
      .cut(normalizeTitleText(title))
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && token.length <= 8 && !/^\d+$/.test(token) && !STOPWORDS.has(token))
  );
}
