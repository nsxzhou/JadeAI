import { describe, expect, it } from 'vitest';
import { assembleRoundEvaluation, buildSessionReportNumbers } from './report';
import type { DimensionConfig, InterviewQuestion } from './types';

const question = (overrides: Partial<InterviewQuestion>): InterviewQuestion => ({
  id: 'q1',
  question: '讲讲你的项目',
  intent: '看真实贡献',
  rubric: { excellent: 'a', pass: 'b', fail: 'c' },
  followUps: [],
  referencePoints: [],
  estimatedMinutes: 5,
  difficulty: 'medium',
  dimension: 'general_logic',
  answer: '我做了 X',
  status: 'answered',
  ...overrides,
});

const ai = (id: string, tier: 'excellent' | 'pass' | 'fail', score: number) => ({
  questionId: id,
  tier,
  score,
  answerSummary: 'summary',
  highlights: ['h'],
  weaknesses: ['w'],
});

describe('assembleRoundEvaluation', () => {
  it('服务端把 AI 给的档位内分 clamp 进档位区间', () => {
    const result = assembleRoundEvaluation({
      roundId: 'r1',
      interviewerType: 'technical',
      interviewerName: '张明',
      questions: [
        question({ id: 'q1' }),
        question({ id: 'q2' }),
      ],
      aiEvaluations: [
        // fail 档给 90 分 → 上限 59；excellent 档给 40 → 下限 85
        ai('q1', 'fail', 90),
        ai('q2', 'excellent', 40),
      ],
      feedback: '本轮表现一般',
    });

    expect(result.questions.map((q) => q.score)).toEqual([59, 85]);
    expect(result.questions.map((q) => q.tier)).toEqual(['fail', 'excellent']);
    expect(result.score).toBe(72); // (59 + 85) / 2
  });

  it('档位边界 59/60/61 与 84/85 都落在正确档位', () => {
    const scores = [
      ai('q1', 'fail', 59),
      ai('q2', 'pass', 60),
      ai('q3', 'pass', 61),
      ai('q4', 'pass', 84),
      ai('q5', 'excellent', 85),
    ];
    const result = assembleRoundEvaluation({
      roundId: 'r1',
      interviewerType: 't',
      interviewerName: 'n',
      questions: scores.map((entry, index) => question({ id: `q${index + 1}` })),
      aiEvaluations: scores,
      feedback: 'f',
    });
    expect(result.questions.map((q) => q.score)).toEqual([59, 60, 61, 84, 85]);
  });

  it('有回答但被漏评的题会让整轮失败（可重试），而不是静默给 0 分', () => {
    expect(() => assembleRoundEvaluation({
      roundId: 'r1',
      interviewerType: 't',
      interviewerName: 'n',
      questions: [question({ id: 'q1' }), question({ id: 'q2' })],
      aiEvaluations: [ai('q1', 'pass', 70)],
      feedback: 'f',
    })).toThrow(/missing answered questions: q2/);
  });

  it('没回答的题保留为未作答，不参与平均', () => {
    const result = assembleRoundEvaluation({
      roundId: 'r1',
      interviewerType: 't',
      interviewerName: 'n',
      questions: [
        question({ id: 'q1' }),
        question({ id: 'q2', answer: '', status: 'skipped' }),
      ],
      aiEvaluations: [ai('q1', 'pass', 70)],
      feedback: 'f',
    });
    expect(result.questions[1].answered).toBe(false);
    expect(result.questions[1].skipped).toBe(true);
    expect(result.score).toBe(70);
  });

  it('引用不存在的题目 id 直接报错', () => {
    expect(() => assembleRoundEvaluation({
      roundId: 'r1',
      interviewerType: 't',
      interviewerName: 'n',
      questions: [question({ id: 'q1' })],
      aiEvaluations: [ai('q1', 'pass', 70), ai('ghost', 'pass', 70)],
      feedback: 'f',
    })).toThrow(/unknown question ids: ghost/);
  });

  it('控制标记归到对应题目上', () => {
    const result = assembleRoundEvaluation({
      roundId: 'r1',
      interviewerType: 't',
      interviewerName: 'n',
      questions: [question({ id: 'q1' })],
      aiEvaluations: [ai('q1', 'pass', 70)],
      flags: { q1: { marked: true, hinted: true } },
      feedback: 'f',
    });
    expect(result.questions[0].marked).toBe(true);
    expect(result.questions[0].hinted).toBe(true);
  });
});

describe('buildSessionReportNumbers', () => {
  const dimensions: DimensionConfig[] = [
    { key: 'general_logic', label: '逻辑思维', layer: 'general', weight: 1, custom: false },
    { key: 'middleware_database', label: '数据库', layer: 'family', weight: 2, custom: false },
  ];

  it('维度分与总分全部由服务端按权重算', () => {
    const { overallScore, dimensionScores } = buildSessionReportNumbers(dimensions, [
      question({ id: 'q1', dimension: 'general_logic', score: 80 }),
      question({ id: 'q2', dimension: 'middleware_database', score: 60 }),
      question({ id: 'q3', dimension: 'middleware_database', score: 70 }),
    ]);
    expect(dimensionScores.find((d) => d.key === 'general_logic')?.score).toBe(80);
    expect(dimensionScores.find((d) => d.key === 'middleware_database')?.score).toBe(65);
    // (80*1 + 65*2) / 3 = 70
    expect(overallScore).toBe(70);
  });

  it('一道题都没答的维度 weight 置 0，不拉低总分', () => {
    const { overallScore, dimensionScores } = buildSessionReportNumbers(dimensions, [
      question({ id: 'q1', dimension: 'general_logic', score: 90 }),
    ]);
    expect(dimensionScores.find((d) => d.key === 'middleware_database')?.weight).toBe(0);
    expect(overallScore).toBe(90);
  });
});
