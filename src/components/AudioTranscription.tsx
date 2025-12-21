import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Loader2, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';

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
  const [currentChunkTime, setCurrentChunkTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriptsEndRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(false);
  const mimeTypeRef = useRef<string>('audio/webm');
  const timerRef = useRef<number | null>(null);

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

  // BlobをArrayBufferに変換
  const blobToArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
    return await blob.arrayBuffer();
  };

  // 音声チャンクを文字起こし（毎回新しいセッションを作成）
  const transcribeChunk = async (audioBlob: Blob) => {
    // サイズチェック
    if (audioBlob.size < 1000) {
      console.log('Audio chunk too small, skipping:', audioBlob.size);
      return;
    }

    const chunkId = crypto.randomUUID();

    setTranscripts(prev => [...prev, {
      id: chunkId,
      text: '',
      timestamp: new Date(),
      isProcessing: true,
    }]);

    let session: LanguageModelSession | null = null;

    try {
      // 毎回新しいセッションを作成
      session = await LanguageModel.create({
        expectedInputs: [{ type: 'audio' }],
        expectedOutputLanguages: ['ja'],
        systemPrompt: 'あなたは音声文字起こしアシスタントです。音声の内容を正確に日本語でテキストに変換してください。音声が聞き取れない場合は「（聞き取れません）」と出力してください。',
      });

      // ArrayBufferに変換
      const arrayBuffer = await blobToArrayBuffer(audioBlob);
      console.log('Audio buffer size:', arrayBuffer.byteLength);

      const response = await session.prompt([
        {
          role: 'user',
          content: [
            { type: 'text', value: 'この音声を文字起こししてください：' },
            { type: 'audio', value: arrayBuffer },
          ],
        },
      ]);

      setTranscripts(prev =>
        prev.map(t =>
          t.id === chunkId
            ? { ...t, text: response, isProcessing: false }
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
      // 録音データを処理
      if (chunksRef.current.length > 0) {
        const audioBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        console.log('Processing complete audio chunk:', audioBlob.size, 'bytes');

        if (audioBlob.size >= 1000) {
          transcribeChunk(audioBlob);
        } else {
          console.log('Audio chunk too small, skipping');
        }
      }

      // まだ録音中なら新しいレコーダーを開始
      if (isRecordingRef.current) {
        startNewRecorder();
      }
    };

    // 録音開始
    mediaRecorder.start();
    console.log('Started new recorder');

    // 5秒後に停止（カウントダウンも更新）
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

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop(); // onstopで残りのデータを処理
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

  const clearTranscripts = () => {
    setTranscripts([]);
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
              {status === 'recording' && `録音中 (${currentChunkTime}s / 5s)`}
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

      {/* Transcripts */}
      <div className="flex-1 overflow-y-auto p-4">
        {transcripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Mic className="w-12 h-12 text-[hsl(var(--muted-foreground))] mb-4" />
            <p className="text-[hsl(var(--muted-foreground))]">
              録音を開始すると、5秒ごとに自動で文字起こしされます
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
