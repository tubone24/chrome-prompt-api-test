declare global {
  interface LanguageModelCreateOptions {
    temperature?: number;
    topK?: number;
    systemPrompt?: string;
    expectedInputLanguages?: string[];
    expectedOutputLanguages?: string[];
    expectedInputs?: Array<{ type: 'text' | 'image' | 'audio'; languages?: string[] }>;
    monitor?: (monitor: LanguageModelDownloadMonitor) => void;
  }

  interface LanguageModelDownloadMonitor {
    addEventListener(
      type: 'downloadprogress',
      callback: (event: { loaded: number; total: number }) => void
    ): void;
  }

  interface LanguageModelSession {
    prompt(
      input: string | LanguageModelPromptInput[]
    ): Promise<string>;
    promptStreaming(
      input: string | LanguageModelPromptInput[],
      options?: { signal?: AbortSignal }
    ): AsyncIterable<string>;
    destroy(): void;
    inputQuota?: number;
    inputQuotaRemaining?: number;
  }

  interface LanguageModelPromptInput {
    role: 'user' | 'assistant' | 'system';
    content: LanguageModelContentPart[];
  }

  type LanguageModelContentPart =
    | { type: 'text'; value: string }
    | { type: 'image'; value: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | Blob | ImageData }
    | { type: 'audio'; value: AudioBuffer | ArrayBuffer | ArrayBufferView | Blob };

  interface LanguageModelAPI {
    availability(options?: { expectedInputs?: Array<{ type: string }> }): Promise<string>;
    create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
  }

  const LanguageModel: LanguageModelAPI;

  // Translator API
  interface TranslatorCreateOptions {
    sourceLanguage?: string;
    targetLanguage: string;
  }

  interface Translator {
    translate(text: string): Promise<string>;
    destroy(): void;
  }

  interface TranslatorAPI {
    availability(): Promise<string>;
    create(options: TranslatorCreateOptions): Promise<Translator>;
  }

  const translation: TranslatorAPI;

  // Summarizer API
  interface SummarizerCreateOptions {
    type?: 'tl;dr' | 'key-points' | 'teaser' | 'headline';
    format?: 'plain-text' | 'markdown';
    length?: 'short' | 'medium' | 'long';
  }

  interface Summarizer {
    summarize(text: string): Promise<string>;
    destroy(): void;
  }

  interface SummarizerAPI {
    availability(): Promise<string>;
    create(options?: SummarizerCreateOptions): Promise<Summarizer>;
  }

  const summarization: SummarizerAPI;
}

export {};
