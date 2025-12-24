import { useEffect, useRef, useState, useCallback } from 'react';
import {
  PoseLandmarker,
  FilesetResolver,
} from '@mediapipe/tasks-vision';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { Video, VideoOff, AlertCircle, Loader2 } from 'lucide-react';
import {
  analyzePose,
  drawPoseOnCanvas,
} from '../utils/yogaPoseAnalysis';
import type {
  YogaPose,
  PoseAnalysisResult,
} from '../utils/yogaPoseAnalysis';

interface YogaPoseViewProps {
  selectedPose: YogaPose | null;
  onAnalysisResult: (result: PoseAnalysisResult | null) => void;
  onCanvasReady: (canvas: HTMLCanvasElement | null) => void;
  isActive: boolean;
}

export function YogaPoseView({
  selectedPose,
  onAnalysisResult,
  onCanvasReady,
  isActive,
}: YogaPoseViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [currentLandmarks, setCurrentLandmarks] = useState<NormalizedLandmark[] | null>(null);

  // MediaPipe Pose Landmarker を初期化
  const initializePoseLandmarker = useCallback(async () => {
    if (poseLandmarkerRef.current) return;

    setIsModelLoading(true);
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });

      setIsModelLoading(false);
    } catch (err) {
      console.error('MediaPipe初期化エラー:', err);
      setError('MediaPipeの初期化に失敗しました');
      setIsModelLoading(false);
    }
  }, []);

  // カメラを開始
  const startCamera = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      // まずMediaPipeを初期化
      await initializePoseLandmarker();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // キャンバスサイズをビデオに合わせる
      canvasRef.current.width = videoRef.current.videoWidth || 640;
      canvasRef.current.height = videoRef.current.videoHeight || 480;

      setIsCameraActive(true);
      onCanvasReady(canvasRef.current);
    } catch (err) {
      console.error('カメラエラー:', err);
      setError('カメラへのアクセスに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [initializePoseLandmarker, onCanvasReady]);

  // カメラを停止
  const stopCamera = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
    setCurrentLandmarks(null);
    onCanvasReady(null);
    onAnalysisResult(null);
  }, [onCanvasReady, onAnalysisResult]);

  // ポーズ検出ループ
  const detectPose = useCallback(() => {
    if (
      !videoRef.current ||
      !canvasRef.current ||
      !poseLandmarkerRef.current ||
      !isCameraActive
    ) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx || video.readyState !== 4) {
      animationFrameRef.current = requestAnimationFrame(detectPose);
      return;
    }

    // ビデオフレームを描画
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // ポーズを検出
    const startTimeMs = performance.now();
    const result = poseLandmarkerRef.current.detectForVideo(video, startTimeMs);

    if (result.landmarks && result.landmarks.length > 0) {
      const landmarks = result.landmarks[0];
      setCurrentLandmarks(landmarks);

      // ポーズを解析
      let analysisResult: PoseAnalysisResult | null = null;
      if (selectedPose) {
        analysisResult = analyzePose(landmarks, selectedPose);
        onAnalysisResult(analysisResult);
      }

      // スケルトンを描画
      drawPoseOnCanvas(ctx, landmarks, analysisResult ?? undefined);
    } else {
      setCurrentLandmarks(null);
      onAnalysisResult(null);
    }

    animationFrameRef.current = requestAnimationFrame(detectPose);
  }, [isCameraActive, selectedPose, onAnalysisResult]);

  // ポーズ検出を開始
  useEffect(() => {
    if (isCameraActive && isActive) {
      animationFrameRef.current = requestAnimationFrame(detectPose);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isCameraActive, isActive, detectPose]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      stopCamera();
      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close();
        poseLandmarkerRef.current = null;
      }
    };
  }, [stopCamera]);

  // 外部からの isActive 制御
  useEffect(() => {
    if (!isActive && isCameraActive) {
      stopCamera();
    }
  }, [isActive, isCameraActive, stopCamera]);

  return (
    <div className="relative w-full max-w-2xl mx-auto aspect-video bg-black rounded-lg overflow-hidden">
      {/* ビデオ要素（非表示） */}
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        muted
      />

      {/* キャンバス（ビデオ + スケルトン描画） */}
      <canvas
        ref={canvasRef}
        className={`w-full h-full object-contain ${isCameraActive ? '' : 'hidden'}`}
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* ローディング表示 */}
      {(isLoading || isModelLoading) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
          <Loader2 className="w-12 h-12 text-[hsl(var(--primary))] animate-spin mb-4" />
          <p className="text-white text-sm">
            {isModelLoading ? 'AIモデルを読み込み中...' : 'カメラを起動中...'}
          </p>
        </div>
      )}

      {/* エラー表示 */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/50 p-4">
          <AlertCircle className="w-12 h-12 text-red-400 mb-2" />
          <p className="text-white text-center">{error}</p>
        </div>
      )}

      {/* カメラ開始ボタン */}
      {!isCameraActive && !isLoading && !isModelLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            onClick={startCamera}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg"
          >
            <Video className="w-5 h-5" />
            カメラを開始
          </button>
        </div>
      )}

      {/* カメラ停止ボタン */}
      {isCameraActive && (
        <button
          onClick={stopCamera}
          className="absolute bottom-4 right-4 p-2 bg-red-500/80 hover:bg-red-600 text-white rounded-full transition-colors"
        >
          <VideoOff className="w-5 h-5" />
        </button>
      )}

      {/* ポーズ検出ステータス */}
      {isCameraActive && (
        <div className="absolute top-4 left-4 px-3 py-1 bg-black/60 rounded-full text-white text-sm flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              currentLandmarks ? 'bg-green-400' : 'bg-yellow-400'
            }`}
          />
          {currentLandmarks ? 'ポーズ検出中' : '人物を探しています...'}
        </div>
      )}
    </div>
  );
}
