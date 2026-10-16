/**
 * 能力画像：同一求职者在多次面试中、同一维度坐标系上的分数累积。
 *
 * 只吃「坐标可识别」的报告：`layer` 必须是 general / family，且 key 必须命中
 * 当前目录。老报告坐标不固定，读得到但不进画像——把不同坐标的分数画在一条线上，
 * 这条线的斜率没有意义。
 */
import type { DimensionLayer, DimensionScore, RoleFamilyKey } from './types';
import { dimensionDefinition } from './dimension';

export interface ProfileInput {
  sessionId: string;
  createdAt: string | Date;
  roleFamilyKey: RoleFamilyKey | null;
  dimensionScores: DimensionScore[];
}

export interface ProfilePoint {
  sessionId: string;
  createdAt: string;
  score: number;
}

export interface ProfileDimensionSeries {
  key: string;
  label: string;
  layer: DimensionLayer;
  /** 按时间升序 */
  points: ProfilePoint[];
  latest: number | null;
  /** 首尾之差；只有一个点时是 0 */
  delta: number;
}

export interface FamilyProfileSeries extends ProfileDimensionSeries {
  roleFamilyKey: RoleFamilyKey;
}

export interface SkillProfile {
  /** 通用层 4 条趋势线，跨岗位族可比 */
  general: ProfileDimensionSeries[];
  /** 族层按岗位族分面，只在同一族内可比 */
  family: FamilyProfileSeries[];
  sessionCount: number;
}

function toTimestamp(value: string | Date): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** 坐标是否可识别：老报告里的自定义/旧 key 会被这一步挡掉。 */
function isRecognizable(score: DimensionScore): boolean {
  if (score.layer !== 'general' && score.layer !== 'family') return false;
  const definition = dimensionDefinition(score.key);
  return definition?.layer === score.layer;
}

export function buildProfile(inputs: ProfileInput[]): SkillProfile {
  const generalPoints = new Map<string, { label: string; points: ProfilePoint[] }>();
  const familyPoints = new Map<string, { roleFamilyKey: RoleFamilyKey; label: string; points: ProfilePoint[] }>();
  let sessionCount = 0;

  const ordered = [...inputs].sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

  for (const input of ordered) {
    let contributed = false;
    for (const score of input.dimensionScores ?? []) {
      if (!isRecognizable(score)) continue;
      const point: ProfilePoint = {
        sessionId: input.sessionId,
        createdAt: new Date(toTimestamp(input.createdAt)).toISOString(),
        score: score.score,
      };

      if (score.layer === 'general') {
        const bucket = generalPoints.get(score.key) ?? { label: score.label, points: [] };
        bucket.points.push(point);
        generalPoints.set(score.key, bucket);
      } else {
        const roleFamilyKey = input.roleFamilyKey ?? 'other';
        // 族层只在同一族内可比，所以 key 里带族。
        const bucketKey = `${roleFamilyKey}:${score.key}`;
        const bucket = familyPoints.get(bucketKey) ?? { roleFamilyKey, label: score.label, points: [] };
        bucket.points.push(point);
        familyPoints.set(bucketKey, bucket);
      }
      contributed = true;
    }
    if (contributed) sessionCount += 1;
  }

  const toSeries = (key: string, label: string, points: ProfilePoint[]): ProfileDimensionSeries => {
    const latest = points.length > 0 ? points[points.length - 1].score : null;
    const first = points.length > 0 ? points[0].score : null;
    return {
      key,
      label,
      layer: 'general',
      points,
      latest,
      delta: latest !== null && first !== null ? latest - first : 0,
    };
  };

  const general = [...generalPoints.entries()].map(([key, bucket]) => toSeries(key, bucket.label, bucket.points));

  const family = [...familyPoints.entries()].map(([bucketKey, bucket]) => {
    const dimensionKey = bucketKey.split(':')[1];
    return {
      ...toSeries(dimensionKey, bucket.label, bucket.points),
      layer: 'family' as const,
      roleFamilyKey: bucket.roleFamilyKey,
    };
  });

  return { general, family, sessionCount };
}
