/**
 * 反问环节。
 *
 * 每场最后一个槽位固定是「候选人向面试官提问」：它在预设题数之外，
 * 题型是 `candidate_questions`，计入通用层的沟通表达——提问质量本身也是可评估的。
 */
import type { InterviewQuestion } from './types';

export const CANDIDATE_QUESTIONS_DIMENSION = 'general_communication';

/** 反问槽位的内容随面试语言给出。 */
export function candidateQuestionsSlot(locale: string): InterviewQuestion {
  if (locale === 'zh') {
    return {
      id: crypto.randomUUID(),
      dimension: CANDIDATE_QUESTIONS_DIMENSION,
      category: 'candidate_questions',
      source: 'jd',
      evidence: '（反问环节，不需要简历依据）',
      question: '面试到这里差不多了，你有什么想问我的？',
      intent: '看你关心什么、怎么提问：是否问到岗位职责、团队协作、技术栈或成长路径这些真正影响判断的事，而不是只问薪资和加班。',
      rubric: {
        excellent: '问到与岗位和团队直接相关的实质问题，问题有准备、能追问，显示出对这份工作的认真考虑。',
        pass: '至少问了一个具体问题，能听出对岗位有关注。',
        fail: '没有问题可问，或只问与工作判断无关的泛泛问题。',
      },
      followUps: [],
      referencePoints: ['岗位实际职责', '团队协作方式', '技术栈与工程实践', '成长与评价机制'],
      referenceAnswer: '围绕岗位职责、团队现状、技术决策与成长路径提出两三个具体问题，并针对回答继续追问。',
      estimatedMinutes: 3,
      difficulty: 'easy',
      status: 'pending',
    };
  }

  return {
    id: crypto.randomUUID(),
    dimension: CANDIDATE_QUESTIONS_DIMENSION,
    category: 'candidate_questions',
    source: 'jd',
    evidence: '(reversal segment — no resume evidence needed)',
    question: "That's about it from my side — what questions do you have for me?",
    intent: 'See what you care about and how you ask. Did you ask about the actual responsibilities, how the team works, the stack, or growth — rather than only pay and hours?',
    rubric: {
      excellent: 'Asks substantive questions tied to the role and team, prepared and able to follow up — a sign of genuine consideration.',
      pass: 'Asks at least one concrete question that shows interest in the role.',
      fail: 'Has no questions, or only asks generic questions unrelated to judging the job.',
    },
    followUps: [],
    referencePoints: ['Actual responsibilities', 'How the team works', 'Stack and engineering practice', 'Growth and evaluation'],
    referenceAnswer: 'Ask two or three concrete questions about responsibilities, the team, technical decisions and growth, then follow up on the answers.',
    estimatedMinutes: 3,
    difficulty: 'easy',
    status: 'pending',
  };
}
