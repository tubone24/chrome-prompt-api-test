import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, Download } from 'lucide-react';
import { usePromptAPI, type APIStatus } from '../hooks/usePromptAPI';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { CameraView, type CameraViewRef } from './CameraView';

interface ChatProps {
  cameraMode: boolean;
}

function StatusBadge({
  status,
  downloadProgress,
  error,
}: {
  status: APIStatus;
  downloadProgress: number | null;
  error: string | null;
}) {
  const configs = {
    checking: {
      icon: <Loader2 className="w-4 h-4 animate-spin" />,
      text: '確認中...',
      className: 'bg-yellow-500/20 text-yellow-400',
    },
    available: {
      icon: <CheckCircle2 className="w-4 h-4" />,
      text: 'Gemini Nano 準備完了',
      className: 'bg-green-500/20 text-green-400',
    },
    downloading: {
      icon: <Download className="w-4 h-4 animate-bounce" />,
      text: downloadProgress !== null ? `ダウンロード中 ${downloadProgress}%` : 'ダウンロード中...',
      className: 'bg-blue-500/20 text-blue-400',
    },
    unavailable: {
      icon: <AlertCircle className="w-4 h-4" />,
      text: error || 'API利用不可',
      className: 'bg-red-500/20 text-red-400',
    },
  };

  const config = configs[status];

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${config.className}`}>
      {config.icon}
      <span className="max-w-[200px] truncate">{config.text}</span>
    </div>
  );
}

export function Chat({ cameraMode }: ChatProps) {
  const {
    messages,
    status,
    isGenerating,
    downloadProgress,
    error,
    checkAvailability,
    sendMessage,
    stopGeneration,
    clearMessages,
  } = usePromptAPI({
    systemPrompt: 'あなたは親切なアシスタントです。日本語で簡潔に回答してください。',
    multimodal: cameraMode,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<CameraViewRef>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const autoCaptureRef = useRef<number | null>(null);
  const isGeneratingRef = useRef(isGenerating);

  // isGeneratingの変更を追跡
  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  useEffect(() => {
    checkAvailability();
  }, [checkAvailability]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCameraReady = () => {
    setCameraReady(true);
  };

  const getVideoElement = () => cameraRef.current?.getVideoElement() ?? null;

  const captureAndSend = () => {
    const video = getVideoElement();
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      sendMessage('この画像に何が写っていますか？日本語で簡潔に説明してください。', canvas);
    }
  };

  const startAutoCapture = () => {
    setAutoCapture(true);
    captureAndSend(); // 最初の1回をすぐ実行

    // 前の回答が終わったら次をキャプチャ
    const checkAndCapture = () => {
      if (!isGeneratingRef.current) {
        captureAndSend();
      }
    };

    autoCaptureRef.current = window.setInterval(checkAndCapture, 5000); // 5秒間隔でチェック
  };

  const stopAutoCapture = () => {
    setAutoCapture(false);
    if (autoCaptureRef.current) {
      window.clearInterval(autoCaptureRef.current);
      autoCaptureRef.current = null;
    }
  };

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (autoCaptureRef.current) {
        window.clearInterval(autoCaptureRef.current);
      }
    };
  }, []);

  const handleSend = (message: string, imageCanvas?: HTMLCanvasElement) => {
    sendMessage(message, imageCanvas);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
        <h1 className="text-lg font-semibold">
          {cameraMode ? 'カメラ認識モード' : 'テキストチャット'}
        </h1>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} downloadProgress={downloadProgress} error={error} />
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            >
              クリア
            </button>
          )}
        </div>
      </div>

      {/* Camera View (if enabled) */}
      {cameraMode && (
        <div className="p-4 border-b border-[hsl(var(--border))]">
          <CameraView ref={cameraRef} onStreamReady={handleCameraReady} />
          {cameraReady && (
            <div className="mt-3 flex items-center justify-center gap-3">
              {autoCapture ? (
                <button
                  onClick={stopAutoCapture}
                  className="px-6 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium transition-all flex items-center gap-2"
                >
                  <span className="w-3 h-3 bg-white rounded-full animate-pulse" />
                  自動認識を停止
                </button>
              ) : (
                <button
                  onClick={startAutoCapture}
                  disabled={status !== 'available'}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  自動認識を開始
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-4">
              <span className="text-3xl">🤖</span>
            </div>
            <h2 className="text-xl font-semibold mb-2">Gemini Nano Chat</h2>
            <p className="text-[hsl(var(--muted-foreground))] max-w-md">
              {cameraMode
                ? 'カメラを起動して、画像をキャプチャして質問してください。'
                : 'Chromeブラウザ内蔵のGemini Nanoモデルとチャットできます。'}
            </p>
            {status === 'unavailable' && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 max-w-md">
                <p className="font-medium mb-2">APIが利用できません</p>
                <ul className="text-left list-disc list-inside space-y-1 text-xs">
                  <li>chrome://flags/#optimization-guide-on-device-model → Enabled</li>
                  <li>chrome://flags/#prompt-api-for-gemini-nano → Enabled</li>
                  {cameraMode && (
                    <li>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input → Enabled</li>
                  )}
                  <li>Chromeを再起動</li>
                </ul>
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={stopGeneration}
        isGenerating={isGenerating}
        disabled={status !== 'available'}
        cameraMode={cameraMode}
        cameraReady={cameraReady}
        getVideoElement={getVideoElement}
      />
    </div>
  );
}
