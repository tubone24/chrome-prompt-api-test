import { useEffect, useRef, useState, useCallback } from 'react';
import { Pen, Trash2, ChevronDown, Send, RefreshCw } from 'lucide-react';
import { usePromptAPI } from '../hooks/usePromptAPI';

// 採点結果のJSON構造
interface FeedbackDetail {
  x: number;
  y: number;
  comment: string;
}

interface GradingResult {
  score: number;
  overallComment: string;
  details: FeedbackDetail[];
}

// お手本文字の選択肢
const SAMPLE_CHARACTERS = [
  { char: '永', reading: 'えい', description: '永字八法 - 基本の8種類の筆法が含まれる' },
  { char: '山', reading: 'やま', description: '横画と縦画のバランス' },
  { char: '川', reading: 'かわ', description: '縦画の払い' },
  { char: '日', reading: 'ひ', description: '四角の構成' },
  { char: '月', reading: 'つき', description: '曲線と払い' },
  { char: '火', reading: 'ひ', description: 'はねと払い' },
  { char: '水', reading: 'みず', description: '複雑な払い' },
  { char: '木', reading: 'き', description: '横画・縦画・払い' },
  { char: '花', reading: 'はな', description: '複雑な構成' },
  { char: '心', reading: 'こころ', description: '点と曲線' },
];

// 毛筆の毛（bristle）を表現するクラス
interface Bristle {
  offset: number;      // 中心からのオフセット（-1〜1）
  thickness: number;   // 毛の太さ係数
  inkAmount: number;   // インク量（カスレに影響）
}

export const CalligraphyChecker = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [lastPressure, setLastPressure] = useState(0.5);
  const [lastTime, setLastTime] = useState(0);
  const [lastAngle, setLastAngle] = useState(0);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [selectedChar, setSelectedChar] = useState(SAMPLE_CHARACTERS[0]);
  const [gradingResult, setGradingResult] = useState<GradingResult | null>(null);
  const [showMarkers, setShowMarkers] = useState(false);
  const [markerAnimationIndex, setMarkerAnimationIndex] = useState(0);

  // 毛筆の毛を初期化（複数の毛で構成）
  const bristlesRef = useRef<Bristle[]>([]);

  // 毛を初期化
  useEffect(() => {
    const bristles: Bristle[] = [];
    const bristleCount = 40; // 毛の本数
    for (let i = 0; i < bristleCount; i++) {
      bristles.push({
        offset: (Math.random() - 0.5) * 2,
        thickness: 0.5 + Math.random() * 0.5,
        inkAmount: 0.7 + Math.random() * 0.3,
      });
    }
    bristlesRef.current = bristles;
  }, []);

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
    systemPrompt: `あなたは厳しくも優しい書道の先生だ。生徒の習字を採点する。
タメ語で指導すること。

【重要】以下の正確なJSON形式のみで回答せよ。マークダウンや説明文は不要：
{"score":75,"overallComment":"コメント","details":[{"x":400,"y":300,"comment":"指摘"}]}

- score: 0〜100の整数
- overallComment: タメ語での総評
- details: 指摘箇所の配列（x:0-800, y:0-600）`,
    multimodal: true,
    temperature: 0.5,
  });

  useEffect(() => {
    checkAvailability();
  }, [checkAvailability]);

  // 半紙テクスチャを描画
  const drawHanshiTexture = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // ベースのクリーム色
    ctx.fillStyle = '#FAF6F0';
    ctx.fillRect(0, 0, width, height);

    // 紙の繊維感を表現（ノイズ）
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 15;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);

    // 薄い罫線（補助線）
    ctx.strokeStyle = 'rgba(200, 180, 160, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    // 中心の十字線
    ctx.beginPath();
    ctx.moveTo(width / 2, 50);
    ctx.lineTo(width / 2, height - 50);
    ctx.moveTo(50, height / 2);
    ctx.lineTo(width - 50, height / 2);
    ctx.stroke();

    // 外枠
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(180, 160, 140, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, width - 80, height - 80);

    ctx.setLineDash([]);
  }, []);

  // キャンバス初期化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawHanshiTexture(ctx, canvas.width, canvas.height);
  }, [drawHanshiTexture]);

  // オーバーレイキャンバスをクリア
  const clearOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }, []);

  // 赤丸マーカーを描画（筆で一筆書きしたような朱色の丸）
  const drawMarkers = useCallback((details: FeedbackDetail[], animateIndex: number) => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    details.forEach((detail, index) => {
      if (index > animateIndex) return;

      const radius = 35;
      const startAngle = Math.random() * Math.PI * 0.5 - Math.PI * 0.25; // 開始角度をランダムに
      const arcLength = Math.PI * 1.7 + Math.random() * 0.4; // 少し開いた円（完全に閉じない）

      ctx.save();

      // 朱色（オレンジがかった赤）
      const r = 220 + Math.floor(Math.random() * 20);
      const g = 80 + Math.floor(Math.random() * 30);
      const b = 20 + Math.floor(Math.random() * 20);

      // 筆で一筆書きした円を描画
      const steps = 60;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const angle = startAngle + arcLength * t;

        // 筆圧の変化（始点と終点で細く、中間で太く）
        const pressureCurve = Math.sin(t * Math.PI);
        const baseWidth = 6 + pressureCurve * 8;

        // カスレ効果（終点に近づくほどカスレる）
        const kasure = t > 0.7 ? (t - 0.7) / 0.3 : 0;

        const x = detail.x + Math.cos(angle) * radius;
        const y = detail.y + Math.sin(angle) * radius;

        // 複数の毛で描画
        const bristleCount = 8;
        for (let j = 0; j < bristleCount; j++) {
          // カスレで一部の毛をスキップ
          if (Math.random() < kasure * 0.7) continue;

          const perpAngle = angle + Math.PI / 2;
          const offset = (j / bristleCount - 0.5) * baseWidth;
          const bx = x + Math.cos(perpAngle) * offset + (Math.random() - 0.5) * 2;
          const by = y + Math.sin(perpAngle) * offset + (Math.random() - 0.5) * 2;

          const alpha = (0.6 + Math.random() * 0.3) * (1 - kasure * 0.5);
          const size = (baseWidth / bristleCount) * (0.8 + Math.random() * 0.4);

          ctx.beginPath();
          ctx.arc(bx, by, size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.fill();
        }
      }

      ctx.restore();
    });
  }, []);

  // マーカーアニメーション
  useEffect(() => {
    if (!showMarkers || !gradingResult?.details.length) return;

    if (markerAnimationIndex < gradingResult.details.length) {
      const timer = setTimeout(() => {
        drawMarkers(gradingResult.details, markerAnimationIndex);
        setMarkerAnimationIndex(prev => prev + 1);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [showMarkers, markerAnimationIndex, gradingResult, drawMarkers]);

  // Auto-scroll
  useEffect(() => {
    if (shouldAutoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, shouldAutoScroll, gradingResult]);

  // Scroll indicator
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
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShouldAutoScroll(true);
  }, []);

  const getCanvasCoordinates = useCallback((
    e: React.PointerEvent<HTMLCanvasElement>
  ): { x: number; y: number; pressure: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      pressure: e.pressure > 0 ? e.pressure : 0.5,
    };
  }, []);

  // 毛筆のストロークを描画（カスレ、止め・はね・払い表現）
  const drawBrushStroke = useCallback((
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    fromPressure: number,
    toPressure: number,
    velocity: number,
    angle: number
  ) => {
    const distance = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
    if (distance < 0.5) return;

    const steps = Math.max(1, Math.floor(distance));
    const bristles = bristlesRef.current;

    // 基本の筆の太さ（大きめに）
    const baseWidth = 35;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = fromX + (toX - fromX) * t;
      const y = fromY + (toY - fromY) * t;
      const pressure = fromPressure + (toPressure - fromPressure) * t;

      // 筆圧に応じた太さ（強く押すと太く）
      const pressureWidth = baseWidth * (0.4 + pressure * 0.8);

      // 速度に応じたカスレ効果（速いほどカスレる）
      const kasureIntensity = Math.min(1, velocity * 0.004);

      // 各毛を描画
      bristles.forEach((bristle) => {
        // カスレ：速度が速いとインクが途切れる
        if (Math.random() < kasureIntensity * 0.6) return;

        // 毛の位置を計算（角度を考慮）
        const perpAngle = angle + Math.PI / 2;
        const offsetX = Math.cos(perpAngle) * bristle.offset * pressureWidth * 0.5;
        const offsetY = Math.sin(perpAngle) * bristle.offset * pressureWidth * 0.5;

        // 毛の太さ
        const bristleWidth = pressureWidth * bristle.thickness * 0.15;

        // インク量に応じた透明度
        const alpha = bristle.inkAmount * (0.7 - kasureIntensity * 0.4) * (0.8 + Math.random() * 0.2);

        ctx.beginPath();
        ctx.arc(
          x + offsetX + (Math.random() - 0.5) * 2,
          y + offsetY + (Math.random() - 0.5) * 2,
          bristleWidth,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = `rgba(15, 15, 25, ${Math.max(0.05, alpha)})`;
        ctx.fill();
      });

      // 墨のにじみ効果（筆圧が強いところ）
      if (pressure > 0.7 && Math.random() > 0.85) {
        ctx.beginPath();
        ctx.arc(x, y, pressureWidth * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 15, 25, 0.03)';
        ctx.fill();
      }
    }
  }, []);

  // 始点の「入り」を描画
  const drawEntryPoint = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number
  ) => {
    const baseSize = 20 * (0.5 + pressure * 0.5);
    const bristles = bristlesRef.current;

    // 始点の墨だまり
    bristles.forEach((bristle) => {
      const offsetX = bristle.offset * baseSize * 0.3;
      const offsetY = bristle.offset * baseSize * 0.3;
      const size = baseSize * bristle.thickness * 0.3;

      ctx.beginPath();
      ctx.arc(
        x + offsetX + (Math.random() - 0.5) * baseSize * 0.2,
        y + offsetY + (Math.random() - 0.5) * baseSize * 0.2,
        size,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = `rgba(15, 15, 25, ${0.4 + Math.random() * 0.3})`;
      ctx.fill();
    });
  }, []);

  // 終点の「払い」「はね」を描画
  const drawExitPoint = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    velocity: number,
    angle: number
  ) => {
    // 払いの長さ（速度に応じて）
    const haraiLength = Math.min(40, velocity * 0.5);
    const steps = Math.floor(haraiLength);

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const size = 8 * (1 - t * t); // 先細り（2次曲線的に）
      const alpha = 0.5 * (1 - t);

      const px = x + Math.cos(angle) * i * 1.5;
      const py = y + Math.sin(angle) * i * 1.5;

      // カスレながら払う
      for (let j = 0; j < 3; j++) {
        if (Math.random() < t * 0.5) continue; // 先に行くほどカスレる

        ctx.beginPath();
        ctx.arc(
          px + (Math.random() - 0.5) * size,
          py + (Math.random() - 0.5) * size,
          size * (0.2 + Math.random() * 0.3),
          0,
          Math.PI * 2
        );
        ctx.fillStyle = `rgba(15, 15, 25, ${alpha * (0.5 + Math.random() * 0.5)})`;
        ctx.fill();
      }
    }
  }, []);

  const startDrawing = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const pos = getCanvasCoordinates(e);
    if (!pos) return;

    setIsDrawing(true);
    setLastPos({ x: pos.x, y: pos.y });
    setLastPressure(pos.pressure);
    setLastTime(Date.now());
    setLastAngle(0);

    // 赤丸マーカーのみクリア（採点結果は残す）
    setShowMarkers(false);
    setMarkerAnimationIndex(0);
    clearOverlay();

    // 始点に「入り」を描画
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    drawEntryPoint(ctx, pos.x, pos.y, pos.pressure);
  }, [getCanvasCoordinates, clearOverlay, drawEntryPoint]);

  const draw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const pos = getCanvasCoordinates(e);
    if (!pos || !lastPos) return;

    const currentTime = Date.now();
    const timeDelta = Math.max(1, currentTime - lastTime);
    const dx = pos.x - lastPos.x;
    const dy = pos.y - lastPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const velocity = distance / timeDelta * 10;

    // 移動方向から角度を計算
    const angle = distance > 1 ? Math.atan2(dy, dx) : lastAngle;

    drawBrushStroke(ctx, lastPos.x, lastPos.y, pos.x, pos.y, lastPressure, pos.pressure, velocity, angle);

    setLastPos({ x: pos.x, y: pos.y });
    setLastPressure(pos.pressure);
    setLastTime(currentTime);
    setLastAngle(angle);
  }, [isDrawing, getCanvasCoordinates, lastPos, lastPressure, lastTime, lastAngle, drawBrushStroke]);

  const stopDrawing = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !lastPos) {
      setIsDrawing(false);
      setLastPos(null);
      return;
    }

    const pos = getCanvasCoordinates(e);
    if (pos) {
      const currentTime = Date.now();
      const timeDelta = Math.max(1, currentTime - lastTime);
      const dx = pos.x - lastPos.x;
      const dy = pos.y - lastPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const velocity = distance / timeDelta * 10;

      // 払い・はねを描画
      drawExitPoint(ctx, pos.x, pos.y, velocity, lastAngle);
    }

    setIsDrawing(false);
    setLastPos(null);
  }, [isDrawing, lastPos, lastTime, lastAngle, getCanvasCoordinates, drawExitPoint]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawHanshiTexture(ctx, canvas.width, canvas.height);
    setGradingResult(null);
    setShowMarkers(false);
    setMarkerAnimationIndex(0);
    clearOverlay();
  }, [drawHanshiTexture, clearOverlay]);

  // 採点を実行
  const handleGrading = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('Canvas not found');
      return;
    }
    if (isGenerating) {
      console.log('Already generating');
      return;
    }
    if (status !== 'available') {
      console.log('API not available:', status);
      return;
    }

    setGradingResult(null);
    setShowMarkers(false);
    setMarkerAnimationIndex(0);
    clearOverlay();

    const prompt = `この習字を採点してください。お手本の文字は「${selectedChar.char}」（${selectedChar.reading}）です。${selectedChar.description}の練習として書かれています。JSON形式のみで回答してください。`;

    try {
      await sendMessage(prompt, canvas);
    } catch (error) {
      console.error('Grading error:', error);
    }
  }, [isGenerating, status, selectedChar, sendMessage, clearOverlay]);

  // AIレスポンスからJSONを抽出してパース
  useEffect(() => {
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant') return;
    if (lastMessage.isStreaming) return;

    console.log('Parsing AI response:', lastMessage.content);

    try {
      // JSONを抽出
      const content = lastMessage.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        console.log('JSON found:', jsonMatch[0]);
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('Parsed result:', parsed);

        // 異なるフォーマットに対応
        let result: GradingResult;

        if (parsed.score !== undefined && parsed.overallComment !== undefined) {
          // 期待通りのフォーマット
          result = {
            score: Number(parsed.score),
            overallComment: String(parsed.overallComment),
            details: Array.isArray(parsed.details) ? parsed.details : []
          };
        } else if (parsed.assessment) {
          // 代替フォーマット（assessment構造）
          const assessment = parsed.assessment;

          // スコアを探す（様々なキー名に対応）
          let score = 0;
          if (assessment.score !== undefined) {
            score = Number(assessment.score);
            // 10点満点の場合は100点満点に変換
            if (assessment.scale === 10 || score <= 10) {
              score = Math.round(score * 10);
            }
          } else if (assessment.overall_score !== undefined) {
            score = Math.round(Number(assessment.overall_score) * 10);
          }

          // コメントを探す（様々なキー名に対応）
          const comment = assessment.overall_impression
            || assessment.comments
            || assessment.comment
            || assessment.notes
            || (Array.isArray(parsed.suggestions) ? parsed.suggestions.join('\n') : '')
            || (Array.isArray(assessment.recommendations) ? assessment.recommendations.join('\n') : '')
            || '採点完了';

          result = {
            score,
            overallComment: String(comment),
            details: []
          };
        } else {
          // その他のフォーマット - スコアやコメントを探す
          let score = 0;
          let comment = '';

          // トップレベルでスコアを探す
          if (parsed.score !== undefined) {
            score = Number(parsed.score);
            if (score <= 10) score = Math.round(score * 10);
          }

          // コメントを探す
          comment = parsed.overallComment
            || parsed.comment
            || parsed.comments
            || parsed.feedback
            || JSON.stringify(parsed, null, 2);

          result = {
            score,
            overallComment: String(comment),
            details: Array.isArray(parsed.details) ? parsed.details : []
          };
        }

        console.log('Final grading result:', result);
        setGradingResult(result);
        if (result.details.length > 0) {
          setShowMarkers(true);
          setMarkerAnimationIndex(0);
        }
      } else {
        console.log('No JSON found in response');
        // JSONが見つからない場合、テキストをそのままコメントとして表示
        setGradingResult({
          score: 0,
          overallComment: lastMessage.content || '採点結果を取得できませんでした。',
          details: []
        });
      }
    } catch (error) {
      console.error('Failed to parse grading result:', error);
      // パース失敗時はエラーメッセージを表示
      setGradingResult({
        score: 0,
        overallComment: `採点結果のパースに失敗しました: ${lastMessage.content}`,
        details: []
      });
    }
  }, [messages]);

  // スコアに応じた色を返す
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    if (score >= 40) return 'text-orange-400';
    return 'text-red-400';
  };

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
      {status === 'checking' && (
        <div className="px-4 py-2 bg-yellow-500 text-white text-sm">
          API確認中...
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
        {/* Canvas Area */}
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-[hsl(var(--secondary))] rounded-lg">
            {/* Character Selector */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">お手本:</label>
              <select
                value={selectedChar.char}
                onChange={(e) => {
                  const char = SAMPLE_CHARACTERS.find(c => c.char === e.target.value);
                  if (char) setSelectedChar(char);
                }}
                className="px-3 py-1.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded text-lg"
                style={{ fontFamily: "'Noto Serif JP', serif" }}
              >
                {SAMPLE_CHARACTERS.map(c => (
                  <option key={c.char} value={c.char}>{c.char} ({c.reading})</option>
                ))}
              </select>
            </div>

            <div className="w-px h-6 bg-[hsl(var(--border))]" />

            {/* Brush indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[hsl(var(--background))] rounded">
              <Pen className="w-5 h-5" />
              <span className="text-sm">毛筆</span>
            </div>

            {/* Clear Button */}
            <button
              onClick={clearCanvas}
              className="p-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              title="書き直す"
            >
              <Trash2 className="w-5 h-5" />
            </button>

            <div className="flex-1" />

            {/* Grade Button */}
            <button
              onClick={handleGrading}
              disabled={isGenerating || status !== 'available'}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  採点中...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  採点する
                </>
              )}
            </button>
          </div>

          {/* Canvas with Model */}
          <div className="flex-1 flex gap-4 min-h-0">
            {/* Main Canvas */}
            <div className="flex-1 flex items-center justify-center bg-[hsl(var(--secondary))] rounded-lg overflow-hidden relative">
              {/* 半紙キャンバス */}
              <div className="relative">
                <canvas
                  ref={canvasRef}
                  width={800}
                  height={600}
                  onPointerDown={startDrawing}
                  onPointerMove={draw}
                  onPointerUp={stopDrawing}
                  onPointerLeave={stopDrawing}
                  onPointerCancel={stopDrawing}
                  className="max-w-full max-h-full touch-none shadow-lg"
                  style={{
                    imageRendering: 'auto',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.3), inset 0 0 30px rgba(0,0,0,0.05)',
                    cursor: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'8\' fill=\'%23333\' fill-opacity=\'0.3\'/%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'2\' fill=\'%23333\'/%3E%3C/svg%3E") 12 12, crosshair'
                  }}
                />
                {/* オーバーレイキャンバス（赤丸マーカー用） */}
                <canvas
                  ref={overlayCanvasRef}
                  width={800}
                  height={600}
                  className="absolute top-0 left-0 max-w-full max-h-full pointer-events-none"
                  style={{ imageRendering: 'auto' }}
                />
              </div>

              {/* お手本表示（右上） */}
              <div className="absolute top-4 right-4 bg-white/90 rounded-lg p-4 shadow-lg border-2 border-amber-200">
                <div className="text-xs text-gray-500 mb-1 text-center">お手本</div>
                <div
                  className="text-8xl text-gray-800 leading-none"
                  style={{
                    fontFamily: "'Noto Serif JP', serif",
                    fontWeight: 900,
                  }}
                >
                  {selectedChar.char}
                </div>
                <div className="text-xs text-gray-500 mt-2 text-center max-w-[120px]">
                  {selectedChar.description}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* AI Grading Results */}
        <div className="w-full lg:w-96 flex flex-col bg-[hsl(var(--secondary))] rounded-lg overflow-hidden relative">
          <div className="p-3 border-b border-[hsl(var(--border))]">
            <h2 className="font-semibold flex items-center gap-2">
              <span className="text-2xl">📝</span>
              先生の採点
            </h2>
          </div>
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto p-4 space-y-4"
          >
            {!gradingResult && !isGenerating ? (
              <div className="text-center py-8">
                <p className="text-4xl mb-4">🖌️</p>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  お手本を見ながら文字を書いて、<br />
                  「採点する」ボタンを押してください
                </p>
                {status !== 'available' && (
                  <p className="text-xs text-yellow-400 mt-4">
                    ※ AIモデルの準備が完了すると採点できます
                  </p>
                )}
              </div>
            ) : (
              <>
                {gradingResult && (
                  <div className="space-y-4">
                    {/* スコア表示 */}
                    <div className="bg-[hsl(var(--background))] rounded-lg p-4 text-center">
                      <div className="text-sm text-[hsl(var(--muted-foreground))] mb-2">評価</div>
                      <div className={`text-5xl font-bold ${getScoreColor(gradingResult.score)}`}>
                        {gradingResult.score}
                        <span className="text-2xl text-[hsl(var(--muted-foreground))]">/100</span>
                      </div>
                    </div>

                    {/* 全体コメント */}
                    <div className="bg-[hsl(var(--background))] rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">👨‍🏫</span>
                        <div className="flex-1">
                          <div className="text-sm font-medium mb-1">先生のコメント</div>
                          <p className="text-[hsl(var(--foreground))]">
                            {gradingResult.overallComment}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* 個別指摘 */}
                    {gradingResult.details.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-sm font-medium flex items-center gap-2">
                          <span className="text-red-500">⭕</span>
                          指摘箇所
                        </div>
                        {gradingResult.details.map((detail, index) => (
                          <div
                            key={index}
                            className="bg-[hsl(var(--background))] rounded-lg p-3 border-l-4 border-red-500"
                          >
                            <div className="text-xs text-[hsl(var(--muted-foreground))] mb-1">
                              位置: ({Math.round(detail.x)}, {Math.round(detail.y)})
                            </div>
                            <p className="text-sm text-[hsl(var(--foreground))]">
                              {detail.comment}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {isGenerating && (
                  <div className="flex justify-center py-4">
                    <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>採点中...</span>
                    </div>
                  </div>
                )}
              </>
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
