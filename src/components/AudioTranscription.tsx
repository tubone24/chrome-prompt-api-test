import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Loader2, AlertCircle, CheckCircle2, Trash2, Volume2, Clock, Layers } from 'lucide-react';
import { useSemaphore } from '../hooks/useProcessingQueue';

type Status = 'checking' | 'available' | 'unavailable' | 'recording';

interface TranscriptChunk {
  id: string;
  text: string;
  timestamp: Date;
  isProcessing: boolean;
}

export function AudioTranscription() {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptChunk[]>([]);

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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriptsEndRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(false);
  const mimeTypeRef = useRef<string>('audio/webm');

  // 音声解析用
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);
  const recordingStartTimeRef = useRef<number>(0);
  const gainNodeRef = useRef<GainNode | null>(null);
  const timerRef = useRef<number | null>(null);

  // 並列処理制御
  const [maxConcurrentProcessing, setMaxConcurrentProcessing] = useState(2);
  const processSemaphore = useSemaphore(maxConcurrentProcessing);
  const [processingQueueSize, setProcessingQueueSize] = useState(0);
  const [activeProcessingCount, setActiveProcessingCount] = useState(0);
  const pendingChunksRef = useRef<Blob[]>([]);
  const isProcessingQueueRef = useRef(false);

  // 固定設定
  const MIN_RECORDING_DURATION = 500; // 最小録音時間（ms）

  // APIの可用性チェック
  const checkAvailability = useCallback(async () => {
    setStatus('checking');
    setError(null);

    if (typeof LanguageModel === 'undefined') {
      setStatus('unavailable');
      setError('LanguageModel APIが見つかりません');
      return;
    }

    try {
      const availability = await LanguageModel.availability({
        expectedInputs: [{ type: 'audio' }],
      });
      console.log('Audio API Availability:', availability);

      if (availability === 'available' || availability === 'readily') {
        setStatus('available');
      } else if (availability === 'downloadable' || availability === 'after-download') {
        setStatus('checking');
        const tempSession = await LanguageModel.create({
          expectedInputs: [{ type: 'audio' }],
          expectedOutputLanguages: ['ja'],
        });
        tempSession.destroy();
        setStatus('available');
      } else {
        setStatus('unavailable');
        setError(`音声API利用不可: ${availability}`);
      }
    } catch (e) {
      setStatus('unavailable');
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }, []);

  useEffect(() => {
    checkAvailability();
  }, [checkAvailability]);

  useEffect(() => {
    transcriptsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

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
      extracted = extracted.replace(/"\s*}?\s*$/, '');
      extracted = extracted.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return extracted;
    }

    // 5. 何も抽出できない場合は元のレスポンスを返す（JSONプレフィックスを除去）
    if (trimmed.startsWith('{"transcription"')) {
      return trimmed.replace(/^\{"transcription"\s*:\s*"?/, '').replace(/"?\s*}?$/, '');
    }

    return trimmed;
  };

  // 音声チャンクを文字起こし（セマフォで同時実行数を制御）
  const transcribeChunkInternal = async (audioBlob: Blob, chunkId: string) => {
    let session: LanguageModelSession | null = null;

    try {
      // 毎回新しいセッションを作成（構造化アウトプット）
      session = await LanguageModel.create({
        expectedInputs: [{ type: 'audio' }],
        expectedOutputLanguages: ['ja'],
        systemPrompt: '音声を文字起こしして、transcriptionフィールドに結果を入れてください。音声が聞き取れない場合は空文字を返してください。',
      });

      // ArrayBufferに変換
      const arrayBuffer = await blobToArrayBuffer(audioBlob);
      console.log('Audio buffer size:', arrayBuffer.byteLength);

      // 構造化アウトプット用のJSON Schema
      const transcriptionSchema = {
        type: 'object',
        properties: {
          transcription: { type: 'string', description: '音声の文字起こし結果' },
        },
        required: ['transcription'],
        additionalProperties: false,
      };

      const rawResponse = await session.prompt(
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

      // JSONをパースして文字起こしテキストを取得
      const transcription = extractTranscription(rawResponse);
      console.log('Extracted transcription:', transcription);

      setTranscripts(prev =>
        prev.map(t =>
          t.id === chunkId
            ? { ...t, text: transcription, isProcessing: false }
            : t
        )
      );
    } catch (e) {
      console.error('Transcription error:', e);
      setTranscripts(prev =>
        prev.map(t =>
          t.id === chunkId
            ? { ...t, text: `エラー: ${e instanceof Error ? e.message : 'Unknown'}`, isProcessing: false }
            : t
        )
      );
    } finally {
      // セッションを必ず破棄
      if (session) {
        session.destroy();
      }
    }
  };

  // キューからチャンクを処理
  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    while (pendingChunksRef.current.length > 0) {
      const audioBlob = pendingChunksRef.current.shift();
      if (!audioBlob) continue;

      setProcessingQueueSize(pendingChunksRef.current.length);

      // セマフォで同時実行数を制限
      await processSemaphore.withSemaphore(async () => {
        setActiveProcessingCount(prev => prev + 1);
        const chunkId = crypto.randomUUID();

        setTranscripts(prev => [...prev, {
          id: chunkId,
          text: '',
          timestamp: new Date(),
          isProcessing: true,
        }]);

        try {
          await transcribeChunkInternal(audioBlob, chunkId);
        } finally {
          setActiveProcessingCount(prev => Math.max(0, prev - 1));
        }
      });
    }

    isProcessingQueueRef.current = false;
  }, [processSemaphore]);

  // 音声チャンクをキューに追加
  const enqueueChunk = useCallback((audioBlob: Blob) => {
    if (audioBlob.size < 1000) {
      console.log('Audio chunk too small, skipping:', audioBlob.size);
      return;
    }

    pendingChunksRef.current.push(audioBlob);
    setProcessingQueueSize(pendingChunksRef.current.length);
    console.log(`Enqueued chunk (queue size: ${pendingChunksRef.current.length})`);

    // キュー処理を開始
    processQueue();
  }, [processQueue]);

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

  // 新しいMediaRecorderを作成（音声検出ベース or 固定時間）
  const startNewRecorder = () => {
    if (!streamRef.current || !isRecordingRef.current) return;

    chunksRef.current = [];
    hasSpokenRef.current = false;
    silenceStartRef.current = null;
    recordingStartTimeRef.current = Date.now();
    setCurrentChunkTime(0);

    // 前のタイマーをクリア
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

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
      // タイマーをクリア
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setCurrentChunkTime(0);

      // 録音データを処理（VADモードは発話があった場合のみ、固定モードは常に処理）
      const shouldProcess = recordingMode === 'fixed' || hasSpokenRef.current;
      if (chunksRef.current.length > 0 && shouldProcess) {
        const audioBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        console.log('Enqueuing audio chunk:', audioBlob.size, 'bytes');

        if (audioBlob.size >= 1000) {
          // キューに追加（並列処理制御）
          enqueueChunk(audioBlob);
        } else {
          console.log('Audio chunk too small, skipping');
        }
      }

      // まだ録音中なら新しいレコーダーを開始（処理完了を待たずに即座に開始）
      if (isRecordingRef.current) {
        startNewRecorder();
      }
    };

    // 100msごとにデータを収集
    mediaRecorder.start(100);

    if (recordingMode === 'vad') {
      console.log('Started new recorder (voice-activated)');
      // 音声解析開始
      startAudioAnalysis();
    } else {
      console.log(`Started new recorder (fixed ${fixedDuration}s)`);
      // 固定モードでは即座にhasSpokenをtrueに
      hasSpokenRef.current = true;
      // タイマーで固定時間後に停止
      let count = 0;
      timerRef.current = window.setInterval(() => {
        count++;
        setCurrentChunkTime(count);
        if (count >= fixedDuration) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          if (mediaRecorderRef.current?.state === 'recording') {
            console.log('Fixed duration reached, stopping recording');
            mediaRecorderRef.current.stop();
          }
        }
      }, 1000);
      // 音声解析開始（レベル表示用）
      startAudioAnalysis();
    }
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

      // AudioContextとAnalyserNode、GainNodeをセットアップ
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.8;

      // GainNodeを作成してゲインを適用
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = inputGain;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(gainNodeRef.current);
      gainNodeRef.current.connect(analyserRef.current);

      // サポートされているMIMEタイプを確認
      mimeTypeRef.current = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      console.log('Using MIME type:', mimeTypeRef.current);

      setIsRecording(true);
      isRecordingRef.current = true;
      setStatus('recording');

      // 最初のレコーダーを開始
      startNewRecorder();
    } catch (e) {
      console.error('Recording error:', e);
      setError(e instanceof Error ? e.message : 'マイクにアクセスできません');
    }
  };

  // 録音停止
  const stopRecording = () => {
    isRecordingRef.current = false;

    // タイマーをキャンセル
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // アニメーションフレームをキャンセル
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop(); // onstopで残りのデータを処理
    }

    // AudioContextをクローズ
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

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
        clearInterval(timerRef.current);
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

  const clearTranscripts = () => {
    setTranscripts([]);
    // キューもクリア
    pendingChunksRef.current = [];
    setProcessingQueueSize(0);
  };

  const getFullTranscript = () => {
    return transcripts
      .filter(t => !t.isProcessing && !t.text.startsWith('エラー'))
      .map(t => t.text)
      .join(' ');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
        <h1 className="text-lg font-semibold">音声文字起こし</h1>
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
              {status === 'recording' && (
              recordingMode === 'fixed'
                ? `⏱️ 録音中... ${currentChunkTime}/${fixedDuration}秒`
                : (isSpeaking ? '🎤 発話検出中...' : '🔇 待機中...')
            )}
              {status === 'unavailable' && (error || 'API利用不可')}
            </span>
          </div>
          {transcripts.length > 0 && (
            <button
              onClick={clearTranscripts}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              クリア
            </button>
          )}
        </div>
      </div>

      {/* 録音モード切り替え */}
      <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.3)]">
        <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-3">録音モード</h3>
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setRecordingMode('vad')}
            disabled={isRecording}
            className={`flex-1 px-3 py-2 rounded-lg text-sm transition-all ${
              recordingMode === 'vad'
                ? 'bg-purple-500 text-white'
                : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary)/0.8)]'
            } disabled:opacity-50`}
          >
            音声検出（VAD）
          </button>
          <button
            onClick={() => setRecordingMode('fixed')}
            disabled={isRecording}
            className={`flex-1 px-3 py-2 rounded-lg text-sm transition-all ${
              recordingMode === 'fixed'
                ? 'bg-purple-500 text-white'
                : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary)/0.8)]'
            } disabled:opacity-50`}
          >
            固定時間
          </button>
        </div>
        {recordingMode === 'fixed' && (
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">録音時間</label>
              <span className="text-xs font-mono text-[hsl(var(--foreground))]">{fixedDuration}秒</span>
            </div>
            <input
              type="range"
              min="3"
              max="30"
              step="1"
              value={fixedDuration}
              onChange={(e) => setFixedDuration(parseInt(e.target.value))}
              disabled={isRecording}
              className="w-full h-2 bg-[hsl(var(--secondary))] rounded-lg appearance-none cursor-pointer accent-purple-500 disabled:opacity-50"
            />
            <div className="flex justify-between text-[10px] text-[hsl(var(--muted-foreground))]">
              <span>3秒</span>
              <span>30秒</span>
            </div>
          </div>
        )}
      </div>

      {/* 並列処理設定 */}
      <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.3)]">
        <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1 mb-3">
          <Layers className="w-3 h-3" />
          並列処理設定
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">同時処理数:</span>
            <select
              value={maxConcurrentProcessing}
              onChange={(e) => setMaxConcurrentProcessing(parseInt(e.target.value))}
              disabled={isRecording}
              className="px-2 py-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-xs disabled:opacity-50"
            >
              <option value="1">1（順次処理）</option>
              <option value="2">2（デフォルト）</option>
              <option value="3">3</option>
              <option value="4">4（高速）</option>
            </select>
          </div>
          {(processingQueueSize > 0 || activeProcessingCount > 0) && (
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-blue-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                処理中: {activeProcessingCount}
              </span>
              {processingQueueSize > 0 && (
                <span className="flex items-center gap-1 text-yellow-400">
                  <Clock className="w-3 h-3" />
                  待機中: {processingQueueSize}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 音声設定（VADモード時のみ詳細表示） */}
      <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.3)]">
        <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1 mb-3">
          <Volume2 className="w-3 h-3" />
          音声検出設定
        </h3>
        <div className={`grid gap-4 ${recordingMode === 'vad' ? 'grid-cols-3' : 'grid-cols-1'}`}>
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

          {/* 無音閾値（VADモードのみ） */}
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

          {/* 無音継続時間（VADモードのみ） */}
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
          <div className="w-full max-w-xs space-y-2">
            {/* 固定モード時のカウントダウン */}
            {recordingMode === 'fixed' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
                  <span>録音進捗</span>
                  <span className="font-mono">{currentChunkTime}/{fixedDuration}秒</span>
                </div>
                <div className="w-full bg-[hsl(var(--secondary))] rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-1000"
                    style={{ width: `${(currentChunkTime / fixedDuration) * 100}%` }}
                  />
                </div>
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
              {recordingMode === 'fixed'
                ? `${fixedDuration}秒ごとに自動で文字起こしします`
                : '発話終了後、自動で文字起こしを開始します'
              }
            </p>
          </div>
        )}
      </div>

      {/* Transcripts */}
      <div className="flex-1 overflow-y-auto p-4">
        {transcripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Mic className="w-12 h-12 text-[hsl(var(--muted-foreground))] mb-4" />
            <p className="text-[hsl(var(--muted-foreground))]">
              {recordingMode === 'fixed'
                ? `録音を開始すると、${fixedDuration}秒ごとに自動で文字起こしされます`
                : '録音を開始すると、発話を検出して自動で文字起こしされます'
              }
            </p>
            {status === 'unavailable' && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 max-w-md">
                <p className="font-medium mb-2">音声APIが利用できません</p>
                <ul className="text-left list-disc list-inside space-y-1 text-xs">
                  <li>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input → Enabled</li>
                  <li>Chromeを再起動</li>
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {transcripts.map((transcript) => (
              <div
                key={transcript.id}
                className={`p-4 rounded-lg ${
                  transcript.isProcessing
                    ? 'bg-[hsl(var(--secondary))] animate-pulse'
                    : 'bg-[hsl(var(--card))] border border-[hsl(var(--border))]'
                }`}
              >
                <div className="text-xs text-[hsl(var(--muted-foreground))] mb-2">
                  {transcript.timestamp.toLocaleTimeString('ja-JP')}
                </div>
                {transcript.isProcessing ? (
                  <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>文字起こし中...</span>
                  </div>
                ) : (
                  <p className="text-[hsl(var(--foreground))]">{transcript.text}</p>
                )}
              </div>
            ))}
            <div ref={transcriptsEndRef} />
          </div>
        )}
      </div>

      {/* Full Transcript */}
      {transcripts.some(t => !t.isProcessing && !t.text.startsWith('エラー')) && (
        <div className="p-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <div className="text-xs text-[hsl(var(--muted-foreground))] mb-2">全文</div>
          <p className="text-sm text-[hsl(var(--foreground))] whitespace-pre-wrap">
            {getFullTranscript()}
          </p>
        </div>
      )}
    </div>
  );
}
