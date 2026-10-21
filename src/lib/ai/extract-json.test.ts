import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { extractJson } from './extract-json';

const schema = z.object({ a: z.string() });

beforeEach(() => {
  // extractJson 失败时会 dump 原文，测试里没必要刷屏
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('extractJson 与思考标签', () => {
  it('剥掉开头的推理块', () => {
    const text = '<think>让我想想</think>{"a":"ok"}';
    expect(extractJson(text, schema)).toEqual({ a: 'ok' });
  });

  it('剥掉未闭合的开头推理块', () => {
    const text = '<think>想了很久但没闭合\n{"a":"ok"}';
    expect(extractJson(text, schema)).toEqual({ a: 'ok' });
  });

  it('正文里的 </think> 是内容，不许把 JSON 头一起吃掉', () => {
    // 这就是线上那条 bug：题目在考「思考标签过滤」，参考答案必须写出字面量 </think>
    const value = '用状态机跨 chunk 剥离 <think>…</think>，不能只做字符串替换';
    const text = JSON.stringify({ a: value });

    expect(extractJson(text, schema)).toEqual({ a: value });
  });

  it('正文里出现 </think> 且外层有 markdown 代码块时仍能解析', () => {
    const value = '先缓存未闭合的 </think> 前缀';
    const text = `\`\`\`json\n${JSON.stringify({ a: value })}\n\`\`\``;

    expect(extractJson(text, schema)).toEqual({ a: value });
  });
});

describe('extractJson 的失败诊断', () => {
  it('schema 不匹配时把 zod 路径写进错误信息', () => {
    expect(() => extractJson('{"a":123}', schema)).toThrow(/a: /);
  });

  it('完全无法解析时错误里带长度与原始原因', () => {
    expect(() => extractJson('抱歉，我无法完成这个请求。', schema)).toThrow(/length=13/);
  });

  it('JSON 缺少开头时明确说出来', () => {
    expect(() => extractJson('尾巴"}', schema)).toThrow(/missing the opening/);
  });
});
