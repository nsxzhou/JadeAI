/**
 * 语音（本期不做，只留接口）。
 *
 * 设计文档 §7.6 的结论：
 * - **只做语音输入**（候选人说，AI 听），不做 AI 语音提问（TTS）。
 * - 技术先用浏览器 `Web Speech API`，把 `SpeechToText` 抽成接口，日后可换 Whisper / 讯飞。
 *   本产品是 BYOK 模式，多要一个 STT key 会明显抬高门槛，先用免费方案验证需求。
 * - **必须处理的边界**：ASR 一定会把「Goroutine」「MVCC」这类词听错。
 *   裁决：**修正 ASR 的转写错误不违反「不可回改」；修改自己的回答违反。**
 *   界面必须让这两件事可区分——提交前的转写编辑记录为「转写修正」，而非「答案修改」。
 *
 * 这里只定义接口与「转写修正 ≠ 答案修改」的类型区分，不提供任何实现。
 */

export interface SpeechToTextResult {
  /** 转写文本 */
  transcript: string;
  /** 是否已经人工修正过转写 */
  corrected: boolean;
}

export interface SpeechToText {
  /** 是否可用（浏览器支持情况、用户授权等） */
  isAvailable(): boolean;
  /** 开始收音并持续转写 */
  start(onPartial: (text: string) => void): void;
  stop(): Promise<SpeechToTextResult>;
}

/** 一条回答的修改来源。错题本与报告只把 `answer` 当回答，转写修正单独记。 */
export type AnswerEditKind = 'transcription_correction' | 'answer_modification';

/**
 * 修改是否允许：提交前修正转写允许，改动已提交的回答不允许。
 * 这条判断属于内核，语音模块与 UI 共用同一份裁决。
 */
export function canEditAnswer(kind: AnswerEditKind, submitted: boolean): boolean {
  if (!submitted) return true;
  return kind === 'transcription_correction';
}
