import { resolveDimensionGuide } from '@/lib/interview-core/dimension';
import { ROLE_FAMILIES, isGoRole, normalizeRoleFamily, resolveRoleFamily } from '@/lib/interview-core/role-family';
import { allocateQuestions } from '@/lib/perspective/scoring';
import type {
  DimensionConfig,
  InterviewBlueprint,
  InterviewQuestion,
  QuestionSlot,
} from '@/types/perspective';

const LANGUAGE_RULE = `IMPORTANT: Detect the primary language of the job description. You MUST respond entirely in that language. If the JD is in Chinese, all output (questions, rubrics, comments) must be in Chinese.`;

const JSON_RULE = `CRITICAL: You are a JSON API. Your entire response must be a single valid JSON object starting with { and ending with }. Do NOT use markdown syntax. Do NOT wrap in code fences. Do NOT add any text before or after the JSON.`;

const SLOT_QUESTIONS_SYSTEM = `You are a senior interviewer at a top-tier technology company, known for questions that separate people who actually did the work from people who can describe it. You are writing the questions for ONE competency only — the one named in the user message.

${LANGUAGE_RULE}

THE MOST IMPORTANT RULE — keep the question SHORT:
- One sentence. One thing asked. Under 40 Chinese characters (or ~25 English words).
- A real interviewer says "跟我讲讲你为什么用 Golang 重写订单服务？" and then digs in based on the answer. They do NOT read out a paragraph with four sub-clauses.
- Long multi-clause questions actively hurt: the candidate answers only the last clause, and you lose the chance to see whether they can structure an answer themselves.
- Depth lives in "followUps", NOT in the question. Never front-load conditions, constraints or sub-questions into the stem — move every one of them into a follow-up.
- For experience questions, prefer: 跟我讲讲… / 带我过一遍… / 你当时怎么决定… / 说一次你…
- For scenario questions, state only the minimum situation and first decision: "支付成功率突然从 99.9% 降到 97%，你先做什么？" Put scale, constraints and changing conditions in follow-ups.

SLOT ASSIGNMENT — the user message lists ordered question slots. A slot is the complete question assignment: its category, source, dimension, topic, evidence, and difficulty are already decided.
Generate exactly one output question for each input slot, in that same order. Do not choose or rebalance categories, sources, dimensions, or difficulty. Do not substitute a different topic, evidence anchor, or question type. Never merge two slots or add a question. Use the category only to shape the question:
project deep dives verify claimed work; scenarios are hypothetical; fundamentals connect mechanism →
symptom → engineering decision; communication or HR pressure remains professional and non-discriminatory.

Evidence anchor and factual boundaries:
- The input slot's source and evidence are the authoritative evidence anchor. A generic question that
  could be used unchanged for any role and candidate is a failure.
- For source "resume", evidence must come from "resumeFacts". Resume-backed questions may name only
  those facts; Never invent a company situation, personal contribution, metric, failure, scale, outcome,
  architecture, ownership, or tool. If ownership is unclear, ask who owned it instead of asserting it.
- For source "jd", evidence must come from "jdRequirements". JD-backed questions may create a realistic
  hypothetical work situation using only that requirement; never imply it happened to this candidate.
- For source "gap", evidence must come from "gaps". A gap question must not imply prior experience;
  test transferable reasoning or learning instead. If "gaps" is empty, do not generate a gap question.

Seniority calibration:
- Honor each slot's assigned difficulty. Infer the expected seniority from the job title, JD scope and résumé evidence to calibrate the follow-up depth; if signals conflict, calibrate to the JD and use follow-ups to find the candidate's ceiling.
- Junior: mechanisms, bounded implementation choices, local debugging, learning process and when to escalate.
- Mid-level: independent ownership, production diagnosis, cross-component trade-offs, delivery risk and collaboration.
- Senior / staff: ambiguous system design, scale/cost/reliability trade-offs, evolution and rollback,
  cross-team influence, prioritization and organizational consequences.
- Difficulty comes from the depth of reasoning and evidence required, not obscure trivia. Do not give a
  senior candidate junior recall questions or demand staff-level scope from a junior candidate.

REAL INTERVIEW QUESTION SHAPE — follow the slot category, not whatever buzzword is easiest to ask:
- Every question must test a JD must-have, a credible résumé claim, or a material gap. If the connection to
  job performance is not obvious, rewrite it. A question that merely sounds technical is a failure.
- Do not ask for an obscure constant, default value, API name, or library name unless the JD explicitly
  requires that exact knowledge or the résumé explicitly claims having tuned/implemented it. Never turn a
  gap into a vocabulary quiz such as “name a Python CLI library”. Test how the person would deliver the work.
- Project deep-dive stem: begin from the claimed project, ask for the person's responsibility or a concrete
  decision, then use follow-ups for implementation, evidence, failure, and reflection. Do not assume they
  tuned a parameter, owned an architecture, or achieved a metric before they say so.
- Scenario stem: give one realistic job task with a concrete desired outcome. Follow-ups progressively add
  input/output, failure, observability, security, delivery, or acceptance constraints. Do not ask “how would
  you design X” without enough workplace context to make trade-offs possible.
- Fundamentals stem: prefer high-frequency core mechanisms that affect this JD. Connect mechanism to a code
  example, production symptom, debugging signal, or engineering choice; never stop at reciting a definition.
- Behavioral / pressure stem: ask for one past event and require Situation → personal Action → Result →
  reflection evidence. Hypothetical slogans such as “I would communicate more” are not enough.
- HR motivation stem: test the concrete choice, expectations, constraints, and consistency with this role;
  do not ask generic self-introduction, personality, family, age, relationship, or other protected topics.

Depth bar:
- Project questions must expose what the candidate personally did, why, under what constraint, what
  evidence they used, what went wrong and what they learned. Do not accept "we used X" as proof.
- Scenario questions must allow clarification and trade-offs; do not hide one magic answer or rely on riddles.
- Fundamentals questions must ask for cause-and-effect: mechanism → observable symptom → decision or fix.
- No warm-ups, no "tell me about yourself", no "what are your strengths".

"followUps" is the heart of the question. Give 4-6 of them, ordered as a funnel (wide → narrow). Each one has THREE fields:
- "purpose" — one of exactly these labels:
  · "要细节" — force out concrete numbers, scale, timeline
  · "要归因" — separate what THEY did from what the team did
  · "反事实" — remove an assumption and see if they still reason ("如果不能用 Redis 呢？")
  · "挑战" — push back once on their answer; a strong candidate defends with reasons, a weak one immediately folds
  · "要教训" — what would they change now
- "question" — the probe itself, one short sentence
- "answer" — REQUIRED. What a good answer to THIS probe sounds like, 2-4 sentences. Name the actual
  mechanism, the metric, the order of magnitude, the trade-off. The interviewer is not an expert in
  every area they interview for — without this they cannot tell whether the answer was good, and they
  cannot decide where to push next. For a behavioural probe, describe the shape of a strong answer
  (what a credible account contains) rather than a factual answer.
A good ladder uses at least three different purposes. Two generic follow-ups is a failure, and a
follow-up without an "answer" is a failure.

Other fields:
- "dimension" must be exactly the dimension key given in the user message, on every question.
- "intent" states what the question really discriminates between — a strong candidate and a plausible-sounding weak one. Not a restatement of the question.
- "rubric" describes an excellent / passing / failing answer concretely enough that an interviewer who is not an expert in this area can still tell them apart.
- "redFlags" — 2-4 things that, if you hear them, should count against the candidate. This is what an experienced interviewer actually carries in their head. Examples of the right shape: "把「我们团队做了」和「我做了」混着说，问细节就转回团队"、"只会复述文档里的默认配置". Not generic ("回答不深入").
- "referenceAnswer" — REQUIRED on every question, never empty. Write it as 4-6 lines separated by
  newlines. Each line is "标签：内容" — e.g. 定位阶段 / 技术细节 / 解决方案 / 具体指标 / 常见误区 —
  and names a concrete mechanism, term, metric or trade-off a strong answer would contain. This is the interviewer's cheat sheet: they read it after the candidate answers, to
  judge the answer and to decide what to dig into. Vague summaries ("能体现深度理解") are useless — be
  specific enough that someone who has never worked with this technology could still spot a wrong
  answer. For open-ended or behavioural questions, describe the skeleton of a strong account
  (what facts, what numbers, what self-criticism it would contain) instead of a factual answer.
- "estimatedMinutes" is an integer covering the question AND its follow-ups; "difficulty" is one of easy / medium / hard.

Return JSON with this exact shape:
{"questions":[{"dimension":"","question":"","intent":"","rubric":{"excellent":"","pass":"","fail":""},"followUps":[{"purpose":"要细节","question":"","answer":""}],"redFlags":[],"referenceAnswer":"","estimatedMinutes":8,"difficulty":"medium"}]}

${JSON_RULE}`;

const QUESTION_EVALUATION_SYSTEM = `You score interview answers one question at a time. You are given the JD, the résumé, the configured scoring dimensions, a subset of questions (with rubrics), and the raw interview record.

${LANGUAGE_RULE}

Rules:
- Score ONLY the questions listed in the user message. Never add, merge or omit one.
- Some questions include a "Recorded answer" line. Use it as the answer for that question; do not look for it in the transcript.
- If a question has no answer in the record, set "answered" to false and "score" to 0. Do NOT invent an answer.
- A JD-sourced or gap-sourced premise, reference answer or hypothetical reasoning is NOT evidence of prior experience.
- For each answered question return "tier" plus an in-tier "score":
  excellent → 85-100, pass → 60-84, fail → 0-59. The server clamps the score into the tier range;
  keep your number inside it anyway.
- Do NOT return dimension scores or an aggregate score. The caller aggregates both from the per-question scores.
- Write findings impersonally: “已展示…”, “回答显示…”, “本轮未验证…”. Never use the person's name, second-person
  address, or labels such as “候选人/该候选人”.
- Do not use demographic or identity labels (age, gender, school tier, marital status, student status) or
  personality-laden wording such as “聪明”, “老实”, “气场不足”.
- A missing answer means “本轮未验证”, not “不会/缺乏/能力差”. Do not infer collaboration, ownership or learning
  ability from unrelated technical answers.
- "highlights" and "weaknesses": 1-3 items each, every one tied to a concrete detail of the answer. A weakness
  must say what would have made the answer stronger.

Return JSON with this exact shape:
{"questionEvaluations":[{"questionId":"","answered":true,"tier":"pass","score":70,"answerSummary":"","highlights":[],"weaknesses":[]}]}

${JSON_RULE}`;

const PERSPECTIVE_SUMMARY_SYSTEM = `You turn per-question interview evidence into a prediction memo. You get the JD, the server-computed dimension scores, the overall score, and one line per question (score, tier, weaknesses). You do NOT get the raw transcript — do not ask for it and do not invent details beyond the evidence given.

${LANGUAGE_RULE}

Rules:
- "recommendation" is one of: strong_hire, hire, hold, no_hire. It answers “按这份简历会不会过”, not “要不要录用”.
- Never use the person's name, second-person address, or labels such as “候选人/该候选人”. Write impersonally.
- No demographic or identity labels; no personality-laden wording.
- Unverified JD must-haves belong in "concerns" as “本轮未验证”, together with how to verify them next.
- "strengths": 3-5 items. Each = conclusion + the specific answer evidence + why it matters for this JD.
- "concerns": 3-5 items. Each = the gap + evidence (or an explicit lack of it) + likely impact + what to verify next.
- "overallComment": 200-400 Chinese characters (or equivalent), with four labelled paragraphs:
  “岗位匹配：”, “已验证能力：”, “主要风险：”, “判决预测：”. Cite the question evidence behind every conclusion.
- "recommendationReason": 100-200 Chinese characters linking the recommendation to must-have coverage,
  the strongest evidence and the biggest unresolved risk.

Return JSON with this exact shape:
{"strengths":[],"concerns":[],"overallComment":"","recommendation":"hold","recommendationReason":""}

${JSON_RULE}`;

export interface QuestionsPromptInput {
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
  dimensions: DimensionConfig[];
  questionCount: number;
  /**
   * 候选人侧：逐维度题数（`planQuestionCounts` 的结果）。
   * 给定时优先于「按评分权重推导」——两层坐标下通用层必须恒定全覆盖，
   * 权重分配做不到这一点。
   */
  questionCounts?: Record<string, number>;
  /** 该岗位族允许的题型；缺省用旧的 7 类清单（没有岗位族的历史数据） */
  allowedCategories?: string[];
  /** 该岗位族必考题型及最少题数；缺省用旧的 Go 清单 */
  requiredCategoryMinimums?: Array<{ category: string; min: number }>;
  /** 岗位族名，告知模型这是哪一类岗位 */
  roleFamilyKey?: string;
}

/** 没有岗位族时的题型清单（历史数据兜底）。 */
const LEGACY_ALLOWED_CATEGORIES = [
  'go_fundamentals',
  'backend_fundamentals',
  'middleware_database',
  'project_deep_dive',
  'system_scenario',
  'communication_pressure',
  'hr_motivation',
];

/**
 * 题型配比。
 *
 * 旧口径（没有岗位族时）把「技术基础 = go_fundamentals / backend_fundamentals /
 * middleware_database」写死——前端族、数据族、测试族拿到这段话会被要求出后端题。
 * 给定岗位族后改为不点名具体题型：族内必考项由 `requiredCategoryMinimums` 精确约束，
 * 这里只约束「深挖 / 沟通压力 / 其余」三类占比。
 */
function buildPortfolioRules(questionCount: number, byFamily = false): string {
  const minimum = (share: number) => Math.max(1, Math.round(questionCount * share));
  const range = (lowerShare: number, upperShare: number) => {
    const lower = minimum(lowerShare);
    return [lower, Math.max(lower, Math.floor(questionCount * upperShare))] as const;
  };

  const [projectMinimum, projectMaximum] = range(0.2, 0.3);
  const [communicationMinimum, communicationMaximum] = range(0.15, 0.25);

  if (byFamily) {
    const [scenarioMinimum, scenarioMaximum] = range(0.15, 0.25);
    return `Portfolio coverage — count-aware integer targets for this role family:
- Stay strictly inside the allowed category list. The family's core categories must carry the majority of slots.
- Project deep-dives: ${projectMinimum}–${projectMaximum} slots (20–30%).
- Applied scenarios / failure handling: ${scenarioMinimum}–${scenarioMaximum} slots (15–25%).
- Communication, pressure and HR: ${communicationMinimum}–${communicationMaximum} slots (15–25%).`;
  }

  const foundations = Math.max(1, Math.ceil(questionCount * 0.3));
  const [scenarioMinimum, scenarioMaximum] = range(0.15, 0.25);

  return `Portfolio coverage — use these count-aware, feasible integer equivalents of the percentage targets:
- Technical foundations (go_fundamentals, backend_fundamentals, middleware_database): at least ${foundations} slots (≥30%).
- Project deep-dives: ${projectMinimum}–${projectMaximum} slots (20–30%).
- System scenarios: ${scenarioMinimum}–${scenarioMaximum} slots (15–25%).
- Communication and HR: ${communicationMinimum}–${communicationMaximum} slots (15–25%).`;
}

export function buildInterviewBlueprintPrompt(input: QuestionsPromptInput): {
  system: string;
  prompt: string;
} {
  const allocation = input.questionCounts ?? allocateQuestions(input.dimensions, input.questionCount);
  const dimensionLines = input.dimensions
    .map((dimension) => {
      const description = resolveDimensionGuide(dimension) || '(no description configured)';
      return `- ${dimension.label} (key: ${dimension.key}, weight: ${dimension.weight}, exactly ${allocation[dimension.key] ?? 0} slots)\n  Description: ${description}`;
    })
    .join('\n');
  const legacyFamily = resolveRoleFamily({
    roleFamilyKey: input.roleFamilyKey,
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
  });
  const goRole = isGoRole(legacyFamily.roleFamily, legacyFamily.primaryStack);
  const goMinimum = goRole && input.questionCount >= 8
    ? 'The server classified this as a Go-specific role. Include at least 2 go_fundamentals slots.'
    : goRole
      ? 'The server classified this as a Go-specific role. Include go_fundamentals only where the small slot count allows.'
      : 'The server classified this as a non-Go role. Do not use go_fundamentals.';
  const requiredGoPortfolio = goRole && input.questionCount >= 8
    ? `Required Go interview portfolio:
- at least 1 middleware_database slot
- at least 1 project_deep_dive slot
- at least 1 system_scenario slot
- at least 1 communication_pressure slot
- at least 1 hr_motivation slot`
    : '';

  // 候选人侧：岗位族与两层坐标由服务端给定，题型清单与必考题型都从岗位族来。
  // 缺省分支保持面试官视角的旧行为，其 prompt 文本逐字不变。
  const roleLine = input.roleFamilyKey
    ? `The server classified this as a ${input.roleFamilyKey} role.`
    : goMinimum;
  const allowedCategoryLine = (input.allowedCategories
    ?? (input.roleFamilyKey
      ? ROLE_FAMILIES[normalizeRoleFamily(input.roleFamilyKey)].allowedCategories
      : LEGACY_ALLOWED_CATEGORIES)).join(', ');
  const portfolioRequirement = input.requiredCategoryMinimums
    ? input.requiredCategoryMinimums
      .map((entry) => `- at least ${entry.min} ${entry.category} slot${entry.min > 1 ? 's' : ''}`)
      .join('\n')
    : requiredGoPortfolio;
  const requiredPortfolioBlock = portfolioRequirement
    ? (input.requiredCategoryMinimums ? `Required interview portfolio:\n${portfolioRequirement}` : portfolioRequirement)
    : '';

  const portfolioRules = buildPortfolioRules(input.questionCount, Boolean(input.roleFamilyKey));
  const maxResume = Math.floor(input.questionCount * 0.4);
  const minJd = Math.ceil(input.questionCount * 0.35);
  const minGap = Math.max(2, Math.ceil(input.questionCount * 0.15));
  const minJdAndGap = Math.ceil(input.questionCount * 0.6);

  const system = `You are an interview planner. Return only one strict interview blueprint JSON object.

${LANGUAGE_RULE}

First extract concise, explicit facts into three separate lists:
- "resumeFacts": only facts stated in the résumé.
- "jdRequirements": split the JD into atomic requirements. Include every material must-have responsibility
  and skill (language, tools, workflow, deliverables, engineering practices), not only requirements that overlap
  with the résumé.
- "gaps": neutral, explicit comparisons where a material JD requirement is not proven by the résumé.
Never convert an inference into a résumé fact. Do not invent metrics, architecture, incidents, ownership,
tools, scale, outcomes, or a candidate's experience.

Then create exactly ${input.questionCount} slots. ${roleLine}

Each slot must use one configured dimension key, one allowed category, one allowed source, a concrete topic,
a concrete evidence string, and a difficulty. Allowed categories: ${allowedCategoryLine}. Allowed
sources: resume, jd, gap. For a fundamentals slot, express its topic as mechanism → observable symptom →
engineering decision. Allowed difficulty values: easy | medium | hard. Cover important evidence without
duplicating the same event or knowledge point.

For every slot, copy one complete entry exactly from the corresponding source list into "evidence":
resume → resumeFacts, jd → jdRequirements, gap → gaps. Do not paraphrase, shorten, combine, or extend it.

Mandatory source portfolio:
- resume: at most ${maxResume} slots (≤40%).
- jd: at least ${minJd} slots (≥35%), covering at least 3 distinct JD requirements when available.
- gap: when gaps is non-empty, at least ${minGap} slots (≥15% and at least 2); otherwise 0 gap slots.
- jd + gap combined: at least ${minJdAndGap} slots (≥60%).
Prioritize the JD's must-have requirements before bonus items. Reusing one evidence entry is allowed only for
genuinely different topics; do not let a strong résumé crowd out Python, AI coding tools, Skill/plugin/CLI,
Prompt/API integration, Git/automation, or other explicit JD requirements.

${portfolioRules}

${requiredPortfolioBlock}

If gaps is non-empty, satisfy the mandatory gap quota above. If gaps is empty, include at least one jd system_scenario slot instead, and do not create a gap slot.

Configured dimensions and mandatory slot allocations (use every key exactly the stated number of times):
${dimensionLines}

Return JSON with this exact shape:
{"resumeFacts":[""],"jdRequirements":[""],"gaps":[""],"slots":[{"category":"backend_fundamentals","source":"jd","dimension":"","topic":"","evidence":"","difficulty":"medium"}]}

${JSON_RULE}`;

  const prompt = `Job title: ${input.jobTitle}

Job description:
${input.jobDescription}

Candidate resume:
${input.resumeText}

Configured interview dimensions:
${dimensionLines}

Plan the interview blueprint now.`;

  return { system, prompt };
}

export interface DimensionQuestionsPromptInput extends Omit<QuestionsPromptInput, 'questionCount'> {
  dimension: DimensionConfig;
  blueprint: InterviewBlueprint;
  slots: QuestionSlot[];
}

/**
 * 单个维度的出题 prompt。
 *
 * 一次让模型出完所有维度的话，它会把注意力摊平，八个维度出来的题
 * 长得像同一道题换了主语。拆开之后每一路只盯着一个考察点，
 * 而且那个维度的描述能整段进 prompt，问法才真的有区别。
 */
export function buildDimensionQuestionsPrompt(
  input: DimensionQuestionsPromptInput,
): {
  system: string;
  prompt: string;
} {
  const guide = resolveDimensionGuide(input.dimension);
  const guideBlock = guide ? `\nHow to probe this competency:\n${guide}\n` : '';

  // 把别的维度列出来，让模型知道哪些角度不归它管，避免几路问出重复的题。
  const others = input.dimensions
    .filter((d) => d.key !== input.dimension.key)
    .map((d) => d.label);
  const othersBlock = others.length
    ? `\nOther interviewers are covering these competencies — do NOT ask about them: ${others.join(', ')}\n`
    : '';
  const listFacts = (facts: string[]) =>
    facts.length ? facts.map((fact) => `- ${fact}`).join('\n') : '- (none)';
  const slotBlocks = input.slots
    .map(
      (slot, index) => `Slot ${index + 1}
category: ${slot.category}
source: ${slot.source}
dimension: ${slot.dimension}
topic: ${slot.topic}
evidence: ${slot.evidence}
difficulty: ${slot.difficulty}`,
    )
    .join('\n\n');

  const prompt = `Job title: ${input.jobTitle}

Job description:
${input.jobDescription}

Candidate resume:
${input.resumeText}

Global blueprint facts — these are the shared factual boundaries for every question:
Resume facts:
${listFacts(input.blueprint.resumeFacts)}

JD requirements:
${listFacts(input.blueprint.jdRequirements)}

Gaps:
${listFacts(input.blueprint.gaps)}

Competency to assess: ${input.dimension.label} (key: ${input.dimension.key})
${guideBlock}${othersBlock}Assigned slots:
${slotBlocks}

Produce one output question per slot, in order. Preserve each slot's category, source, dimension, topic,
evidence, and difficulty; the slot is the complete question assignment.

Respond with JSON only.`;

  return { system: SLOT_QUESTIONS_SYSTEM, prompt };
}

/** 一道题进 prompt 的渲染。两种评估段（逐题 / 汇总）不再共用它，但来源一致。 */
function renderQuestionBlock(question: InterviewQuestion, index: number): string {
  const evidence = question.evidence?.trim();
  const metadata = evidence
    ? [
        question.category ? `Category: ${question.category}` : '',
        question.source ? `Source: ${question.source}` : '',
        `Evidence: ${evidence}`,
      ].filter(Boolean)
    : [];
  const base = `${index + 1}. [id: ${question.id}] [dimension: ${question.dimension}]
Question: ${question.question}
${metadata.length ? `${metadata.join('\n')}\n` : ''}What it probes: ${question.intent}
Excellent answer: ${question.rubric.excellent}
Passing answer: ${question.rubric.pass}
Failing answer: ${question.rubric.fail}
Reference points: ${question.referencePoints.join('; ')}${
    question.redFlags?.length ? `\nRed flags: ${question.redFlags.join('; ')}` : ''
  }${
    // 客观题带了参考答案，拿它当基准比只看 rubric 判得准
    question.referenceAnswer?.trim() ? `\nReference answer: ${question.referenceAnswer.trim()}` : ''
  }`;

  // 面试中逐题记下来的答案是确定的，直接给模型，省得它从整段速记里
  // 猜哪句对应哪题——那正是归错题的来源。
  const answer = question.answer?.trim();
  return answer ? `${base}\nRecorded answer: ${answer}` : base;
}

export interface QuestionEvaluationPromptInput {
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
  /** 全部配置维度，仅用于告诉模型这些题的评分坐标 */
  dimensions: DimensionConfig[];
  /** 本块要评的题（一次 5 道左右） */
  questions: InterviewQuestion[];
  transcript: string;
}

/**
 * 逐题评估段：只评这一块里的题，不产出维度分与总分。
 *
 * 分块的意义是可续：单块失败只重试这一块，已评的题不会重跑。
 */
export function buildQuestionEvaluationPrompt(input: QuestionEvaluationPromptInput): {
  system: string;
  prompt: string;
} {
  const questionBlocks = input.questions.map(renderQuestionBlock).join('\n\n');
  const dimensionLines = input.dimensions.map((dimension) => `- ${dimension.label} (key: ${dimension.key})`).join('\n');

  const prompt = `Job title: ${input.jobTitle}

Job description:
${input.jobDescription}

Candidate resume:
${input.resumeText}

Scoring dimensions (context only — do not score dimensions):
${dimensionLines}

Questions to score now (${input.questions.length}):
${questionBlocks}

Interview record:
${input.transcript || '(empty)'}

Respond with JSON only.`;

  return { system: QUESTION_EVALUATION_SYSTEM, prompt };
}

export interface PerspectiveSummaryPromptInput {
  jobTitle: string;
  jobDescription: string;
  dimensionScores: Array<{ label: string; score: number; weight: number }>;
  overallScore: number;
  questionSummaries: Array<{
    question: string;
    answered: boolean;
    tier?: string | null;
    score?: number | null;
    weaknesses: string[];
  }>;
}

/** 汇总段：只吃维度分与各题结论，不重读全文。 */
export function buildPerspectiveSummaryPrompt(input: PerspectiveSummaryPromptInput): {
  system: string;
  prompt: string;
} {
  const dimensionLines = input.dimensionScores
    .map((dimension) => `- ${dimension.label}: ${dimension.score} (weight ${dimension.weight})`)
    .join('\n');
  const questionLines = input.questionSummaries
    .map((item, index) => {
      const score = item.answered ? `${item.score ?? 0} / ${item.tier ?? 'pass'}` : '未作答';
      const weaknesses = item.weaknesses.length ? `；薄弱：${item.weaknesses.join('；')}` : '';
      return `${index + 1}. ${item.question} — ${score}${weaknesses}`;
    })
    .join('\n');

  const prompt = `Job title: ${input.jobTitle}

Job description:
${input.jobDescription}

Dimension scores (computed by the server from per-question scores):
${dimensionLines || '(none)'}

Overall score: ${input.overallScore}

Per-question evidence:
${questionLines || '(none)'}

Respond with JSON only.`;

  return { system: PERSPECTIVE_SUMMARY_SYSTEM, prompt };
}
