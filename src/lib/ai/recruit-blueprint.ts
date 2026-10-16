/**
 * 面试官视角侧的蓝图入口。
 *
 * 泛化后的实现住在 `@/lib/interview-core/blueprint`——两个模式共用同一套槽位
 * 校验与装配。这里只留一层薄适配：面试官视角仍用 `isGoRole` 布尔值（它会由
 * 岗位族 + 语言栈重新推出），候选人侧直接用新签名。
 */
import type { DimensionConfig, InterviewBlueprint, InterviewQuestion } from '@/lib/interview-core/types';
import {
  assembleGeneratedQuestions as assembleCore,
  bindQuestionsToSlots as bindCore,
  canonicalizeBlueprintEvidence,
  groupBlueprintSlots as groupCore,
  validateBlueprint as validateCore,
} from '@/lib/interview-core/blueprint';
import { isGoRole, resolveRoleFamily } from '@/lib/interview-core/role-family';

export type { GeneratedGroup, IndexedQuestionSlot } from '@/lib/interview-core/blueprint';
export { canonicalizeBlueprintEvidence };

export const groupBlueprintSlots = groupCore;
export const bindQuestionsToSlots = bindCore;
export const assembleGeneratedQuestions = assembleCore;

/**
 * @deprecated 用 `resolveRoleFamily` + `isGoRole` 代替。
 * 保留这个名字只为过渡期调用点；正则判定已经删除。
 */
export function detectGoRole(jobTitle: string, jobDescription: string): boolean {
  const { roleFamily, primaryStack } = resolveRoleFamily({ jobTitle, jobDescription });
  return isGoRole(roleFamily, primaryStack);
}

/** 面试官视角的历史签名：`isGoRole` 映射回岗位族 + 语言栈。 */
export function validateBlueprint(
  input: InterviewBlueprint,
  options: {
    questionCount: number;
    dimensions: DimensionConfig[];
    isGoRole: boolean;
    enforceJdCoverage?: boolean;
  },
): InterviewBlueprint {
  return validateCore(input, {
    questionCount: options.questionCount,
    dimensions: options.dimensions,
    roleFamily: options.isGoRole ? 'backend' : 'other',
    primaryStack: options.isGoRole ? 'go' : 'none',
    enforceJdCoverage: options.enforceJdCoverage,
  });
}

export type { DimensionConfig, InterviewBlueprint, InterviewQuestion };
