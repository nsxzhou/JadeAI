/**
 * 蓝图出题。
 *
 * 两个阶段：
 * 1. 先规划整场的题型与知识覆盖（蓝图）；
 * 2. 按维度、再按 2 题一批生成题目，最后服务端硬校验并还原顺序。
 *
 * 为什么按 2 题分批：单题要求包含 4–6 条带参考答案的追问、三档 rubric、
 * 危险信号和 4–6 行参考答案，输出量很大。一次生成 3 题以上时，模型很容易
 * 在中途被截断或漏字段，导致整次作废。分批不改变任何单题质量要求，只是把
 * 一次输出变小；生成失败的批次会原样重试，仍失败才整次失败——绝不落半套题，
 * 也不用泛化题补齐。
 */
import { generateText, type LanguageModel } from 'ai';
import { extractJson } from '@/lib/ai/extract-json';
import type { getJsonProviderOptions } from '@/lib/ai/provider';
import { interviewBlueprintOutputSchema, questionsOutputSchema, type QuestionsOutput } from '@/lib/ai/perspective-schema';
import { buildDimensionQuestionsPrompt, buildInterviewBlueprintPrompt } from '@/lib/ai/perspective-prompts';
import {
  assembleGeneratedQuestions,
  canonicalizeBlueprintEvidence,
  groupBlueprintSlots,
  validateBlueprint,
  type GeneratedGroup,
  type IndexedQuestionSlot,
} from '@/lib/interview-core/blueprint';
import { totalQuestions } from '@/lib/interview-core/dimension';
import { isGoRole, ROLE_FAMILIES } from '@/lib/interview-core/role-family';
import type { GenerationProgress } from '@/lib/perspective/generation-progress';
import type {
  DimensionConfig,
  InterviewBlueprint,
  InterviewQuestion,
  PrimaryStack,
  RoleFamilyKey,
} from '@/lib/interview-core/types';

/** 每次模型调用最多生成几道题。2 题可以在 8192 token 内完整输出所有字段。 */
const QUESTION_CHUNK_SIZE = 2;
/** 同时最多发几路题目请求，避免一次打满供应商的并发/限流。 */
const QUESTION_CONCURRENCY = 3;
/** 单次调用的输出预算。 */
const OUTPUT_TOKENS = 8192;
/** 输出被截断时的重试预算（只升一级，避免无限烧 token）。 */
const OUTPUT_TOKENS_ESCALATED = 16384;
/** 蓝图失败后最多尝试几次（含第一次）。 */
const BLUEPRINT_ATTEMPTS = 3;
/** 多题批次失败后的重试次数。 */
const CHUNK_ATTEMPTS = 2;
/** 单题批次失败后的重试次数（单题最需要救回来）。 */
const SINGLE_QUESTION_ATTEMPTS = 3;
/** 测试里不等待，生产环境给供应商一点冷却时间。 */
const RETRY_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 300;

type ProviderOptions = ReturnType<typeof getJsonProviderOptions>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 只追加「格式/校验修复」提示，绝不要求缩短追问或参考答案。 */
function withRetryNote(
  system: string,
  error: unknown,
  instruction: string,
  closing: string,
): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${system}

RETRY NOTE — the previous response was rejected: ${message}
${instruction}
${closing}
Return only one complete JSON object.`;
}

interface JsonTextResult {
  text: string;
  finishReason: string;
}

/**
 * 调一次模型，并把「输出被预算截断」当成可处理的情况：翻倍预算再要一次。
 * 截断的唯一可靠信号是 finishReason——模型不会主动告诉你它没写完。
 */
async function generateJsonText(args: {
  model: LanguageModel;
  providerOptions: ProviderOptions;
  system: string;
  prompt: string;
}): Promise<JsonTextResult> {
  const result = await generateText({ ...args, maxOutputTokens: OUTPUT_TOKENS });
  if (result.finishReason !== 'length') {
    return { text: result.text, finishReason: result.finishReason };
  }

  console.warn(
    '[blueprint] output truncated at %d tokens, retrying with %d',
    OUTPUT_TOKENS,
    OUTPUT_TOKENS_ESCALATED,
  );
  const escalated = await generateText({ ...args, maxOutputTokens: OUTPUT_TOKENS_ESCALATED });
  return { text: escalated.text, finishReason: escalated.finishReason };
}

/** 把调用侧的 finishReason / 输出长度附到错误里，否则日志里只剩「JSON 解析失败」。 */
function withCallDiagnostics(error: unknown, result: JsonTextResult): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${message} [finishReason=${result.finishReason}, chars=${result.text.length}]`);
}

function splitIntoChunks<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * 有并发上限地跑任务。任务自己捕获错误并返回结果对象，这样所有已发出的请求
 * 都会结算，不会在调用方已经返回失败后还留着一批在途请求。
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface BlueprintGenerationInput {
  model: LanguageModel;
  providerOptions: ProviderOptions;
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
  dimensions: DimensionConfig[];
  /** 与 questionCounts 之和一致 */
  questionCount: number;
  questionCounts: Record<string, number>;
  roleFamily: RoleFamilyKey;
  primaryStack: PrimaryStack;
  allowedCategories: string[];
  requiredCategoryMinimums: Array<{ category: string; min: number }>;
  enforceJdCoverage?: boolean;
  /** 前端进度流；候选人口语化面试（非流式）不传 */
  onProgress?: (progress: GenerationProgress) => void;
}

/**
 * 生成并校验蓝图。校验失败时把具体错误回喂给模型再试；错误只涉及
 * 槽位数/维度配额/evidence 匹配，不改变任何出题质量要求。
 */
export async function generateValidatedBlueprint(
  input: BlueprintGenerationInput,
): Promise<InterviewBlueprint> {
  const { system, prompt } = buildInterviewBlueprintPrompt({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    resumeText: input.resumeText,
    dimensions: input.dimensions,
    questionCount: input.questionCount,
    questionCounts: input.questionCounts,
    roleFamilyKey: input.roleFamily,
    allowedCategories: input.allowedCategories,
    requiredCategoryMinimums: input.requiredCategoryMinimums,
  });

  const dimensionCountHint = Object.entries(input.questionCounts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key}=${count}`)
    .join(', ');

  input.onProgress?.({
    type: 'progress',
    phase: 'blueprint',
    completed: 0,
    total: input.questionCount,
  });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < BLUEPRINT_ATTEMPTS; attempt += 1) {
    try {
      const result = await generateJsonText({
        model: input.model,
        providerOptions: input.providerOptions,
        system: attempt === 0
          ? system
          : withRetryNote(
            system,
            lastError,
            `Return a complete blueprint with exactly ${input.questionCount} slots. Dimension counts must be exactly: ${dimensionCountHint}.`,
            'Do not omit slots, dimensions or evidence entries.',
          ),
        prompt,
      });

      let blueprint: InterviewBlueprint;
      try {
        blueprint = validateBlueprint(
          canonicalizeBlueprintEvidence(
            extractJson(result.text, interviewBlueprintOutputSchema),
          ),
          {
            questionCount: input.questionCount,
            dimensions: input.dimensions,
            roleFamily: input.roleFamily,
            primaryStack: input.primaryStack,
            questionCounts: input.questionCounts,
            enforceJdCoverage: input.enforceJdCoverage,
            // 生成管线用覆盖式校验：prompt 仍然按精确配额要求模型，但模型在 17 题、
            // 8 个维度、三个来源同时约束下很难精确命中；一次偏差就整场失败不值得。
            // 覆盖式仍保证每个启用维度都有题、总数精确、来源不全是简历。
            strictDimensionCounts: false,
            strictSourceCoverage: false,
          },
        );
      } catch (error) {
        throw withCallDiagnostics(error, result);
      }
      input.onProgress?.({
        type: 'progress',
        phase: 'blueprint',
        completed: 0,
        total: input.questionCount,
        message: '蓝图已完成',
      });
      return blueprint;
    } catch (error) {
      lastError = error;
      if (attempt < BLUEPRINT_ATTEMPTS - 1) {
        input.onProgress?.({
          type: 'progress',
          phase: 'blueprint',
          completed: 0,
          total: input.questionCount,
          retry: true,
        });
      }
      if (attempt < BLUEPRINT_ATTEMPTS - 1 && RETRY_DELAY_MS > 0) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw new Error(
    `Blueprint generation failed after ${BLUEPRINT_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export interface QuestionGenerationInput {
  model: LanguageModel;
  providerOptions: ProviderOptions;
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
  dimensions: DimensionConfig[];
  blueprint: InterviewBlueprint;
  questionCount: number;
  onProgress?: (progress: GenerationProgress) => void;
}

/**
 * 质量闸门：schema 对缺失字段有兜底，兜底能防止整次失败，但也会让「漏了追问
 * 答案 / 漏了参考答案」的题静默落库。分批生成时更不能靠缩短字段换成功率，
 * 所以这里显式检查 prompt 要求的硬字段；不合格就重试，绝不降级保存。
 */
function assertGeneratedQuestionQuality(
  questions: InterviewQuestion[],
  slots: IndexedQuestionSlot[],
): void {
  questions.forEach((question, index) => {
    const label = slots[index]?.slotIndex ?? index + 1;
    const fail = (message: string): never => {
      throw new Error(`Question ${label} failed quality gate: ${message}`);
    };

    if (!question.question?.trim()) fail('question stem is empty');
    if (!question.intent?.trim()) fail('intent is empty');
    if (
      !question.rubric?.excellent?.trim()
      || !question.rubric?.pass?.trim()
      || !question.rubric?.fail?.trim()
    ) {
      fail('rubric is incomplete');
    }
    if (!Array.isArray(question.followUps) || question.followUps.length < 4) {
      fail('expected at least 4 follow-ups');
    }
    question.followUps.forEach((followUp, followUpIndex) => {
      if (!followUp.purpose?.trim() || !followUp.question?.trim() || !followUp.answer?.trim()) {
        fail(`follow-up ${followUpIndex + 1} is missing purpose/question/answer`);
      }
    });
    if (!question.referenceAnswer?.trim()) fail('referenceAnswer is empty');
    if ((question.redFlags?.length ?? 0) < 2) fail('expected at least 2 red flags');
  });
}

async function generateQuestionChunkOnce(
  input: QuestionGenerationInput,
  dimension: DimensionConfig,
  slots: IndexedQuestionSlot[],
  siblingSlots: IndexedQuestionSlot[],
  lastError: unknown,
): Promise<InterviewQuestion[]> {
  const { system, prompt } = buildDimensionQuestionsPrompt({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    resumeText: input.resumeText,
    dimensions: input.dimensions,
    dimension,
    blueprint: input.blueprint,
    slots,
    otherSlots: siblingSlots,
  });

  const result = await generateJsonText({
    model: input.model,
    providerOptions: input.providerOptions,
    system: lastError
      ? withRetryNote(
        system,
        lastError,
        `Return exactly ${slots.length} complete question object${slots.length > 1 ? 's' : ''}, one per assigned slot, in order.`,
        'Do not omit fields, do not shorten the required follow-ups or reference answer.',
      )
      : system,
    prompt,
  });

  let parsed: QuestionsOutput;
  try {
    parsed = extractJson(result.text, questionsOutputSchema);
  } catch (error) {
    throw withCallDiagnostics(error, result);
  }
  if (parsed.questions.length !== slots.length) {
    throw new Error(`Expected ${slots.length} question(s); received ${parsed.questions.length}.`);
  }
  assertGeneratedQuestionQuality(parsed.questions, slots);
  return parsed.questions;
}

async function generateChunkWithRetry(
  input: QuestionGenerationInput,
  dimension: DimensionConfig,
  slots: IndexedQuestionSlot[],
  siblingSlots: IndexedQuestionSlot[],
  onRetry?: () => void,
): Promise<GeneratedGroup> {
  const attempts = slots.length > 1 ? CHUNK_ATTEMPTS : SINGLE_QUESTION_ATTEMPTS;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const questions = await generateQuestionChunkOnce(
        input,
        dimension,
        slots,
        siblingSlots,
        lastError,
      );
      return { slots, questions };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) onRetry?.();
      if (attempt < attempts - 1 && RETRY_DELAY_MS > 0) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  // 2 题一起失败时，拆成两个单题再各救一次。单题输出更小，通常能成功。
  if (slots.length > 1) {
    onRetry?.();
    const settled = await Promise.allSettled(
      slots.map((slot) =>
        generateChunkWithRetry(
          input,
          dimension,
          [slot],
          [...siblingSlots, ...slots.filter((candidate) => candidate !== slot)],
          onRetry,
        ),
      ),
    );
    const rejected = settled.find((result) => result.status === 'rejected');
    if (rejected && rejected.status === 'rejected') throw rejected.reason;

    return {
      slots,
      questions: settled.flatMap((result) =>
        result.status === 'fulfilled' ? result.value.questions : []),
    };
  }

  throw new Error(
    `Failed to generate question for slot ${slots[0]?.slotIndex ?? '?'}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

interface ChunkTask {
  dimension: DimensionConfig;
  slots: IndexedQuestionSlot[];
  siblingSlots: IndexedQuestionSlot[];
}

type ChunkResult =
  | { ok: true; group: GeneratedGroup }
  | { ok: false; dimension: string; slotIndexes: number[]; error: unknown };

/**
 * 按维度分块生成题目，并还原成蓝图槽位顺序。
 *
 * 失败语义与旧实现一致：任何一道题在重试后仍生成不出来，整次失败，
 * 不落库、不返回半套题、不用泛化题补齐。
 */
export async function generateQuestionsForBlueprint(
  input: QuestionGenerationInput,
): Promise<InterviewQuestion[]> {
  const dimensionByKey = new Map(input.dimensions.map((dimension) => [dimension.key, dimension]));
  const tasks: ChunkTask[] = [];

  for (const group of groupBlueprintSlots(input.blueprint.slots)) {
    const dimension = dimensionByKey.get(group.dimension);
    if (!dimension) {
      throw new Error(`Blueprint dimension "${group.dimension}" is not configured.`);
    }
    for (const chunk of splitIntoChunks(group.slots, QUESTION_CHUNK_SIZE)) {
      tasks.push({
        dimension,
        slots: chunk,
        siblingSlots: group.slots.filter((slot) => !chunk.includes(slot)),
      });
    }
  }

  let completed = 0;
  const total = input.questionCount;
  input.onProgress?.({
    type: 'progress',
    phase: 'questions',
    completed,
    total,
  });

  const results = await runWithConcurrency<ChunkTask, ChunkResult>(
    tasks,
    QUESTION_CONCURRENCY,
    async (task) => {
      try {
        const group = await generateChunkWithRetry(
          input,
          task.dimension,
          task.slots,
          task.siblingSlots,
          () => input.onProgress?.({
            type: 'progress',
            phase: 'questions',
            completed,
            total,
            retry: true,
          }),
        );
        completed += task.slots.length;
        input.onProgress?.({
          type: 'progress',
          phase: 'questions',
          completed,
          total,
        });
        return { ok: true, group };
      } catch (error) {
        return {
          ok: false,
          dimension: task.dimension.key,
          slotIndexes: task.slots.map((slot) => slot.slotIndex),
          error,
        };
      }
    },
  );

  const failures = results.filter((result): result is Extract<ChunkResult, { ok: false }> => !result.ok);
  if (failures.length > 0) {
    const detail = failures
      .map((failure) =>
        `dimension "${failure.dimension}" slots ${failure.slotIndexes.join(',')}: ${
          failure.error instanceof Error ? failure.error.message : String(failure.error)
        }`)
      .join('; ');
    throw new Error(`Question generation failed for at least one dimension. ${detail}`);
  }

  const groups = results
    .filter((result): result is Extract<ChunkResult, { ok: true }> => result.ok)
    .map((result) => result.group);

  return assembleGeneratedQuestions(groups, input.questionCount);
}

export interface PlanSessionQuestionsInput {
  model: LanguageModel;
  /** 与 provider 相关的 JSON 模式选项，由调用方从 AIConfig 生成 */
  providerOptions: ProviderOptions;
  dimensions: DimensionConfig[];
  /** 逐维度题数，来自 planQuestionCounts */
  questionCounts: Record<string, number>;
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
  roleFamily: RoleFamilyKey;
  primaryStack: PrimaryStack;
}

export interface PlannedSessionQuestions {
  questions: InterviewQuestion[];
  questionCounts: Record<string, number>;
}

/** 题数够多时，把岗位族的必考题型（含 Go 基础最少 2 题）交给模型。 */
export function requiredCategoryMinimums(
  roleFamily: RoleFamilyKey,
  primaryStack: PrimaryStack,
  questionCount: number,
): Array<{ category: string; min: number }> {
  if (questionCount < 8) return [];
  const required = ROLE_FAMILIES[roleFamily].requiredCategories.map((category) => ({ category, min: 1 }));
  if (isGoRole(roleFamily, primaryStack)) {
    required.push({ category: 'go_fundamentals', min: 2 });
  }
  return required;
}

export async function planSessionQuestions(
  input: PlanSessionQuestionsInput,
): Promise<PlannedSessionQuestions> {
  const questionCount = totalQuestions(input.questionCounts);
  if (questionCount <= 0) throw new Error('Session must contain at least one question.');

  const blueprint = await generateValidatedBlueprint({
    model: input.model,
    providerOptions: input.providerOptions,
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    resumeText: input.resumeText,
    dimensions: input.dimensions,
    questionCount,
    questionCounts: input.questionCounts,
    roleFamily: input.roleFamily,
    primaryStack: input.primaryStack,
    allowedCategories: ROLE_FAMILIES[input.roleFamily].allowedCategories,
    requiredCategoryMinimums: requiredCategoryMinimums(
      input.roleFamily,
      input.primaryStack,
      questionCount,
    ),
    enforceJdCoverage: true,
  });

  const raw = await generateQuestionsForBlueprint({
    model: input.model,
    providerOptions: input.providerOptions,
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    resumeText: input.resumeText,
    dimensions: input.dimensions,
    blueprint,
    questionCount,
  });

  // id 由服务端生成——模型返回的 id 可能重复或缺失，而报告与错题本要靠它对齐。
  const questions: InterviewQuestion[] = raw.map((question) => ({
    id: crypto.randomUUID(),
    dimension: question.dimension,
    category: question.category,
    source: question.source,
    evidence: question.evidence,
    question: question.question,
    intent: question.intent,
    rubric: question.rubric,
    followUps: question.followUps,
    referencePoints: question.referencePoints,
    redFlags: question.redFlags,
    referenceAnswer: question.referenceAnswer,
    estimatedMinutes: question.estimatedMinutes,
    difficulty: question.difficulty,
    status: 'pending',
  }));

  return { questions, questionCounts: input.questionCounts };
}
