import { describe, expect, it } from 'vitest';
import { canEditAnswer } from './speech';

describe('canEditAnswer', () => {
  it('未提交时两种修改都允许', () => {
    expect(canEditAnswer('transcription_correction', false)).toBe(true);
    expect(canEditAnswer('answer_modification', false)).toBe(true);
  });

  it('提交后只允许修正转写，不允许改回答', () => {
    expect(canEditAnswer('transcription_correction', true)).toBe(true);
    expect(canEditAnswer('answer_modification', true)).toBe(false);
  });
});
