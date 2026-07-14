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
  return /\brequest(?:\s+(?:body|payload|parameters?))?\b|\bpayload\b|请求体|请求参数/iu.test(text);
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
        /自动(?:循环|重复|再次|重新)提交|自动重提|自动(?:重放|回放)|automatically\s+(?:repeat(?:ed|ing)?\s+submissions?|re-?submit(?:ted)?|submit(?:s|ted|ting)?\s+again|replayed)|auto(?:matically)?\s+replay(?:ed)?|automatic\s+repeated\s+(?:paid\s+)?submission/iu
      );
      for (const match of affirmativeMatches(text, paidImageReplayMatches)) {
        findings.push(finding("automatic repeated paid submission", item, clause));
      }
      for (const match of affirmativeMatches(text, matchPositiveProviderChanges(text, clause.context))) {
        findings.push(finding("replaceable paid-image provider wording", item, clause));
      }
      const ledgerContext = text;
      const historicalLedgerTopic =
        /付费账本|paid[- ]image[- ]ledger|runtime[- ]ledger/iu.test(ledgerContext) &&
        /历史|旧|historical|legacy/iu.test(ledgerContext);
      const historicalLedgerMatches = historicalLedgerTopic
        ? findAllMatches(
            text,
            /(?:支持|supports?)[^；;。！？!?，,|]{0,80}(?:迁移|导入|兼容|migrat(?:e|ion)|import|compatib(?:le|ility))|迁移|导入|兼容|migrat(?:e|ion)|import|compatib(?:le|ility)/iu
          )
        : [];
      for (const match of affirmativeMatches(text, historicalLedgerMatches)) {
        findings.push(finding("historical paid-ledger migration instruction", item, clause));
      }
    }
  }
  return findings;
}

export function hasCanonicalProviderRuleItem(markdown) {
  return splitMarkdownRuleItems(markdown).some(({ text, context }) => {
    const affirmative = (pattern) => affirmativeMatches(text, findAllMatches(text, pattern)).length > 0;
    const soleProviderAssignments = affirmativeMatches(
      text,
      findAllMatches(
        text,
        /(?:主图|生图|图片|图像)?\s*(?:唯一(?:有效)?(?:的)?|仅限|只允许)\s*(?:provider(?:\s+family)?|供应商)\s*(?:是|为|=)\s*`?([\p{L}\p{N}._-]+)`?|(?:sole|only|exclusive)\s+(?:(?:main[- ]?)?image\s+)?provider(?:\s+family)?\s*(?:is|=|:)\s*`?([\p{L}\p{N}._-]+)`?/iu
      )
    );
    const soleProviderValues = soleProviderAssignments.map((match) => match[1] || match[2]);
    const soleCanonicalProvider = soleProviderValues.some(
      (provider) => provider.toLowerCase() === "openai-compatible"
    );
    const canonicalModel = affirmative(
      /(?:模型|model)\s*(?:固定)?\s*(?:是|为|=|:)\s*`?gpt-image-2`?/iu
    );
    const canonicalMode = affirmative(
      /(?:模式|mode)\s*(?:固定)?\s*(?:是|为|=|:)\s*`?videos-base64`?/iu
    );
    const canonicalEndpoint = affirmative(
      /(?:接口|路径|endpoint|path)\s*(?:必须)?\s*(?:精确)?\s*(?:是|为|=|:)\s*`?\/v1\/videos`?/iu
    );
    const alternativesForbidden = affirmative(
      /不存在(?:任何)?(?:其他|替代)(?:的)?\s*(?:provider|供应商|兼容入口)|禁止(?:任何)?(?:其他|替代)(?:的)?\s*(?:provider|供应商|兼容入口)|(?:no|without)\s+(?:other|alternate|alternative)\s+(?:image\s+)?(?:provider|endpoint|entry)|(?:other|alternate|alternative)\s+(?:image\s+)?(?:providers?|endpoints?|entries)\s+(?:are\s+)?forbidden/iu
    );
    const wrongSoleProvider = soleProviderValues.some(
      (provider) => provider.toLowerCase() !== "openai-compatible"
    );
    const canonicalComponentDisabled = /(?:OpenAI-compatible|gpt-image-2|videos-base64|\/v1\/videos)[^，,；;。]{0,24}(?:已?禁用|停用|不可用|disabled|deactivated|not\s+(?:enabled|used|allowed))|(?:不使用|不得使用|禁止使用|must\s+not\s+use|do\s+not\s+use)[^，,；;。]{0,24}(?:OpenAI-compatible|gpt-image-2|videos-base64|\/v1\/videos)/iu.test(
      text
    );
    const canonicalFieldNegated = /(?:provider|供应商|模型|model|模式|mode|接口|路径|endpoint|path)[^，,；;。]{0,20}(?:不(?:得|能|可|应|允许)?(?:再)?(?:是|为|使用|启用)?|禁止(?:使用|设为)?|(?:is|are|must|should|can)?\s*not\s+(?:be|use|allow)?|cannot|can't)[^，,；;。]{0,20}(?:OpenAI-compatible|gpt-image-2|videos-base64|\/v1\/videos)/iu.test(
      text
    );
    const noContradiction = findObsoleteProviderContradictions(text).length === 0;
    return (
      context.image &&
      soleCanonicalProvider &&
      canonicalModel &&
      canonicalMode &&
      canonicalEndpoint &&
      alternativesForbidden &&
      !wrongSoleProvider &&
      !canonicalComponentDisabled &&
      !canonicalFieldNegated &&
      noContradiction
    );
  });
}

function splitArtifactSemanticClauses(text) {
  return text
    .split(
      /(?:；|;|。|\.(?=\s|$)|,?\s+(?:while|whereas|but|however)\s+|但(?:是)?|而)/iu
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function hasOnlySyntacticTail(text) {
  const residue = text
    .replace(/[\s`*_、，,：:()（）\[\]{}-]+/gu, "")
    .replace(/均|都|必须|需要|应|一律|统一|并|且|are|is|must|shall|need|to|be|and/giu, "");
  return residue.length === 0;
}

const ARTIFACT_PERSISTENCE_ACTION = /持久(?:化)?|落盘|保存|persist(?:ed|ence)?|sav(?:e|ed)|writ(?:e|ten)/iu;

function clausePersistsArtifactClasses(clause, artifactPatterns) {
  const actions = findAllMatches(clause, ARTIFACT_PERSISTENCE_ACTION);
  const positiveActions = affirmativeMatches(clause, actions);
  if (actions.length === 0 || positiveActions.length !== actions.length) {
    return false;
  }
  const artifactMatches = artifactPatterns
    .map((artifactPattern) => findAllMatches(clause, artifactPattern)[0])
    .filter(Boolean)
    .sort((left, right) => left.index - right.index);
  if (artifactMatches.length !== artifactPatterns.length) {
    return false;
  }
  const lastArtifact = artifactMatches[artifactMatches.length - 1];
  const listEnd = lastArtifact.index + lastArtifact[0].length;
  return positiveActions.some((action) => {
    if (action.index >= listEnd) {
      return hasOnlySyntacticTail(clause.slice(listEnd, action.index));
    }
    return false;
  });
}

function clauseNegatesArtifactPersistence(clause, artifactPatterns) {
  if (!artifactPatterns.some((artifactPattern) => artifactPattern.test(clause))) {
    return false;
  }
  const actions = findAllMatches(clause, ARTIFACT_PERSISTENCE_ACTION);
  return affirmativeMatches(clause, actions).length < actions.length;
}

export function hasProviderArtifactPersistenceRuleItem(markdown) {
  return splitMarkdownRuleItems(markdown).some(({ text }) => {
    const artifactClasses = [
      /(?:provider\s+)?task\s+ID|任务\s*ID/iu,
      /response-XX\.json/iu,
      /response-XX-status-N\.json/iu
    ];
    const clauses = splitArtifactSemanticClauses(text);
    if (clauses.some((clause) => clauseNegatesArtifactPersistence(clause, artifactClasses))) {
      return false;
    }
    const completeListClause = clauses.some(
      (clause) => clausePersistsArtifactClasses(clause, artifactClasses)
    );
    if (completeListClause) {
      return true;
    }
    return artifactClasses.every((artifactPattern) =>
      clauses.some((clause) => clausePersistsArtifactClasses(clause, [artifactPattern]))
    );
  });
}
