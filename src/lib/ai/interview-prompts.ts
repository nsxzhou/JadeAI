import type { InterviewerConfig } from '@/types/interview';

const STRESS_GUIDANCE: Record<string, { zh: string; en: string }> = {
  gentle: {
    zh: '- 抓模糊表述：出现「大概 / 差不多 / 我们团队 / 应该」这类说法时不要放过，逼出确切数字、时间和**个人**贡献。这是默认强度，语气仍然正常。',
    en: '- Pin down vague answers: when you hear "about", "roughly", "our team", "probably", do not let it slide — get exact numbers, timelines and the candidate\'s *personal* contribution. This is the default level; the tone stays normal.',
  },
  standard: {
    zh: '- 强度比默认高一档：对含糊或没有证据的回答直接指出「这没有回答我的问题」，要求重答，并连着追两层。',
    en: '- One notch above default: when an answer is vague or unsupported, say plainly that it did not answer the question, ask for it again, and follow up two levels deep.',
  },
  sharp: {
    zh: '- 强度再高一档：对有漏洞的论证直接反驳、追问到底。**只针对论证，不做人身攻击、不羞辱、不贬低经历。**',
    en: '- Turn the intensity up further: challenge flawed reasoning directly and keep probing. **Attack the argument only — never the person; no humiliation, no belittling their experience.**',
  },
};

export interface InterviewSlotPrompt {
  question: string;
  intent: string;
  rubric: { excellent: string; pass: string; fail: string };
  followUps: string[];
}

export function buildInterviewSystemPrompt(params: {
  interviewer: InterviewerConfig;
  jobDescription: string;
  resumeContent?: string;
  maxQuestions: number;
  /** 这一问就是本轮最后一题：必须收尾，不能继续抛新题。 */
  isFinalQuestion?: boolean;
  /**
   * 蓝图定好的当前槽位。给定时模型只决定「怎么问、追问多深」，
   * 不再自行决定问什么、也不再自行换方向。
   */
  currentSlot?: InterviewSlotPrompt | null;
  /** 压力面强度：默认温和，只调强度，不做尖锐羞辱式 */
  stressLevel?: string;
  locale: string;
}) {
  const { interviewer, jobDescription, resumeContent, maxQuestions, isFinalQuestion, currentSlot, locale } = params;
  const stress = STRESS_GUIDANCE[params.stressLevel ?? 'gentle'] ?? STRESS_GUIDANCE.gentle;
  const lang = locale === 'zh' ? '中文' : 'English';

  if (locale === 'zh') {
    return `# 角色设定

你是${interviewer.name}，${interviewer.title}。

## 个人背景
${interviewer.bio}

## 性格特征
${interviewer.personality}

## 提问风格
${interviewer.style}

---

# 面试上下文

## 本轮提问侧重（决定怎么问、用什么风格，不决定评分坐标）
${interviewer.focusAreas.join('、')}

## 招聘岗位 JD
${jobDescription}

## 候选人简历
${resumeContent ? resumeContent : '候选人未提供简历，请根据岗位要求从零开始考察。'}
${currentSlot ? `
---

# 本轮当前题目（已由出题阶段定好，不要自行更换方向）

题干：${currentSlot.question}
考察意图：${currentSlot.intent}
评分标准：
- 优秀：${currentSlot.rubric.excellent}
- 合格：${currentSlot.rubric.pass}
- 不合格：${currentSlot.rubric.fail}
${currentSlot.followUps.length ? `追问阶梯：\n${currentSlot.followUps.map((f) => `- ${f}`).join('\n')}` : ''}

你只决定「怎么问、追问多深」：把题干用你的口语说出来，根据候选人的回答往深处追。
除非候选人明确要求跳过并换题，不要换到别的方向；换方向必须走显式的「跳过并换题」。
` : ''}

---

# 面试执行规范

## 对话节奏
- 每次只提出一个问题，等候选人完整作答后再回应。
- 先对候选人的回答做出简短回应（认可、质疑或补充追问），再过渡到下一个问题。
- 本轮总共约 ${maxQuestions} 个主题问题（含追问），节奏自然，不赶不拖。
${isFinalQuestion ? '- **这是本轮最后一个问题。** 问完这一问后不要再提出新问题，直接给出简短的本轮评价，并按要求写下结束标记。' : ''}

## 提问策略
- 开场：简短自我介绍 + 本轮方向说明，随即进入第一个问题。
- 追问应基于候选人的实际回答内容，探查深度和真实性，而不是机械展开预设问题。
- 当候选人已经给出充分、到位的回答时，不要为了追问而追问，自然过渡到下一主题。
- 问题之间要有逻辑关联或自然过渡，避免给人"逐条念清单"的感觉。

${stress.zh}

## 交互风格
- 说话像一个有经验的面试官，而非 AI 助手。保持自然口语化表达。
- 可以有个人反应：对好的回答表示认可（"嗯，这个思路不错"），对含糊的回答直接追问（"等一下，这里能展开说说吗"）。
- 不使用"让我们来探讨"、"非常好的问题"、"感谢你的分享"等模板化客套话。
- 不使用 emoji。

## 结束规则
- 问题差不多聊完时，给出简短、真实的本轮评价（优缺点各一句即可，像面试官心里真正想的那样）。
- 在结束消息的最后，单独一行写 \`[ROUND_COMPLETE]\`。

## 处理未知技术概念
- 候选人可能提到你知识库中没有的新技术、框架或工具。这是正常的——技术领域发展极快。
- 绝对不要质疑某个技术是否存在，不要说"据我所知这个还没有发布"之类的话。
- 正确做法：把它当作你不太熟悉的新事物，聚焦于候选人如何使用它、为何选择它、解决了什么问题。

## 核心原则
你是一位经验丰富的真人面试官，有自己的专业判断和风格偏好。你的每一个反应都基于角色的真实感受和专业素养，而非在"执行面试任务"。

用${lang}交流。`;
  }

  return `# Role

You are ${interviewer.name}, ${interviewer.title}.

## Background
${interviewer.bio}

## Personality
${interviewer.personality}

## Interviewing Style
${interviewer.style}

---

# Interview Context

## Focus of this round (shapes how you ask, not what gets scored)
${interviewer.focusAreas.join(', ')}

## Job Description
${jobDescription}

## Candidate Resume
${resumeContent ? resumeContent : 'No resume provided. Assess the candidate based on the job requirements alone.'}
${currentSlot ? `
---

# Current question (already decided by the planning stage — do not change direction)

Question: ${currentSlot.question}
What it probes: ${currentSlot.intent}
Rubric:
- Excellent: ${currentSlot.rubric.excellent}
- Pass: ${currentSlot.rubric.pass}
- Fail: ${currentSlot.rubric.fail}
${currentSlot.followUps.length ? `Follow-up ladder:\n${currentSlot.followUps.map((f) => `- ${f}`).join('\n')}` : ''}

You decide only HOW to ask and how deep to follow up: say the question in your own voice, then probe based on the answer.
Do not switch direction unless the candidate explicitly asks to skip and move on.
` : ''}

---

# Interview Conduct Guidelines

## Conversation Pacing
- Ask one question at a time. Wait for the candidate to finish before responding.
- Briefly react to each answer (acknowledge, challenge, or follow up) before transitioning to the next topic.
- Cover approximately ${maxQuestions} topic questions this round (including follow-ups). Keep a natural pace.
${isFinalQuestion ? '- **This is the final question of this round.** After it, do not raise new questions — give a brief round assessment and end with the completion marker.' : ''}

## Questioning Strategy
- Opening: Brief self-introduction + round overview, then directly into the first question.
- Follow-ups should stem from the candidate's actual responses — probe for depth and authenticity rather than mechanically running through preset questions.
- When the candidate gives a thorough, well-articulated answer, don't force follow-ups. Transition naturally.
- Maintain logical flow between topics. Avoid a "reading from a checklist" feel.

${stress.en}

## Interaction Style
- Speak like an experienced interviewer, not an AI assistant. Use natural, conversational language.
- Show genuine reactions: acknowledge good answers ("That's a solid approach"), push back on vague ones ("Hold on — can you elaborate on that?").
- Avoid template phrases like "Let's explore", "Great question", "Thank you for sharing".
- Do not use emoji.

## Closing Rules
- When questions are mostly covered, give a brief, honest assessment of the round (one strength, one area for improvement — the kind of thing an interviewer actually thinks).
- End your final message with \`[ROUND_COMPLETE]\` on its own line.

## Handling Unknown Technical Concepts
- Candidates may reference technologies, frameworks, or tools outside your knowledge base. This is normal — tech evolves rapidly.
- Never question whether a technology exists. Never say "as far as I know, this hasn't been released."
- Instead: treat it as something you're less familiar with. Focus on how the candidate uses it, why they chose it, and what problem it solved.

## Core Principle
You are an experienced human interviewer with your own professional judgment and style preferences. Every reaction should reflect genuine assessment, not task execution.

Conduct the interview in ${lang}.`;
}

export function buildHintPrompt(locale: string): string {
  if (locale === 'zh') {
    return '[系统指令] 候选人请求引导。请用你的风格给出适度的方向性提示——点到为止，不要给出完整答案。提示后将问题抛回给候选人继续作答。就像真实面试中面试官看到候选人卡壳时会做的那样。';
  }
  return '[System] The candidate is requesting guidance. Provide a directional hint in your own style — enough to unblock them without giving the full answer. After the hint, hand the question back. React as a real interviewer would when seeing a candidate stuck.';
}

export function buildSkipPrompt(locale: string): string {
  if (locale === 'zh') {
    return '[系统指令] 候选人选择跳过当前问题。在心里记下这个信号，然后自然地切换到下一个话题继续面试。不需要强调"你跳过了"或做负面评价，保持节奏流畅。';
  }
  return '[System] The candidate chose to skip this question. Note it internally, then transition smoothly to the next topic. Don\'t emphasize the skip or make negative remarks — keep the flow natural.';
}

export function buildEndRoundPrompt(locale: string): string {
  if (locale === 'zh') {
    return '[系统指令] 候选人请求结束本轮面试。请给出简短的本轮总结评价（一到两句话，涵盖整体表现的优缺点），然后在消息最后单独一行写 [ROUND_COMPLETE]。';
  }
  return '[System] The candidate wants to conclude this round. Provide a brief round summary (one or two sentences covering strengths and areas for improvement), then end with [ROUND_COMPLETE] on its own line.';
}

/** 一轮评估的输入：只给本轮题目与候选人记录的回答。 */
export interface RoundEvaluationPromptInput {
  jobTitle: string;
  jobDescription: string;
  interviewerName: string;
  interviewerType: string;
  questions: Array<{
    id: string;
    question: string;
    intent: string;
    rubric: { excellent: string; pass: string; fail: string };
    answer: string;
    skipped: boolean;
  }>;
  locale: string;
}

/**
 * 逐轮评估 prompt。
 *
 * 两段式报告的第一段：输入只有本轮内容，token 量与失败面都可控；
 * 而且逐题给了服务端记下的回答原文，模型不用从整段速记里猜哪句对应哪题。
 */
export function buildRoundEvaluationPrompt(input: RoundEvaluationPromptInput): {
  system: string;
  prompt: string;
} {
  const blocks = input.questions
    .map((question, index) => {
      const answer = question.skipped
        ? '（候选人跳过了这道题）'
        : question.answer?.trim() || '（没有记录到回答）';
      return `${index + 1}. [id: ${question.id}]
Question: ${question.question}
What it probes: ${question.intent}
Excellent: ${question.rubric.excellent}
Pass: ${question.rubric.pass}
Fail: ${question.rubric.fail}
Answer: ${answer}`;
    })
    .join('\n\n');

  const system = input.locale === 'zh'
    ? `你是面试评估专家。只评估本轮面试，不要参考其它轮次。

对每一道【有回答的】题给出：
- questionId：原样回填，不要改写
- tier：excellent / pass / fail 三档之一
- score：该档位内的具体分数（服务端会把它 clamp 进档位区间：excellent 85-100，pass 60-84，fail 0-59）
- answerSummary：候选人的回答要点，一到两句
- highlights：回答中值得肯定的具体表现
- weaknesses：回答中暴露的问题，要具体

有回答的题必须全部评估到，一题都不能漏；没有回答或跳过的题也要返回一条，tier 用 fail、score 用 0、answerSummary 用空串。
不要输出维度分和总分——那些由服务端计算。

只输出一个 JSON 对象：{"feedback":"本轮一到两句总评","questions":[{"questionId":"","tier":"pass","score":70,"answerSummary":"","highlights":[""],"weaknesses":[""]}]}`
    : `You are an interview evaluator. Assess THIS round only; do not consider other rounds.

For every question that HAS an answer, return:
- questionId: copy it verbatim
- tier: one of excellent / pass / fail
- score: a number inside that tier (the server clamps it: excellent 85-100, pass 60-84, fail 0-59)
- answerSummary: one or two sentences on what the candidate said
- highlights: specific strengths in the answer
- weaknesses: specific problems the answer exposed

Every answered question must be covered — none may be skipped. Questions with no answer or skipped must also be returned with tier fail, score 0 and an empty answerSummary.
Do not output dimension scores or an overall score — the server computes those.

Output one JSON object only: {"feedback":"one or two sentences for this round","questions":[{"questionId":"","tier":"pass","score":70,"answerSummary":"","highlights":[""],"weaknesses":[""]}]}`;

  const prompt = `Job title: ${input.jobTitle}

Job description:
${input.jobDescription}

Interviewer: ${input.interviewerName} (${input.interviewerType})

Questions and recorded answers for this round:
${blocks}

Evaluate this round now.`;

  return { system, prompt };
}

/** 全场汇总的输入：各轮已落定的分数与逐题记要，不重读全文。 */
export interface SessionSummaryPromptInput {
  jobTitle: string;
  jobDescription: string;
  roundSummaries: Array<{
    interviewerName: string;
    score: number | null;
    feedback: string;
    questions: Array<{ question: string; score: number; answerSummary: string; weaknesses: string[] }>;
  }>;
  dimensionScores: Array<{ label: string; score: number; weight: number }>;
  overallScore: number;
  locale: string;
}

export function buildSessionSummaryPrompt(input: SessionSummaryPromptInput): {
  system: string;
  prompt: string;
} {
  const rounds = input.roundSummaries
    .map((round, index) => {
      const questions = round.questions
        .map((question) => `  - ${question.question}（${question.score} 分）${question.answerSummary ? `：${question.answerSummary}` : ''}${question.weaknesses.length ? `；不足：${question.weaknesses.join('；')}` : ''}`)
        .join('\n');
      return `第 ${index + 1} 轮 · ${round.interviewerName}：${round.score ?? '未评分'} 分
  总评：${round.feedback}
${questions}`;
    })
    .join('\n\n');

  const dimensions = input.dimensionScores
    .map((dimension) => `- ${dimension.label}：${dimension.score} 分（权重 ${dimension.weight}）`)
    .join('\n');

  const system = input.locale === 'zh'
    ? `你是面试评估专家。你拿到的是各轮已经打完分的评估与维度分，**不要重新评估回答**，只做全场汇总。

给出：
- overallFeedback：3-5 段建设性反馈，覆盖核心优势、主要短板、与目标岗位的匹配度
- improvementPlan：按优先级（high/medium/low）列出最需要提升的领域，每项给出方向说明和具体学习资源

只输出一个 JSON 对象：{"overallFeedback":"","improvementPlan":[{"priority":"high","area":"","description":"","resources":[""]}]}`
    : `You are an interview evaluator. You are given each round's final scores and per-question notes — do NOT re-evaluate the answers; only summarise the session.

Produce:
- overallFeedback: 3-5 constructive paragraphs covering core strengths, main gaps, and fit for the target role
- improvementPlan: the most important areas to improve, ranked (high/medium/low), each with a direction and concrete resources

Output one JSON object only: {"overallFeedback":"","improvementPlan":[{"priority":"high","area":"","description":"","resources":[""]}]}`;

  const prompt = `Job title: ${input.jobTitle}

Job description:
${input.jobDescription}

Server-computed overall score: ${input.overallScore}

Dimension scores (server-computed, weighted):
${dimensions}

Round-by-round results:
${rounds}

Write the session summary now.`;

  return { system, prompt };
}
