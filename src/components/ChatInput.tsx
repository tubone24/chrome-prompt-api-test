import { useState, useRef, useEffect } from 'react';
import { Send, Square, Camera, X } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string, imageCanvas?: HTMLCanvasElement) => void;
  onStop: () => void;
  isGenerating: boolean;
  disabled: boolean;
  cameraMode: boolean;
  cameraReady?: boolean;
  getVideoElement?: () => HTMLVideoElement | null;
}

export function ChatInput({
  onSend,
  onStop,
  isGenerating,
  disabled,
  cameraMode,
  cameraReady,
  getVideoElement,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const captureImage = () => {
    const video = getVideoElement?.();
    if (!video || !canvasRef.current) {
      console.error('Video element not available');
      return;
    }

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setCapturedImage(canvas.toDataURL('image/jpeg', 0.8));
    }
  };

  const clearImage = () => {
    setCapturedImage(null);
  };

  const handleSubmit = () => {
    if (!input.trim() && !capturedImage) return;
    if (disabled || isGenerating) return;

    const message = input.trim() || 'この画像に何が写っていますか？';
    onSend(message, capturedImage ? canvasRef.current! : undefined);
    setInput('');
    setCapturedImage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <canvas ref={canvasRef} className="hidden" />

      {capturedImage && (
        <div className="relative inline-block mb-3">
          <img
            src={capturedImage}
            alt="キャプチャ画像"
            className="max-w-[200px] rounded-lg border border-[hsl(var(--border))]"
          />
          <button
            onClick={clearImage}
            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex gap-3 items-end">
        {cameraMode && (
          <button
            onClick={captureImage}
            disabled={disabled || !cameraReady}
            className="w-16 h-16 rounded-lg bg-[hsl(var(--secondary))] hover:bg-[hsl(var(--accent))] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center shrink-0"
            title="画像をキャプチャ"
          >
            <Camera className="w-8 h-8" />
          </button>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={cameraMode ? "画像について質問..." : "メッセージを入力..."}
          disabled={disabled}
          rows={3}
          className="flex-1 resize-none rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--input))] px-4 py-3 text-base placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] disabled:opacity-50 min-h-[80px]"
        />

        {isGenerating ? (
          <button
            onClick={onStop}
            className="w-16 h-16 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors flex items-center justify-center shrink-0"
            title="停止"
          >
            <Square className="w-8 h-8" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={disabled || (!input.trim() && !capturedImage)}
            className="w-16 h-16 rounded-lg bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.9)] text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center shrink-0"
            title="送信"
          >
            <Send className="w-8 h-8" />
          </button>
        )}
      </div>

      <div className="text-xs text-[hsl(var(--muted-foreground))] mt-2 text-center">
        Shift+Enter で改行 / Enter で送信
      </div>
    </div>
  );
}
