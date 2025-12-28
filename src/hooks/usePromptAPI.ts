import { useState, useCallback, useRef } from 'react';

export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  imageData?: string; // base64 image for display
  timestamp: Date;
  isStreaming?: boolean;
}

export type APIStatus = 'checking' | 'available' | 'downloading' | 'unavailable';

interface UsePromptAPIOptions {
  systemPrompt?: string;
  temperature?: number;
  topK?: number;
  multimodal?: boolean;
  responseConstraint?: Record<string, unknown>; // JSON Schema for structured output
}

export function usePromptAPI(options: UsePromptAPIOptions = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<APIStatus>('checking');
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<LanguageModelSession | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const checkAvailability = useCallback(async () => {
    setStatus('checking');
    setError(null);

    if (typeof LanguageModel === 'undefined') {
      setStatus('unavailable');
      setError('LanguageModel APIが見つかりません。Chromeのフラグを有効にしてください。');
      return false;
    }

    try {
      const availabilityOptions = options.multimodal
        ? { expectedInputs: [{ type: 'image' }] }
        : undefined;

      const availability = await LanguageModel.availability(availabilityOptions);
      console.log('API Availability:', availability);

      if (availability === 'available' || availability === 'readily') {
        setStatus('available');
        return true;
      } else if (availability === 'downloadable' || availability === 'after-download') {
        setStatus('downloading');
        setDownloadProgress(0);

        // Trigger download
        const createOptions: LanguageModelCreateOptions = {
          expectedOutputLanguages: ['ja'],
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              const percent = Math.round((e.loaded / e.total) * 100);
              setDownloadProgress(percent);
            });
          },
        };

        if (options.multimodal) {
          createOptions.expectedInputs = [{ type: 'image' }];
        }

        const tempSession = await LanguageModel.create(createOptions);
        tempSession.destroy();

        setStatus('available');
        setDownloadProgress(null);
        return true;
      } else {
        setStatus('unavailable');
        setError(`API利用不可: ${availability}`);
        return false;
      }
    } catch (e) {
      setStatus('unavailable');
      setError(e instanceof Error ? e.message : 'Unknown error');
      return false;
    }
  }, [options.multimodal]);

  const createSession = useCallback(async () => {
    const createOptions: LanguageModelCreateOptions = {
      temperature: options.temperature ?? 0.7,
      topK: options.topK ?? 3,
      expectedInputLanguages: ['ja', 'en'],
      expectedOutputLanguages: ['ja'],
    };

    if (options.systemPrompt) {
      createOptions.systemPrompt = options.systemPrompt;
    }

    if (options.multimodal) {
      createOptions.expectedInputs = [
        { type: 'text' },
        { type: 'image' },
      ];
    }

    sessionRef.current = await LanguageModel.create(createOptions);
    return sessionRef.current;
  }, [options]);

  const sendMessage = useCallback(async (
    content: string,
    imageCanvas?: HTMLCanvasElement
  ) => {
    if (isGenerating) return;

    setIsGenerating(true);
    setError(null);

    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();

    // Add user message
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content,
      imageData: imageCanvas?.toDataURL('image/jpeg', 0.8),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Add empty assistant message for streaming
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const session = await createSession();
      abortControllerRef.current = new AbortController();

      let promptInput: string | LanguageModelPromptInput[];

      if (imageCanvas && options.multimodal) {
        promptInput = [
          {
            role: 'user',
            content: [
              { type: 'text', value: content },
              { type: 'image', value: imageCanvas },
            ],
          },
        ];
      } else {
        promptInput = content;
      }

      const promptOptions: { signal: AbortSignal; responseConstraint?: Record<string, unknown> } = {
        signal: abortControllerRef.current.signal,
      };

      // 構造化出力のためのJSONスキーマを設定
      if (options.responseConstraint) {
        promptOptions.responseConstraint = options.responseConstraint;
      }

      const stream = session.promptStreaming(promptInput, promptOptions);

      // chunkが差分の場合は累積、累積テキストの場合はそのまま使用
      let accumulatedText = '';
      for await (const chunk of stream) {
        // Chrome Prompt APIは累積テキストを返すが、念のため両方に対応
        // chunkが前のテキストを含んでいれば累積テキスト、そうでなければ差分
        if (chunk.startsWith(accumulatedText) || accumulatedText === '') {
          // 累積テキストとして扱う
          accumulatedText = chunk;
        } else {
          // 差分として扱う
          accumulatedText += chunk;
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: accumulatedText }
              : msg
          )
        );
      }

      // Mark streaming as complete
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, isStreaming: false }
            : msg
        )
      );

      session.destroy();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: msg.content + '\n\n[中断されました]', isStreaming: false }
              : msg
          )
        );
      } else {
        setError(e instanceof Error ? e.message : 'Unknown error');
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: `エラー: ${e instanceof Error ? e.message : 'Unknown error'}`, isStreaming: false }
              : msg
          )
        );
      }
    } finally {
      setIsGenerating(false);
      sessionRef.current = null;
      abortControllerRef.current = null;
    }
  }, [isGenerating, createSession, options.multimodal]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    status,
    isGenerating,
    downloadProgress,
    error,
    checkAvailability,
    sendMessage,
    stopGeneration,
    clearMessages,
  };
}
