import fs from "node:fs";
import path from "node:path";
import { formatTimestamp, sanitizeFileName } from "./paths.js";
import type { SaveTitlesOptions, SaveTitlesResult, TitleRow } from "./types.js";

function normalizeLine(line: string): string {
  return line.replace(/\r/g, "").trim();
}

function cleanTitle(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\*\*/g, "")
    .replace(/本回答由AI生成[\s\S]*$/i, "")
    .replace(/参考资料[\s\S]*$/i, "")
    .replace(/\s+/g, "")
    .trim();
}

function looksLikeNoise(value: string): boolean {
  return /严格执行|输出格式|请生成|本回答由AI生成|表格|序号|标题|分析这张白底图|卖点|快问快答|超能模式|PPT生成|图像生成|帮我写作|更多/.test(
    value
  );
}

function isLikelyTitle(value: string): boolean {
  if (!value) {
    return false;
  }
  if (value.length < 4 || value.length > 80) {
    return false;
  }
  if (/^(序号|标题|表格|markdown)$/i.test(value) || looksLikeNoise(value)) {
    return false;
  }
  return /[\u4e00-\u9fa5A-Za-z0-9]/.test(value);
}

function extractContinuousNumberSequence(text: string, titleCount: number): TitleRow[] {
  const normalized = text.replace(/\r/g, "\n");
  const matcher = /(\d{1,3})\s+([\s\S]*?)(?=(\d{1,3})\s+|$)/g;
  const tokens: TitleRow[] = [];
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(normalized)) !== null) {
    const index = String(Number(match[1]));
    const title = cleanTitle(match[2] || "");
    if (!isLikelyTitle(title)) {
      continue;
    }
    tokens.push({ index, title });
  }

  const candidates: TitleRow[][] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    if (tokens[start].index !== "1") {
      continue;
    }
    const block: TitleRow[] = [tokens[start]];
    let expected = 2;
    for (let index = start + 1; index < tokens.length && expected <= titleCount; index += 1) {
      if (tokens[index].index !== String(expected)) {
        break;
      }
      block.push(tokens[index]);
      expected += 1;
    }
    if (block.length === titleCount) {
      candidates.push(block);
    }
  }

  return candidates.at(-1) || [];
}

function finalizeBlock(block: TitleRow[], titleCount: number, candidates: TitleRow[][]): void {
  if (block.length === titleCount) {
    candidates.push([...block]);
  }
}

function extractNumberedBlocks(lines: string[], titleCount: number): TitleRow[] {
  const candidates: TitleRow[][] = [];
  let current: TitleRow[] = [];
  let expected = 1;

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    const match = line.match(/^(?:[-*]\s*)?(\d{1,3})[\.\)、\s\t|]+(.+)$/);
    if (!match) {
      finalizeBlock(current, titleCount, candidates);
      current = [];
      expected = 1;
      continue;
    }

    const number = Number(match[1]);
    const title = cleanTitle(match[2]);
    if (!isLikelyTitle(title)) {
      continue;
    }

    if (number === 1) {
      finalizeBlock(current, titleCount, candidates);
      current = [{ index: "1", title }];
      expected = 2;
      continue;
    }

    if (current.length > 0 && number === expected) {
      current.push({ index: String(number), title });
      expected += 1;
      if (current.length === titleCount) {
        candidates.push([...current]);
        current = [];
        expected = 1;
      }
      continue;
    }

    finalizeBlock(current, titleCount, candidates);
    current = [];
    expected = 1;
  }

  finalizeBlock(current, titleCount, candidates);
  return candidates.at(-1) || [];
}

function extractMarkdownTable(lines: string[], titleCount: number): TitleRow[] {
  const rows: TitleRow[] = [];
  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line.startsWith("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    if (cells.length < 2) {
      continue;
    }
    if (/^-+$/.test(cells[0].replace(/:/g, "")) || /^序号$/i.test(cells[0]) || /^标题$/i.test(cells[1])) {
      continue;
    }
    if (!/^\d{1,3}$/.test(cells[0])) {
      continue;
    }
    const title = cleanTitle(cells[1]);
    if (!isLikelyTitle(title)) {
      continue;
    }
    rows.push({ index: String(Number(cells[0])), title });
  }

  if (rows.length < titleCount) {
    return [];
  }
  return rows.slice(-titleCount);
}

function extractCsvStyle(lines: string[], titleCount: number): TitleRow[] {
  const rows: TitleRow[] = [];
  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    const match = line.match(/^"?(?<index>\d{1,3})"?,(?<title>".*"|[^,]+)$/);
    if (!match?.groups?.title) {
      continue;
    }
    const title = cleanTitle(match.groups.title.replace(/""/g, '"'));
    if (!isLikelyTitle(title)) {
      continue;
    }
    rows.push({ index: String(Number(match.groups.index)), title });
  }

  if (rows.length < titleCount) {
    return [];
  }
  return rows.slice(-titleCount);
}

function extractLooseTail(lines: string[], titleCount: number): TitleRow[] {
  const tail = lines
    .map((line) => cleanTitle(line))
    .filter(isLikelyTitle)
    .slice(-titleCount);

  if (tail.length !== titleCount) {
    return [];
  }

  return tail.map((title, index) => ({
    index: String(index + 1),
    title
  }));
}

function extractRows(text: string, titleCount: number): TitleRow[] {
  const sequence = extractContinuousNumberSequence(text, titleCount);
  if (sequence.length === titleCount) {
    return sequence;
  }

  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  const numbered = extractNumberedBlocks(lines, titleCount);
  if (numbered.length === titleCount) {
    return numbered;
  }

  const markdown = extractMarkdownTable(lines, titleCount);
  if (markdown.length === titleCount) {
    return markdown;
  }

  const csvStyle = extractCsvStyle(lines, titleCount);
  if (csvStyle.length === titleCount) {
    return csvStyle;
  }

  const loose = extractLooseTail(lines, titleCount);
  if (loose.length === titleCount) {
    return loose;
  }

  return [];
}

function extractStrictNumberedLines(text: string, titleCount: number): TitleRow[] {
  const lines = text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: TitleRow[] = [];
  for (const line of lines) {
    const match = line.match(/^(?<index>\d{1,2})\s+(?<title>.+)$/);
    if (!match?.groups?.index || !match.groups.title) {
      continue;
    }
    const index = String(Number(match.groups.index));
    const title = cleanTitle(match.groups.title);
    if (!isLikelyTitle(title)) {
      continue;
    }
    rows.push({ index, title });
  }

  const candidates: TitleRow[][] = [];
  for (let start = 0; start < rows.length; start += 1) {
    if (rows[start].index !== "1") {
      continue;
    }
    const block: TitleRow[] = [rows[start]];
    let expected = 2;
    for (let index = start + 1; index < rows.length && expected <= titleCount; index += 1) {
      if (rows[index].index !== String(expected)) {
        break;
      }
      block.push(rows[index]);
      expected += 1;
    }
    if (block.length === titleCount) {
      candidates.push(block);
    }
  }

  return candidates.at(-1) || [];
}

function isolateLatestReplyText(text: string, promptText?: string): string {
  if (!promptText?.trim()) {
    return text;
  }

  const normalizedText = text.replace(/\r/g, "\n");
  const normalizedPrompt = promptText.trim().replace(/\r/g, "\n");
  const exactIndex = normalizedText.lastIndexOf(normalizedPrompt);
  if (exactIndex >= 0) {
    return normalizedText.slice(exactIndex + normalizedPrompt.length).trim();
  }

  const promptLines = normalizedPrompt.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const anchor = [...promptLines].reverse().find((line) => line.length >= 8);
  if (!anchor) {
    return normalizedText;
  }

  const anchorIndex = normalizedText.lastIndexOf(anchor);
  if (anchorIndex >= 0) {
    return normalizedText.slice(anchorIndex + anchor.length).trim();
  }

  return normalizedText;
}

function inferProductName(rows: TitleRow[]): string {
  const suffixes = rows
    .map((row) => row.title.match(/([\u4e00-\u9fa5A-Za-z0-9]+)延草纲目$/)?.[1] || "")
    .filter(Boolean);

  const frequency = new Map<string, number>();
  for (const suffix of suffixes) {
    for (let start = 0; start < suffix.length; start += 1) {
      for (let end = start + 2; end <= suffix.length; end += 1) {
        const token = suffix.slice(start, end);
        if (!/^[\u4e00-\u9fa5A-Za-z0-9]+$/.test(token)) {
          continue;
        }
        frequency.set(token, (frequency.get(token) || 0) + 1);
      }
    }
  }

  const ranked = [...frequency.entries()]
    .filter(([, count]) => count >= Math.max(3, Math.ceil(rows.length / 2)))
    .filter(([token]) => token.length >= 3 && token.length <= 12)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0].length - a[0].length;
    });

  const preferred = ranked.find(([token]) => /凝胶|贴膏|乳膏|喷剂|喷雾|药膏|冷敷贴|抑菌液|敷料|眼周贴/.test(token));
  if (preferred) {
    return preferred[0];
  }

  const fallback = rows[0]?.title.slice(-12) || "豆包标题";
  return fallback.replace(/延草纲目$/, "") || "豆包标题";
}

export function saveTitlesFromRaw(options: SaveTitlesOptions): SaveTitlesResult {
  const titleCount = options.titleCount ?? 12;
  if (!fs.existsSync(options.rawFile)) {
    throw new Error(`Raw file not found: ${options.rawFile}`);
  }
  if (!fs.existsSync(options.outputDir)) {
    throw new Error(`Output dir not found: ${options.outputDir}`);
  }

  const text = fs.readFileSync(options.rawFile, "utf8");
  const isolatedText = isolateLatestReplyText(text, options.promptText);
  const strictRows = extractStrictNumberedLines(isolatedText, titleCount);
  const isolatedRows = strictRows.length === titleCount ? strictRows : extractRows(isolatedText, titleCount);
  const rows = isolatedRows.length === titleCount ? isolatedRows : extractRows(text, titleCount);
  if (rows.length !== titleCount) {
    throw new Error(`Could not isolate exactly ${titleCount} generated titles, got ${rows.length}`);
  }

  const productName = sanitizeFileName(inferProductName(rows));
  const timestamp = formatTimestamp(options.timestamp);
  const baseName = `${productName}-${timestamp}`;
  const csvFile = path.join(options.outputDir, `${baseName}.csv`);
  const csv = ["序号,标题", ...rows.map((row) => `${JSON.stringify(row.index)},${JSON.stringify(row.title)}`)].join("\n");

  fs.writeFileSync(csvFile, `${csv}\n`, "utf8");

  return {
    productName,
    titleCount: rows.length,
    csvFile,
    titles: rows
  };
}
