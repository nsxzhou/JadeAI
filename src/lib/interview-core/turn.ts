/**
 * 对话式面试的回合推进。
 *
 * 题目由蓝图决定（「问什么」），对话只决定「怎么问、追问多深」。这个纯函数把
 * 「候选人的这条消息对应哪道题、下一步该问哪道、本轮是否结束」从路由里抽出来，
 * 路由只负责落库与调模型。
 *
 * 一道题 = 一个槽位：追问不单独计时、不计题，其问答作为该题的证据进报告。
 */
import type { QuestionStatus } from './types';

export interface TurnQuestionState {
  id: string;
  status: QuestionStatus;
}

/** 候选人这一条消息的性质。 */
export type CandidateTurnKind =
  /** 真实回答 */
  | 'answer'
  /** 主动跳过并换题 */
  | 'skip'
  /** 请求提示：题目不变，继续在这道题上追 */
  | 'hint'
  /** 开场触发语或没有对应题目 */
  | 'none';

export interface TurnPlan {
  /** 这条候选人消息属于哪道题（没有则为 null） */
  answeringQuestionId: string | null;
  /** 本回合应当提问的题；null 表示本轮题目已问完，该收尾了 */
  askQuestionId: string | null;
  /** 本回合处理完后，本轮是否已全部解决 */
  roundResolved: boolean;
}

const RESOLVED: QuestionStatus[] = ['answered', 'skipped', 'timed_out'];

function isResolved(status: QuestionStatus): boolean {
  return RESOLVED.includes(status);
}

/** 当前被问到、尚未解决的那道题。currentQuestionId 失效时退回到最后一道 asked。 */
function askedQuestionId(questions: TurnQuestionState[], currentQuestionId: string | null): string | null {
  if (currentQuestionId) {
    const match = questions.find((question) => question.id === currentQuestionId);
    if (match && !isResolved(match.status)) return match.id;
  }
  const asked = [...questions].reverse().find((question) => question.status === 'asked');
  if (asked) return asked.id;
  // 没有任何题被问过时，把第一条未解决的题当成「正在问」
  return questions.find((question) => !isResolved(question.status))?.id ?? null;
}

export function planInterviewTurn(input: {
  questions: TurnQuestionState[];
  currentQuestionId: string | null;
  candidateTurn: CandidateTurnKind;
}): TurnPlan {
  const states = input.questions.map((question) => ({ ...question }));
  const answeringQuestionId = input.candidateTurn === 'none'
    ? null
    : askedQuestionId(states, input.currentQuestionId);

  if (answeringQuestionId && input.candidateTurn === 'answer') {
    const target = states.find((question) => question.id === answeringQuestionId);
    if (target) target.status = 'answered';
  }
  if (answeringQuestionId && input.candidateTurn === 'skip') {
    const target = states.find((question) => question.id === answeringQuestionId);
    if (target) target.status = 'skipped';
  }

  const ask = states.find((question) => !isResolved(question.status))?.id ?? null;
  return {
    answeringQuestionId,
    askQuestionId: ask,
    roundResolved: states.every((question) => isResolved(question.status)),
  };
}

/** 本轮已解决的题数（用于进度展示与「到最后一题」判定）。 */
export function resolvedQuestionCount(questions: TurnQuestionState[]): number {
  return questions.filter((question) => isResolved(question.status)).length;
}
