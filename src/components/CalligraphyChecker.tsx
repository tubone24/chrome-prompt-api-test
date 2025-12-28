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

// 構造化出力のためのJSONスキーマ
const GRADING_SCHEMA = {
  type: 'object',
  properties: {
    score: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      description: '0〜100点での評価'
    },
    overallComment: {
      type: 'string',
      description: 'タメ語での総評コメント'
    },
    details: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          x: { type: 'integer', minimum: 0, maximum: 800 },
          y: { type: 'integer', minimum: 0, maximum: 600 },
          comment: { type: 'string' }
        },
        required: ['x', 'y', 'comment']
      },
      description: '指摘箇所の配列'
    }
  },
  required: ['score', 'overallComment', 'details']
};

// 毛筆の毛（bristle）を表現する構造
// 実際の筆は先が尖っており、筆圧で毛が広がる
interface Bristle {
  // 筆先からの距離（0=先端、1=根本）
  distanceFromTip: number;
  // 中心からの横方向オフセット（-1〜1、先端ほど0に近い）
  lateralOffset: number;
  // 毛の太さ係数
  thickness: number;
  // インク保持量（0〜1、先端ほど少ない）
  inkCapacity: number;
  // 現在のインク量
  currentInk: number;
  // 毛の剛性（先端ほど柔らかい）
  stiffness: number;
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
  // ストローク中のインク消費を追跡
  const strokeInkRef = useRef<number>(1.0);
  // 筆圧対応デバイスかどうか（null=未検出、true=対応、false=非対応）
  const hasPressureSupportRef = useRef<boolean | null>(null);
  // 速度履歴（筆圧シミュレーション用、過去5フレーム分）
  const velocityHistoryRef = useRef<number[]>([]);
  // 生の筆圧値を収集（デバイス検出用）
  const rawPressureValuesRef = useRef<number[]>([]);
  // シミュレートされた筆圧（スムージング用）
  const simulatedPressureRef = useRef<number>(0.5);

  // 速度から筆圧をシミュレート（Mac trackpad等、筆圧非対応デバイス用）
  // ゆっくり = 強い筆圧（太く濃い線）、速い = 軽い筆圧（細くカスレる線）
  const simulatePressureFromVelocity = useCallback((velocity: number): number => {
    // 速度を0-200程度の範囲で想定
    // velocity 0-30: 強い筆圧 (0.7-0.9)
    // velocity 30-80: 中程度 (0.4-0.7)
    // velocity 80+: 軽い筆圧 (0.15-0.4)

    let targetPressure: number;

    if (velocity < 30) {
      // ゆっくり = 強い筆圧
      targetPressure = 0.7 + (1 - velocity / 30) * 0.2; // 0.7-0.9
    } else if (velocity < 80) {
      // 中速 = 中程度の筆圧
      const t = (velocity - 30) / 50;
      targetPressure = 0.7 - t * 0.3; // 0.7-0.4
    } else {
      // 速い = 軽い筆圧
      const t = Math.min(1, (velocity - 80) / 120);
      targetPressure = 0.4 - t * 0.25; // 0.4-0.15
    }

    // 速度履歴を使ってスムージング
    velocityHistoryRef.current.push(velocity);
    if (velocityHistoryRef.current.length > 5) {
      velocityHistoryRef.current.shift();
    }

    // 速度履歴の平均で安定化
    const avgVelocity = velocityHistoryRef.current.reduce((a, b) => a + b, 0) / velocityHistoryRef.current.length;

    // 急激な変化を防ぐため、現在の値と目標値を補間
    const currentPressure = simulatedPressureRef.current;

    // 速度変化が大きい場合（急停止や急加速）は少し反応を速く
    const velocityChange = Math.abs(velocity - avgVelocity);
    const responseFactor = Math.min(1, 0.3 + velocityChange * 0.01);
    const finalPressure = currentPressure + (targetPressure - currentPressure) * responseFactor;

    simulatedPressureRef.current = finalPressure;

    return Math.max(0.1, Math.min(0.95, finalPressure));
  }, []);

  // 毛を初期化 - 筆先の形状をシミュレート
  useEffect(() => {
    const bristles: Bristle[] = [];

    // 筆先の形状: 先端は尖り、根本に向かって広がる
    // 層ごとに毛を配置
    const layers = 8; // 先端から根本までの層数

    for (let layer = 0; layer < layers; layer++) {
      const distanceFromTip = layer / (layers - 1); // 0〜1

      // 各層の毛の本数（先端は少なく、根本は多い）
      const bristlesInLayer = Math.floor(3 + distanceFromTip * 12);

      // 各層の広がり幅（先端は狭く、根本は広い）
      const layerSpread = 0.1 + distanceFromTip * 0.9;

      for (let i = 0; i < bristlesInLayer; i++) {
        // 層内での位置（中心に近いほど密度が高い）
        const normalizedPos = (i / (bristlesInLayer - 1 || 1)) * 2 - 1; // -1〜1
        // ガウス分布的な配置（中心に密集）
        const gaussianOffset = normalizedPos * Math.pow(Math.abs(normalizedPos), 0.5);
        const lateralOffset = gaussianOffset * layerSpread;

        bristles.push({
          distanceFromTip,
          lateralOffset: lateralOffset + (Math.random() - 0.5) * 0.1, // 少しランダム性
          thickness: 0.6 + Math.random() * 0.4 + distanceFromTip * 0.3, // 根本ほど太い
          inkCapacity: 0.5 + distanceFromTip * 0.5, // 根本ほど墨を多く保持
          currentInk: 1.0,
          stiffness: 0.3 + distanceFromTip * 0.7, // 先端は柔らかく、根本は硬い
        });
      }
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

採点基準：
- 筆の運び、止め・はね・払いの表現
- 文字全体のバランスと形
- お手本との比較

指摘箇所のx,yは書かれた文字の問題がある位置を指定すること。`,
    multimodal: true,
    temperature: 0.5,
    responseConstraint: GRADING_SCHEMA,
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

  // 毛筆のストロークを描画（本物の筆の挙動をシミュレート）
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

    const bristles = bristlesRef.current;
    const steps = Math.max(2, Math.floor(distance * 1.5));

    // 基本の筆の最大幅（太めに設定）
    const maxBrushWidth = 60;

    // インク消費（距離に応じて減少）
    const inkConsumption = distance * 0.001 * (1 + velocity * 0.002);
    strokeInkRef.current = Math.max(0.1, strokeInkRef.current - inkConsumption);
    const strokeInk = strokeInkRef.current;

    // 速度に応じたカスレ強度
    const velocityKasure = Math.min(0.8, velocity * 0.003);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = fromX + (toX - fromX) * t;
      const y = fromY + (toY - fromY) * t;
      const pressure = fromPressure + (toPressure - fromPressure) * t;

      // 筆圧による毛の広がり
      // 軽い筆圧 = 先端の毛だけが紙に触れる
      // 強い筆圧 = 根本まで全ての毛が紙に触れる
      const pressureThreshold = 1 - pressure; // 0〜1（筆圧が強いほど0に近い）

      // 筆圧による幅
      const currentWidth = maxBrushWidth * (0.15 + pressure * 0.85);

      // 進行方向に対して垂直な角度
      const perpAngle = angle + Math.PI / 2;

      // 各毛を描画
      bristles.forEach((bristle) => {
        // 筆圧が低いと先端の毛だけが描画される
        if (bristle.distanceFromTip < pressureThreshold * 0.8) return;

        // インク量計算
        const bristleInk = bristle.currentInk * strokeInk * bristle.inkCapacity;

        // カスレ判定（インクが少ない + 速度が速い = カスレる）
        const kasureChance = velocityKasure + (1 - bristleInk) * 0.3;
        // 中心の毛はカスレにくく、端の毛はカスレやすい
        const edgeFactor = Math.abs(bristle.lateralOffset);
        if (Math.random() < kasureChance * (0.5 + edgeFactor * 0.5)) return;

        // 毛の位置計算
        // 筆圧に応じて毛が広がる（柔らかい毛ほど広がりやすい）
        const spreadFactor = pressure * (1 - bristle.stiffness * 0.5);
        const lateralPos = bristle.lateralOffset * spreadFactor * currentWidth;

        const bx = x + Math.cos(perpAngle) * lateralPos;
        const by = y + Math.sin(perpAngle) * lateralPos;

        // 毛の太さ（中心は太く、端は細い）- 太めに設定
        const centerFactor = 1 - Math.abs(bristle.lateralOffset) * 0.5;
        const bristleSize = bristle.thickness * (2.5 + pressure * 3) * centerFactor;

        // 墨の濃さ（中心は濃く、端は薄い）
        const inkAlpha = Math.min(0.95, bristleInk * (0.6 + centerFactor * 0.4));

        // 墨色（純黒ではなく、やや青みがかった黒）
        const r = 15 + Math.random() * 10;
        const g = 15 + Math.random() * 8;
        const b = 20 + Math.random() * 15;

        // メインの描画
        ctx.beginPath();
        ctx.arc(bx, by, bristleSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${inkAlpha})`;
        ctx.fill();

        // 毛のテクスチャ（微細な線を追加）
        if (Math.random() > 0.7 && bristleInk > 0.3) {
          ctx.beginPath();
          ctx.moveTo(bx - bristleSize * 0.5, by);
          ctx.lineTo(bx + bristleSize * 0.5, by);
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${inkAlpha * 0.5})`;
          ctx.lineWidth = bristleSize * 0.3;
          ctx.stroke();
        }
      });

      // 墨だまり（筆圧が強く、速度が遅いところ）
      if (pressure > 0.6 && velocity < 50 && Math.random() > 0.8) {
        const poolSize = currentWidth * 0.3 * (1 - velocity * 0.01);
        ctx.beginPath();
        ctx.arc(x, y, poolSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(10, 10, 20, ${0.02 + strokeInk * 0.03})`;
        ctx.fill();
      }

      // エッジのにじみ
      if (pressure > 0.5 && strokeInk > 0.5 && Math.random() > 0.9) {
        const edgeX = x + Math.cos(perpAngle) * currentWidth * 0.5 * (Math.random() > 0.5 ? 1 : -1);
        const edgeY = y + Math.sin(perpAngle) * currentWidth * 0.5 * (Math.random() > 0.5 ? 1 : -1);
        ctx.beginPath();
        ctx.arc(edgeX, edgeY, 2 + Math.random() * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(15, 15, 25, ${0.05 + Math.random() * 0.05})`;
        ctx.fill();
      }
    }
  }, []);

  // 始点の「入り」を描画 - 筆が紙に触れる瞬間
  const drawEntryPoint = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number,
    angle: number
  ) => {
    // インクをリセット
    strokeInkRef.current = 1.0;

    const bristles = bristlesRef.current;
    const entrySize = 22 * (0.6 + pressure * 0.6);

    // 入りの角度（筆が斜めに入る）
    const entryAngle = angle - Math.PI * 0.1;

    // 筆先が紙に触れる形を描画
    bristles.forEach((bristle) => {
      // 先端の毛だけが最初に触れる
      if (bristle.distanceFromTip > 0.4) return;

      const spread = pressure * 0.5;
      const perpAngle = entryAngle + Math.PI / 2;
      const lateralPos = bristle.lateralOffset * spread * entrySize;

      const bx = x + Math.cos(perpAngle) * lateralPos + Math.cos(entryAngle) * bristle.distanceFromTip * 8;
      const by = y + Math.sin(perpAngle) * lateralPos + Math.sin(entryAngle) * bristle.distanceFromTip * 8;

      const size = bristle.thickness * (3 + pressure * 3);
      const alpha = 0.5 + pressure * 0.4;

      ctx.beginPath();
      ctx.arc(bx, by, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(15, 15, 25, ${alpha})`;
      ctx.fill();
    });

    // 入りの墨だまり（筆が一瞬止まるところ）
    if (pressure > 0.4) {
      ctx.beginPath();
      ctx.arc(x, y, entrySize * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(10, 10, 20, ${0.1 + pressure * 0.1})`;
      ctx.fill();
    }
  }, []);

  // 終点の「払い」「はね」「止め」を描画
  const drawExitPoint = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    velocity: number,
    angle: number,
    pressure: number
  ) => {
    const bristles = bristlesRef.current;
    const strokeInk = strokeInkRef.current;

    // 速度が低い場合は「止め」、高い場合は「払い」
    const isTome = velocity < 30;
    const isHane = velocity > 80 && Math.abs(Math.sin(angle)) > 0.5; // 上方向への速い動き

    if (isTome) {
      // 止め - 筆を押し付けて止める
      const tomeSize = 18 * (0.5 + pressure * 0.5);

      // 止めの墨だまり
      bristles.forEach((bristle) => {
        if (bristle.distanceFromTip > 0.6) return;

        const spread = pressure * 0.4;
        const perpAngle = angle + Math.PI / 2;
        const lateralPos = bristle.lateralOffset * spread * tomeSize;

        const bx = x + Math.cos(perpAngle) * lateralPos;
        const by = y + Math.sin(perpAngle) * lateralPos;
        const size = bristle.thickness * (2.5 + pressure * 1.5);
        const alpha = strokeInk * 0.6;

        ctx.beginPath();
        ctx.arc(bx, by, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(15, 15, 25, ${alpha})`;
        ctx.fill();
      });
    } else {
      // 払い/はね - 筆を持ち上げながら抜く
      const haraiLength = isHane ? Math.min(60, velocity * 0.5) : Math.min(45, velocity * 0.4);
      const steps = Math.max(12, Math.floor(haraiLength));

      // はねは上方向に曲がる
      const curveAmount = isHane ? 0.3 : 0;

      for (let i = 0; i < steps; i++) {
        const t = i / steps;

        // 先細りの曲線（3次曲線的に）
        const widthDecay = Math.pow(1 - t, 2);
        const currentWidth = 22 * widthDecay;

        // 進行方向（はねは曲がる）
        const currentAngle = angle - curveAmount * t * Math.PI;

        const px = x + Math.cos(currentAngle) * i * 2;
        const py = y + Math.sin(currentAngle) * i * 2;

        // カスレ強度（先に行くほど強く）
        const kasure = t * 0.8 + (1 - strokeInk) * 0.2;

        // 個別の毛の軌跡を描画
        bristles.forEach((bristle) => {
          // 先端の毛だけが最後まで残る
          if (bristle.distanceFromTip > widthDecay * 0.8) return;
          if (Math.random() < kasure) return;

          const perpAngle = currentAngle + Math.PI / 2;
          const lateralPos = bristle.lateralOffset * currentWidth * widthDecay;

          const bx = px + Math.cos(perpAngle) * lateralPos + (Math.random() - 0.5) * 2;
          const by = py + Math.sin(perpAngle) * lateralPos + (Math.random() - 0.5) * 2;

          const size = bristle.thickness * (1.5 + widthDecay) * 1.2;
          const alpha = strokeInk * widthDecay * 0.6;

          ctx.beginPath();
          ctx.arc(bx, by, size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(15, 15, 25, ${alpha})`;
          ctx.fill();
        });
      }
    }
  }, []);

  const startDrawing = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const pos = getCanvasCoordinates(e);
    if (!pos) return;

    // ストローク開始時に速度履歴と筆圧値をリセット
    velocityHistoryRef.current = [];
    rawPressureValuesRef.current = [];
    simulatedPressureRef.current = 0.6; // 初期筆圧（やや強め）

    // 生の筆圧値を収集（デバイス検出用）
    const rawPressure = e.pressure;
    rawPressureValuesRef.current.push(rawPressure);

    // 筆圧の初期値を決定
    // ペン/タッチが0.5以外の値を返せば筆圧対応デバイス
    let usePressure = pos.pressure;
    if (rawPressure !== 0.5 && rawPressure > 0 && rawPressure < 1) {
      hasPressureSupportRef.current = true;
    }
    // 非対応デバイスの場合、始点はやや強めの筆圧でシミュレート
    if (hasPressureSupportRef.current === false) {
      usePressure = 0.6;
    }

    setIsDrawing(true);
    setLastPos({ x: pos.x, y: pos.y });
    setLastPressure(usePressure);
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

    // 初期角度（下向きをデフォルト）
    const initialAngle = Math.PI / 2;
    drawEntryPoint(ctx, pos.x, pos.y, usePressure, initialAngle);
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

    // 生の筆圧値を収集してデバイス検出
    const rawPressure = e.pressure;
    rawPressureValuesRef.current.push(rawPressure);

    // 数回のサンプリング後にデバイスを判定
    if (hasPressureSupportRef.current === null && rawPressureValuesRef.current.length >= 5) {
      // 全ての値が0.5（または0）なら筆圧非対応デバイス
      const allSamePressure = rawPressureValuesRef.current.every(
        p => p === 0.5 || p === 0
      );
      hasPressureSupportRef.current = !allSamePressure;
      if (!hasPressureSupportRef.current) {
        console.log('筆圧非対応デバイスを検出 - 速度ベースの筆圧シミュレーションを使用');
      }
    }

    // 使用する筆圧を決定
    let usePressure: number;
    if (hasPressureSupportRef.current === false) {
      // 筆圧非対応デバイス: 速度から筆圧をシミュレート
      usePressure = simulatePressureFromVelocity(velocity);
    } else {
      // 筆圧対応デバイス: 実際の筆圧を使用
      usePressure = pos.pressure;
    }

    drawBrushStroke(ctx, lastPos.x, lastPos.y, pos.x, pos.y, lastPressure, usePressure, velocity, angle);

    setLastPos({ x: pos.x, y: pos.y });
    setLastPressure(usePressure);
    setLastTime(currentTime);
    setLastAngle(angle);
  }, [isDrawing, getCanvasCoordinates, lastPos, lastPressure, lastTime, lastAngle, drawBrushStroke, simulatePressureFromVelocity]);

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

      // 払い・はね・止めを描画
      drawExitPoint(ctx, pos.x, pos.y, velocity, lastAngle, lastPressure);
    }

    setIsDrawing(false);
    setLastPos(null);
  }, [isDrawing, lastPos, lastTime, lastAngle, lastPressure, getCanvasCoordinates, drawExitPoint]);

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
        } else if (parsed.assessment || parsed.evaluation) {
          // 代替フォーマット（assessment/evaluation構造）
          const assessment = parsed.assessment || parsed.evaluation;

          // スコアを探す（様々なキー名に対応、トップレベルも確認）
          let score = 0;
          if (assessment.score !== undefined) {
            score = Number(assessment.score);
            if (assessment.scale === 10 || score <= 10) {
              score = Math.round(score * 10);
            }
          } else if (assessment.overall_score !== undefined) {
            score = Math.round(Number(assessment.overall_score) * 10);
          } else if (parsed.total_score !== undefined) {
            // トップレベルのtotal_scoreをチェック
            score = Number(parsed.total_score);
            if (score <= 10) score = Math.round(score * 10);
          } else if (parsed.overall_score !== undefined) {
            score = Number(parsed.overall_score);
            if (score <= 10) score = Math.round(score * 10);
          }

          // コメントを構築（様々なフォーマットに対応）
          let comment = '';

          // 直接のコメントフィールドを探す
          if (typeof assessment.overall_impression === 'string') {
            comment = assessment.overall_impression;
          } else if (typeof assessment.comments === 'string') {
            comment = assessment.comments;
          } else if (typeof assessment.comment === 'string') {
            comment = assessment.comment;
          } else if (typeof assessment.feedback === 'string') {
            comment = assessment.feedback;
          } else if (typeof assessment.notes === 'string') {
            comment = assessment.notes;
          }

          // notesが別途ある場合は追加（overall_impressionと別にnotesがある場合）
          if (comment && typeof assessment.notes === 'string' && assessment.notes !== comment) {
            comment = comment + '\n\n' + assessment.notes;
          }

          // detailed_feedback がオブジェクトの場合、各フィードバックを結合
          if (assessment.detailed_feedback && typeof assessment.detailed_feedback === 'object') {
            const feedbackEntries = Object.entries(assessment.detailed_feedback);
            const feedbackText = feedbackEntries.map(([, value]) => {
              if (typeof value === 'string') return value;
              if (typeof value === 'object' && value !== null) {
                return Object.values(value).filter(v => typeof v === 'string').join(' ');
              }
              return String(value);
            }).join('\n\n');
            comment = comment ? `${comment}\n\n${feedbackText}` : feedbackText;
          }

          // specific_comments がある場合
          if (assessment.specific_comments && typeof assessment.specific_comments === 'object') {
            const specificEntries = Object.entries(assessment.specific_comments);
            const specificText = specificEntries.map(([key, value]) => {
              if (typeof value === 'string') return `【${key}】${value}`;
              if (typeof value === 'object' && value !== null) {
                const vals = Object.values(value).filter(v => typeof v === 'string');
                return `【${key}】${vals.join(' ')}`;
              }
              return `【${key}】${String(value)}`;
            }).join('\n');
            comment = comment ? `${comment}\n\n${specificText}` : specificText;
          }

          // まだコメントがない場合、assessment内の全ての文字列値を探す
          if (!comment) {
            const extractStrings = (obj: Record<string, unknown>, depth = 0): string[] => {
              if (depth > 2) return [];
              const strings: string[] = [];
              for (const [key, value] of Object.entries(obj)) {
                if (key === 'score' || key === 'overall_score' || key === 'scale') continue;
                if (typeof value === 'string' && value.length > 5) {
                  strings.push(value);
                } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                  strings.push(...extractStrings(value as Record<string, unknown>, depth + 1));
                }
              }
              return strings;
            };
            const allStrings = extractStrings(assessment);
            comment = allStrings.join('\n\n');
          }

          // suggestionsがあれば追加
          if (Array.isArray(assessment.suggestions) && assessment.suggestions.length > 0) {
            const suggestionsText = '\n\n【改善点】\n' + assessment.suggestions.map((s: string) => `・${s}`).join('\n');
            comment = comment ? comment + suggestionsText : suggestionsText;
          } else if (Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
            const suggestionsText = '\n\n【改善点】\n' + parsed.suggestions.map((s: string) => `・${s}`).join('\n');
            comment = comment ? comment + suggestionsText : suggestionsText;
          }

          if (!comment) {
            comment = '採点完了';
          }

          // detailsがない場合、ランダムな位置に赤丸を生成（指摘がある場合）
          const details: FeedbackDetail[] = [];

          // strokes配列がある場合（各筆画のフィードバック）
          if (Array.isArray(assessment.strokes) && assessment.strokes.length > 0) {
            const numMarkers = Math.min(3, assessment.strokes.length);
            for (let i = 0; i < numMarkers; i++) {
              const stroke = assessment.strokes[i];
              const strokeName = stroke.stroke_name || stroke.name || `筆画${i + 1}`;
              const strokeComment = stroke.comment || stroke.feedback || '';
              details.push({
                x: 200 + Math.random() * 400,
                y: 150 + Math.random() * 300,
                comment: `【${strokeName}】${strokeComment}`
              });
            }
          }

          // detailed_feedback, specific_comments など様々なフィードバック構造に対応
          const feedbackSource = !details.length ? (
            assessment.detailed_feedback
            || assessment.specific_comments
            || assessment.feedback_items
            || assessment.points
          ) : null;

          if (feedbackSource && typeof feedbackSource === 'object') {
            const feedbackKeys = Object.keys(feedbackSource);
            // 最大3つの指摘箇所を生成
            const numMarkers = Math.min(3, feedbackKeys.length);
            for (let i = 0; i < numMarkers; i++) {
              const feedbackValue = feedbackSource[feedbackKeys[i]];
              let commentText: string;
              if (typeof feedbackValue === 'string') {
                commentText = feedbackValue;
              } else if (typeof feedbackValue === 'object' && feedbackValue !== null) {
                const vals = Object.values(feedbackValue).filter(v => typeof v === 'string');
                commentText = vals.join(' ') || String(feedbackValue);
              } else {
                commentText = String(feedbackValue);
              }
              details.push({
                x: 200 + Math.random() * 400, // 200-600の範囲
                y: 150 + Math.random() * 300, // 150-450の範囲
                comment: commentText
              });
            }
          }

          result = {
            score,
            overallComment: String(comment),
            details
          };
        } else {
          // その他のフォーマット（トップレベルにスコアやコメントがある場合）
          let score = 0;
          let comment = '';

          // トップレベルでスコアを探す（様々なキー名に対応）
          if (parsed.score !== undefined) {
            score = Number(parsed.score);
            if (score <= 10) score = Math.round(score * 10);
          } else if (parsed.overall_score !== undefined) {
            score = Number(parsed.overall_score);
            if (score <= 10) score = Math.round(score * 10);
          }

          // コメントを探す
          if (typeof parsed.overallComment === 'string') {
            comment = parsed.overallComment;
          } else if (typeof parsed.comment === 'string') {
            comment = parsed.comment;
          } else if (typeof parsed.comments === 'string') {
            comment = parsed.comments;
          } else if (typeof parsed.feedback === 'string') {
            comment = parsed.feedback;
          }

          // suggestionsがあれば追加（文字列または配列）
          if (typeof parsed.suggestions === 'string' && parsed.suggestions) {
            const suggestionsText = '\n\n【改善点】\n' + parsed.suggestions;
            comment = comment ? comment + suggestionsText : suggestionsText;
          } else if (Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
            const suggestionsText = '\n\n【改善点】\n' + parsed.suggestions.map((s: string) => `・${s}`).join('\n');
            comment = comment ? comment + suggestionsText : suggestionsText;
          }

          if (!comment) {
            comment = '採点完了';
          }

          // detailsを生成（breakdownがあれば使用）
          const details: FeedbackDetail[] = [];
          const breakdownSource = parsed.breakdown || parsed.details_breakdown || parsed.stroke_feedback;

          if (breakdownSource && typeof breakdownSource === 'object') {
            const breakdownKeys = Object.keys(breakdownSource);
            const numMarkers = Math.min(3, breakdownKeys.length);
            for (let i = 0; i < numMarkers; i++) {
              const item = breakdownSource[breakdownKeys[i]];
              let commentText: string;
              if (typeof item === 'string') {
                commentText = item;
              } else if (typeof item === 'object' && item !== null) {
                // breakdown内の各項目からコメントを抽出
                const vals = Object.entries(item)
                  .filter(([k]) => k !== 'score' && k !== 'rating')
                  .map(([, v]) => typeof v === 'string' ? v : '')
                  .filter(v => v.length > 0);
                commentText = vals.join(' ') || breakdownKeys[i];
              } else {
                commentText = breakdownKeys[i];
              }
              details.push({
                x: 200 + Math.random() * 400,
                y: 150 + Math.random() * 300,
                comment: commentText
              });
            }
          } else if (Array.isArray(parsed.details)) {
            details.push(...parsed.details);
          }

          result = {
            score,
            overallComment: String(comment),
            details
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
              {/* 半紙キャンバス - 両キャンバスを同じサイズで重ねる */}
              <div className="relative" style={{ width: '800px', height: '600px', maxWidth: '100%', maxHeight: '100%' }}>
                <canvas
                  ref={canvasRef}
                  width={800}
                  height={600}
                  onPointerDown={startDrawing}
                  onPointerMove={draw}
                  onPointerUp={stopDrawing}
                  onPointerLeave={stopDrawing}
                  onPointerCancel={stopDrawing}
                  className="touch-none shadow-lg"
                  style={{
                    width: '100%',
                    height: '100%',
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
                  className="absolute top-0 left-0 pointer-events-none"
                  style={{ width: '100%', height: '100%', imageRendering: 'auto' }}
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
