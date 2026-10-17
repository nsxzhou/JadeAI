import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { extractJson } from '@/lib/ai/extract-json';
import { dimensionSuggestionsOutputSchema } from '@/lib/ai/perspective-schema';
import { AIConfigError, extractAIConfig, getJsonProviderOptions, getModel } from '@/lib/ai/provider';
import { normalizeQuestionCounts, planQuestionCounts } from '@/lib/interview-core/dimension';
import { QUESTION_COUNT_DEFAULT } from '@/lib/interview-core/types';
import { resolveRoleFamily } from '@/lib/interview-core/role-family';
import { sessionDimensions } from '@/lib/interview/session-dimensions';

export const maxDuration = 120;

/**
 * 按 JD 识别岗位族与各维度题数。
 *
 * 评分坐标是固定的两层目录——模型只负责两件事：给每个维度写考察重点、分配题数。
 * 它不能发明维度、也不能改评分权重。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const jobDescription = typeof body.jobDescription === 'string' ? body.jobDescription.trim() : '';
    const locale = typeof body.locale === 'string' ? body.locale : 'zh';
    if (!title || !jobDescription) {
      return NextResponse.json({ error: 'Job title and JD are required' }, { status: 400 });
    }

    // 岗位族用纯静态规则判定（不调模型）：坐标一旦被模型判漂，画像就断链。
    const { roleFamily: roleFamilyKey, primaryStack } = resolveRoleFamily({ jobTitle: title, jobDescription });
    const dimensions = await sessionDimensions(locale, roleFamilyKey, primaryStack);

    const planned = planQuestionCounts({
      general: dimensions.filter((dimension) => dimension.layer === 'general'),
      family: dimensions.filter((dimension) => dimension.layer === 'family'),
      total: QUESTION_COUNT_DEFAULT,
    });

    const aiConfig = extractAIConfig(request);
    const allowedKeys = dimensions.map((dimension) => dimension.key);
    const result = await generateText({
      model: getModel(aiConfig),
      maxOutputTokens: 4096,
      providerOptions: getJsonProviderOptions(aiConfig),
      system: `You design interview dimensions from a job description. Return strict JSON only.
The role family and the scoring dimension keys are already decided by the server — do not invent, rename or drop one.
Use exactly these dimension keys, once each: ${allowedKeys.join(', ')}.
For every dimension provide:
- questionCount: integer 1-5 meaning how many questions to generate for this dimension;
- description: 250-600 Chinese characters, written as a professional competency model using exactly these sections:
  【考察目标】【知识/能力范围】【工程实践或行为场景】【追问与验证】【评价重点】.
  Each section must contain JD-specific, actionable content. Cover fundamentals, applied practice, failure diagnosis,
  trade-offs, evidence to request, strong-answer signals, and risk signals where applicable. Do not write a short summary.
Ground every technology-specific scope in the JD. Do not invent required technologies. Keep behavioral dimensions role-specific.
Shape: {"dimensions":[{"key":"...","questionCount":2,"description":"..."}]}`,
      prompt: `岗位名称：${title}\n\n职位描述（JD）：\n${jobDescription}`,
    });

    const parsed = extractJson(result.text, dimensionSuggestionsOutputSchema);
    const suggestions = new Map(parsed.dimensions.map((dimension) => [dimension.key, dimension]));

    const merged = dimensions.map((dimension) => {
      const suggestion = suggestions.get(dimension.key);
      return suggestion?.description?.trim()
        ? { ...dimension, description: suggestion.description }
        : dimension;
    });

    const questionCounts = normalizeQuestionCounts(
      merged,
      Object.fromEntries(
        merged.map((dimension) => [
          dimension.key,
          Math.max(1, Math.min(5, suggestions.get(dimension.key)?.questionCount ?? planned[dimension.key] ?? 1)),
        ]),
      ),
    );

    return NextResponse.json({ roleFamilyKey, primaryStack, dimensions: merged, questionCounts });
  } catch (error) {
    if (error instanceof AIConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[perspective] dimension suggestion failed:', error);
    return NextResponse.json({ error: 'Failed to suggest dimensions' }, { status: 500 });
  }
}
