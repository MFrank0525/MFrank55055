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
  return /request(?:\s+(?:body|payload|parameters?))?|\b(?:payload|input)\b|请求(?:体|参数)?|输入(?:体|参数|图)?|生图请求|provider\s+request/iu.test(text);
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

function isInsideJsonMetadataObject(text, targetIndex) {
  for (const metadataMatch of findAllMatches(text, /["']?metadata["']?\s*:\s*\{/iu)) {
    const objectStart = metadataMatch.index + metadataMatch[0].lastIndexOf("{");
    let depth = 0;
    for (let index = objectStart; index < text.length; index += 1) {
      if (text[index] === "{") {
        depth += 1;
      } else if (text[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          if (targetIndex > objectStart && targetIndex < index) {
            return true;
          }
          break;
        }
      }
    }
  }
  return false;
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
    /可替换|可更换|可插拔|可切换|支持(?:更换|切换|替换)|允许(?:更换|切换|替换)|可以(?:更换|切换|替换)|允许使用\s*(?:另一(?:个)?|其他|替代)\s*(?:provider|模型)|可改用\s*(?:另一(?:个)?|其他|替代)\s*(?:provider|模型)|(?:更换|切换|替换)\s*(?:图片|主图|生图)?\s*(?:provider|模型)|replaceable|interchangeable|pluggable|switchable|can\s+(?:change|switch|replace)|may\s+(?:change|switch|replace)|supports?\s+(?:changing|switching|replacing)|can\s+use\s+(?:an?\s+)?(?:alternate|other)\s+(?:provider|model)/iu
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
        if (clause.context.request) {
          findings.push(finding("legacy imagePath request field", item, clause));
        }
      }
      for (const match of affirmativeMatches(
        text,
        findAllMatches(text, /(?<!metadata\.)\b["'`]?size["'`]?\s*(?:=|:)/iu)
      )) {
        if (clause.context.request && !isInsideJsonMetadataObject(text, match.index)) {
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
        /(?:历史|旧)[^；;。！？!?，,|]{0,80}(?:付费账本|paid[- ]image[- ]ledger|runtime[- ]ledger)|(?:付费账本|paid[- ]image[- ]ledger)[^；;。！？!?，,|]{0,80}(?:历史|旧|historical|legacy)[^；;。！？!?，,|]{0,24}runtime|(?:historical|legacy)[^.;,|]{0,80}(?:paid[- ]image|runtime)[- ]ledger|paid[- ]image[- ]ledger[^.;,|]{0,80}(?:historical|legacy)[^.;,|]{0,24}runtime/iu,
        /(?:支持|supports?)[^；;。！？!?，,|]{0,80}(?:迁移|导入|兼容|migrat(?:e|ion)|import|compatib(?:le|ility))|迁移|导入|兼容|migrat(?:e|ion)|import|compatib(?:le|ility)/iu
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
    const soleProvider =
      /(?:唯一(?:有效)?(?:的)?|仅限|只允许|sole|only|exclusive)[^，,；;。]{0,24}(?:provider|模型|模式|路径|接口|contract)|(?:provider|模型|模式|路径|接口|contract)[^，,；;。]{0,24}(?:唯一|仅限|只允许|sole|only|exclusive)/iu.test(
        text
      );
    const noContradiction = findObsoleteProviderContradictions(text).length === 0;
    return (
      context.image &&
      soleProvider &&
      noContradiction &&
      /OpenAI-compatible/iu.test(text) &&
      /gpt-image-2/iu.test(text) &&
      /videos-base64/iu.test(text) &&
      /\/v1\/videos/iu.test(text)
    );
  });
}

function splitPersistenceStatements(text) {
  return text
    .split(/(?:；|;|。|\.(?=\s|$))/u)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function artifactClassHasPositivePersistence(text, artifactPattern) {
  const persistencePattern = /持久(?:化)?|落盘|保存|persist(?:ed|ence)?|sav(?:e|ed)|writ(?:e|ten)/iu;
  return splitPersistenceStatements(text).some((statement) => {
    const artifactMatches = findAllMatches(statement, artifactPattern);
    if (artifactMatches.length === 0) {
      return false;
    }
    const actions = findAllMatches(statement, persistencePattern);
    return artifactMatches.some((artifactMatch) => {
      const commaSegments = statement.split(/[，,]/u);
      let offset = 0;
      let artifactSegment;
      for (const segment of commaSegments) {
        const end = offset + segment.length;
        if (artifactMatch.index >= offset && artifactMatch.index <= end) {
          artifactSegment = { text: segment, offset };
          break;
        }
        offset = end + 1;
      }
      const localActions = artifactSegment
        ? findAllMatches(artifactSegment.text, persistencePattern).map((match) => ({
            ...match,
            index: match.index + artifactSegment.offset
          }))
        : [];
      const candidates = localActions.length > 0 ? localActions : actions;
      const closest = candidates
        .filter((action) => !isLocallyNegated(statement, action.index))
        .sort(
          (left, right) =>
            Math.abs(left.index - artifactMatch.index) - Math.abs(right.index - artifactMatch.index)
        )[0];
      if (!closest) {
        return false;
      }
      const nearerNegated = candidates.some(
        (action) =>
          isLocallyNegated(statement, action.index) &&
          Math.abs(action.index - artifactMatch.index) < Math.abs(closest.index - artifactMatch.index)
      );
      return !nearerNegated;
    });
  });
}

export function hasProviderArtifactPersistenceRuleItem(markdown) {
  return splitMarkdownRuleItems(markdown).some(({ text }) => {
    const taskPersisted = artifactClassHasPositivePersistence(text, /(?:provider\s+)?task\s+ID|任务\s*ID/iu);
    const submitResponsePersisted = artifactClassHasPositivePersistence(text, /response-XX\.json/iu);
    const statusResponsePersisted = artifactClassHasPositivePersistence(text, /response-XX-status-N\.json/iu);
    return taskPersisted && submitResponsePersisted && statusResponsePersisted;
  });
}
