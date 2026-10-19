import { describe, expect, it } from 'vitest';
import {
  generationProgressPercent,
  type GenerationProgress,
} from './generation-progress';

const progress = (phase: GenerationProgress['phase'], completed = 0, total = 17): GenerationProgress => ({
  type: 'progress',
  phase,
  completed,
  total,
});

describe('generationProgressPercent', () => {
  it('从蓝图到保存只向前，不会倒回 0', () => {
    const values = [
      generationProgressPercent(null),
      generationProgressPercent(progress('blueprint')),
      generationProgressPercent(progress('questions', 0)),
      generationProgressPercent(progress('questions', 8)),
      generationProgressPercent(progress('questions', 17)),
      generationProgressPercent(progress('quality', 17)),
      generationProgressPercent(progress('saving', 17)),
    ];
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
    }
    expect(values.at(-1)).toBe(98);
  });

  it('出题阶段按已完成题数线性铺满 10–90%', () => {
    expect(generationProgressPercent(progress('questions', 0, 17))).toBe(10);
    expect(generationProgressPercent(progress('questions', 17, 17))).toBe(90);
    expect(generationProgressPercent(progress('quality', 17))).toBe(92);
    expect(generationProgressPercent(progress('saving', 17))).toBe(98);
  });
});
