/**
 * 诊断匹配模块（第 1 轮）
 * 关键词 + 故障码精确命中 + 部件加权。
 * 知识 JSON 不动；第 5 轮可替换本文件。
 */

const STOPWORDS = new Set([
  "故障",
  "报过",
  "出现",
  "一下",
  "什么",
  "怎么",
  "排查",
  "机组",
  "风机",
  "请",
  "帮我",
  "一下",
  "一个",
  "这个",
  "那个",
  "还有",
  "以及",
  "或者",
  "然后",
  "已经",
  "可能",
  "感觉",
  "发现",
  "报警",
  "告警",
  "问题",
]);

const CODE_RE = /\b[A-Z]{0,4}-?\d{3,6}\b/gi;
const MIN_SCORE = 12;
const DEFAULT_LIMIT = 3;

export function normalizeQuery(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFaultCodes(text) {
  const found = String(text || "").match(CODE_RE) || [];
  const codes = found.map((c) => c.toUpperCase().replace(/^-/, ""));
  return [...new Set(codes)];
}

function isStopword(term) {
  return STOPWORDS.has(term);
}

function tokenizeQuery(query) {
  const codes = extractFaultCodes(query);
  const withoutCodes = query.replace(CODE_RE, " ");
  const parts = withoutCodes
    .split(/[\s,，。；;：:、/\\|]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && !isStopword(p));
  return { codes, parts };
}

function uniqueTerms(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const term = String(value || "").trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}

function caseSearchTerms(caseItem, componentMap) {
  const component = componentMap.get(caseItem.componentId);
  const relatedNames = (caseItem.relatedComponentIds || [])
    .map((id) => componentMap.get(id)?.name)
    .filter(Boolean);

  return {
    faultCodes: (caseItem.faultCodes || []).map((c) => c.toUpperCase()),
    nameTerms: uniqueTerms([caseItem.faultMode, ...(caseItem.synonyms || [])]),
    symptomTerms: uniqueTerms(caseItem.symptoms || []),
    extraTerms: uniqueTerms([
      ...(caseItem.causes || []),
      ...(caseItem.steps || []),
    ]),
    componentNames: uniqueTerms([
      component?.name,
      ...(component?.aliases || []),
      ...relatedNames,
    ]),
    primaryComponentId: caseItem.componentId,
    relatedComponentIds: caseItem.relatedComponentIds || [],
  };
}

function containsTerm(haystack, term) {
  if (!term) return false;
  const h = haystack.toLowerCase();
  const t = term.toLowerCase();
  return h.includes(t);
}

function longestHit(query, terms) {
  let best = "";
  for (const term of terms) {
    if (term.length < 2 || isStopword(term)) continue;
    if (containsTerm(query, term) && term.length > best.length) {
      best = term;
    }
  }
  return best;
}

function scoreCase(query, tokens, caseItem, terms, selectedComponentId) {
  const reasons = [];
  let score = 0;

  for (const code of tokens.codes) {
    const hit = terms.faultCodes.find((c) => c === code);
    if (hit) {
      score += 100;
      reasons.push({ type: "fault_code", text: `故障码命中 ${hit}` });
    }
  }

  const nameHit = longestHit(query, terms.nameTerms);
  if (nameHit) {
    const weight = 28 + Math.min(nameHit.length, 12);
    score += weight;
    reasons.push({ type: "keyword", text: `故障模式/同义词：${nameHit}` });
  }

  const symptomHit = longestHit(query, terms.symptomTerms);
  if (symptomHit) {
    score += 18 + Math.min(symptomHit.length, 8);
    reasons.push({ type: "keyword", text: `现象关键词：${symptomHit}` });
  }

  for (const part of tokens.parts) {
    if (nameHit && containsTerm(nameHit, part)) continue;
    if (symptomHit && containsTerm(symptomHit, part)) continue;
    const extraHit = terms.extraTerms.find((term) => containsTerm(term, part) || containsTerm(part, term));
    if (extraHit) {
      score += 8;
      reasons.push({ type: "keyword", text: `排查描述命中：${part}` });
      break;
    }
  }

  const componentHit = longestHit(query, terms.componentNames);
  if (componentHit) {
    const primaryCount = 1 + (caseItem._primaryAliasCount || 0);
    const isPrimaryName = terms.componentNames.slice(0, primaryCount).includes(componentHit);
    if (isPrimaryName) {
      score += 35;
      reasons.push({ type: "component", text: `部件加权：${componentHit}` });
    } else {
      score += 12;
      reasons.push({ type: "component", text: `相关部件：${componentHit}` });
    }
  }

  if (selectedComponentId) {
    if (caseItem.componentId === selectedComponentId) {
      score += 50;
      reasons.push({ type: "component", text: "已选部件加权（主部件）" });
    } else if ((caseItem.relatedComponentIds || []).includes(selectedComponentId)) {
      score += 18;
      reasons.push({ type: "component", text: "已选部件加权（相关部件）" });
    }
  }

  const uniqueReasons = [];
  const seen = new Set();
  for (const reason of reasons) {
    if (seen.has(reason.text)) continue;
    seen.add(reason.text);
    uniqueReasons.push(reason);
  }

  return { score, reasons: uniqueReasons };
}

function attachPrimaryAliasMeta(caseItem, componentMap) {
  const component = componentMap.get(caseItem.componentId);
  return {
    ...caseItem,
    _primaryAliasCount: component?.aliases?.length || 0,
  };
}

/**
 * @param {string} rawQuery
 * @param {{ components: object[], cases: object[], documents?: object[] }} knowledge
 * @param {{ componentId?: string | null, limit?: number }} [options]
 */
export function diagnose(rawQuery, knowledge, options = {}) {
  const query = normalizeQuery(rawQuery);
  const selectedComponentId = options.componentId || null;
  const limit = options.limit || DEFAULT_LIMIT;
  const components = knowledge.components || [];
  const cases = knowledge.cases || [];
  const componentMap = new Map(components.map((c) => [c.id, c]));

  if (!query && !selectedComponentId) {
    return { hits: [], empty: true, query, selectedComponentId };
  }

  const tokens = tokenizeQuery(query || "");
  const ranked = [];

  for (const rawCase of cases) {
    const caseItem = attachPrimaryAliasMeta(rawCase, componentMap);
    const terms = caseSearchTerms(caseItem, componentMap);
    const { score, reasons } = scoreCase(query, tokens, caseItem, terms, selectedComponentId);
    if (score >= MIN_SCORE && reasons.length > 0) {
      ranked.push({
        caseId: caseItem.id,
        score,
        reasons,
        caseItem: rawCase,
      });
    }
  }

  ranked.sort((a, b) => b.score - a.score || a.caseItem.faultMode.localeCompare(b.caseItem.faultMode, "zh"));
  const hits = ranked.slice(0, limit).map((hit, index) => ({
    rank: index + 1,
    caseId: hit.caseId,
    score: hit.score,
    reasons: hit.reasons,
    case: hit.caseItem,
  }));

  return {
    hits,
    empty: hits.length === 0,
    query,
    selectedComponentId,
  };
}

export const MATCH_LIMIT = DEFAULT_LIMIT;
export const MATCH_MIN_SCORE = MIN_SCORE;
