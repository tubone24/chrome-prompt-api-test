import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

// MediaPipe Pose のランドマークインデックス
export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

// 関節の接続定義（描画用）
export const POSE_CONNECTIONS = [
  // 顔
  [POSE_LANDMARKS.LEFT_EAR, POSE_LANDMARKS.LEFT_EYE],
  [POSE_LANDMARKS.LEFT_EYE, POSE_LANDMARKS.NOSE],
  [POSE_LANDMARKS.NOSE, POSE_LANDMARKS.RIGHT_EYE],
  [POSE_LANDMARKS.RIGHT_EYE, POSE_LANDMARKS.RIGHT_EAR],
  // 腕（左）
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_ELBOW],
  [POSE_LANDMARKS.LEFT_ELBOW, POSE_LANDMARKS.LEFT_WRIST],
  [POSE_LANDMARKS.LEFT_WRIST, POSE_LANDMARKS.LEFT_PINKY],
  [POSE_LANDMARKS.LEFT_WRIST, POSE_LANDMARKS.LEFT_INDEX],
  [POSE_LANDMARKS.LEFT_WRIST, POSE_LANDMARKS.LEFT_THUMB],
  // 腕（右）
  [POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_ELBOW],
  [POSE_LANDMARKS.RIGHT_ELBOW, POSE_LANDMARKS.RIGHT_WRIST],
  [POSE_LANDMARKS.RIGHT_WRIST, POSE_LANDMARKS.RIGHT_PINKY],
  [POSE_LANDMARKS.RIGHT_WRIST, POSE_LANDMARKS.RIGHT_INDEX],
  [POSE_LANDMARKS.RIGHT_WRIST, POSE_LANDMARKS.RIGHT_THUMB],
  // 胴体
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.RIGHT_SHOULDER],
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_HIP],
  [POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_HIP],
  [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.RIGHT_HIP],
  // 脚（左）
  [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.LEFT_KNEE],
  [POSE_LANDMARKS.LEFT_KNEE, POSE_LANDMARKS.LEFT_ANKLE],
  [POSE_LANDMARKS.LEFT_ANKLE, POSE_LANDMARKS.LEFT_HEEL],
  [POSE_LANDMARKS.LEFT_ANKLE, POSE_LANDMARKS.LEFT_FOOT_INDEX],
  [POSE_LANDMARKS.LEFT_HEEL, POSE_LANDMARKS.LEFT_FOOT_INDEX],
  // 脚（右）
  [POSE_LANDMARKS.RIGHT_HIP, POSE_LANDMARKS.RIGHT_KNEE],
  [POSE_LANDMARKS.RIGHT_KNEE, POSE_LANDMARKS.RIGHT_ANKLE],
  [POSE_LANDMARKS.RIGHT_ANKLE, POSE_LANDMARKS.RIGHT_HEEL],
  [POSE_LANDMARKS.RIGHT_ANKLE, POSE_LANDMARKS.RIGHT_FOOT_INDEX],
  [POSE_LANDMARKS.RIGHT_HEEL, POSE_LANDMARKS.RIGHT_FOOT_INDEX],
];

// 3点間の角度を計算（度数法）
export function calculateAngle(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark
): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180) {
    angle = 360 - angle;
  }
  return angle;
}

// 2点間の距離を計算
export function calculateDistance(
  a: NormalizedLandmark,
  b: NormalizedLandmark
): number {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

// ヨガポーズの定義
export interface YogaPose {
  id: string;
  name: string;
  nameJa: string;
  description: string;
  keyAngles: {
    name: string;
    landmarks: [number, number, number]; // [点A, 頂点B, 点C]
    idealAngle: number;
    tolerance: number;
  }[];
  tips: string[];
}

export const YOGA_POSES: YogaPose[] = [
  {
    id: 'downward_dog',
    name: 'Downward-Facing Dog',
    nameJa: 'ダウンドッグ（下向きの犬のポーズ）',
    description: '両手と両足を床につけ、お尻を高く上げて逆V字型になるポーズ',
    keyAngles: [
      {
        name: '左肘',
        landmarks: [
          POSE_LANDMARKS.LEFT_SHOULDER,
          POSE_LANDMARKS.LEFT_ELBOW,
          POSE_LANDMARKS.LEFT_WRIST,
        ],
        idealAngle: 180,
        tolerance: 20,
      },
      {
        name: '右肘',
        landmarks: [
          POSE_LANDMARKS.RIGHT_SHOULDER,
          POSE_LANDMARKS.RIGHT_ELBOW,
          POSE_LANDMARKS.RIGHT_WRIST,
        ],
        idealAngle: 180,
        tolerance: 20,
      },
      {
        name: '左膝',
        landmarks: [
          POSE_LANDMARKS.LEFT_HIP,
          POSE_LANDMARKS.LEFT_KNEE,
          POSE_LANDMARKS.LEFT_ANKLE,
        ],
        idealAngle: 180,
        tolerance: 25,
      },
      {
        name: '右膝',
        landmarks: [
          POSE_LANDMARKS.RIGHT_HIP,
          POSE_LANDMARKS.RIGHT_KNEE,
          POSE_LANDMARKS.RIGHT_ANKLE,
        ],
        idealAngle: 180,
        tolerance: 25,
      },
      {
        name: '左股関節',
        landmarks: [
          POSE_LANDMARKS.LEFT_SHOULDER,
          POSE_LANDMARKS.LEFT_HIP,
          POSE_LANDMARKS.LEFT_KNEE,
        ],
        idealAngle: 60,
        tolerance: 20,
      },
      {
        name: '右股関節',
        landmarks: [
          POSE_LANDMARKS.RIGHT_SHOULDER,
          POSE_LANDMARKS.RIGHT_HIP,
          POSE_LANDMARKS.RIGHT_KNEE,
        ],
        idealAngle: 60,
        tolerance: 20,
      },
    ],
    tips: [
      '手のひらを床にしっかりつける',
      '背中をまっすぐに保つ',
      'かかとを床に近づける',
      '首の力を抜いてリラックス',
    ],
  },
  {
    id: 'warrior_1',
    name: 'Warrior I',
    nameJa: '戦士のポーズ1（ヴィーラバドラーサナ1）',
    description: '前足を曲げ、後ろ足を伸ばし、両腕を上に伸ばすポーズ',
    keyAngles: [
      {
        name: '前膝（左）',
        landmarks: [
          POSE_LANDMARKS.LEFT_HIP,
          POSE_LANDMARKS.LEFT_KNEE,
          POSE_LANDMARKS.LEFT_ANKLE,
        ],
        idealAngle: 90,
        tolerance: 15,
      },
      {
        name: '後膝（右）',
        landmarks: [
          POSE_LANDMARKS.RIGHT_HIP,
          POSE_LANDMARKS.RIGHT_KNEE,
          POSE_LANDMARKS.RIGHT_ANKLE,
        ],
        idealAngle: 170,
        tolerance: 20,
      },
      {
        name: '左肘',
        landmarks: [
          POSE_LANDMARKS.LEFT_SHOULDER,
          POSE_LANDMARKS.LEFT_ELBOW,
          POSE_LANDMARKS.LEFT_WRIST,
        ],
        idealAngle: 180,
        tolerance: 20,
      },
      {
        name: '右肘',
        landmarks: [
          POSE_LANDMARKS.RIGHT_SHOULDER,
          POSE_LANDMARKS.RIGHT_ELBOW,
          POSE_LANDMARKS.RIGHT_WRIST,
        ],
        idealAngle: 180,
        tolerance: 20,
      },
    ],
    tips: [
      '前膝がつま先より前に出ないように',
      '後ろ足のかかとを床につける',
      '腰を正面に向ける',
      '両腕は耳の横に',
    ],
  },
  {
    id: 'warrior_2',
    name: 'Warrior II',
    nameJa: '戦士のポーズ2（ヴィーラバドラーサナ2）',
    description: '前足を曲げ、両腕を水平に伸ばすポーズ',
    keyAngles: [
      {
        name: '前膝（左）',
        landmarks: [
          POSE_LANDMARKS.LEFT_HIP,
          POSE_LANDMARKS.LEFT_KNEE,
          POSE_LANDMARKS.LEFT_ANKLE,
        ],
        idealAngle: 90,
        tolerance: 15,
      },
      {
        name: '後膝（右）',
        landmarks: [
          POSE_LANDMARKS.RIGHT_HIP,
          POSE_LANDMARKS.RIGHT_KNEE,
          POSE_LANDMARKS.RIGHT_ANKLE,
        ],
        idealAngle: 170,
        tolerance: 20,
      },
      {
        name: '左肩角度',
        landmarks: [
          POSE_LANDMARKS.LEFT_ELBOW,
          POSE_LANDMARKS.LEFT_SHOULDER,
          POSE_LANDMARKS.LEFT_HIP,
        ],
        idealAngle: 90,
        tolerance: 20,
      },
      {
        name: '右肩角度',
        landmarks: [
          POSE_LANDMARKS.RIGHT_ELBOW,
          POSE_LANDMARKS.RIGHT_SHOULDER,
          POSE_LANDMARKS.RIGHT_HIP,
        ],
        idealAngle: 90,
        tolerance: 20,
      },
    ],
    tips: [
      '両腕は肩の高さで水平に',
      '前膝はくるぶしの真上に',
      '骨盤は横向きを維持',
      '視線は前方の指先へ',
    ],
  },
  {
    id: 'tree',
    name: 'Tree Pose',
    nameJa: '木のポーズ（ヴリクシャーサナ）',
    description: '片足で立ち、もう一方の足を太ももに付けるバランスポーズ',
    keyAngles: [
      {
        name: '立脚の膝',
        landmarks: [
          POSE_LANDMARKS.LEFT_HIP,
          POSE_LANDMARKS.LEFT_KNEE,
          POSE_LANDMARKS.LEFT_ANKLE,
        ],
        idealAngle: 180,
        tolerance: 15,
      },
      {
        name: '曲げ脚の膝',
        landmarks: [
          POSE_LANDMARKS.RIGHT_HIP,
          POSE_LANDMARKS.RIGHT_KNEE,
          POSE_LANDMARKS.RIGHT_ANKLE,
        ],
        idealAngle: 45,
        tolerance: 25,
      },
    ],
    tips: [
      '立脚をまっすぐに保つ',
      '足裏は太ももの内側に（膝は避ける）',
      '骨盤を水平に保つ',
      '視線を一点に集中',
    ],
  },
  {
    id: 'triangle',
    name: 'Triangle Pose',
    nameJa: '三角のポーズ（トリコナーサナ）',
    description: '両足を開き、体を横に倒して三角形を作るポーズ',
    keyAngles: [
      {
        name: '前膝（左）',
        landmarks: [
          POSE_LANDMARKS.LEFT_HIP,
          POSE_LANDMARKS.LEFT_KNEE,
          POSE_LANDMARKS.LEFT_ANKLE,
        ],
        idealAngle: 180,
        tolerance: 15,
      },
      {
        name: '後膝（右）',
        landmarks: [
          POSE_LANDMARKS.RIGHT_HIP,
          POSE_LANDMARKS.RIGHT_KNEE,
          POSE_LANDMARKS.RIGHT_ANKLE,
        ],
        idealAngle: 180,
        tolerance: 15,
      },
      {
        name: '体側の傾き',
        landmarks: [
          POSE_LANDMARKS.LEFT_WRIST,
          POSE_LANDMARKS.LEFT_SHOULDER,
          POSE_LANDMARKS.LEFT_HIP,
        ],
        idealAngle: 180,
        tolerance: 25,
      },
    ],
    tips: [
      '両膝はまっすぐに保つ',
      '体は横に倒し、前後に傾かない',
      '下の手は脛に軽く添える',
      '上の腕は天井へまっすぐ伸ばす',
    ],
  },
];

// ポーズ解析結果
export interface PoseAnalysisResult {
  pose: YogaPose;
  overallScore: number; // 0-100
  angleAnalysis: {
    name: string;
    currentAngle: number;
    idealAngle: number;
    difference: number;
    score: number; // 0-100
    status: 'good' | 'warning' | 'bad';
  }[];
  feedback: string[];
}

// ポーズを解析
export function analyzePose(
  landmarks: NormalizedLandmark[],
  pose: YogaPose
): PoseAnalysisResult {
  const angleAnalysis = pose.keyAngles.map((angle) => {
    const [aIdx, bIdx, cIdx] = angle.landmarks;
    const currentAngle = calculateAngle(
      landmarks[aIdx],
      landmarks[bIdx],
      landmarks[cIdx]
    );
    const difference = Math.abs(currentAngle - angle.idealAngle);
    const score = Math.max(0, 100 - (difference / angle.tolerance) * 50);

    let status: 'good' | 'warning' | 'bad';
    if (difference <= angle.tolerance * 0.5) {
      status = 'good';
    } else if (difference <= angle.tolerance) {
      status = 'warning';
    } else {
      status = 'bad';
    }

    return {
      name: angle.name,
      currentAngle: Math.round(currentAngle),
      idealAngle: angle.idealAngle,
      difference: Math.round(difference),
      score: Math.round(score),
      status,
    };
  });

  const overallScore =
    angleAnalysis.reduce((sum, a) => sum + a.score, 0) / angleAnalysis.length;

  // フィードバック生成
  const feedback: string[] = [];
  angleAnalysis.forEach((a) => {
    if (a.status === 'bad') {
      const direction =
        a.currentAngle > a.idealAngle ? 'もう少し曲げて' : 'もう少し伸ばして';
      feedback.push(`${a.name}を${direction}ください（現在: ${a.currentAngle}°, 理想: ${a.idealAngle}°）`);
    } else if (a.status === 'warning') {
      feedback.push(`${a.name}はほぼ良好です（現在: ${a.currentAngle}°）`);
    }
  });

  if (feedback.length === 0) {
    feedback.push('素晴らしいフォームです！このまま維持してください。');
  }

  return {
    pose,
    overallScore: Math.round(overallScore),
    angleAnalysis,
    feedback,
  };
}

// ポーズをキャンバスに描画
export function drawPoseOnCanvas(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  analysisResult?: PoseAnalysisResult
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  // 接続線を描画
  POSE_CONNECTIONS.forEach(([startIdx, endIdx]) => {
    const start = landmarks[startIdx];
    const end = landmarks[endIdx];

    if (start && end && start.visibility > 0.5 && end.visibility > 0.5) {
      ctx.beginPath();
      ctx.moveTo(start.x * width, start.y * height);
      ctx.lineTo(end.x * width, end.y * height);
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  });

  // ランドマークを描画
  landmarks.forEach((landmark, index) => {
    if (landmark.visibility > 0.5) {
      const x = landmark.x * width;
      const y = landmark.y * height;

      // 分析結果がある場合、該当する関節の色を変える
      let color = 'rgba(255, 0, 0, 0.8)';

      if (analysisResult) {
        const relatedAngle = analysisResult.angleAnalysis.find(
          (a) => analysisResult.pose.keyAngles.find(
            (ka) => ka.name === a.name && ka.landmarks[1] === index
          )
        );

        if (relatedAngle) {
          switch (relatedAngle.status) {
            case 'good':
              color = 'rgba(0, 255, 0, 0.9)';
              break;
            case 'warning':
              color = 'rgba(255, 255, 0, 0.9)';
              break;
            case 'bad':
              color = 'rgba(255, 0, 0, 0.9)';
              break;
          }
        }
      }

      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  // 角度情報を描画
  if (analysisResult) {
    analysisResult.angleAnalysis.forEach((angle) => {
      const keyAngle = analysisResult.pose.keyAngles.find(
        (ka) => ka.name === angle.name
      );
      if (keyAngle) {
        const vertexIdx = keyAngle.landmarks[1];
        const vertex = landmarks[vertexIdx];

        if (vertex && vertex.visibility > 0.5) {
          const x = vertex.x * width + 15;
          const y = vertex.y * height;

          // 背景
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(x - 2, y - 12, 60, 16);

          // テキスト
          ctx.font = '12px Arial';
          ctx.fillStyle =
            angle.status === 'good'
              ? '#00ff00'
              : angle.status === 'warning'
              ? '#ffff00'
              : '#ff0000';
          ctx.fillText(`${angle.currentAngle}°`, x, y);
        }
      }
    });
  }
}

// 解析結果のサマリーテキストを生成
export function generateAnalysisSummary(result: PoseAnalysisResult): string {
  const lines: string[] = [
    `## ポーズ解析結果: ${result.pose.nameJa}`,
    '',
    `### 総合スコア: ${result.overallScore}/100`,
    '',
    '### 各関節の角度分析:',
  ];

  result.angleAnalysis.forEach((angle) => {
    const statusEmoji =
      angle.status === 'good' ? '✅' : angle.status === 'warning' ? '⚠️' : '❌';
    lines.push(
      `- ${angle.name}: ${angle.currentAngle}° (理想: ${angle.idealAngle}°) ${statusEmoji}`
    );
  });

  lines.push('', '### フィードバック:');
  result.feedback.forEach((fb) => {
    lines.push(`- ${fb}`);
  });

  lines.push('', '### ポーズのコツ:');
  result.pose.tips.forEach((tip) => {
    lines.push(`- ${tip}`);
  });

  return lines.join('\n');
}
