import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Download,
  Play,
  Square,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { YogaPoseView } from './YogaPoseView';
import { usePromptAPI, type Message } from '../hooks/usePromptAPI';
import {
  YOGA_POSES,
  generateAnalysisSummary,
} from '../utils/yogaPoseAnalysis';
import type { YogaPose, PoseAnalysisResult } from '../utils/yogaPoseAnalysis';

const SYSTEM_PROMPT = `あなたはヨガインストラクターのAIアシスタントです。
ユーザーのヨガポーズを分析した結果が画像とともに送られてきます。

画像にはユーザーのポーズがスケルトン（骨格線）で表示されており、
各関節には角度が表示されています。

以下の点に注目してアドバイスしてください：
1. ポーズの全体的なフォームの評価
2. 改善が必要な部分の具体的な指示
3. 良くできている部分への励まし
4. 安全上の注意点
5. ポーズを深めるためのヒント

回答は親しみやすく、励ましを含めた日本語で行ってください。
具体的な角度の数値を参照しながら、わかりやすく説明してください。`;

export function YogaMode() {
  const [selectedPose, setSelectedPose] = useState<YogaPose | null>(null);
  const [analysisResult, setAnalysisResult] = useState<PoseAnalysisResult | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPoseSelectOpen, setIsPoseSelectOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const analyzeIntervalRef = useRef<number | null>(null);
  const isGeneratingRef = useRef(false);

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
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.7,
    topK: 3,
    multimodal: true,
  });

  // API可用性チェック
  useEffect(() => {
    checkAvailability();
  }, [checkAvailability]);

  // メッセージが追加されたらスクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // isGeneratingをrefにも保存
  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  // 解析結果を受け取るハンドラー
  const handleAnalysisResult = useCallback((result: PoseAnalysisResult | null) => {
    setAnalysisResult(result);
  }, []);

  // キャンバス準備完了ハンドラー
  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement | null) => {
    setCanvasElement(canvas);
  }, []);

  // AIにアドバイスを求める
  const requestAdvice = useCallback(() => {
    if (!canvasElement || !analysisResult || isGenerating) return;

    const summary = generateAnalysisSummary(analysisResult);
    const prompt = `以下はユーザーのヨガポーズ「${analysisResult.pose.nameJa}」の解析結果です。
添付の画像（スケルトン表示付き）と合わせて、ポーズの改善アドバイスをお願いします。

${summary}

画像を見て、具体的なアドバイスをお願いします。`;

    sendMessage(prompt, canvasElement);
  }, [canvasElement, analysisResult, isGenerating, sendMessage]);

  // 自動解析を開始
  const startAutoAnalysis = useCallback(() => {
    if (!selectedPose) return;

    setIsAnalyzing(true);

    // 最初の解析をすぐに実行（既に解析結果がある場合）
    if (analysisResult && canvasElement && !isGeneratingRef.current) {
      requestAdvice();
    }

    // 10秒ごとに自動で解析を実行
    analyzeIntervalRef.current = window.setInterval(() => {
      if (analysisResult && canvasElement && !isGeneratingRef.current) {
        requestAdvice();
      }
    }, 10000);
  }, [selectedPose, analysisResult, canvasElement, requestAdvice]);

  // 自動解析を停止
  const stopAutoAnalysis = useCallback(() => {
    setIsAnalyzing(false);
    if (analyzeIntervalRef.current) {
      clearInterval(analyzeIntervalRef.current);
      analyzeIntervalRef.current = null;
    }
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (analyzeIntervalRef.current) {
        clearInterval(analyzeIntervalRef.current);
      }
    };
  }, []);

  // ステータスバッジのレンダリング
  const renderStatusBadge = () => {
    switch (status) {
      case 'checking':
        return (
          <span className="flex items-center gap-1.5 text-yellow-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            確認中...
          </span>
        );
      case 'available':
        return (
          <span className="flex items-center gap-1.5 text-green-400 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            準備完了
          </span>
        );
      case 'downloading':
        return (
          <span className="flex items-center gap-1.5 text-blue-400 text-sm">
            <Download className="w-4 h-4 animate-bounce" />
            ダウンロード中 {downloadProgress}%
          </span>
        );
      case 'unavailable':
        return (
          <span className="flex items-center gap-1.5 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            利用不可
          </span>
        );
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* ヘッダー */}
      <div className="p-4 border-b border-[hsl(var(--border))] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            ヨガポーズ解析
          </h2>
          {renderStatusBadge()}
        </div>
        <button
          onClick={clearMessages}
          className="p-2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] rounded-lg transition-colors"
          title="履歴をクリア"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      {/* エラー表示 */}
      {error && status === 'unavailable' && (
        <div className="p-4 bg-red-500/10 border-b border-red-500/20 shrink-0">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* メインコンテンツ - 2カラムレイアウト */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左カラム: カメラ・操作 */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* ポーズ選択 */}
          <div className="bg-[hsl(var(--secondary)/0.3)] rounded-lg p-4">
            <h3 className="text-sm font-medium text-[hsl(var(--foreground))] mb-3">
              練習するポーズを選択
            </h3>
            <div className="relative">
              <button
                onClick={() => setIsPoseSelectOpen(!isPoseSelectOpen)}
                className="w-full flex items-center justify-between p-3 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg hover:border-[hsl(var(--primary))] transition-colors"
              >
                <span className="text-[hsl(var(--foreground))]">
                  {selectedPose ? selectedPose.nameJa : 'ポーズを選択してください'}
                </span>
                <ChevronDown
                  className={`w-5 h-5 text-[hsl(var(--muted-foreground))] transition-transform ${
                    isPoseSelectOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {isPoseSelectOpen && (
                <div className="absolute z-10 w-full mt-2 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                  {YOGA_POSES.map((pose) => (
                    <button
                      key={pose.id}
                      onClick={() => {
                        setSelectedPose(pose);
                        setIsPoseSelectOpen(false);
                        stopAutoAnalysis();
                        clearMessages();
                      }}
                      className={`w-full text-left p-3 hover:bg-[hsl(var(--secondary))] transition-colors ${
                        selectedPose?.id === pose.id
                          ? 'bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]'
                          : 'text-[hsl(var(--foreground))]'
                      }`}
                    >
                      <div className="font-medium">{pose.nameJa}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                        {pose.description}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ポーズ指示 */}
          {selectedPose && (
            <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg p-4 border border-purple-500/20">
              <h3 className="text-lg font-bold text-[hsl(var(--foreground))] mb-2">
                {selectedPose.nameJa}をしてください
              </h3>
              <p className="text-[hsl(var(--muted-foreground))] text-sm mb-3">
                {selectedPose.description}
              </p>
              <div className="text-sm text-[hsl(var(--foreground))]">
                <strong>ポイント:</strong>
                <ul className="list-disc list-inside mt-1 space-y-1 text-[hsl(var(--muted-foreground))]">
                  {selectedPose.tips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* カメラビュー */}
          <YogaPoseView
            selectedPose={selectedPose}
            onAnalysisResult={handleAnalysisResult}
            onCanvasReady={handleCanvasReady}
            isActive={status === 'available' || status === 'downloading'}
          />

          {/* 解析コントロール */}
          {selectedPose && canvasElement && (
            <div className="flex gap-3 justify-center">
              {!isAnalyzing ? (
                <>
                  <button
                    onClick={requestAdvice}
                    disabled={!analysisResult || isGenerating || status !== 'available'}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
                  >
                    <Play className="w-5 h-5" />
                    AIにアドバイスを求める
                  </button>
                  <button
                    onClick={startAutoAnalysis}
                    disabled={!analysisResult || status !== 'available'}
                    className="flex items-center gap-2 px-6 py-3 bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] rounded-xl hover:bg-[hsl(var(--secondary)/0.8)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    自動解析開始
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    stopAutoAnalysis();
                    stopGeneration();
                  }}
                  className="flex items-center gap-2 px-6 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-all shadow-lg"
                >
                  <Square className="w-5 h-5" />
                  自動解析停止
                </button>
              )}
            </div>
          )}

          {/* AIからのメッセージ */}
          {messages.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-[hsl(var(--foreground))]">
                AIからのアドバイス
              </h3>
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 右カラム: リアルタイム解析結果 */}
        <div className="w-80 border-l border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.2)] overflow-auto shrink-0">
          <div className="p-4">
            <h3 className="text-sm font-medium text-[hsl(var(--foreground))] mb-4">
              リアルタイム解析
            </h3>

            {!analysisResult ? (
              <div className="text-center py-8 text-[hsl(var(--muted-foreground))] text-sm">
                <p>ポーズを選択してカメラを起動すると</p>
                <p>ここに解析結果が表示されます</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* スコア */}
                <div className="text-center p-4 bg-[hsl(var(--background))] rounded-lg">
                  <div className="text-xs text-[hsl(var(--muted-foreground))] mb-1">
                    総合スコア
                  </div>
                  <div
                    className={`text-4xl font-bold ${
                      analysisResult.overallScore >= 80
                        ? 'text-green-400'
                        : analysisResult.overallScore >= 50
                        ? 'text-yellow-400'
                        : 'text-red-400'
                    }`}
                  >
                    {analysisResult.overallScore}
                    <span className="text-lg text-[hsl(var(--muted-foreground))]">点</span>
                  </div>
                </div>

                {/* 関節角度 */}
                <div>
                  <h4 className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-2">
                    各関節の角度
                  </h4>
                  <div className="space-y-2">
                    {analysisResult.angleAnalysis.map((angle) => (
                      <div
                        key={angle.name}
                        className={`p-2 rounded text-sm ${
                          angle.status === 'good'
                            ? 'bg-green-500/20 border border-green-500/30'
                            : angle.status === 'warning'
                            ? 'bg-yellow-500/20 border border-yellow-500/30'
                            : 'bg-red-500/20 border border-red-500/30'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span
                            className={`font-medium ${
                              angle.status === 'good'
                                ? 'text-green-300'
                                : angle.status === 'warning'
                                ? 'text-yellow-300'
                                : 'text-red-300'
                            }`}
                          >
                            {angle.name}
                          </span>
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">
                            {angle.status === 'good'
                              ? '良好'
                              : angle.status === 'warning'
                              ? '調整中'
                              : '要修正'}
                          </span>
                        </div>
                        <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          現在: {angle.currentAngle}° / 理想: {angle.idealAngle}°
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* フィードバック */}
                <div>
                  <h4 className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-2">
                    フィードバック
                  </h4>
                  <div className="text-sm text-[hsl(var(--foreground))] space-y-2 bg-[hsl(var(--background))] rounded-lg p-3">
                    {analysisResult.feedback.map((fb, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-purple-400 shrink-0">•</span>
                        <span className="text-[hsl(var(--muted-foreground))]">{fb}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// メッセージ表示コンポーネント
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="bg-[hsl(var(--secondary)/0.3)] rounded-lg p-3">
        <div className="text-xs text-[hsl(var(--muted-foreground))] mb-1">
          あなた - {message.timestamp.toLocaleTimeString('ja-JP')}
        </div>
        {message.imageData && (
          <img
            src={message.imageData}
            alt="ポーズ画像"
            className="max-w-xs rounded-lg mb-2 border border-[hsl(var(--border))]"
            style={{ transform: 'scaleX(-1)' }}
          />
        )}
        <div className="text-sm text-[hsl(var(--foreground))] whitespace-pre-wrap line-clamp-3">
          {message.content.split('\n')[0]}...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-lg p-4 border border-purple-500/20">
      <div className="text-xs text-[hsl(var(--muted-foreground))] mb-2">
        Gemini Nano - {message.timestamp.toLocaleTimeString('ja-JP')}
      </div>
      <div className="prose prose-sm dark:prose-invert max-w-none text-[hsl(var(--foreground))]">
        <ReactMarkdown>{message.content}</ReactMarkdown>
        {message.isStreaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-[hsl(var(--primary))] animate-pulse" />
        )}
      </div>
    </div>
  );
}
