const RULE_ITEM_START = /^\s*(?:[-*+]\s+|\d+(?:\.\d+)*[.)]\s+)/u;
const HEADING = /^\s*#{1,6}\s+/u;
const TABLE_ROW = /^\s*\|.*\|\s*$/u;

function normalizeRuleItem(text) {
  return text.replace(RULE_ITEM_START, "").replace(/\s+/gu, " ").trim();
}

function hasImageContext(text) {
  return /主图|生图|图片|图像|paid[- ]?image|main[- ]?image|image\s+(?:provider|model|request)/iu.test(text);
}

function hasProviderContext(text) {
  return /provider|供应商|中转站|模型|model/iu.test(text);
}

function hasRequestContext(text) {
  return /request(?:\s+(?:body|payload|parameters?))?|请求(?:体|参数)?|生图请求|provider\s+request/iu.test(text);
}

function splitClauses(text) {
  return text
    .split(/(?:\||[；;。！？!?，,]|\s+(?:and|but|while|whereas|however|yet)\s+|而|但(?:是)?|并且|同时|且|以及)/iu)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function isLocallyNegated(text, matchIndex, scopeStart = 0) {
  const localText = text.slice(Math.max(scopeStart, matchIndex - 64), matchIndex);
  const matchNeighborhood = text.slice(Math.max(0, matchIndex - 8), matchIndex + 20);
  if (/non-?(?:replaceable|pluggable|switchable)/iu.test(matchNeighborhood)) {
    return true;
  }
  return /(?:禁止|不得|不允许|不可|严禁|不能|不应|不(?:存在|导入|迁移|扫描|提供|使用|支持|更换|切换|替换|自动))[^；;。！？!?，,|]{0,40}$|不\s*$|(?:must\s+not|never|do\s+not|does\s+not|should\s+not|cannot|can't|not\s+(?:be\s+)?|no\s+(?:automatic|legacy|alternate))[^.;,|]{0,48}$/iu.test(
    localText
  );
}

function findAllMatches(text, pattern) {
  const flags = [...new Set(`${pattern.flags}g`.split(""))].join("");
  return [...text.matchAll(new RegExp(pattern.source, flags))];
}

function affirmativeMatches(text, matches) {
  const affirmative = [];
  let scopeStart = 0;
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const previousMatch = matches[index - 1];
    if (previousMatch) {
      const bridge = text.slice(previousMatch.index + previousMatch[0].length, match.index);
      if (!/^\s*(?:或(?:者)?|or\b)/iu.test(bridge)) {
        scopeStart = previousMatch.index + previousMatch[0].length;
      }
    }
    if (!isLocallyNegated(text, match.index, scopeStart)) {
      affirmative.push(match);
    }
  }
  return affirmative;
}

function topicActionMatches(text, itemText, topicPattern, actionPattern) {
  return topicPattern.test(`${itemText} ${text}`) ? findAllMatches(text, actionPattern) : [];
}

export function splitMarkdownRuleItems(markdown) {
  const items = [];
  let current = "";
  let sectionContext = "";
  let itemSubjectContext = "";
  let tableSubjectContext = "";
  const flush = () => {
    const text = normalizeRuleItem(current);
    if (text) {
      const contextText = `${sectionContext} ${itemSubjectContext} ${text}`.trim();
      const itemContext = {
        image: hasImageContext(contextText),
        provider: hasProviderContext(contextText),
        request: hasRequestContext(contextText)
      };
      items.push({
        text,
        context: itemContext,
        clauses: splitClauses(text).map((clause) => ({ text: clause, context: itemContext }))
      });
    }
    current = "";
    itemSubjectContext = "";
  };

  for (const rawLine of String(markdown).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (HEADING.test(line)) {
      flush();
      tableSubjectContext = "";
      sectionContext = line.replace(HEADING, "").trim();
      continue;
    }
    if (!line || line.startsWith("```")) {
      flush();
      tableSubjectContext = "";
      continue;
    }
    if (TABLE_ROW.test(rawLine)) {
      flush();
      const rowText = rawLine.replace(/^\s*\||\|\s*$/gu, "").trim();
      const separatorRow = /^(?:\s*:?-+:?\s*\|?)+$/u.test(rowText);
      if (!separatorRow && !tableSubjectContext && (hasImageContext(rowText) || hasProviderContext(rowText))) {
        tableSubjectContext = rowText;
      }
      itemSubjectContext = tableSubjectContext;
      current = rawLine;
      flush();
      continue;
    }
    tableSubjectContext = "";
    if (RULE_ITEM_START.test(rawLine)) {
      flush();
      current = rawLine;
      continue;
    }
    if (current) {
      current += ` ${line}`;
    } else {
      current = line;
    }
  }
  flush();
  return items;
}

function matchPositiveProviderChanges(clause, context) {
  const providerMentioned = context.provider || hasProviderContext(clause);
  if (!providerMentioned) {
    return [];
  }
  const positiveChanges = findAllMatches(
    clause,
    /可替换|可插拔|可切换|支持(?:更换|切换|替换)|允许(?:更换|切换|替换)|可以(?:更换|切换|替换)|允许使用\s*(?:另一(?:个)?|其他|替代)\s*(?:provider|模型)|可改用\s*(?:另一(?:个)?|其他|替代)\s*(?:provider|模型)|(?:更换|切换|替换)\s*(?:图片|主图|生图)?\s*(?:provider|模型)|replaceable|pluggable|switchable|can\s+(?:change|switch|replace)|may\s+(?:change|switch|replace)|supports?\s+(?:changing|switching|replacing)|can\s+use\s+(?:an?\s+)?(?:alternate|other)\s+(?:provider|model)/iu
  );
  const explicitlyNonImage = /标题|title\s+provider|飞书|Feishu|浏览器|browser|data\s+source|数据源/iu.test(clause);
  return context.image || hasImageContext(clause) || !explicitlyNonImage ? positiveChanges : [];
}

function finding(label, item, clause) {
  return { label, item: item.text, clause: clause.text };
}

export function findObsoleteProviderContradictions(markdown) {
  const findings = [];
  for (const item of splitMarkdownRuleItems(markdown)) {
    for (const clause of item.clauses) {
      const text = clause.text;
      for (const match of affirmativeMatches(
        text,
        findAllMatches(text, /\bmode["'`]?\s*(?:=|:)\s*["'`]?edits\b/iu)
      )) {
        findings.push(finding("obsolete image-edit mode", item, clause));
      }
      for (const match of affirmativeMatches(text, findAllMatches(text, /\bquery_result\b/iu))) {
        findings.push(finding("legacy query_result artifact", item, clause));
      }
      for (const match of affirmativeMatches(text, findAllMatches(text, /\bfail_reason\b/iu))) {
        findings.push(finding("legacy fail_reason artifact", item, clause));
      }
      for (const match of affirmativeMatches(text, findAllMatches(text, /\bimagePath\b/iu))) {
        findings.push(finding("legacy imagePath request field", item, clause));
      }
      for (const match of affirmativeMatches(
        text,
        findAllMatches(text, /(?<!metadata\.)\b["'`]?size["'`]?\s*(?:=|:)/iu)
      )) {
        if (clause.context.request) {
          findings.push(finding("legacy top-level size request field", item, clause));
        }
      }
      const paidImageReplayMatches = topicActionMatches(
        text,
        item.text,
        /付费(?:图片|生图)?(?:任务|请求)|paid[- ]image\s+(?:request|task)|paid\s+image\s+(?:request|task)/iu,
        /自动(?:循环|重复)提交|自动重提|自动(?:重放|回放)|automatically\s+(?:repeat(?:ed|ing)?\s+submissions?|re-?submit(?:ted)?|replayed)|auto(?:matically)?\s+replay(?:ed)?|automatic\s+repeated\s+(?:paid\s+)?submission/iu
      );
      for (const match of affirmativeMatches(text, paidImageReplayMatches)) {
        findings.push(finding("automatic repeated paid submission", item, clause));
      }
      for (const match of affirmativeMatches(text, matchPositiveProviderChanges(text, clause.context))) {
        findings.push(finding("replaceable paid-image provider wording", item, clause));
      }
      const historicalLedgerMatches = topicActionMatches(
        text,
        item.text,
        /(?:历史|旧)[^；;。！？!?，,|]{0,48}(?:付费账本|paid[- ]image[- ]ledger|runtime[- ]ledger)|(?:historical|legacy)[^.;,|]{0,80}(?:paid[- ]image|runtime)[- ]ledger/iu,
        /迁移|导入|兼容|migrat(?:e|ion)|import|compatib(?:le|ility)|supports?/iu
      );
      for (const match of affirmativeMatches(text, historicalLedgerMatches)) {
        findings.push(finding("historical paid-ledger migration instruction", item, clause));
      }
    }
  }
  return findings;
}

export function hasCanonicalProviderRuleItem(markdown) {
  return splitMarkdownRuleItems(markdown).some(({ text, context }) => {
    const soleProvider = /唯一|唯一有效|sole|only|canonical/iu.test(text);
    const noAlternate = /唯一|sole|only|不存在其他|没有其他|不得增加替代|no\s+(?:other|alternate)/iu.test(text);
    return (
      context.image &&
      soleProvider &&
      noAlternate &&
      /OpenAI-compatible/iu.test(text) &&
      /gpt-image-2/iu.test(text) &&
      /videos-base64/iu.test(text) &&
      /\/v1\/videos/iu.test(text)
    );
  });
}

export function hasProviderArtifactPersistenceRuleItem(markdown) {
  return splitMarkdownRuleItems(markdown).some(
    ({ text }) =>
      /(?:provider\s+)?task\s+ID|任务\s*ID/iu.test(text) &&
      /response-XX\.json/iu.test(text) &&
      /response-XX-status-N\.json/iu.test(text) &&
      /持久|persist|落盘|保存/iu.test(text)
  );
}
