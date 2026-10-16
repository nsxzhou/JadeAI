import { getTranslations } from 'next-intl/server';
import { resolveDimensions, toDimensionConfigs } from '@/lib/interview-core/dimension';
import type { DimensionConfig, PrimaryStack, RoleFamilyKey } from '@/lib/interview-core/types';

/**
 * 一场面试的两层评分坐标，文案走 i18n。
 *
 * 维度 key 与层级只在 `interview-core/dimension.ts` 定义；中文/英文文案只在
 * `messages/{zh,en}.json`。这里把两者拼起来给服务端用。
 *
 * 服务端（Route Handler）走 next-intl 的 `getTranslations`，locale 由请求体显式传入。
 * 不在 Next 请求上下文时（单测、迁移脚本）退回到直接读同一个消息文件——
 * 文案仍然只有一份，只是取法不同。
 */
export async function sessionDimensions(
  locale: string,
  roleFamily: RoleFamilyKey,
  primaryStack: PrimaryStack,
): Promise<DimensionConfig[]> {
  const definitions = resolveDimensions(roleFamily, primaryStack);

  let labelOf: (key: string) => string;
  let describeOf: (key: string) => string;

  try {
    const t = await getTranslations({ locale, namespace: 'perspective.dimensions' });
    labelOf = (key) => t(key as never);
    describeOf = (key) => t(`descriptions.${key}` as never);
  } catch {
    const messages = (await import(`../../../messages/${locale}.json`)).default as {
      perspective: { dimensions: Record<string, unknown> & { descriptions?: Record<string, string> } };
    };
    const dimensions = messages.perspective.dimensions;
    labelOf = (key) => (typeof dimensions[key] === 'string' ? (dimensions[key] as string) : key);
    describeOf = (key) => dimensions.descriptions?.[key] ?? '';
  }

  return toDimensionConfigs(definitions, labelOf, describeOf);
}
