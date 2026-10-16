/**
 * 蓝图：先规划整场的题型与知识覆盖，再按维度并发逐槽位生成，最后服务端硬校验。
 *
 * 这份逻辑从面试官视角那套已被验证的实现里泛化而来：槽位数、维度配额、evidence
 * 精确匹配、岗位族题型配额都在服务端校验，模型返回的蓝图只要有一项对不上就整次
 * 作废——绝不半信半疑地落库。
 */
import type {
  DimensionConfig,
  InterviewBlueprint,
  InterviewQuestion,
  PrimaryStack,
  QuestionSlot,
  RoleFamilyKey,
} from './types';
import { planQuestionCounts } from './dimension';
import { canonicalizeBlueprintEvidence, normalizeEvidence, sourceListName } from './evidence';
import { isGoRole, ROLE_FAMILIES } from './role-family';

export type IndexedQuestionSlot = QuestionSlot & { slotIndex: number };

export interface GeneratedGroup {
  slots: IndexedQuestionSlot[];
  questions: InterviewQuestion[];
}

export interface ValidateBlueprintOptions {
  questionCount: number;
  dimensions: DimensionConfig[];
  roleFamily: RoleFamilyKey;
  primaryStack: PrimaryStack;
  /** 面试官视角逐维度可调时传入；缺省用 planQuestionCounts 推导 */
  questionCounts?: Record<string, number>;
  enforceJdCoverage?: boolean;
}

function expectedCountsFor(options: ValidateBlueprintOptions): Record<string, number> {
  if (options.questionCounts) return options.questionCounts;
  return planQuestionCounts({
    general: options.dimensions.filter((d) => d.layer === 'general'),
    family: options.dimensions.filter((d) => d.layer === 'family'),
    total: options.questionCount,
  });
}

/**
 * 校验蓝图。任何一项不满足都抛错——调用方据此放弃整次生成，不落库、不覆盖旧题。
 */
export function validateBlueprint(
  input: InterviewBlueprint,
  options: ValidateBlueprintOptions,
): InterviewBlueprint {
  if (input.slots.length !== options.questionCount) {
    throw new Error(
      `Blueprint must contain exactly ${options.questionCount} slots; received ${input.slots.length}.`,
    );
  }

  const configuredDimensions = new Set(options.dimensions.map((dimension) => dimension.key));
  const expectedDimensionCounts = expectedCountsFor(options);
  const allowedCategories = new Set(ROLE_FAMILIES[options.roleFamily].allowedCategories);
  const actualDimensionCounts = new Map<string, number>();
  const categoryCounts = new Map<QuestionSlot['category'], number>();
  const sourceCounts = new Map<QuestionSlot['source'], number>();
  const distinctJdEvidence = new Set<string>();
  const evidenceBySource = {
    resume: new Set(input.resumeFacts.map(normalizeEvidence)),
    jd: new Set(input.jdRequirements.map(normalizeEvidence)),
    gap: new Set(input.gaps.map(normalizeEvidence)),
  } satisfies Record<QuestionSlot['source'], Set<string>>;

  for (const slot of input.slots) {
    if (!configuredDimensions.has(slot.dimension)) {
      throw new Error(`Blueprint slot dimension "${slot.dimension}" is not configured.`);
    }

    if (!allowedCategories.has(slot.category)) {
      throw new Error(
        `Blueprint category "${slot.category}" is not allowed for role family "${options.roleFamily}".`,
      );
    }

    if (!slot.topic.trim()) {
      throw new Error('Blueprint slot topic must not be empty.');
    }

    if (!slot.evidence.trim()) {
      throw new Error('Blueprint slot evidence must not be empty.');
    }

    if (!evidenceBySource[slot.source].has(normalizeEvidence(slot.evidence))) {
      throw new Error(
        `Blueprint ${slot.source} evidence must exactly match an entry in ${sourceListName(slot.source)}.`,
      );
    }

    actualDimensionCounts.set(slot.dimension, (actualDimensionCounts.get(slot.dimension) ?? 0) + 1);
    categoryCounts.set(slot.category, (categoryCounts.get(slot.category) ?? 0) + 1);
    sourceCounts.set(slot.source, (sourceCounts.get(slot.source) ?? 0) + 1);
    if (slot.source === 'jd') distinctJdEvidence.add(normalizeEvidence(slot.evidence));
  }

  if (options.enforceJdCoverage) {
    const resumeCount = sourceCounts.get('resume') ?? 0;
    const jdCount = sourceCounts.get('jd') ?? 0;
    const gapCount = sourceCounts.get('gap') ?? 0;
    const maxResume = Math.floor(options.questionCount * 0.4);
    const minJd = Math.ceil(options.questionCount * 0.35);
    const minJdAndGap = Math.ceil(options.questionCount * 0.6);
    const minGap = input.gaps.length > 0
      ? Math.max(2, Math.ceil(options.questionCount * 0.15))
      : 0;
    const minDistinctJd = Math.min(3, input.jdRequirements.length, minJd);

    if (resumeCount > maxResume) {
      throw new Error(`Blueprint may use at most ${maxResume} resume-sourced slots; received ${resumeCount}.`);
    }
    if (jdCount < minJd) {
      throw new Error(`Blueprint requires at least ${minJd} JD-sourced slots; received ${jdCount}.`);
    }
    if (gapCount < minGap) {
      throw new Error(`Blueprint requires at least ${minGap} gap-sourced slots; received ${gapCount}.`);
    }
    if (jdCount + gapCount < minJdAndGap) {
      throw new Error(`Blueprint requires at least ${minJdAndGap} JD-or-gap slots.`);
    }
    if (distinctJdEvidence.size < minDistinctJd) {
      throw new Error(`Blueprint must cover at least ${minDistinctJd} distinct JD requirements.`);
    }
  }

  for (const dimension of options.dimensions) {
    const expected = expectedDimensionCounts[dimension.key] ?? 0;
    const actual = actualDimensionCounts.get(dimension.key) ?? 0;
    if (actual !== expected) {
      throw new Error(
        `Blueprint dimension "${dimension.key}" must contain exactly ${expected} slots; received ${actual}.`,
      );
    }
  }

  const goCount =
    (categoryCounts.get('go_fundamentals') ?? 0)
    + (actualDimensionCounts.get('go_fundamentals') ?? 0);
  if (isGoRole(options.roleFamily, options.primaryStack) && options.questionCount >= 8 && goCount < 2) {
    throw new Error('Go roles require at least two go_fundamentals slots.');
  }

  // 非 Go 堆栈不得生成 Go 类题。这条同时防两种写法：category 与 dimension。
  if (!isGoRole(options.roleFamily, options.primaryStack) && goCount > 0) {
    throw new Error('Non-Go stacks must not include go_fundamentals slots.');
  }

  // 题数够多时，族自带的必考题型必须出现（反问环节是固定末槽，不算在必考里）。
  if (options.questionCount >= 8) {
    for (const category of ROLE_FAMILIES[options.roleFamily].requiredCategories) {
      if ((categoryCounts.get(category) ?? 0) < 1) {
        throw new Error(
          `Role family "${options.roleFamily}" with at least eight questions requires a ${category} slot.`,
        );
      }
    }
  }

  return {
    resumeFacts: [...input.resumeFacts],
    jdRequirements: [...input.jdRequirements],
    gaps: [...input.gaps],
    slots: input.slots.map((slot) => ({ ...slot })),
  };
}

/** 按维度把槽位分组，便于按维度并发调用模型；slotIndex 保留全局顺序。 */
export function groupBlueprintSlots(
  slots: QuestionSlot[],
): Array<{ dimension: string; slots: IndexedQuestionSlot[] }> {
  const groups = new Map<string, IndexedQuestionSlot[]>();

  for (const [slotIndex, slot] of slots.entries()) {
    const indexedSlot = { ...slot, slotIndex };
    const dimensionSlots = groups.get(slot.dimension);
    if (dimensionSlots) {
      dimensionSlots.push(indexedSlot);
    } else {
      groups.set(slot.dimension, [indexedSlot]);
    }
  }

  return Array.from(groups, ([dimension, dimensionSlots]) => ({
    dimension,
    slots: dimensionSlots,
  }));
}

/** 模型只决定题干内容；category / source / dimension / evidence / difficulty 以槽位为准。 */
export function bindQuestionsToSlots(
  raw: InterviewQuestion[],
  slots: QuestionSlot[],
): InterviewQuestion[] {
  const count = Math.min(raw.length, slots.length);

  return Array.from({ length: count }, (_, index) => ({
    ...raw[index],
    category: slots[index].category,
    source: slots[index].source,
    dimension: slots[index].dimension,
    evidence: slots[index].evidence,
    difficulty: slots[index].difficulty,
  }));
}

/** 汇总各维度生成结果，按槽位顺序还原成整场题目。数量对不上即整次失败。 */
export function assembleGeneratedQuestions(
  groups: GeneratedGroup[],
  plannedCount: number,
): InterviewQuestion[] {
  for (const group of groups) {
    if (group.questions.length !== group.slots.length) {
      throw new Error(
        `Expected exactly ${group.slots.length} generated questions for dimension "${group.slots[0]?.dimension ?? 'unknown'}"; received ${group.questions.length}.`,
      );
    }
  }

  const ordered = groups
    .flatMap((group) => {
      const bound = bindQuestionsToSlots(group.questions, group.slots);
      return bound.map((question, index) => ({ question, slotIndex: group.slots[index].slotIndex }));
    })
    .sort((left, right) => left.slotIndex - right.slotIndex);

  if (ordered.length !== plannedCount) {
    throw new Error(
      `Expected exactly ${plannedCount} generated questions; received ${ordered.length}.`,
    );
  }

  return ordered.map(({ question }) => question);
}

export { canonicalizeBlueprintEvidence };
