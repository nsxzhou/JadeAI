'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInterviewStore } from '@/stores/interview-store';
import { getAIHeaders } from '@/stores/settings-store';
import { useLocale } from 'next-intl';

interface UseInterviewChatOptions {
  sessionId: string;
  roundId: string;
  selectedModel?: string;
}

export function useInterviewChat({ sessionId, roundId, selectedModel }: UseInterviewChatOptions) {
  const [input, setInput] = useState('');
  const locale = useLocale();
  const modelRef = useRef(selectedModel);
  modelRef.current = selectedModel;

  const roundIdRef = useRef(roundId);
  roundIdRef.current = roundId;

  // 超时提交要带上标记：内容照常留下，但服务端把这道题记成 timed_out。
  const timedOutRef = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/interview/${sessionId}/chat`,
        body: () => ({
          roundId: roundIdRef.current,
          model: modelRef.current,
          locale,
          timedOut: timedOutRef.current,
        }),
        headers: () => {
          const fp = typeof window !== 'undefined' ? localStorage.getItem('jade_fingerprint') : null;
          return { ...(fp ? { 'x-fingerprint': fp } : {}), ...getAIHeaders() };
        },
      }),
    [sessionId, locale]
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    id: `interview-${sessionId}-${roundId}`,
    transport,
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;

    const textPart = lastAssistant.parts?.find((p: any) => p.type === 'text');
    const text = (textPart as any)?.text || '';
    if (text.includes('[ROUND_COMPLETE]') && !isLoading) {
      const store = useInterviewStore.getState();
      store.updateRound(roundIdRef.current, { status: 'completed' });
    }
  }, [messages, isLoading]);

  // 服务端为候选人消息生成 id 并通过流回传；前端把它替换掉自己临时造的那个，
  // 这样刷新后重读 DB 时消息 id 一致，控制标记也能对得上。
  useEffect(() => {
    if (isLoading) return;
    const assistantIndex = messages.findLastIndex((m) => m.role === 'assistant');
    if (assistantIndex < 0) return;

    const serverUserId = (messages[assistantIndex].metadata as { candidateMessageId?: string | null } | undefined)?.candidateMessageId;
    if (!serverUserId) return;

    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== 'user') continue;
      if (message.id === serverUserId) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, id: serverUserId } : m)));
      return;
    }
  }, [messages, isLoading, setMessages]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;
      sendMessage({ text: input });
      setInput('');
    },
    [input, sendMessage, isLoading]
  );

  /** 倒计时归零时提交：把已写内容（可能为空）连同超时标记一起发出去。 */
  const sendTimeout = useCallback(
    (text: string) => {
      if (isLoading) return;
      timedOutRef.current = true;
      void sendMessage({ text }).finally(() => {
        timedOutRef.current = false;
      });
    },
    [isLoading, sendMessage],
  );

  const resetMessages = useCallback(() => {
    setMessages([]);
  }, [setMessages]);

  return {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    status,
    error,
    resetMessages,
    sendMessage,
    sendTimeout,
    setMessages,
    setInput,
  };
}
