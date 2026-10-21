/**
 * 修复「响应被从中间劈开」的网关行为。
 *
 * 有些 OpenAI 兼容网关（小米 MiMo 等）用「第一个 `</think>` 之前算思考、之后算正文」
 * 的方式切分响应。当模型在 JSON 字符串里合法地写出 `</think>`（比如题目本身就在考
 * 「思考标签过滤」，参考答案必须提到这个标记）时，JSON 会被从中间劈开：前半截进
 * `reasoning_content`，后半截进 `content`。AI SDK 只读 `content`
 * （`@ai-sdk/openai` 不映射 `reasoning_content`），于是我们拿到一段没有开头的 JSON，
 * 无论怎么 repair 都解析不出来。
 *
 * 这里的判据是保守的：只有 `content` 不像 JSON 开头、而 `reasoning_content` 里确实存在
 * 能拼成合法 JSON 的起点时才动它。正常响应（含真正的推理响应）一律原样通过。
 */

/** 最多试多少个 `{` 作为拼接起点，避免在超长文本上空转。 */
const MAX_CANDIDATES = 64;

function startsWithJson(content: string): boolean {
  return /^\s*[{[]/.test(content);
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 找到 `reasoning` 里能让「起点之后 + content」成为合法 JSON 的下标。
 * 找不到时返回 -1；除非能确定 content 是 JSON 尾巴，否则不做猜测式拼接。
 */
function findJsonStart(reasoning: string, content: string): number {
  const first = reasoning.indexOf('{');
  if (first === -1) return -1;

  let index = first;
  for (let tries = 0; index !== -1 && tries < MAX_CANDIDATES; tries += 1) {
    if (parsesAsJson(reasoning.slice(index) + content)) return index;
    index = reasoning.indexOf('{', index + 1);
  }

  // 拼不成完整 JSON 时：content 为空、或明显是 JSON 尾巴，才按第一个 `{` 拼一次，
  // 交给下游的修复链去处理。content 是普通正文（非 JSON）时绝不拼接。
  const tail = content.trim();
  const looksLikeJsonTail = tail === '' || /[}\]]$/.test(tail);
  if (!looksLikeJsonTail) return -1;
  if (tail === '' && !/^\s*\{/.test(reasoning)) return -1;
  return first;
}

/**
 * 就地修复 chat.completion 响应体。返回是否改动过。
 *
 * 修好后 `reasoning_content` 只保留真正的思考部分，`content` 是完整 JSON，
 * 后续 `extractJson` 与质量闸门都不需要知道这个网关毛病。
 */
export function recoverSplitJsonContent(body: unknown): boolean {
  const choices = (body as { choices?: unknown })?.choices;
  if (!Array.isArray(choices)) return false;

  let recovered = false;
  for (const choice of choices) {
    const message = (choice as { message?: unknown })?.message;
    if (!message || typeof message !== 'object') continue;
    const record = message as Record<string, unknown>;

    const content = typeof record.content === 'string' ? record.content : '';
    const reasoning = typeof record.reasoning_content === 'string'
      ? record.reasoning_content
      : typeof record.reasoning === 'string'
        ? record.reasoning
        : '';
    if (!reasoning.trim()) continue;
    if (startsWithJson(content)) continue;

    const start = findJsonStart(reasoning, content);
    if (start === -1) continue;

    record.content = reasoning.slice(start) + content;
    if (typeof record.reasoning_content === 'string') {
      record.reasoning_content = reasoning.slice(0, start);
    }
    recovered = true;
  }

  return recovered;
}

function rebuildResponse(text: string, response: Response): Response {
  const headers = new Headers(response.headers);
  // body 已被解码重写，长度与编码对不上，交给 fetch 重新算
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 包一层 fetch：非流式 JSON 响应先尝试修复被劈开的 content，其余请求原样透传。
 * 流式（SSE）响应不碰——推理与正文本来就是两条通道，拼接无从谈起。
 */
export function createContentRecoveryFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return response;

    let text: string;
    try {
      text = await response.text();
    } catch {
      return response;
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return rebuildResponse(text, response);
    }

    if (!recoverSplitJsonContent(body)) return rebuildResponse(text, response);
    return rebuildResponse(JSON.stringify(body), response);
  };
}
