import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Loader2, AlertCircle, CheckCircle2, Trash2, Languages, FileText } from 'lucide-react';

type Status = 'checking' | 'available' | 'unavailable' | 'recording';

interface ProcessedChunk {
  id: string;
  timestamp: Date;
  transcription: {
    text: string;
    isProcessing: boolean;
    error?: string;
  };
  translation: {
    text: string;
    isProcessing: boolean;
    error?: string;
  };
  summary: {
    text: string;
    isProcessing: boolean;
    error?: string;
  };
}

export function VoiceTranscriptionPipeline() {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [chunks, setChunks] = useState<ProcessedChunk[]>([]);
  const [currentChunkTime, setCurrentChunkTime] = useState(0);
  const [targetLanguage, setTargetLanguage] = useState('en');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunksEndRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(false);
  const mimeTypeRef = useRef<string>('audio/webm');
  const timerRef = useRef<number | null>(null);

  // APIの可用性チェック
  const checkAvailability = useCallback(async () => {
    setStatus('checking');
    setError(null);

    // LanguageModel APIチェック
    if (typeof LanguageModel === 'undefined') {
      setStatus('unavailable');
      setError('LanguageModel APIが見つかりません');
      return;
    }

    // Translation APIチェック
    if (typeof translation === 'undefined') {
      setStatus('unavailable');
      setError('Translation APIが見つかりません');
      return;
    }

    // Summarization APIチェック
    if (typeof summarization === 'undefined') {
      setStatus('unavailable');
      setError('Summarization APIが見つかりません');
      return;
    }

    try {
      // LanguageModel availability
      const audioAvailability = await LanguageModel.availability({
        expectedInputs: [{ type: 'audio' }],
      });
      console.log('Audio API Availability:', audioAvailability);

      if (audioAvailability !== 'available' && audioAvailability !== 'readily') {
        setStatus('unavailable');
        setError(`音声API利用不可: ${audioAvailability}`);
        return;
      }

      // Translation availability
      const translationAvailability = await translation.availability();
      console.log('Translation API Availability:', translationAvailability);

      if (translationAvailability !== 'available' && translationAvailability !== 'readily') {
        setStatus('unavailable');
        setError(`翻訳API利用不可: ${translationAvailability}`);
        return;
      }

      // Summarization availability
      const summarizationAvailability = await summarization.availability();
      console.log('Summarization API Availability:', summarizationAvailability);

      if (summarizationAvailability !== 'available' && summarizationAvailability !== 'readily') {
        setStatus('unavailable');
        setError(`要約API利用不可: ${summarizationAvailability}`);
        return;
      }

      setStatus('available');
    } catch (e) {
      setStatus('unavailable');
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }, []);

  useEffect(() => {
    checkAvailability();
  }, [checkAvailability]);

  useEffect(() => {
    chunksEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chunks]);

  // BlobをArrayBufferに変換
  const blobToArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
    return await blob.arrayBuffer();
  };

  // 音声チャンクを処理（文字起こし→翻訳→要約）
  const processChunk = async (audioBlob: Blob) => {
    if (audioBlob.size < 1000) {
      console.log('Audio chunk too small, skipping:', audioBlob.size);
      return;
    }

    const chunkId = crypto.randomUUID();

    const newChunk: ProcessedChunk = {
      id: chunkId,
      timestamp: new Date(),
      transcription: { text: '', isProcessing: true },
      translation: { text: '', isProcessing: false },
      summary: { text: '', isProcessing: false },
    };

    setChunks(prev => [...prev, newChunk]);

    let languageModelSession: LanguageModelSession | null = null;
    let translator: Translator | null = null;
    let summarizer: Summarizer | null = null;

    try {
      // ステップ1: 文字起こし
      languageModelSession = await LanguageModel.create({
        expectedInputs: [{ type: 'audio' }],
        expectedOutputLanguages: ['ja'],
        systemPrompt: 'あなたは音声文字起こしアシスタントです。音声の内容を正確に日本語でテキストに変換してください。音声が聞き取れない場合は「（聞き取れません）」と出力してください。',
      });

      const arrayBuffer = await blobToArrayBuffer(audioBlob);
      console.log('Audio buffer size:', arrayBuffer.byteLength);

      const transcription = await languageModelSession.prompt([
        {
          role: 'user',
          content: [
            { type: 'text', value: 'この音声を文字起こししてください：' },
            { type: 'audio', value: arrayBuffer },
          ],
        },
      ]);

      setChunks(prev =>
        prev.map(c =>
          c.id === chunkId
            ? {
                ...c,
                transcription: { text: transcription, isProcessing: false },
                translation: { text: '', isProcessing: true },
              }
            : c
        )
      );

      // ステップ2: 翻訳
      translator = await translation.create({
        sourceLanguage: 'ja',
        targetLanguage: targetLanguage,
      });

      const translatedText = await translator.translate(transcription);

      setChunks(prev =>
        prev.map(c =>
          c.id === chunkId
            ? {
                ...c,
                translation: { text: translatedText, isProcessing: false },
                summary: { text: '', isProcessing: true },
              }
            : c
        )
      );

      // ステップ3: 要約
      summarizer = await summarization.create({
        type: 'tl;dr',
        format: 'plain-text',
        length: 'short',
      });

      const summaryText = await summarizer.summarize(translatedText);

      setChunks(prev =>
        prev.map(c =>
          c.id === chunkId
            ? {
                ...c,
                summary: { text: summaryText, isProcessing: false },
              }
            : c
        )
      );
    } catch (e) {
      console.error('Processing error:', e);
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';

      setChunks(prev =>
        prev.map(c =>
          c.id === chunkId
            ? {
                ...c,
                transcription: c.transcription.isProcessing
                  ? { text: '', isProcessing: false, error: errorMessage }
                  : c.transcription,
                translation: c.translation.isProcessing
                  ? { text: '', isProcessing: false, error: errorMessage }
                  : c.translation,
                summary: c.summary.isProcessing
                  ? { text: '', isProcessing: false, error: errorMessage }
                  : c.summary,
              }
            : c
        )
      );
    } finally {
      if (languageModelSession) languageModelSession.destroy();
      if (translator) translator.destroy();
      if (summarizer) summarizer.destroy();
    }
  };

  // 新しいMediaRecorderを作成して5秒間録音
  const startNewRecorder = () => {
    if (!streamRef.current || !isRecordingRef.current) return;

    chunksRef.current = [];
    setCurrentChunkTime(0);

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: mimeTypeRef.current
    });
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      if (chunksRef.current.length > 0) {
        const audioBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        console.log('Processing complete audio chunk:', audioBlob.size, 'bytes');

        if (audioBlob.size >= 1000) {
          processChunk(audioBlob);
        } else {
          console.log('Audio chunk too small, skipping');
        }
      }

      if (isRecordingRef.current) {
        startNewRecorder();
      }
    };

    mediaRecorder.start();
    console.log('Started new recorder');

    let count = 0;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }
    timerRef.current = window.setInterval(() => {
      count++;
      setCurrentChunkTime(count);

      if (count >= 5) {
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }
    }, 1000);
  };

  // 録音開始
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        }
      });
      streamRef.current = stream;

      mimeTypeRef.current = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      console.log('Using MIME type:', mimeTypeRef.current);

      setIsRecording(true);
      isRecordingRef.current = true;
      setStatus('recording');

      startNewRecorder();
    } catch (e) {
      console.error('Recording error:', e);
      setError(e instanceof Error ? e.message : 'マイクにアクセスできません');
    }
  };

  // 録音停止
  const stopRecording = () => {
    isRecordingRef.current = false;

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
    setStatus('available');
    setCurrentChunkTime(0);
  };

  // クリーンアップ
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const clearChunks = () => {
    setChunks([]);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
        <h1 className="text-lg font-semibold">音声パイプライン（文字起こし→翻訳→要約）</h1>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${
            status === 'checking' ? 'bg-yellow-500/20 text-yellow-400' :
            status === 'available' ? 'bg-green-500/20 text-green-400' :
            status === 'recording' ? 'bg-red-500/20 text-red-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {status === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />}
            {status === 'available' && <CheckCircle2 className="w-4 h-4" />}
            {status === 'recording' && <Mic className="w-4 h-4 animate-pulse" />}
            {status === 'unavailable' && <AlertCircle className="w-4 h-4" />}
            <span>
              {status === 'checking' && '確認中...'}
              {status === 'available' && '準備完了'}
              {status === 'recording' && `録音中 (${currentChunkTime}s / 5s)`}
              {status === 'unavailable' && (error || 'API利用不可')}
            </span>
          </div>
          {chunks.length > 0 && (
            <button
              onClick={clearChunks}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              クリア
            </button>
          )}
        </div>
      </div>

      {/* Settings */}
      <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.3)]">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-[hsl(var(--foreground))]">
            翻訳先言語:
          </label>
          <select
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value)}
            disabled={isRecording}
            className="px-3 py-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm disabled:opacity-50"
          >
            <option value="en">英語 (English)</option>
            <option value="zh">中国語 (Chinese)</option>
            <option value="ko">韓国語 (Korean)</option>
            <option value="es">スペイン語 (Spanish)</option>
            <option value="fr">フランス語 (French)</option>
            <option value="de">ドイツ語 (German)</option>
          </select>
        </div>
      </div>

      {/* Recording Controls */}
      <div className="p-6 border-b border-[hsl(var(--border))] flex flex-col items-center gap-4">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={status === 'checking' || status === 'unavailable'}
          className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
            isRecording
              ? 'bg-red-500 hover:bg-red-600 animate-pulse'
              : 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isRecording ? (
            <MicOff className="w-10 h-10 text-white" />
          ) : (
            <Mic className="w-10 h-10 text-white" />
          )}
        </button>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {isRecording ? 'タップして録音停止' : 'タップして録音開始'}
        </p>
        {isRecording && (
          <div className="w-full max-w-xs bg-[hsl(var(--secondary))] rounded-full h-2">
            <div
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-1000"
              style={{ width: `${(currentChunkTime / 5) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Processed Chunks */}
      <div className="flex-1 overflow-y-auto p-4">
        {chunks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Mic className="w-12 h-12 text-[hsl(var(--muted-foreground))] mb-4" />
            <p className="text-[hsl(var(--muted-foreground))]">
              録音を開始すると、5秒ごとに自動で文字起こし→翻訳→要約が実行されます
            </p>
            {status === 'unavailable' && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 max-w-md">
                <p className="font-medium mb-2">APIが利用できません</p>
                <ul className="text-left list-disc list-inside space-y-1 text-xs">
                  <li>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input → Enabled</li>
                  <li>chrome://flags/#translation-api → Enabled</li>
                  <li>chrome://flags/#summarization-api → Enabled</li>
                  <li>Chromeを再起動</li>
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {chunks.map((chunk) => (
              <div
                key={chunk.id}
                className="p-4 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))]"
              >
                <div className="text-xs text-[hsl(var(--muted-foreground))] mb-3">
                  {chunk.timestamp.toLocaleTimeString('ja-JP')}
                </div>

                {/* 文字起こし */}
                <div className="mb-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                    <Mic className="w-3 h-3" />
                    文字起こし
                  </div>
                  {chunk.transcription.isProcessing ? (
                    <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">処理中...</span>
                    </div>
                  ) : chunk.transcription.error ? (
                    <p className="text-sm text-red-400">エラー: {chunk.transcription.error}</p>
                  ) : (
                    <p className="text-sm text-[hsl(var(--foreground))]">{chunk.transcription.text}</p>
                  )}
                </div>

                {/* 翻訳 */}
                <div className="mb-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                    <Languages className="w-3 h-3" />
                    翻訳
                  </div>
                  {chunk.translation.isProcessing ? (
                    <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">処理中...</span>
                    </div>
                  ) : chunk.translation.error ? (
                    <p className="text-sm text-red-400">エラー: {chunk.translation.error}</p>
                  ) : chunk.translation.text ? (
                    <p className="text-sm text-[hsl(var(--foreground))]">{chunk.translation.text}</p>
                  ) : null}
                </div>

                {/* 要約 */}
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                    <FileText className="w-3 h-3" />
                    要約
                  </div>
                  {chunk.summary.isProcessing ? (
                    <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">処理中...</span>
                    </div>
                  ) : chunk.summary.error ? (
                    <p className="text-sm text-red-400">エラー: {chunk.summary.error}</p>
                  ) : chunk.summary.text ? (
                    <p className="text-sm text-[hsl(var(--foreground))] bg-[hsl(var(--primary)/0.1)] px-3 py-2 rounded">
                      {chunk.summary.text}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={chunksEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
