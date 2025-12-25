import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Volume2,
  Download,
  HardDrive,
} from 'lucide-react';
import {
  canUseWhisperWeb,
  downloadWhisperModel,
  getLoadedModels,
  resampleTo16Khz,
  transcribe,
  type WhisperWebModel,
} from '@remotion/whisper-web';

type Status =
  | 'checking'
  | 'downloading'
  | 'available'
  | 'unavailable'
  | 'recording'
  | 'transcribing';

interface TranscriptChunk {
  id: string;
  text: string;
  timestamp: Date;
  isProcessing: boolean;
  duration?: number;
}

const AVAILABLE_MODELS: { id: WhisperWebModel; name: string; size: string }[] = [
  { id: 'tiny', name: 'Tiny', size: '~75MB' },
  { id: 'tiny.en', name: 'Tiny (English)', size: '~75MB' },
  { id: 'base', name: 'Base', size: '~150MB' },
  { id: 'base.en', name: 'Base (English)', size: '~150MB' },
  { id: 'small', name: 'Small', size: '~500MB' },
  { id: 'small.en', name: 'Small (English)', size: '~500MB' },
];

export function WhisperTranscription() {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptChunk[]>([]);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // 音声レベル可視化用
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // モデル選択
  const [selectedModel, setSelectedModel] = useState<WhisperWebModel>('tiny');
  const [loadedModels, setLoadedModels] = useState<WhisperWebModel[]>([]);

  // 録音設定
  const [recordingMode, setRecordingMode] = useState<'vad' | 'fixed'>('fixed');
  const [fixedDuration, setFixedDuration] = useState(5);
  const [currentChunkTime, setCurrentChunkTime] = useState(0);

  // 音声設定
  const [inputGain, setInputGain] = useState(1.0);
  const [silenceThreshold, setSilenceThreshold] = useState(15);
  const [silenceDuration, setSilenceDuration] = useState(1500);

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

  const MIN_RECORDING_DURATION = 500;

  // APIの可用性チェック
  const checkAvailability = useCallback(async () => {
    setStatus('checking');
    setError(null);

    try {
      const result = await canUseWhisperWeb(selectedModel);
      console.log('Whisper Web availability:', result);

      if (result.supported) {
        setStatus('available');
      } else {
        setStatus('unavailable');
        setError(result.detailedReason || result.reason || 'Whisper Web APIが利用できません');
      }

      // 読み込み済みモデルを取得
      const models = await getLoadedModels();
      setLoadedModels(models);
    } catch (e) {
      setStatus('unavailable');
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }, [selectedModel]);

  useEffect(() => {
    checkAvailability();
  }, [checkAvailability]);

  useEffect(() => {
    transcriptsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = inputGain;
    }
  }, [inputGain]);

  // モデルダウンロード
  const downloadModel = async () => {
    try {
      setStatus('downloading');
      setDownloadProgress(0);

      await downloadWhisperModel({
        model: selectedModel,
        onProgress: ({ progress }) => {
          setDownloadProgress(Math.round(progress * 100));
        },
      });

      const models = await getLoadedModels();
      setLoadedModels(models);
      setStatus('available');
    } catch (e) {
      setStatus('unavailable');
      setError(e instanceof Error ? e.message : 'ダウンロードエラー');
    }
  };

  // 音声チャンクを文字起こし
  const transcribeChunk = async (audioBlob: Blob) => {
    if (audioBlob.size < 1000) {
      console.log('Audio chunk too small, skipping:', audioBlob.size);
      return;
    }

    const chunkId = crypto.randomUUID();

    setTranscripts((prev) => [
      ...prev,
      {
        id: chunkId,
        text: '',
        timestamp: new Date(),
        isProcessing: true,
      },
    ]);

    setStatus('transcribing');

    try {
      // 16kHzにリサンプル（BlobをそのままAPIに渡す）
      console.log('Resampling audio, blob size:', audioBlob.size, 'type:', audioBlob.type);
      const waveform = await resampleTo16Khz({
        file: audioBlob,
        logLevel: 'verbose',
        onProgress: (p) => console.log('Resample progress:', p),
      });
      console.log('Resampled waveform length:', waveform.length);

      const durationSeconds = waveform.length / 16000;
      console.log(
        'Transcribing with model:',
        selectedModel,
        'duration:',
        durationSeconds.toFixed(2),
        's'
      );

      // 文字起こし実行
      const result = await transcribe({
        model: selectedModel,
        channelWaveform: waveform,
        language: 'auto',
        logLevel: 'verbose',
        threads: 1,
        onProgress: (p) => {
          console.log('Transcription progress:', p);
        },
      });

      // テキストを抽出
      const text = result.transcription
        .map((t) => t.text)
        .join('')
        .trim();

      console.log('Transcription result:', text);

      setTranscripts((prev) =>
        prev.map((t) =>
          t.id === chunkId
            ? {
                ...t,
                text: text || '(無音)',
                isProcessing: false,
                duration: durationSeconds,
              }
            : t
        )
      );
    } catch (e) {
      console.error('Transcription error:', e);
      setTranscripts((prev) =>
        prev.map((t) =>
          t.id === chunkId
            ? {
                ...t,
                text: `エラー: ${e instanceof Error ? e.message : 'Unknown'}`,
                isProcessing: false,
              }
            : t
        )
      );
    } finally {
      if (isRecordingRef.current) {
        setStatus('recording');
      } else {
        setStatus('available');
      }
    }
  };

  // 音声レベルを監視
  const startAudioAnalysis = () => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const analyze = () => {
      if (!isRecordingRef.current) return;

      analyser.getByteFrequencyData(dataArray);

      const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
      setAudioLevel(Math.min(100, (average / 128) * 100));

      if (recordingMode === 'vad') {
        const now = Date.now();
        const recordingDuration = now - recordingStartTimeRef.current;

        if (average > silenceThreshold) {
          setIsSpeaking(true);
          hasSpokenRef.current = true;
          silenceStartRef.current = null;
        } else {
          setIsSpeaking(false);

          if (hasSpokenRef.current && recordingDuration > MIN_RECORDING_DURATION) {
            if (silenceStartRef.current === null) {
              silenceStartRef.current = now;
            } else if (now - silenceStartRef.current > silenceDuration) {
              console.log('Silence detected, stopping current recording');
              if (mediaRecorderRef.current?.state === 'recording') {
                mediaRecorderRef.current.stop();
              }
              return;
            }
          }
        }
      } else {
        setIsSpeaking(average > silenceThreshold);
      }

      animationFrameRef.current = requestAnimationFrame(analyze);
    };

    analyze();
  };

  // 新しいMediaRecorderを作成
  const startNewRecorder = () => {
    if (!streamRef.current || !isRecordingRef.current) return;

    chunksRef.current = [];
    hasSpokenRef.current = false;
    silenceStartRef.current = null;
    recordingStartTimeRef.current = Date.now();
    setCurrentChunkTime(0);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: mimeTypeRef.current,
    });
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setCurrentChunkTime(0);

      const shouldProcess = recordingMode === 'fixed' || hasSpokenRef.current;
      if (chunksRef.current.length > 0 && shouldProcess) {
        const audioBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        console.log('Processing complete audio chunk:', audioBlob.size, 'bytes');

        if (audioBlob.size >= 1000) {
          transcribeChunk(audioBlob);
        } else {
          console.log('Audio chunk too small, skipping');
        }
      }

      if (isRecordingRef.current) {
        startNewRecorder();
      }
    };

    mediaRecorder.start(100);

    if (recordingMode === 'vad') {
      console.log('Started new recorder (voice-activated)');
      startAudioAnalysis();
    } else {
      console.log(`Started new recorder (fixed ${fixedDuration}s)`);
      hasSpokenRef.current = true;
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
      startAudioAnalysis();
    }
  };

  // 録音開始
  const startRecording = async () => {
    // モデルがダウンロードされているか確認
    if (!loadedModels.includes(selectedModel)) {
      setError('モデルをダウンロードしてください');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.8;

      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = inputGain;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(gainNodeRef.current);
      gainNodeRef.current.connect(analyserRef.current);

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
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
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
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const clearTranscripts = () => {
    setTranscripts([]);
  };

  const getFullTranscript = () => {
    return transcripts
      .filter((t) => !t.isProcessing && !t.text.startsWith('エラー'))
      .map((t) => t.text)
      .join(' ');
  };

  const isModelLoaded = loadedModels.includes(selectedModel);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
        <h1 className="text-lg font-semibold">Whisper 文字起こし</h1>
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${
              status === 'checking'
                ? 'bg-yellow-500/20 text-yellow-400'
                : status === 'downloading'
                  ? 'bg-blue-500/20 text-blue-400'
                  : status === 'available'
                    ? 'bg-green-500/20 text-green-400'
                    : status === 'recording'
                      ? 'bg-red-500/20 text-red-400'
                      : status === 'transcribing'
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-red-500/20 text-red-400'
            }`}
          >
            {status === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />}
            {status === 'downloading' && <Download className="w-4 h-4 animate-bounce" />}
            {status === 'available' && <CheckCircle2 className="w-4 h-4" />}
            {status === 'recording' && <Mic className="w-4 h-4 animate-pulse" />}
            {status === 'transcribing' && <Loader2 className="w-4 h-4 animate-spin" />}
            {status === 'unavailable' && <AlertCircle className="w-4 h-4" />}
            <span>
              {status === 'checking' && '確認中...'}
              {status === 'downloading' && `ダウンロード中 ${downloadProgress}%`}
              {status === 'available' && '準備完了'}
              {status === 'recording' &&
                (recordingMode === 'fixed'
                  ? `録音中... ${currentChunkTime}/${fixedDuration}秒`
                  : isSpeaking
                    ? '発話検出中...'
                    : '待機中...')}
              {status === 'transcribing' && '文字起こし中...'}
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

      {/* モデル選択 */}
      <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.3)]">
        <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-3 flex items-center gap-1">
          <HardDrive className="w-3 h-3" />
          モデル選択
        </h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {AVAILABLE_MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => setSelectedModel(model.id)}
              disabled={isRecording || status === 'downloading'}
              className={`px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1 ${
                selectedModel === model.id
                  ? 'bg-purple-500 text-white'
                  : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary)/0.8)]'
              } disabled:opacity-50`}
            >
              {loadedModels.includes(model.id) && (
                <CheckCircle2 className="w-3 h-3 text-green-400" />
              )}
              {model.name}
              <span className="opacity-60">({model.size})</span>
            </button>
          ))}
        </div>
        {!isModelLoaded && status !== 'downloading' && (
          <button
            onClick={downloadModel}
            disabled={isRecording}
            className="w-full px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg text-sm font-medium hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            {selectedModel} モデルをダウンロード
          </button>
        )}
        {status === 'downloading' && (
          <div className="w-full bg-[hsl(var(--secondary))] rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
        )}
      </div>

      {/* 録音モード切り替え */}
      <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.3)]">
        <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-3">
          録音モード
        </h3>
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
              <span className="text-xs font-mono text-[hsl(var(--foreground))]">
                {fixedDuration}秒
              </span>
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

      {/* 音声設定 */}
      <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.3)]">
        <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1 mb-3">
          <Volume2 className="w-3 h-3" />
          音声検出設定
        </h3>
        <div
          className={`grid gap-4 ${recordingMode === 'vad' ? 'grid-cols-3' : 'grid-cols-1'}`}
        >
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">入力ゲイン</label>
              <span className="text-xs font-mono text-[hsl(var(--foreground))]">
                {inputGain.toFixed(1)}x
              </span>
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
          </div>

          {recordingMode === 'vad' && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-[hsl(var(--muted-foreground))]">無音閾値</label>
                  <span className="text-xs font-mono text-[hsl(var(--foreground))]">
                    {silenceThreshold}
                  </span>
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
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-[hsl(var(--muted-foreground))]">
                    無音継続時間
                  </label>
                  <span className="text-xs font-mono text-[hsl(var(--foreground))]">
                    {(silenceDuration / 1000).toFixed(1)}s
                  </span>
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
              </div>
            </>
          )}
        </div>
      </div>

      {/* Recording Controls */}
      <div className="p-6 border-b border-[hsl(var(--border))] flex flex-col items-center gap-4">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={
            status === 'checking' ||
            status === 'unavailable' ||
            status === 'downloading' ||
            !isModelLoaded
          }
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
          {!isModelLoaded
            ? 'モデルをダウンロードしてください'
            : isRecording
              ? 'タップして録音停止'
              : 'タップして録音開始'}
        </p>
        {isRecording && (
          <div className="w-full max-w-xs space-y-2">
            {recordingMode === 'fixed' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
                  <span>録音進捗</span>
                  <span className="font-mono">
                    {currentChunkTime}/{fixedDuration}秒
                  </span>
                </div>
                <div className="w-full bg-[hsl(var(--secondary))] rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-1000"
                    style={{ width: `${(currentChunkTime / fixedDuration) * 100}%` }}
                  />
                </div>
              </div>
            )}
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
              <span
                className={`text-xs w-16 text-right ${isSpeaking ? 'text-green-400' : 'text-[hsl(var(--muted-foreground))]'}`}
              >
                {isSpeaking ? '発話中' : '無音'}
              </span>
            </div>
            <p className="text-xs text-center text-[hsl(var(--muted-foreground))]">
              {recordingMode === 'fixed'
                ? `${fixedDuration}秒ごとに自動で文字起こしします`
                : '発話終了後、自動で文字起こしを開始します'}
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
              {!isModelLoaded
                ? `${selectedModel} モデルをダウンロードして開始してください`
                : recordingMode === 'fixed'
                  ? `録音を開始すると、${fixedDuration}秒ごとに自動で文字起こしされます`
                  : '録音を開始すると、発話を検出して自動で文字起こしされます'}
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
              whisper.cpp (WebAssembly) を使用
            </p>
            {status === 'unavailable' && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 max-w-md">
                <p className="font-medium mb-2">Whisper APIが利用できません</p>
                <ul className="text-left list-disc list-inside space-y-1 text-xs">
                  <li>Cross-Origin-Isolationヘッダーが必要です</li>
                  <li>SharedArrayBufferがサポートされている必要があります</li>
                  {error && <li>{error}</li>}
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
                <div className="flex justify-between items-center text-xs text-[hsl(var(--muted-foreground))] mb-2">
                  <span>{transcript.timestamp.toLocaleTimeString('ja-JP')}</span>
                  {transcript.duration && (
                    <span>{transcript.duration.toFixed(1)}秒</span>
                  )}
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
      {transcripts.some((t) => !t.isProcessing && !t.text.startsWith('エラー')) && (
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
