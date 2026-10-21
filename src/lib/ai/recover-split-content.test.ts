import { describe, expect, it, vi } from 'vitest';
import { createContentRecoveryFetch, recoverSplitJsonContent } from './recover-split-content';

/** MiMo 实测形态：JSON 从 </think> 处被劈开，头进 reasoning_content、尾进 content。 */
const SPLIT_BODY = {
  choices: [
    {
      message: {
        role: 'assistant',
        content: '跨 chunk 切断问题（思考内容过滤或独立通道）。"},{"purpose":"要归因","question":"哪些是你写的？","answer":"…"}]}',
        reasoning_content: '{"questions":[{"dimension":"project_deep_dive","question":"思考标签过滤怎么实现？","referenceAnswer":"用状态机剥离 ...</think>',
      },
    },
  ],
};

function parseContent(body: { choices: Array<{ message: { content: string } }> }) {
  return JSON.parse(body.choices[0].message.content) as { questions: unknown[] };
}

describe('recoverSplitJsonContent', () => {
  it('把被劈开的 JSON 拼回去，并只把真正的思考留在 reasoning_content', () => {
    const body = structuredClone(SPLIT_BODY);

    expect(recoverSplitJsonContent(body)).toBe(true);

    const parsed = parseContent(body);
    expect(Array.isArray(parsed.questions)).toBe(true);
    expect(body.choices[0].message.content.startsWith('{"questions"')).toBe(true);
    // </think> 之前那段才是被误当思考的部分，现在已经被搬进 content
    expect(body.choices[0].message.reasoning_content).toBe('');
  });

  it('正常响应一个字都不改', () => {
    const body = {
      choices: [{ message: { content: '{"questions":[]}', reasoning_content: '真正的思考过程' } }],
    };
    const before = structuredClone(body);

    expect(recoverSplitJsonContent(body)).toBe(false);
    expect(body).toEqual(before);
  });

  it('content 本身就是 JSON 开头时不动它', () => {
    const body = {
      choices: [{ message: { content: '{"a":1}', reasoning_content: '{"b":2}' } }],
    };
    expect(recoverSplitJsonContent(body)).toBe(false);
  });

  it('content 是普通正文时绝不猜测拼接', () => {
    const body = {
      choices: [
        {
          message: {
            content: '这是一个普通回答，没有 JSON。',
            reasoning_content: '思考：先看 { 这个符号',
          },
        },
      ],
    };
    const before = structuredClone(body);

    expect(recoverSplitJsonContent(body)).toBe(false);
    expect(body).toEqual(before);
  });
});

describe('createContentRecoveryFetch', () => {
  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('重写 JSON 响应体并去掉过期的 content-length', async () => {
    const baseFetch = vi.fn(async () => jsonResponse(structuredClone(SPLIT_BODY))) as unknown as typeof fetch;
    const wrapped = createContentRecoveryFetch(baseFetch);

    const response = await wrapped('https://api.example.com/v1/chat/completions', { method: 'POST' });
    const body = (await response.json()) as typeof SPLIT_BODY;
    const parsed = JSON.parse(body.choices[0].message.content) as { questions: unknown[] };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBeNull();
    expect(Array.isArray(parsed.questions)).toBe(true);
  });

  it('流式响应原样透传', async () => {
    const sse = new Response('data: {"choices":[]}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
    const wrapped = createContentRecoveryFetch((async () => sse) as unknown as typeof fetch);

    const response = await wrapped('https://api.example.com/v1/chat/completions', {});

    expect(await response.text()).toBe('data: {"choices":[]}\n\n');
  });
});
