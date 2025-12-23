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

  interface LanguageModelPromptOptions {
    signal?: AbortSignal;
    responseConstraint?: Record<string, unknown> | RegExp;
  }

  interface LanguageModelSession {
    prompt(
      input: string | LanguageModelPromptInput[],
      options?: LanguageModelPromptOptions
    ): Promise<string>;
    promptStreaming(
      input: string | LanguageModelPromptInput[],
      options?: LanguageModelPromptOptions
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
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: TranslatorDownloadMonitor) => void;
  }

  interface TranslatorDownloadMonitor {
    addEventListener(
      type: 'downloadprogress',
      callback: (event: { loaded: number; total: number }) => void
    ): void;
  }

  interface TranslatorSession {
    translate(text: string): Promise<string>;
    translateStreaming(text: string): AsyncIterable<string>;
    destroy(): void;
  }

  interface TranslatorAPI {
    availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
    create(options: TranslatorCreateOptions): Promise<TranslatorSession>;
  }

  const Translator: TranslatorAPI;

  // Summarizer API
  interface SummarizerCreateOptions {
    type?: 'tldr' | 'key-points' | 'teaser' | 'headline';
    format?: 'plain-text' | 'markdown';
    length?: 'short' | 'medium' | 'long';
    sharedContext?: string;
    expectedInputLanguages?: string[];
    outputLanguage?: string;
    monitor?: (monitor: SummarizerDownloadMonitor) => void;
  }

  interface SummarizerDownloadMonitor {
    addEventListener(
      type: 'downloadprogress',
      callback: (event: { loaded: number; total: number }) => void
    ): void;
  }

  interface SummarizerSession {
    summarize(text: string, options?: { context?: string }): Promise<string>;
    summarizeStreaming(text: string, options?: { context?: string }): AsyncIterable<string>;
    destroy(): void;
  }

  interface SummarizerAPI {
    availability(): Promise<string>;
    create(options?: SummarizerCreateOptions): Promise<SummarizerSession>;
  }

  const Summarizer: SummarizerAPI;
}

export {};
