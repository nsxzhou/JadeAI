import { NextRequest } from 'next/server';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createContentRecoveryFetch } from '@/lib/ai/recover-split-content';

export interface AIConfig {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

export function extractAIConfig(request: NextRequest): AIConfig {
  const provider = request.headers.get('x-provider') || 'openai';
  const apiKey = request.headers.get('x-api-key') || '';
  const baseURL = request.headers.get('x-base-url') || 'https://api.openai.com/v1';
  const model = request.headers.get('x-model') || 'gpt-4o';
  return { provider, apiKey, baseURL, model };
}

export function getModel(config: AIConfig, modelOverride?: string) {
  if (!config.apiKey) {
    throw new AIConfigError('API key is required. Please configure it in Settings.');
  }
  const modelId = modelOverride || config.model;

  switch (config.provider) {
    case 'anthropic': {
      const p = createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL || undefined });
      return p(modelId);
    }
    case 'gemini': {
      const p = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseURL || undefined });
      return p(modelId);
    }
    default: {
      // 有些兼容网关会把响应从第一个 </think> 处劈成 reasoning_content + content，
      // 模型正文里一旦出现这个字面量（比如题目在考「思考标签过滤」），JSON 就会缺头。
      // 在响应层拼回去，后续解析不必知道这个网关毛病。
      const p = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        fetch: createContentRecoveryFetch(),
      });
      return p.chat(modelId);
    }
  }
}

/** 判断是不是 OpenAI 官方端点；空 baseURL 视为官方默认。 */
function isOfficialOpenAIEndpoint(baseURL: string): boolean {
  if (!baseURL) return true;
  try {
    return new URL(baseURL).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

/**
 * Returns providerOptions for JSON mode — only applicable to OpenAI-compatible providers.
 *
 * 第三方 OpenAI 兼容网关（MiMo / DeepSeek / 自建代理等）经常默认开启 thinking。
 * 结构化 JSON 输出时，thinking 会先吃掉输出预算：8192 token 全花在推理上，
 * 最终 content 为空（finish_reason=length），表现为「生成失败」。
 * 对非官方端点显式关闭 thinking，官方 OpenAI 保持默认（o 系列/GPT-5 的推理策略
 * 由用户模型自身决定，不在这里强行改写）。
 */
export function getJsonProviderOptions(config: AIConfig) {
  if (config.provider === 'openai') {
    const openai: {
      response_format: { type: 'json_object' };
      reasoningEffort?: 'none';
    } = {
      response_format: { type: 'json_object' },
    };
    if (!isOfficialOpenAIEndpoint(config.baseURL)) {
      openai.reasoningEffort = 'none';
    }
    return { openai };
  }
  return {} as Record<string, never>;
}

export class AIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIConfigError';
  }
}
