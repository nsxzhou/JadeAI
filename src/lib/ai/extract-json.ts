import { jsonrepair } from 'jsonrepair';
import type { ZodType } from 'zod/v4';

/**
 * Repair unescaped double quotes inside JSON string values.
 *
 * AI models often output JSON like:
 *   "suggestion": "如"some text"more"
 * where the inner " are content quotes that should be escaped as \".
 *
 * Algorithm: walk character by character, track whether we're inside a JSON
 * string. When we hit a " inside a string, look ahead — if the next
 * non-whitespace character is a JSON structural char (, } ] :) or EOF,
 * it's a real closing quote; otherwise escape it.
 */
function repairUnescapedQuotes(text: string): string {
  const len = text.length;
  const out: string[] = [];
  let inString = false;
  let i = 0;

  while (i < len) {
    const ch = text[i];

    // Handle escape sequences inside strings
    if (inString && ch === '\\') {
      out.push(ch);
      if (i + 1 < len) {
        out.push(text[i + 1]);
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (ch === '"') {
      if (!inString) {
        inString = true;
        out.push(ch);
      } else {
        // Look ahead past whitespace for a JSON structural character
        let j = i + 1;
        while (j < len && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')) {
          j++;
        }
        const next = j < len ? text[j] : '';
        if (next === '' || next === ',' || next === '}' || next === ']' || next === ':') {
          // Structural closing quote
          inString = false;
          out.push(ch);
        } else {
          // Unescaped content quote — escape it
          out.push('\\', '"');
        }
      }
    } else {
      out.push(ch);
    }
    i++;
  }

  return out.join('');
}

/**
 * Strip a LEADING reasoning block (qwen3, deepseek-r1, …).
 *
 * 只从开头撕：正文里出现的 `</think>` 往往是被讨论的技术名词（题目就在考「思考标签
 * 过滤」，参考答案必须提到这个标记）。旧实现 `^[\s\S]*?</think>` 会把 JSON 开头的
 * `{"questions":[…` 一并吃掉，结果是一段没有头的 JSON，怎么 repair 都救不回来。
 * 只有「整段以思考标签开头」才可能是推理块。
 */
function stripThinkBlocks(text: string): string {
  const open = /^<\|?\s*(?:think|thinking|reasoning)\s*\|?>/i;
  const close = /<\s*\/\s*(?:think|thinking|reasoning)\s*>|<\|\s*\/\s*(?:think|thinking|reasoning)\s*\|>/i;

  let out = text.trim();
  while (open.test(out)) {
    const closing = close.exec(out);
    if (!closing) {
      // 未闭合的推理：从第一个 JSON 起始符开始保留，没有就整段丢弃
      const brace = out.search(/[{\[]/);
      return brace === -1 ? '' : out.slice(brace).trim();
    }
    out = out.slice(closing.index + closing[0].length).trim();
  }
  return out;
}

/** Strip markdown code fences from text */
function stripFences(text: string): string {
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return m ? m[1].trim() : text;
}

/** Common key aliases AI models invent instead of the canonical schema keys */
const KEY_ALIASES: Record<string, string> = {
  comprehensiveScore: 'overallScore',
  totalScore: 'overallScore',
  finalScore: 'overallScore',
  capabilityScores: 'dimensionScores',
  competencyScores: 'dimensionScores',
  abilityScores: 'dimensionScores',
  rounds: 'roundEvaluations',
  evaluations: 'roundEvaluations',
  feedback: 'overallFeedback',
  overallSummary: 'overallFeedback',
  improvements: 'improvementPlan',
  improvementSuggestions: 'improvementPlan',
  improvementAreas: 'improvementPlan',
  direction: 'description',
};

function normalizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const nk = KEY_ALIASES[k] ?? k;
      out[nk] = normalizeKeys(v);
    }
    return out;
  }
  return value;
}

/** 最近一次解析/校验为什么失败。截断与 schema 不匹配必须能分清。 */
let lastParseError: unknown = null;

/** Try to parse text as JSON, return null on failure */
function tryParse<T>(text: string, schema: ZodType<T>): T | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    lastParseError = error;
    return null;
  }
  try {
    return schema.parse(normalizeKeys(parsed));
  } catch (error) {
    lastParseError = error;
    return null;
  }
}

/** 把 zod / 语法错误压成一句能进日志的原因，不泄露简历原文。 */
function describeFailure(error: unknown): string {
  if (!error) return '';
  const issues = (error as { issues?: Array<{ path?: unknown[]; message?: string }> }).issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .slice(0, 3)
      .map((issue) => `${(issue.path ?? []).join('.') || '(root)'}: ${issue.message ?? 'invalid'}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Robustly extract and validate a JSON object from AI text output.
 * Handles: code fences, unescaped quotes, truncated JSON, extra text.
 */
export function extractJson<T>(text: string, schema: ZodType<T>): T {
  lastParseError = null;
  const trimmed = text.trim();

  // Step 0: Strip reasoning blocks (qwen3, deepseek-r1)
  const noThink = stripThinkBlocks(trimmed);

  // Step 1: Strip code fences if present
  const cleaned = stripFences(noThink);

  // Step 2: Try direct parse
  const direct = tryParse(cleaned, schema);
  if (direct !== null) return direct;

  // Step 3: Repair unescaped quotes then parse
  const repaired = repairUnescapedQuotes(cleaned);
  const afterRepair = tryParse(repaired, schema);
  if (afterRepair !== null) return afterRepair;

  // Step 4: jsonrepair on the quote-repaired text
  try {
    const jr = jsonrepair(repaired);
    const r = tryParse(jr, schema);
    if (r !== null) return r;
  } catch {}

  // Step 5: Brute-force first { to last } on original cleaned text
  const braceStart = cleaned.indexOf('{');
  const braceEnd = cleaned.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    const slice = cleaned.slice(braceStart, braceEnd + 1);
    const repairedSlice = repairUnescapedQuotes(slice);
    const r = tryParse(repairedSlice, schema);
    if (r !== null) return r;
    try {
      const jr = jsonrepair(repairedSlice);
      const r2 = tryParse(jr, schema);
      if (r2 !== null) return r2;
    } catch {}
  }

  // Step 6: Handle array-wrapped response — some models return [{...}] instead of {...}
  // Try to unwrap single-element arrays
  const bracketStart = cleaned.indexOf('[');
  const bracketEnd = cleaned.lastIndexOf(']');
  if (bracketStart !== -1 && bracketEnd > bracketStart) {
    const arrSlice = cleaned.slice(bracketStart, bracketEnd + 1);
    try {
      const parsed = JSON.parse(arrSlice);
      if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'object') {
        const r = tryParse(JSON.stringify(parsed[0]), schema);
        if (r !== null) return r;
      }
    } catch {}
    try {
      const jr = jsonrepair(arrSlice);
      const parsed = JSON.parse(jr);
      if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'object') {
        const r = tryParse(JSON.stringify(parsed[0]), schema);
        if (r !== null) return r;
      }
    } catch {}
  }

  const failure = describeFailure(lastParseError);
  const head = cleaned.trimStart();
  const tail = cleaned.trimEnd();
  const hints = [
    // 头部缺失 = 内容被网关/清洗逻辑从中间切掉，和「输出太长」是两种病
    tail.endsWith('}') && !head.startsWith('{') ? 'missing the opening of the JSON object' : '',
    head.startsWith('{') && !/[}\]]$/.test(tail) ? 'looks truncated (no closing brace)' : '',
  ].filter(Boolean);

  console.error(
    '[extractJson] failed (length=%d%s):\n%s',
    text.length,
    hints.length ? `, ${hints.join('; ')}` : '',
    cleaned.slice(0, 2000),
  );
  throw new Error(
    `Failed to extract valid JSON from AI response (length=${text.length}${
      hints.length ? `, ${hints.join('; ')}` : ''
    })${failure ? ` — ${failure}` : ''}`,
  );
}
