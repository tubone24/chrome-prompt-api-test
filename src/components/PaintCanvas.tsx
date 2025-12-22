import { useEffect, useRef, useState, useCallback } from 'react';
import { Pen, Eraser, Trash2, Palette, ChevronDown, Image, SprayCan, Square } from 'lucide-react';
import { usePromptAPI } from '../hooks/usePromptAPI';
import { ChatMessage } from './ChatMessage';

type Tool = 'pen' | 'eraser' | 'fill' | 'spray' | 'rectangle';

export const PaintCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(5);
  const [sprayDensity, setSprayDensity] = useState(50);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [rectangleFilled, setRectangleFilled] = useState(false);
  const [tempCanvas, setTempCanvas] = useState<ImageData | null>(null);

  const {
    messages,
    status,
    isGenerating,
    downloadProgress,
    error: apiError,
    checkAvailability,
    sendMessage,
    stopGeneration,
  } = usePromptAPI({
    systemPrompt: 'あなたは絵を見て、それが何かを当てる専門家です。ユーザーが描いた絵を見て、それが何かを推測してください。',
    multimodal: true,
    temperature: 0.8,
  });

  useEffect(() => {
    checkAvailability();
  }, [checkAvailability]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize canvas with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    if (shouldAutoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, shouldAutoScroll]);

  // Check scroll position and update indicator
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;

      setShowScrollIndicator(!isNearBottom);
      setShouldAutoScroll(isNearBottom);
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll(); // Initial check

    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShouldAutoScroll(true);
  }, []);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        // Draw image scaled to fit canvas
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
        const x = (canvas.width - img.width * scale) / 2;
        const y = (canvas.height - img.height * scale) / 2;

        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const sprayPaint = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const radius = lineWidth * 2;
    for (let i = 0; i < sprayDensity; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * radius;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;

      ctx.fillStyle = color;
      ctx.fillRect(px, py, 1, 1);
    }
  }, [color, lineWidth, sprayDensity]);

  const getCanvasCoordinates = useCallback((
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    } else {
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }
  }, []);

  const floodFill = useCallback((startX: number, startY: number, fillColor: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;

    const startIdx = (Math.floor(startY) * width + Math.floor(startX)) * 4;
    const startR = data[startIdx];
    const startG = data[startIdx + 1];
    const startB = data[startIdx + 2];
    const startA = data[startIdx + 3];

    // Convert fill color to RGB
    const fillRGB = {
      r: parseInt(fillColor.slice(1, 3), 16),
      g: parseInt(fillColor.slice(3, 5), 16),
      b: parseInt(fillColor.slice(5, 7), 16),
    };

    // If same color, return
    if (startR === fillRGB.r && startG === fillRGB.g && startB === fillRGB.b) return;

    const stack: [number, number][] = [[Math.floor(startX), Math.floor(startY)]];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      if (r !== startR || g !== startG || b !== startB || a !== startA) continue;

      visited.add(key);
      data[idx] = fillRGB.r;
      data[idx + 1] = fillRGB.g;
      data[idx + 2] = fillRGB.b;
      data[idx + 3] = 255;

      stack.push([x + 1, y]);
      stack.push([x - 1, y]);
      stack.push([x, y + 1]);
      stack.push([x, y - 1]);
    }

    ctx.putImageData(imageData, 0, 0);
  }, []);

  const startDrawing = useCallback((
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault();
    const pos = getCanvasCoordinates(e);
    if (!pos) return;

    if (tool === 'fill') {
      floodFill(pos.x, pos.y, color);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    setIsDrawing(true);
    setLastPos(pos);
    setStartPos(pos);

    // Save canvas state for rectangle preview
    if (tool === 'rectangle') {
      setTempCanvas(ctx.getImageData(0, 0, canvas.width, canvas.height));
    }

    // Initial spray or pen point
    if (tool === 'spray') {
      sprayPaint(pos.x, pos.y);
    }
  }, [getCanvasCoordinates, tool, floodFill, color, sprayPaint]);

  const draw = useCallback((
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const pos = getCanvasCoordinates(e);
    if (!pos) return;

    if (tool === 'spray') {
      sprayPaint(pos.x, pos.y);
      setLastPos(pos);
      return;
    }

    if (tool === 'rectangle' && startPos && tempCanvas) {
      // Restore canvas and draw preview rectangle
      ctx.putImageData(tempCanvas, 0, 0);

      const width = pos.x - startPos.x;
      const height = pos.y - startPos.y;

      if (rectangleFilled) {
        ctx.fillStyle = color;
        ctx.fillRect(startPos.x, startPos.y, width, height);
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(startPos.x, startPos.y, width, height);
      }
      setLastPos(pos);
      return;
    }

    // Regular pen/eraser
    if (!lastPos) return;

    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    setLastPos(pos);
  }, [isDrawing, getCanvasCoordinates, lastPos, startPos, color, lineWidth, tool, sprayPaint, tempCanvas, rectangleFilled]);

  const stopDrawing = useCallback(async () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setLastPos(null);
    setStartPos(null);
    setTempCanvas(null);

    // Send to AI for recognition
    const canvas = canvasRef.current;
    if (canvas && !isGenerating) {
      await sendMessage('この絵は何ですか？詳しく説明してください。', canvas);
    }
  }, [isDrawing, isGenerating, sendMessage]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Status Bar */}
      {status === 'downloading' && downloadProgress !== null && (
        <div className="px-4 py-2 bg-blue-500 text-white text-sm">
          AIモデルをダウンロード中... {downloadProgress}%
        </div>
      )}
      {status === 'unavailable' && (
        <div className="px-4 py-2 bg-red-500 text-white text-sm">
          {apiError || 'Prompt API が利用できません'}
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
        {/* Canvas Area */}
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 p-3 bg-[hsl(var(--secondary))] rounded-lg">
            {/* Tools */}
            <div className="flex gap-1 p-1 bg-[hsl(var(--background))] rounded">
              <button
                onClick={() => setTool('pen')}
                className={`p-2 rounded transition-colors ${
                  tool === 'pen'
                    ? 'bg-[hsl(var(--primary))] text-white'
                    : 'hover:bg-[hsl(var(--secondary))]'
                }`}
                title="ペン"
              >
                <Pen className="w-5 h-5" />
              </button>
              <button
                onClick={() => setTool('eraser')}
                className={`p-2 rounded transition-colors ${
                  tool === 'eraser'
                    ? 'bg-[hsl(var(--primary))] text-white'
                    : 'hover:bg-[hsl(var(--secondary))]'
                }`}
                title="消しゴム"
              >
                <Eraser className="w-5 h-5" />
              </button>
              <button
                onClick={() => setTool('fill')}
                className={`p-2 rounded transition-colors ${
                  tool === 'fill'
                    ? 'bg-[hsl(var(--primary))] text-white'
                    : 'hover:bg-[hsl(var(--secondary))]'
                }`}
                title="塗りつぶし"
              >
                <Palette className="w-5 h-5" />
              </button>
              <button
                onClick={() => setTool('spray')}
                className={`p-2 rounded transition-colors ${
                  tool === 'spray'
                    ? 'bg-[hsl(var(--primary))] text-white'
                    : 'hover:bg-[hsl(var(--secondary))]'
                }`}
                title="スプレー"
              >
                <SprayCan className="w-5 h-5" />
              </button>
              <button
                onClick={() => setTool('rectangle')}
                className={`p-2 rounded transition-colors ${
                  tool === 'rectangle'
                    ? 'bg-[hsl(var(--primary))] text-white'
                    : 'hover:bg-[hsl(var(--secondary))]'
                }`}
                title="矩形"
              >
                <Square className="w-5 h-5" />
              </button>
            </div>

            {/* Color Picker */}
            <div className="flex items-center gap-2">
              <label htmlFor="color-picker" className="text-sm font-medium cursor-pointer">
                色:
              </label>
              <input
                id="color-picker"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border-2 border-[hsl(var(--border))]"
              />
            </div>

            {/* Line Width */}
            <div className="flex items-center gap-2 flex-1 min-w-[150px]">
              <label htmlFor="line-width" className="text-sm font-medium whitespace-nowrap">
                太さ: {lineWidth}px
              </label>
              <input
                id="line-width"
                type="range"
                min="1"
                max="50"
                value={lineWidth}
                onChange={(e) => setLineWidth(Number(e.target.value))}
                className="flex-1"
              />
            </div>

            {/* Spray Density */}
            {tool === 'spray' && (
              <div className="flex items-center gap-2 flex-1 min-w-[150px]">
                <label htmlFor="spray-density" className="text-sm font-medium whitespace-nowrap">
                  密度: {sprayDensity}
                </label>
                <input
                  id="spray-density"
                  type="range"
                  min="10"
                  max="100"
                  value={sprayDensity}
                  onChange={(e) => setSprayDensity(Number(e.target.value))}
                  className="flex-1"
                />
              </div>
            )}

            {/* Rectangle Fill Toggle */}
            {tool === 'rectangle' && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rectangleFilled}
                    onChange={(e) => setRectangleFilled(e.target.checked)}
                    className="cursor-pointer"
                  />
                  塗りつぶし
                </label>
              </div>
            )}

            {/* Image Upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              title="画像を貼り付け"
            >
              <Image className="w-5 h-5" />
            </button>

            {/* Clear Button */}
            <button
              onClick={clearCanvas}
              className="p-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              title="クリア"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>

          {/* Canvas */}
          <div className="flex-1 flex items-center justify-center bg-[hsl(var(--secondary))] rounded-lg overflow-hidden min-h-0">
            <canvas
              ref={canvasRef}
              width={800}
              height={600}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              className="max-w-full max-h-full bg-white cursor-crosshair touch-none"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        </div>

        {/* AI Recognition Results */}
        <div className="w-full lg:w-96 flex flex-col bg-[hsl(var(--secondary))] rounded-lg overflow-hidden relative">
          <div className="p-3 border-b border-[hsl(var(--border))]">
            <h2 className="font-semibold">AI認識結果</h2>
          </div>
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto p-4 space-y-4"
          >
            {messages.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))] text-center">
                絵を描くと、AIがそれが何かを当てます！
              </p>
            ) : (
              messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))
            )}
            {isGenerating && (
              <div className="flex justify-center">
                <button
                  onClick={stopGeneration}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  停止
                </button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Scroll to bottom indicator */}
          {showScrollIndicator && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 p-2 bg-[hsl(var(--primary))] text-white rounded-full shadow-lg hover:bg-[hsl(var(--primary)/0.9)] transition-all animate-bounce"
              title="最新のメッセージへ"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
