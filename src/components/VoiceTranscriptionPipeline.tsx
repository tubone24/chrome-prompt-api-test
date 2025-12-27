import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Loader2, AlertCircle, CheckCircle2, Trash2, Languages, FileText, Download, Volume2, Monitor, MonitorSpeaker, RefreshCw } from 'lucide-react';

type Status = 'checking' | 'available' | 'unavailable' | 'recording' | 'downloading';

// 音声ソースタイプ
type AudioSource = 'microphone' | 'system' | 'both';

// 文字起こし結果の状態
type TranscriptionStatus = 'provisional' | 'confirmed' | 're-evaluating';

interface ProcessedChunk {
  id: string;
  timestamp: Date;
  transcription: {
    text: string;
    isProcessing: boolean;
    error?: string;
    status: TranscriptionStatus; // 仮/確定/再評価中
  };
  translation: {
    text: string;
    isProcessing: boolean;
    error?: string;
  };
  // 段階的処理用
  audioBlob?: Blob; // 再評価用の音声データ
  segmentId?: string; // セグメントグループID（再評価時に統合）
}

interface OverallSummary {
  text: string;
  isProcessing: boolean;
  error?: string;
}

export function VoiceTranscriptionPipeline() {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [chunks, setChunks] = useState<ProcessedChunk[]>([]);

  // Translator設定
  const [sourceLanguage, setSourceLanguage] = useState('ja');
  const [targetLanguage, setTargetLanguage] = useState('en');

  // Summarizer設定
  const [enableSummarization, setEnableSummarization] = useState(true);
  const [summaryType, setSummaryType] = useState<'tldr' | 'key-points' | 'teaser' | 'headline'>('tldr');
  const [summaryFormat, setSummaryFormat] = useState<'plain-text' | 'markdown'>('plain-text');
  const [summaryLength, setSummaryLength] = useState<'short' | 'medium' | 'long'>('medium');

  const [downloadProgress, setDownloadProgress] = useState<{ translator: number; summarizer: number } | null>(null);
  const [transcriptionSummary, setTranscriptionSummary] = useState<OverallSummary>({ text: '', isProcessing: false });
  const [translationSummary, setTranslationSummary] = useState<OverallSummary>({ text: '', isProcessing: false });

  // チェックポイント形式の要約管理
  interface SummaryCheckpoint {
    summarizedUpTo: number;      // 既に要約済みの文字数
    previousSummary: string;     // 前回の要約結果
  }
  const transcriptionCheckpointRef = useRef<SummaryCheckpoint>({ summarizedUpTo: 0, previousSummary: '' });
  const translationCheckpointRef = useRef<SummaryCheckpoint>({ summarizedUpTo: 0, previousSummary: '' });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunksEndRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(false);
  const mimeTypeRef = useRef<string>('audio/webm');

  // 音声解析用
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);

  // 音声レベル可視化用
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // 録音モード
  const [recordingMode, setRecordingMode] = useState<'vad' | 'fixed'>('vad');
  const [fixedDuration, setFixedDuration] = useState(5); // 固定録音時間（秒）
  const [currentChunkTime, setCurrentChunkTime] = useState(0);

  // 音声設定（調整可能）
  const [inputGain, setInputGain] = useState(1.0); // ゲイン（0.1〜3.0）
  const [silenceThreshold, setSilenceThreshold] = useState(15); // 無音閾値（0〜100）
  const [silenceDuration, setSilenceDuration] = useState(1500); // 無音継続時間（ms）

  // GainNode参照
  const gainNodeRef = useRef<GainNode | null>(null);
  const timerRef = useRef<number | null>(null);

  // 音声ソース設定
  const [audioSource, setAudioSource] = useState<AudioSource>('microphone');
  const systemStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mixedStreamRef = useRef<MediaStream | null>(null);

  // 段階的文字起こし設定
  const [enableProgressiveTranscription, setEnableProgressiveTranscription] = useState(true);
  const [provisionalInterval, setProvisionalInterval] = useState(3); // 仮文字起こし間隔（秒）
  const [reEvaluationInterval, setReEvaluationInterval] = useState(12); // 再評価間隔（秒）

  // 段階的処理用のバッファ
  const audioBufferRef = useRef<Blob[]>([]); // 再評価用音声バッファ
  const currentSegmentIdRef = useRef<string>(crypto.randomUUID());
  const segmentStartTimeRef = useRef<number>(0);
  const chunkCountInSegmentRef = useRef<number>(0);

  // 仮処理のキャンセル用
  const provisionalAbortControllerRef = useRef<AbortController | null>(null);
  const pendingProvisionalChunksRef = useRef<Set<string>>(new Set()); // 処理中の仮チャンクID

  // 固定設定
  const MIN_RECORDING_DURATION = 500; // 最小録音時間（ms）

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

    // Translator APIチェック
    if (typeof Translator === 'undefined') {
      setStatus('unavailable');
      setError('Translator APIが見つかりません');
      return;
    }

    // Summarizer APIチェック
    if (typeof Summarizer === 'undefined') {
      setStatus('unavailable');
      setError('Summarizer APIが見つかりません');
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

      // Translator availability - check with default language pair
      const translatorAvailability = await Translator.availability({
        sourceLanguage: 'ja',
        targetLanguage: 'en',
      });
      console.log('Translator API Availability:', translatorAvailability);

      // Summarizer availability
      const summarizerAvailability = await Summarizer.availability();
      console.log('Summarizer API Availability:', summarizerAvailability);

      // 両方利用可能かチェック
      const translatorReady = translatorAvailability === 'readily' || translatorAvailability === 'available';
      const summarizerReady = summarizerAvailability === 'readily' || summarizerAvailability === 'available';
      const translatorDownloadable = translatorAvailability === 'downloadable' || translatorAvailability === 'after-download';
      const summarizerDownloadable = summarizerAvailability === 'downloadable' || summarizerAvailability === 'after-download';

      // ダウンロードが必要な場合
      if (!translatorReady || !summarizerReady) {
        if (!translatorReady && !translatorDownloadable) {
          setStatus('unavailable');
          setError(`翻訳API利用不可: ${translatorAvailability}`);
          return;
        }
        if (!summarizerReady && !summarizerDownloadable) {
          setStatus('unavailable');
          setError(`要約API利用不可: ${summarizerAvailability}`);
          return;
        }

        // ダウンロード開始
        setStatus('downloading');
        setDownloadProgress({ translator: translatorReady ? 100 : 0, summarizer: summarizerReady ? 100 : 0 });

        // Translatorのダウンロード
        if (!translatorReady && translatorDownloadable) {
          console.log('Downloading Translator model...');
          const translatorSession = await Translator.create({
            sourceLanguage: 'ja',
            targetLanguage: 'en',
            monitor(m) {
              m.addEventListener('downloadprogress', (e) => {
                const percent = Math.round((e.loaded / e.total) * 100);
                setDownloadProgress(prev => prev ? { ...prev, translator: percent } : { translator: percent, summarizer: 0 });
              });
            },
          });
          translatorSession.destroy();
          setDownloadProgress(prev => prev ? { ...prev, translator: 100 } : { translator: 100, summarizer: 0 });
        }

        // Summarizerのダウンロード
        if (!summarizerReady && summarizerDownloadable) {
          console.log('Downloading Summarizer model...');
          const summarizerSession = await Summarizer.create({
            monitor(m) {
              m.addEventListener('downloadprogress', (e) => {
                const percent = Math.round((e.loaded / e.total) * 100);
                setDownloadProgress(prev => prev ? { ...prev, summarizer: percent } : { translator: 100, summarizer: percent });
              });
            },
          });
          summarizerSession.destroy();
          setDownloadProgress(prev => prev ? { ...prev, summarizer: 100 } : { translator: 100, summarizer: 100 });
        }

        setDownloadProgress(null);
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

  // ゲイン変更時にGainNodeを更新
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = inputGain;
    }
  }, [inputGain]);

  // BlobをArrayBufferに変換
  const blobToArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
    return await blob.arrayBuffer();
  };

  // JSONレスポンスからtranscriptionを抽出するヘルパー関数
  const extractTranscription = (response: string): string => {
    console.log('Raw response:', response);

    // 前後の空白を削除
    const trimmed = response.trim();

    // 1. まず通常のJSONパースを試みる
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.transcription === 'string') {
        return parsed.transcription;
      }
    } catch {
      // パース失敗
    }

    // 2. 不完全なJSONの場合、閉じ括弧を追加してパースを試みる
    if (trimmed.startsWith('{"transcription"') && !trimmed.endsWith('}')) {
      try {
        // 末尾の改行や不完全な引用符を処理
        let fixed = trimmed;
        if (!fixed.endsWith('"')) {
          fixed = fixed + '"';
        }
        fixed = fixed + '}';
        const parsed = JSON.parse(fixed);
        if (typeof parsed.transcription === 'string') {
          return parsed.transcription;
        }
      } catch {
        // パース失敗
      }
    }

    // 3. "transcription": "..." パターンを正規表現で抽出
    const match = trimmed.match(/"transcription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match && match[1]) {
      // エスケープされた文字を処理
      return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    // 4. {"transcription": の後の文字列を直接抽出
    const prefixMatch = trimmed.match(/^\{"transcription"\s*:\s*"(.*)$/s);
    if (prefixMatch && prefixMatch[1]) {
      // 末尾の "}や改行を削除
      let extracted = prefixMatch[1];
      extracted = extracted.replace(/"\s*\}?\s*$/, '');
      extracted = extracted.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return extracted;
    }

    // 5. 何も抽出できない場合は元のレスポンスを返す（JSONプレフィックスを除去）
    if (trimmed.startsWith('{"transcription"')) {
      return trimmed.replace(/^\{"transcription"\s*:\s*"?/, '').replace(/"?\s*\}?$/, '');
    }

    return trimmed;
  };

  // 要約を生成するヘルパー関数（チェックポイント形式）
  const MAX_NEW_CONTENT_LENGTH = 3000; // 新規コンテンツの最大長

  const summarizeTextWithCheckpoint = useCallback(async (
    fullText: string,
    setSummary: React.Dispatch<React.SetStateAction<OverallSummary>>,
    checkpointRef: React.MutableRefObject<{ summarizedUpTo: number; previousSummary: string }>,
    outputLanguage?: string
  ) => {
    const checkpoint = checkpointRef.current;

    // テキストが短い場合はそのまま表示
    if (fullText.trim().length < 50) {
      setSummary({ text: fullText, isProcessing: false });
      return;
    }

    // 新しいコンテンツがない場合は前回の要約を維持
    if (fullText.length <= checkpoint.summarizedUpTo && checkpoint.previousSummary) {
      setSummary({ text: checkpoint.previousSummary, isProcessing: false });
      return;
    }

    setSummary(prev => ({ ...prev, isProcessing: true }));

    let summarizerSession: SummarizerSession | null = null;
    try {
      summarizerSession = await Summarizer.create({
        type: summaryType,
        format: summaryFormat,
        length: summaryLength,
        ...(outputLanguage && { outputLanguage }),
      });

      let textToSummarize: string;
      let newCheckpointLength: number;

      // 前回の要約がある場合はチェックポイント形式で処理
      if (checkpoint.previousSummary && checkpoint.summarizedUpTo > 0) {
        // 新しい部分のみ抽出
        const newContent = fullText.slice(checkpoint.summarizedUpTo);

        if (newContent.length > MAX_NEW_CONTENT_LENGTH) {
          // 新しいコンテンツも長すぎる場合は、最新部分のみ使用
          const truncatedNew = newContent.slice(-MAX_NEW_CONTENT_LENGTH);
          textToSummarize = `[これまでの要約]\n${checkpoint.previousSummary}\n\n[新しい内容]\n...${truncatedNew}`;
          newCheckpointLength = fullText.length;
        } else {
          // 前回の要約 + 新しいコンテンツを要約
          textToSummarize = `[これまでの要約]\n${checkpoint.previousSummary}\n\n[新しい内容]\n${newContent}`;
          newCheckpointLength = fullText.length;
        }

        console.log(`Checkpoint summary: prev=${checkpoint.summarizedUpTo}, new=${newContent.length}, total=${fullText.length}`);
      } else {
        // 初回または全文が短い場合
        if (fullText.length > MAX_NEW_CONTENT_LENGTH) {
          // 長い場合は最新部分を使用
          textToSummarize = '...' + fullText.slice(-MAX_NEW_CONTENT_LENGTH);
        } else {
          textToSummarize = fullText;
        }
        newCheckpointLength = fullText.length;
      }

      const summaryText = await summarizerSession.summarize(textToSummarize);

      // チェックポイントを更新
      checkpointRef.current = {
        summarizedUpTo: newCheckpointLength,
        previousSummary: summaryText,
      };

      setSummary({ text: summaryText, isProcessing: false });
    } catch (e) {
      console.error('Summary error:', e);
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';

      if (errorMessage.includes('too large') || errorMessage.includes('too long')) {
        // エラー時は前回の要約を維持
        if (checkpoint.previousSummary) {
          setSummary({
            text: checkpoint.previousSummary + '\n\n（新しい内容は長すぎるため追加されませんでした）',
            isProcessing: false,
          });
        } else {
          setSummary({
            text: '（テキストが長すぎるため要約をスキップしました）',
            isProcessing: false,
          });
        }
      } else {
        setSummary({
          text: checkpoint.previousSummary || '',
          isProcessing: false,
          error: errorMessage,
        });
      }
    } finally {
      if (summarizerSession) summarizerSession.destroy();
    }
  }, [summaryType, summaryFormat, summaryLength]);

  // 全文要約を更新（文字起こし + 翻訳）- チェックポイント形式
  const updateOverallSummaries = useCallback(async (
    allTranscriptions: string[],
    allTranslations: string[],
    srcLang: string,
    tgtLang: string
  ) => {
    // 要約が無効の場合はスキップ
    if (!enableSummarization) {
      return;
    }

    // 文字起こしの要約（ソース言語で出力）
    if (allTranscriptions.length > 0) {
      const transcriptionText = allTranscriptions.join('\n\n');
      summarizeTextWithCheckpoint(transcriptionText, setTranscriptionSummary, transcriptionCheckpointRef, srcLang);
    }

    // 翻訳の要約（翻訳先言語で出力）
    if (allTranslations.length > 0) {
      const translationText = allTranslations.join('\n\n');
      summarizeTextWithCheckpoint(translationText, setTranslationSummary, translationCheckpointRef, tgtLang);
    }
  }, [summarizeTextWithCheckpoint, enableSummarization]);

  // システム音声ストリームを取得
  const getSystemAudioStream = async (): Promise<MediaStream> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // getDisplayMediaにはvideo: trueが必須
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      // ビデオトラックは不要なので停止
      stream.getVideoTracks().forEach(track => track.stop());

      // 音声トラックのみを含む新しいストリームを作成
      const audioOnlyStream = new MediaStream(stream.getAudioTracks());
      return audioOnlyStream;
    } catch (e) {
      console.error('Failed to get system audio:', e);
      throw new Error('システム音声の取得に失敗しました。画面共有を許可してください。');
    }
  };

  // マイクストリームを取得
  const getMicrophoneStream = async (): Promise<MediaStream> => {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      }
    });
  };

  // 複数のオーディオストリームを混合
  const mixAudioStreams = (streams: MediaStream[]): MediaStream => {
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    streams.forEach(stream => {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(destination);
    });

    audioContextRef.current = audioContext;
    return destination.stream;
  };

  // 音声ストリームを設定
  const setupAudioStream = async (): Promise<MediaStream> => {
    let finalStream: MediaStream;

    if (audioSource === 'microphone') {
      finalStream = await getMicrophoneStream();
      micStreamRef.current = finalStream;
    } else if (audioSource === 'system') {
      finalStream = await getSystemAudioStream();
      systemStreamRef.current = finalStream;
    } else {
      // 両方を混合
      const [micStream, sysStream] = await Promise.all([
        getMicrophoneStream(),
        getSystemAudioStream()
      ]);
      micStreamRef.current = micStream;
      systemStreamRef.current = sysStream;
      finalStream = mixAudioStreams([micStream, sysStream]);
      mixedStreamRef.current = finalStream;
    }

    return finalStream;
  };

  // セグメントの再評価を実行
  const reEvaluateSegment = async (segmentId: string, combinedAudioBlob: Blob) => {
    console.log(`Re-evaluating segment ${segmentId}, size: ${combinedAudioBlob.size}`);

    let languageModelSession: LanguageModelSession | null = null;
    let translatorSession: TranslatorSession | null = null;

    try {
      // セグメント内のチャンクを再評価中に設定
      setChunks(prev =>
        prev.map(c =>
          c.segmentId === segmentId
            ? {
                ...c,
                transcription: { ...c.transcription, status: 're-evaluating' as TranscriptionStatus }
              }
            : c
        )
      );

      // 文字起こしセッション作成
      languageModelSession = await LanguageModel.create({
        expectedInputs: [{ type: 'audio' }],
        expectedOutputLanguages: [sourceLanguage],
        systemPrompt: '音声を文字起こしして、transcriptionフィールドに結果を入れてください。音声が聞き取れない場合は空文字を返してください。前後の文脈を考慮して、自然な日本語になるように文字起こしを行ってください。',
      });

      const arrayBuffer = await blobToArrayBuffer(combinedAudioBlob);

      const transcriptionSchema = {
        type: 'object',
        properties: {
          transcription: { type: 'string', description: '音声の文字起こし結果' },
        },
        required: ['transcription'],
        additionalProperties: false,
      };

      const rawResponse = await languageModelSession.prompt(
        [
          {
            role: 'user',
            content: [
              { type: 'text', value: 'この音声を文字起こししてください。文脈を考慮して自然な文章にしてください：' },
              { type: 'audio', value: arrayBuffer },
            ],
          },
        ],
        { responseConstraint: transcriptionSchema }
      );

      const transcription = extractTranscription(rawResponse);
      console.log(`Re-evaluated transcription for segment ${segmentId}:`, transcription);

      // 翻訳
      translatorSession = await Translator.create({
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
      });

      const translatedText = await translatorSession.translate(transcription);

      // セグメント内のチャンクを統合して更新
      setChunks(prev => {
        const segmentChunks = prev.filter(c => c.segmentId === segmentId);
        const otherChunks = prev.filter(c => c.segmentId !== segmentId);

        if (segmentChunks.length === 0) return prev;

        // 最初のチャンクに統合結果を設定、他は削除
        const firstChunk = segmentChunks[0];
        const consolidatedChunk: ProcessedChunk = {
          ...firstChunk,
          transcription: {
            text: transcription,
            isProcessing: false,
            status: 'confirmed' as TranscriptionStatus,
          },
          translation: {
            text: translatedText,
            isProcessing: false,
          },
        };

        const updated = [...otherChunks, consolidatedChunk].sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        );

        // 要約を更新
        const allTranscriptions = updated
          .filter(c => c.transcription.text && !c.transcription.error)
          .map(c => c.transcription.text);

        const allTranslations = updated
          .filter(c => c.translation.text && !c.translation.error)
          .map(c => c.translation.text);

        updateOverallSummaries(allTranscriptions, allTranslations, sourceLanguage, targetLanguage);

        return updated;
      });
    } catch (e) {
      console.error('Re-evaluation error:', e);
      // エラー時は仮結果を確定結果に変更
      setChunks(prev =>
        prev.map(c =>
          c.segmentId === segmentId
            ? {
                ...c,
                transcription: { ...c.transcription, status: 'confirmed' as TranscriptionStatus }
              }
            : c
        )
      );
    } finally {
      if (languageModelSession) languageModelSession.destroy();
      if (translatorSession) translatorSession.destroy();
    }
  };

  // 音声チャンクを処理（文字起こし→翻訳）
  const processChunk = async (
    audioBlob: Blob,
    isProvisional: boolean = false,
    segmentId?: string,
    abortSignal?: AbortSignal
  ) => {
    if (audioBlob.size < 1000) {
      console.log('Audio chunk too small, skipping:', audioBlob.size);
      return;
    }

    const chunkId = crypto.randomUUID();

    // 仮処理の場合はpendingに追加
    if (isProvisional) {
      pendingProvisionalChunksRef.current.add(chunkId);
    }

    const newChunk: ProcessedChunk = {
      id: chunkId,
      timestamp: new Date(),
      transcription: {
        text: '',
        isProcessing: true,
        status: isProvisional ? 'provisional' : 'confirmed'
      },
      translation: { text: '', isProcessing: false },
      audioBlob: isProvisional ? audioBlob : undefined,
      segmentId: segmentId,
    };

    setChunks(prev => [...prev, newChunk]);

    let languageModelSession: LanguageModelSession | null = null;
    let translatorSession: TranslatorSession | null = null;

    // キャンセルチェック用のヘルパー
    const checkAborted = () => {
      if (abortSignal?.aborted) {
        throw new Error('ABORTED');
      }
    };

    try {
      checkAborted();

      // ステップ1: 文字起こし（構造化アウトプット）
      languageModelSession = await LanguageModel.create({
        expectedInputs: [{ type: 'audio' }],
        expectedOutputLanguages: [sourceLanguage],
        systemPrompt: '音声を文字起こしして、transcriptionフィールドに結果を入れてください。音声が聞き取れない場合は空文字を返してください。',
      });

      checkAborted();

      const arrayBuffer = await blobToArrayBuffer(audioBlob);
      console.log('Audio buffer size:', arrayBuffer.byteLength);

      checkAborted();

      // 構造化アウトプット用のJSON Schema
      const transcriptionSchema = {
        type: 'object',
        properties: {
          transcription: { type: 'string', description: '音声の文字起こし結果' },
        },
        required: ['transcription'],
        additionalProperties: false,
      };

      const rawResponse = await languageModelSession.prompt(
        [
          {
            role: 'user',
            content: [
              { type: 'text', value: 'この音声を文字起こししてください：' },
              { type: 'audio', value: arrayBuffer },
            ],
          },
        ],
        { responseConstraint: transcriptionSchema }
      );

      checkAborted();

      // JSONをパースして文字起こしテキストを取得
      const transcription = extractTranscription(rawResponse);
      console.log('Extracted transcription:', transcription);

      setChunks(prev =>
        prev.map(c =>
          c.id === chunkId
            ? {
                ...c,
                transcription: {
                  text: transcription,
                  isProcessing: false,
                  status: isProvisional ? 'provisional' : 'confirmed'
                },
                translation: { text: '', isProcessing: true },
              }
            : c
        )
      );

      checkAborted();

      // ステップ2: 翻訳
      translatorSession = await Translator.create({
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
      });

      checkAborted();

      const translatedText = await translatorSession.translate(transcription);

      checkAborted();

      // チャンクを更新
      setChunks(prev => {
        const updated = prev.map(c =>
          c.id === chunkId
            ? {
                ...c,
                translation: { text: translatedText, isProcessing: false },
              }
            : c
        );

        // 全テキストを収集して要約を更新
        const allTranscriptions = updated
          .filter(c => c.transcription.text && !c.transcription.error)
          .map(c => c.transcription.text);

        const allTranslations = updated
          .filter(c => c.translation.text && !c.translation.error)
          .map(c => c.translation.text);

        // 非同期で要約を更新
        updateOverallSummaries(allTranscriptions, allTranslations, sourceLanguage, targetLanguage);

        return updated;
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';

      // ABORTED エラーの場合は静かに処理中のチャンクを削除
      if (errorMessage === 'ABORTED') {
        console.log(`Provisional processing aborted for chunk ${chunkId}`);
        setChunks(prev => prev.filter(c => c.id !== chunkId));
        return;
      }

      console.error('Processing error:', e);

      setChunks(prev =>
        prev.map(c =>
          c.id === chunkId
            ? {
                ...c,
                transcription: c.transcription.isProcessing
                  ? { text: '', isProcessing: false, error: errorMessage, status: 'confirmed' as TranscriptionStatus }
                  : c.transcription,
                translation: c.translation.isProcessing
                  ? { text: '', isProcessing: false, error: errorMessage }
                  : c.translation,
              }
            : c
        )
      );
    } finally {
      // pendingから削除
      if (isProvisional) {
        pendingProvisionalChunksRef.current.delete(chunkId);
      }
      if (languageModelSession) languageModelSession.destroy();
      if (translatorSession) translatorSession.destroy();
    }
  };

  // 録音開始時刻を記録
  const recordingStartTimeRef = useRef<number>(0);

  // 音声レベルを監視
  const startAudioAnalysis = () => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const analyze = () => {
      if (!isRecordingRef.current) return;

      analyser.getByteFrequencyData(dataArray);

      // 平均音量を計算
      const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
      setAudioLevel(Math.min(100, (average / 128) * 100));

      // VADモードのみ無音検出を行う
      if (recordingMode === 'vad') {
        const now = Date.now();
        const recordingDuration = now - recordingStartTimeRef.current;

        if (average > silenceThreshold) {
          // 音声検出
          setIsSpeaking(true);
          hasSpokenRef.current = true;
          silenceStartRef.current = null;
        } else {
          // 無音
          setIsSpeaking(false);

          if (hasSpokenRef.current && recordingDuration > MIN_RECORDING_DURATION) {
            // 発話後の無音を検出
            if (silenceStartRef.current === null) {
              silenceStartRef.current = now;
            } else if (now - silenceStartRef.current > silenceDuration) {
              // 無音が一定時間続いたら録音停止
              console.log('Silence detected, stopping current recording');
              if (mediaRecorderRef.current?.state === 'recording') {
                mediaRecorderRef.current.stop();
              }
              return; // 次のanalyzeは呼ばない
            }
          }
        }
      } else {
        // 固定モードでは音声レベルのみ表示
        setIsSpeaking(average > silenceThreshold);
      }

      animationFrameRef.current = requestAnimationFrame(analyze);
    };

    analyze();
  };

  // 再評価タイマー
  const reEvaluationTimerRef = useRef<number | null>(null);

  // 仮処理をキャンセルして再評価を実行
  const triggerReEvaluation = () => {
    const segmentId = currentSegmentIdRef.current;
    const audioChunks = [...audioBufferRef.current];

    if (audioChunks.length === 0) {
      console.log('No audio chunks for re-evaluation');
      return;
    }

    console.log(`Triggering re-evaluation for segment ${segmentId}, ${audioChunks.length} chunks`);

    // 仮処理をキャンセル
    if (provisionalAbortControllerRef.current) {
      provisionalAbortControllerRef.current.abort();
      provisionalAbortControllerRef.current = null;
    }

    // 処理中の仮チャンクを削除
    setChunks(prev => prev.filter(c =>
      c.segmentId !== segmentId || c.transcription.status === 'confirmed'
    ));

    // 音声を結合
    const combinedBlob = new Blob(audioChunks, { type: mimeTypeRef.current });

    // バッファをリセット
    audioBufferRef.current = [];
    chunkCountInSegmentRef.current = 0;

    // 新しいセグメントIDを生成
    currentSegmentIdRef.current = crypto.randomUUID();
    segmentStartTimeRef.current = Date.now();

    // 新しいAbortControllerを作成
    provisionalAbortControllerRef.current = new AbortController();

    // 再評価を実行（確定結果として）
    reEvaluateSegment(segmentId, combinedBlob);
  };

  // 新しいMediaRecorderを作成
  const startNewRecorder = () => {
    if (!streamRef.current || !isRecordingRef.current) return;

    chunksRef.current = [];
    hasSpokenRef.current = false;
    silenceStartRef.current = null;
    recordingStartTimeRef.current = Date.now();
    setCurrentChunkTime(0);

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: mimeTypeRef.current
    });
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
        // 段階的処理用バッファにも追加
        if (enableProgressiveTranscription) {
          audioBufferRef.current.push(event.data);
        }
      }
    };

    mediaRecorder.onstop = () => {
      // VADモードの場合は発話があった場合のみ処理、固定モードは常に処理
      const shouldProcess = recordingMode === 'fixed' || hasSpokenRef.current;

      if (chunksRef.current.length > 0 && shouldProcess) {
        const audioBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        console.log('Processing audio chunk:', audioBlob.size, 'bytes');

        if (audioBlob.size >= 1000) {
          if (enableProgressiveTranscription) {
            // 段階的処理: 仮文字起こし
            const segmentId = currentSegmentIdRef.current;
            chunkCountInSegmentRef.current++;

            // AbortControllerがなければ作成
            if (!provisionalAbortControllerRef.current) {
              provisionalAbortControllerRef.current = new AbortController();
            }

            processChunk(
              audioBlob,
              true, // isProvisional
              segmentId,
              provisionalAbortControllerRef.current.signal
            );

            // 再評価タイミングをチェック
            const elapsedSinceSegmentStart = (Date.now() - segmentStartTimeRef.current) / 1000;
            if (elapsedSinceSegmentStart >= reEvaluationInterval) {
              triggerReEvaluation();
            }
          } else {
            // 通常処理
            processChunk(audioBlob);
          }
        } else {
          console.log('Audio chunk too small, skipping');
        }
      }

      // 録音継続中なら次のチャンクを開始
      if (isRecordingRef.current) {
        startNewRecorder();
      }
    };

    // 100msごとにデータを収集
    mediaRecorder.start(100);

    if (recordingMode === 'vad') {
      // 音声検出モード
      console.log('Started new recorder (voice-activated)');
      startAudioAnalysis();
    } else {
      // 固定時間モード - 段階的処理の場合は短い間隔で
      const interval = enableProgressiveTranscription ? provisionalInterval : fixedDuration;
      console.log(`Started new recorder (fixed ${interval}s, progressive: ${enableProgressiveTranscription})`);
      hasSpokenRef.current = true; // 固定モードでは常にtrueにする

      // タイマーでカウントダウンと自動停止
      let count = 0;
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      timerRef.current = window.setInterval(() => {
        count++;
        setCurrentChunkTime(count);

        if (count >= interval) {
          if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        }
      }, 1000);

      // 音声レベル表示のみ（VADなし）
      startAudioAnalysis();
    }
  };

  // 録音開始
  const startRecording = async () => {
    try {
      // 音声ソースを設定
      const stream = await setupAudioStream();
      streamRef.current = stream;

      // AudioContextが既にセットアップされている場合（mixAudioStreamsで作成）はスキップ
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      // AnalyserNodeをセットアップ
      if (!analyserRef.current) {
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        analyserRef.current.smoothingTimeConstant = 0.8;
      }

      // GainNodeを作成してゲインを適用
      if (!gainNodeRef.current) {
        gainNodeRef.current = audioContextRef.current.createGain();
        gainNodeRef.current.gain.value = inputGain;

        const source = audioContextRef.current.createMediaStreamSource(stream);
        source.connect(gainNodeRef.current);
        gainNodeRef.current.connect(analyserRef.current);
      }

      mimeTypeRef.current = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      console.log('Using MIME type:', mimeTypeRef.current);
      console.log('Audio source:', audioSource);

      // 段階的処理の初期化
      if (enableProgressiveTranscription) {
        audioBufferRef.current = [];
        currentSegmentIdRef.current = crypto.randomUUID();
        segmentStartTimeRef.current = Date.now();
        chunkCountInSegmentRef.current = 0;
        provisionalAbortControllerRef.current = new AbortController();
        pendingProvisionalChunksRef.current.clear();
      }

      setIsRecording(true);
      isRecordingRef.current = true;
      setStatus('recording');

      startNewRecorder();
    } catch (e) {
      console.error('Recording error:', e);
      setError(e instanceof Error ? e.message : '音声入力にアクセスできません');
    }
  };

  // 録音停止
  const stopRecording = () => {
    isRecordingRef.current = false;

    // タイマーをクリア
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // 再評価タイマーをクリア
    if (reEvaluationTimerRef.current) {
      window.clearInterval(reEvaluationTimerRef.current);
      reEvaluationTimerRef.current = null;
    }

    // アニメーションフレームをキャンセル
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    // 残っているバッファがあれば最終的な再評価を実行
    if (enableProgressiveTranscription && audioBufferRef.current.length > 0) {
      triggerReEvaluation();
    }

    // 仮処理をキャンセル
    if (provisionalAbortControllerRef.current) {
      provisionalAbortControllerRef.current.abort();
      provisionalAbortControllerRef.current = null;
    }

    // AudioContextをクローズ
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // 全てのストリームを停止
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach(track => track.stop());
      systemStreamRef.current = null;
    }
    if (mixedStreamRef.current) {
      mixedStreamRef.current.getTracks().forEach(track => track.stop());
      mixedStreamRef.current = null;
    }

    // AnalyserNodeとGainNodeをリセット
    analyserRef.current = null;
    gainNodeRef.current = null;

    setIsRecording(false);
    setIsSpeaking(false);
    setAudioLevel(0);
    setCurrentChunkTime(0);
    setStatus('available');
  };

  // クリーンアップ
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const clearChunks = () => {
    setChunks([]);
    setTranscriptionSummary({ text: '', isProcessing: false });
    setTranslationSummary({ text: '', isProcessing: false });
    // チェックポイントもリセット
    transcriptionCheckpointRef.current = { summarizedUpTo: 0, previousSummary: '' };
    translationCheckpointRef.current = { summarizedUpTo: 0, previousSummary: '' };
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
        <h1 className="text-lg font-semibold">音声パイプライン（文字起こし→翻訳→要約）</h1>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${
            status === 'checking' ? 'bg-yellow-500/20 text-yellow-400' :
            status === 'downloading' ? 'bg-blue-500/20 text-blue-400' :
            status === 'available' ? 'bg-green-500/20 text-green-400' :
            status === 'recording' ? 'bg-red-500/20 text-red-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {status === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />}
            {status === 'downloading' && <Download className="w-4 h-4 animate-bounce" />}
            {status === 'available' && <CheckCircle2 className="w-4 h-4" />}
            {status === 'recording' && <Mic className="w-4 h-4 animate-pulse" />}
            {status === 'unavailable' && <AlertCircle className="w-4 h-4" />}
            <span>
              {status === 'checking' && '確認中...'}
              {status === 'downloading' && (
                downloadProgress
                  ? `ダウンロード中... 翻訳:${downloadProgress.translator}% 要約:${downloadProgress.summarizer}%`
                  : 'ダウンロード中...'
              )}
              {status === 'available' && '準備完了'}
              {status === 'recording' && (
                recordingMode === 'vad'
                  ? (isSpeaking ? '🎤 発話検出中...' : '🔇 待機中...')
                  : enableProgressiveTranscription
                    ? `⏱️ 録音中 (${currentChunkTime}s / ${provisionalInterval}s) [段階的処理]`
                    : `⏱️ 録音中 (${currentChunkTime}s / ${fixedDuration}s)`
              )}
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
        <div className="grid grid-cols-2 gap-4">
          {/* 翻訳設定 */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1">
              <Languages className="w-3 h-3" />
              翻訳設定
            </h3>
            <div className="flex items-center gap-2">
              <select
                value={sourceLanguage}
                onChange={(e) => setSourceLanguage(e.target.value)}
                disabled={isRecording}
                className="flex-1 px-2 py-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs disabled:opacity-50"
              >
                <option value="ja">日本語</option>
                <option value="en">英語</option>
                <option value="zh">中国語</option>
                <option value="ko">韓国語</option>
                <option value="es">スペイン語</option>
                <option value="fr">フランス語</option>
                <option value="de">ドイツ語</option>
              </select>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">→</span>
              <select
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                disabled={isRecording}
                className="flex-1 px-2 py-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs disabled:opacity-50"
              >
                <option value="en">英語</option>
                <option value="ja">日本語</option>
                <option value="zh">中国語</option>
                <option value="ko">韓国語</option>
                <option value="es">スペイン語</option>
                <option value="fr">フランス語</option>
                <option value="de">ドイツ語</option>
              </select>
            </div>
          </div>

          {/* 要約設定 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1">
                <FileText className="w-3 h-3" />
                要約設定
              </h3>
              <button
                onClick={() => setEnableSummarization(!enableSummarization)}
                disabled={isRecording}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  enableSummarization
                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                    : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30'
                } disabled:opacity-50`}
              >
                {enableSummarization ? 'ON' : 'OFF'}
              </button>
            </div>
            {enableSummarization && (
              <div className="flex items-center gap-2">
                <select
                  value={summaryType}
                  onChange={(e) => setSummaryType(e.target.value as 'tldr' | 'key-points' | 'teaser' | 'headline')}
                  disabled={isRecording}
                  className="flex-1 px-2 py-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs disabled:opacity-50"
                >
                  <option value="tldr">TL;DR</option>
                  <option value="key-points">キーポイント</option>
                  <option value="teaser">ティーザー</option>
                  <option value="headline">見出し</option>
                </select>
                <select
                  value={summaryFormat}
                  onChange={(e) => setSummaryFormat(e.target.value as 'plain-text' | 'markdown')}
                  disabled={isRecording}
                  className="flex-1 px-2 py-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs disabled:opacity-50"
                >
                  <option value="plain-text">プレーン</option>
                  <option value="markdown">Markdown</option>
                </select>
                <select
                  value={summaryLength}
                  onChange={(e) => setSummaryLength(e.target.value as 'short' | 'medium' | 'long')}
                  disabled={isRecording}
                  className="flex-1 px-2 py-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs disabled:opacity-50"
                >
                  <option value="short">短い</option>
                  <option value="medium">中程度</option>
                  <option value="long">長い</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* 音声ソース設定 */}
        <div className="mt-4 pt-4 border-t border-[hsl(var(--border))]">
          <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1 mb-3">
            <MonitorSpeaker className="w-3 h-3" />
            音声ソース
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAudioSource('microphone')}
              disabled={isRecording}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                audioSource === 'microphone'
                  ? 'bg-purple-500 text-white'
                  : 'bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/0.8)]'
              } disabled:opacity-50`}
            >
              <Mic className="w-3 h-3" />
              マイク
            </button>
            <button
              onClick={() => setAudioSource('system')}
              disabled={isRecording}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                audioSource === 'system'
                  ? 'bg-purple-500 text-white'
                  : 'bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/0.8)]'
              } disabled:opacity-50`}
            >
              <Monitor className="w-3 h-3" />
              システム音声
            </button>
            <button
              onClick={() => setAudioSource('both')}
              disabled={isRecording}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                audioSource === 'both'
                  ? 'bg-purple-500 text-white'
                  : 'bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/0.8)]'
              } disabled:opacity-50`}
            >
              <MonitorSpeaker className="w-3 h-3" />
              両方
            </button>
          </div>
          {audioSource !== 'microphone' && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
              ⚠️ システム音声を使用するには、録音開始時に画面共有を許可してください
            </p>
          )}
        </div>

        {/* 段階的処理設定 */}
        <div className="mt-4 pt-4 border-t border-[hsl(var(--border))]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />
              段階的処理（リアルタイム精度向上）
            </h3>
            <button
              onClick={() => setEnableProgressiveTranscription(!enableProgressiveTranscription)}
              disabled={isRecording}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                enableProgressiveTranscription
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30'
              } disabled:opacity-50`}
            >
              {enableProgressiveTranscription ? 'ON' : 'OFF'}
            </button>
          </div>
          {enableProgressiveTranscription && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-[hsl(var(--muted-foreground))]">仮文字起こし間隔</label>
                  <span className="text-xs font-mono text-[hsl(var(--foreground))]">{provisionalInterval}秒</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="10"
                  step="1"
                  value={provisionalInterval}
                  onChange={(e) => setProvisionalInterval(parseInt(e.target.value))}
                  disabled={isRecording}
                  className="w-full h-2 bg-[hsl(var(--secondary))] rounded-lg appearance-none cursor-pointer accent-purple-500 disabled:opacity-50"
                />
                <div className="flex justify-between text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span>2秒</span>
                  <span>10秒</span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-[hsl(var(--muted-foreground))]">再評価間隔</label>
                  <span className="text-xs font-mono text-[hsl(var(--foreground))]">{reEvaluationInterval}秒</span>
                </div>
                <input
                  type="range"
                  min="6"
                  max="30"
                  step="3"
                  value={reEvaluationInterval}
                  onChange={(e) => setReEvaluationInterval(parseInt(e.target.value))}
                  disabled={isRecording}
                  className="w-full h-2 bg-[hsl(var(--secondary))] rounded-lg appearance-none cursor-pointer accent-purple-500 disabled:opacity-50"
                />
                <div className="flex justify-between text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span>6秒</span>
                  <span>30秒</span>
                </div>
              </div>
            </div>
          )}
          {enableProgressiveTranscription && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
              💡 {provisionalInterval}秒ごとに仮文字起こし → {reEvaluationInterval}秒ごとに精度向上のため再評価
            </p>
          )}
        </div>

        {/* 録音設定 */}
        <div className="mt-4 pt-4 border-t border-[hsl(var(--border))]">
          <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1 mb-3">
            <Volume2 className="w-3 h-3" />
            録音設定
          </h3>

          {/* 録音モード選択 */}
          <div className="flex items-center gap-4 mb-4">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">録音モード:</span>
            <div className="flex gap-2">
              <button
                onClick={() => setRecordingMode('vad')}
                disabled={isRecording}
                className={`px-3 py-1 rounded-md text-xs transition-colors ${
                  recordingMode === 'vad'
                    ? 'bg-purple-500 text-white'
                    : 'bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/0.8)]'
                } disabled:opacity-50`}
              >
                🎤 音声検出
              </button>
              <button
                onClick={() => setRecordingMode('fixed')}
                disabled={isRecording}
                className={`px-3 py-1 rounded-md text-xs transition-colors ${
                  recordingMode === 'fixed'
                    ? 'bg-purple-500 text-white'
                    : 'bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/0.8)]'
                } disabled:opacity-50`}
              >
                ⏱️ 固定時間
              </button>
            </div>
            {recordingMode === 'fixed' && (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="3"
                  max="30"
                  step="1"
                  value={fixedDuration}
                  onChange={(e) => setFixedDuration(parseInt(e.target.value))}
                  disabled={isRecording}
                  className="w-24 h-2 bg-[hsl(var(--secondary))] rounded-lg appearance-none cursor-pointer accent-purple-500 disabled:opacity-50"
                />
                <span className="text-xs font-mono text-[hsl(var(--foreground))] w-8">{fixedDuration}s</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* 入力ゲイン */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs text-[hsl(var(--muted-foreground))]">入力ゲイン</label>
                <span className="text-xs font-mono text-[hsl(var(--foreground))]">{inputGain.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={inputGain}
                onChange={(e) => setInputGain(parseFloat(e.target.value))}
                className="w-full h-2 bg-[hsl(var(--secondary))] rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <div className="flex justify-between text-[10px] text-[hsl(var(--muted-foreground))]">
                <span>0.1x</span>
                <span>3.0x</span>
              </div>
            </div>

            {/* 無音閾値 - VADモード時のみ表示 */}
            {recordingMode === 'vad' && (
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-[hsl(var(--muted-foreground))]">無音閾値</label>
                  <span className="text-xs font-mono text-[hsl(var(--foreground))]">{silenceThreshold}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={silenceThreshold}
                  onChange={(e) => setSilenceThreshold(parseInt(e.target.value))}
                  className="w-full h-2 bg-[hsl(var(--secondary))] rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
                <div className="flex justify-between text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span>敏感</span>
                  <span>鈍感</span>
                </div>
              </div>
            )}

            {/* 無音継続時間 - VADモード時のみ表示 */}
            {recordingMode === 'vad' && (
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-[hsl(var(--muted-foreground))]">無音継続時間</label>
                  <span className="text-xs font-mono text-[hsl(var(--foreground))]">{(silenceDuration / 1000).toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="5000"
                  step="100"
                  value={silenceDuration}
                  onChange={(e) => setSilenceDuration(parseInt(e.target.value))}
                  className="w-full h-2 bg-[hsl(var(--secondary))] rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
                <div className="flex justify-between text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span>0.5s</span>
                  <span>5.0s</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recording Controls */}
      <div className="p-6 border-b border-[hsl(var(--border))] flex flex-col items-center gap-4">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={status === 'checking' || status === 'unavailable' || status === 'downloading'}
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
          <div className="w-full max-w-xs space-y-2">
            {/* 固定モード: タイマープログレス */}
            {recordingMode === 'fixed' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[hsl(var(--muted-foreground))] w-12">進行</span>
                <div className="flex-1 bg-[hsl(var(--secondary))] rounded-full h-3 overflow-hidden">
                  <div
                    className="h-3 rounded-full transition-all duration-1000 bg-gradient-to-r from-purple-500 to-pink-500"
                    style={{ width: `${(currentChunkTime / (enableProgressiveTranscription ? provisionalInterval : fixedDuration)) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-[hsl(var(--foreground))] w-16 text-right">
                  {currentChunkTime}s / {enableProgressiveTranscription ? provisionalInterval : fixedDuration}s
                </span>
              </div>
            )}
            {/* 音声レベルメーター */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[hsl(var(--muted-foreground))] w-12">音声</span>
              <div className="flex-1 bg-[hsl(var(--secondary))] rounded-full h-3 overflow-hidden">
                <div
                  className={`h-3 rounded-full transition-all duration-75 ${
                    isSpeaking
                      ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                      : 'bg-gradient-to-r from-gray-400 to-gray-500'
                  }`}
                  style={{ width: `${audioLevel}%` }}
                />
              </div>
              <span className={`text-xs w-16 text-right ${isSpeaking ? 'text-green-400' : 'text-[hsl(var(--muted-foreground))]'}`}>
                {isSpeaking ? '発話中' : '無音'}
              </span>
            </div>
            {/* 説明 */}
            <p className="text-xs text-center text-[hsl(var(--muted-foreground))]">
              {recordingMode === 'vad'
                ? '発話終了後、自動で文字起こしを開始します'
                : enableProgressiveTranscription
                  ? `${provisionalInterval}秒ごとに仮文字起こし → ${reEvaluationInterval}秒ごとに再評価`
                  : `${fixedDuration}秒ごとに自動で文字起こしを開始します`}
            </p>
          </div>
        )}
      </div>

      {/* Main Content - 2 Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane - Chunks */}
        <div className="flex-1 overflow-y-auto p-4 border-r border-[hsl(var(--border))]">
          {chunks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Mic className="w-12 h-12 text-[hsl(var(--muted-foreground))] mb-4" />
              <p className="text-[hsl(var(--muted-foreground))]">
                録音を開始すると、発話を検出して自動で文字起こし→翻訳が実行されます
              </p>
              {status === 'downloading' && (
                <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-400 max-w-md">
                  <p className="font-medium mb-2">モデルをダウンロード中...</p>
                  {downloadProgress && (
                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>翻訳モデル</span>
                          <span>{downloadProgress.translator}%</span>
                        </div>
                        <div className="w-full bg-blue-500/20 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all"
                            style={{ width: `${downloadProgress.translator}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>要約モデル</span>
                          <span>{downloadProgress.summarizer}%</span>
                        </div>
                        <div className="w-full bg-blue-500/20 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all"
                            style={{ width: `${downloadProgress.summarizer}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {status === 'unavailable' && (
                <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 max-w-md">
                  <p className="font-medium mb-2">APIが利用できません</p>
                  <ul className="text-left list-disc list-inside space-y-1 text-xs">
                    <li>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input → Enabled</li>
                    <li>chrome://flags/#translation-api → Enabled</li>
                    <li>chrome://flags/#summarization-api-for-gemini-nano → Enabled</li>
                    <li>Chromeを再起動</li>
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {chunks.map((chunk) => {
                const isProvisional = chunk.transcription.status === 'provisional';
                const isReEvaluating = chunk.transcription.status === 're-evaluating';

                return (
                  <div
                    key={chunk.id}
                    className={`p-4 rounded-lg border transition-all ${
                      isReEvaluating
                        ? 'bg-blue-500/10 border-blue-500/30 animate-pulse'
                        : isProvisional
                          ? 'bg-yellow-500/5 border-yellow-500/20 opacity-80'
                          : 'bg-[hsl(var(--card))] border-[hsl(var(--border))]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">
                        {chunk.timestamp.toLocaleTimeString('ja-JP')}
                      </div>
                      {/* ステータスバッジ */}
                      {enableProgressiveTranscription && (
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ${
                          isReEvaluating
                            ? 'bg-blue-500/20 text-blue-400'
                            : isProvisional
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-green-500/20 text-green-400'
                        }`}>
                          {isReEvaluating ? (
                            <>
                              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                              再評価中
                            </>
                          ) : isProvisional ? (
                            <>
                              <Loader2 className="w-2.5 h-2.5" />
                              仮
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              確定
                            </>
                          )}
                        </div>
                      )}
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
                      ) : chunk.transcription.text ? (
                        <p className={`text-sm ${isProvisional ? 'text-[hsl(var(--muted-foreground))] italic' : 'text-[hsl(var(--foreground))]'}`}>
                          {chunk.transcription.text}
                        </p>
                      ) : (
                        <p className="text-sm text-[hsl(var(--muted-foreground))] italic">（音声なし）</p>
                      )}
                    </div>

                    {/* 翻訳 */}
                    <div>
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
                        <p className={`text-sm ${isProvisional ? 'text-[hsl(var(--muted-foreground))] italic' : 'text-[hsl(var(--foreground))]'}`}>
                          {chunk.translation.text}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div ref={chunksEndRef} />
            </div>
          )}
        </div>

        {/* Right Pane - Overall Summaries */}
        {enableSummarization && (
        <div className="w-80 flex-shrink-0 overflow-y-auto p-4 bg-[hsl(var(--secondary)/0.3)]">
          {chunks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <FileText className="w-8 h-8 text-[hsl(var(--muted-foreground))] mb-2" />
              <p className="text-sm text-[hsl(var(--muted-foreground))] italic">
                録音を開始すると、ここに全文の要約が表示されます
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 翻訳の要約 */}
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--foreground))] mb-2">
                  <Languages className="w-4 h-4" />
                  翻訳の要約
                </div>
                {translationSummary.isProcessing ? (
                  <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">要約を生成中...</span>
                  </div>
                ) : translationSummary.error ? (
                  <p className="text-sm text-red-400">エラー: {translationSummary.error}</p>
                ) : translationSummary.text ? (
                  <div className="p-3 rounded-lg bg-[hsl(var(--primary)/0.1)] border border-[hsl(var(--primary)/0.2)]">
                    <p className="text-sm text-[hsl(var(--foreground))] whitespace-pre-wrap">
                      {translationSummary.text}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] italic">
                    翻訳が完了すると要約が生成されます
                  </p>
                )}
              </div>

              {/* 文字起こしの要約 */}
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--foreground))] mb-2">
                  <Mic className="w-4 h-4" />
                  文字起こしの要約（日本語）
                </div>
                {transcriptionSummary.isProcessing ? (
                  <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">要約を生成中...</span>
                  </div>
                ) : transcriptionSummary.error ? (
                  <p className="text-sm text-red-400">エラー: {transcriptionSummary.error}</p>
                ) : transcriptionSummary.text ? (
                  <div className="p-3 rounded-lg bg-[hsl(var(--secondary))] border border-[hsl(var(--border))]">
                    <p className="text-sm text-[hsl(var(--foreground))] whitespace-pre-wrap">
                      {transcriptionSummary.text}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] italic">
                    文字起こしが完了すると要約が生成されます
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
