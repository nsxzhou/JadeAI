import type { RecruitCandidate } from '@/types/perspective';
import type {
  GenerationEvent,
  GenerationProgress,
} from './generation-progress';

/** 把接口返回的 JSON 错误体转成可展示的 Error。 */
async function responseError(response: Response): Promise<Error> {
  try {
    const data = (await response.json()) as { error?: unknown; detail?: unknown };
    if (typeof data?.error === 'string' && data.error.trim()) {
      return new Error(data.error);
    }
  } catch {
    // 非 JSON 错误体（网关 502 等）走下面的状态码文案
  }
  return new Error(`Question generation failed (HTTP ${response.status})`);
}

function parseLine(line: string): GenerationEvent | null {
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line) as GenerationEvent;
    if (!event || typeof event !== 'object') return null;
    if (event.type !== 'progress' && event.type !== 'result' && event.type !== 'error') return null;
    return event;
  } catch {
    return null;
  }
}

/**
 * 读取出题接口的 NDJSON 流。
 *
 * 服务端在生成过程中逐条发送 progress；最终发 result 或 error。
 * 任何一条 error 都会抛错，调用方沿用现有的 try/catch 即可。
 */
export async function consumeQuestionGenerationStream(
  response: Response,
  onProgress?: (progress: GenerationProgress) => void,
): Promise<RecruitCandidate> {
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new Error('Generation stream is unavailable');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let candidate: RecruitCandidate | null = null;
  let streamError: string | null = null;

  const consume = (line: string) => {
    const event = parseLine(line);
    if (!event) return;
    if (event.type === 'progress') {
      onProgress?.(event);
    } else if (event.type === 'result') {
      candidate = event.candidate as RecruitCandidate;
    } else if (event.type === 'error') {
      streamError = event.error || 'Question generation failed';
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) consume(line);
    if (streamError) break;
  }

  if (buffer.trim()) consume(buffer);
  if (streamError) throw new Error(streamError);
  if (!candidate) throw new Error('Generation finished without a result');
  return candidate;
}
