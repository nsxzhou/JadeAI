/**
 * 旧 JSON 题目 → `interview_questions` 行的映射。
 *
 * 翻转之前，面试官视角的题目存在 `perspective_candidates.questions` JSON 列里。
 * 题目升格为实体后要迁成行；这里只做「字段无损」的纯映射，落库与幂等由执行器负责。
 */
import type { FollowUp, InterviewQuestion, QuestionDifficulty, QuestionStatus, InterviewQuestionSource } from './types';

/** 与 `interview_questions` 表一一对应的插入行。 */
export interface InterviewQuestionRow {
  id: string;
  roundId: string | null;
  perspectiveCandidateId: string | null;
  sortOrder: number;
  dimensionKey: string;
  category: string | null;
  source: string | null;
  evidence: string;
  question: string;
  intent: string;
  rubric: unknown;
  followUps: unknown;
  referencePoints: unknown;
  referenceAnswer: string;
  redFlags: unknown;
  estimatedMinutes: number;
  difficulty: string;
  answer: string;
  timeSpentSec: number | null;
  timedOut: number;
  tier: string | null;
  score: number | null;
  markedWeak: number;
  status: string;
  originQuestionId: string | null;
}

const CATEGORIES = new Set<string>([
  'go_fundamentals', 'backend_fundamentals', 'middleware_database', 'project_deep_dive',
  'system_scenario', 'communication_pressure', 'hr_motivation', 'frontend_fundamentals',
  'browser_network', 'engineering_practice', 'data_processing', 'algorithm_complexity',
  'metrics_experiment', 'testing_strategy', 'cicd_delivery', 'observability_incident',
  'candidate_questions',
]);

const SOURCES = new Set<string>(['resume', 'jd', 'gap']);
const DIFFICULTIES = new Set<string>(['easy', 'medium', 'hard']);
const STATUSES = new Set<string>(['pending', 'asked', 'answered', 'skipped', 'timed_out']);
const TIERS = new Set<string>(['excellent', 'pass', 'fail']);

/** 追问从纯字符串升级成对象过，老数据统一补成 purpose 为空。 */
export function coerceFollowUps(raw: unknown): FollowUp[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): FollowUp | null => {
      if (typeof item === 'string') {
        const question = item.trim();
        return question ? { purpose: '', question, answer: '' } : null;
      }
      if (item && typeof item === 'object') {
        const record = item as { purpose?: unknown; question?: unknown; answer?: unknown };
        const question = typeof record.question === 'string' ? record.question.trim() : '';
        if (!question) return null;
        return {
          purpose: typeof record.purpose === 'string' ? record.purpose : '',
          question,
          answer: typeof record.answer === 'string' ? record.answer : '',
        };
      }
      return null;
    })
    .filter((value): value is FollowUp => value !== null);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function nameFrom(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

/**
 * 把一条题目对象映射成行。字段名与领域字段的差异（`dimension` → `dimension_key`）在这里吸收，
 * 非法枚举值一律丢弃而不是写入脏数据。
 */
export function questionToRow(
  raw: unknown,
  owner: { roundId?: string | null; perspectiveCandidateId?: string | null },
  sortOrder: number,
): InterviewQuestionRow {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const category = nameFrom(record, 'category');
  const source = nameFrom(record, 'source');
  const difficulty = nameFrom(record, 'difficulty');
  const status = nameFrom(record, 'status');
  const tier = nameFrom(record, 'tier');

  return {
    id: optionalStr(record.id) ?? crypto.randomUUID(),
    roundId: owner.roundId ?? null,
    perspectiveCandidateId: owner.perspectiveCandidateId ?? null,
    sortOrder,
    dimensionKey: str(record.dimension, 'other'),
    category: category && CATEGORIES.has(category) ? category : null,
    source: source && SOURCES.has(source) ? source : null,
    evidence: str(record.evidence),
    question: str(record.question),
    intent: str(record.intent),
    rubric: record.rubric ?? { excellent: '', pass: '', fail: '' },
    followUps: coerceFollowUps(record.followUps),
    referencePoints: strArray(record.referencePoints),
    referenceAnswer: str(record.referenceAnswer),
    redFlags: record.redFlags ?? null,
    estimatedMinutes: typeof record.estimatedMinutes === 'number' ? record.estimatedMinutes : 5,
    difficulty: difficulty && DIFFICULTIES.has(difficulty) ? difficulty : 'medium',
    answer: str(record.answer),
    timeSpentSec: typeof record.timeSpentSec === 'number' ? record.timeSpentSec : null,
    timedOut: record.timedOut ? 1 : 0,
    tier: tier && TIERS.has(tier) ? tier : null,
    score: typeof record.score === 'number' ? record.score : null,
    markedWeak: record.markedWeak ? 1 : 0,
    status: status && STATUSES.has(status) ? status : 'pending',
    originQuestionId: optionalStr(record.originQuestionId),
  };
}

/** JSON 列里的题目数组 → 行。`raw` 可能是 null / 非数组，一律当作空。 */
export function legacyQuestionsToRows(raw: unknown, perspectiveCandidateId: string): InterviewQuestionRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((question, index) =>
    questionToRow(question, { perspectiveCandidateId }, index),
  );
}

/** 行 → 领域题目。两边方言的布尔/JSON 表示差异在这里收敛。 */
export function rowToQuestion(row: Record<string, unknown>): InterviewQuestion {
  const category = optionalStr(row.category);
  const source = optionalStr(row.source);
  const difficulty = optionalStr(row.difficulty);
  const status = optionalStr(row.status);
  const tier = optionalStr(row.tier);

  return {
    id: str(row.id) || undefined,
    roundId: optionalStr(row.roundId) ?? undefined,
    perspectiveCandidateId: optionalStr(row.perspectiveCandidateId) ?? undefined,
    sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : 0,
    dimension: str(row.dimensionKey, 'other'),
    category: (category && CATEGORIES.has(category) ? category : undefined) as InterviewQuestion['category'],
    source: (source && SOURCES.has(source) ? source : undefined) as InterviewQuestionSource | undefined,
    evidence: str(row.evidence),
    question: str(row.question),
    intent: str(row.intent),
    rubric: (row.rubric ?? { excellent: '', pass: '', fail: '' }) as InterviewQuestion['rubric'],
    followUps: coerceFollowUps(row.followUps),
    referencePoints: strArray(row.referencePoints),
    referenceAnswer: str(row.referenceAnswer) || undefined,
    redFlags: Array.isArray(row.redFlags) ? strArray(row.redFlags) : undefined,
    estimatedMinutes: typeof row.estimatedMinutes === 'number' ? row.estimatedMinutes : 5,
    difficulty: (difficulty && DIFFICULTIES.has(difficulty) ? difficulty : 'medium') as QuestionDifficulty,
    answer: str(row.answer),
    timeSpentSec: typeof row.timeSpentSec === 'number' ? row.timeSpentSec : undefined,
    timedOut: Boolean(row.timedOut),
    tier: (tier && TIERS.has(tier) ? tier : null) as InterviewQuestion['tier'],
    score: typeof row.score === 'number' ? row.score : null,
    markedWeak: Boolean(row.markedWeak),
    status: (status && STATUSES.has(status) ? status : 'pending') as QuestionStatus,
    originQuestionId: optionalStr(row.originQuestionId) ?? undefined,
  };
}
