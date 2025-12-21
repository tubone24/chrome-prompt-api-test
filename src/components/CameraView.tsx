import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Video, VideoOff, RefreshCw } from 'lucide-react';

interface CameraViewProps {
  onStreamReady?: () => void;
}

export interface CameraViewRef {
  getVideoElement: () => HTMLVideoElement | null;
}

export const CameraView = forwardRef<CameraViewRef, CameraViewProps>(
  ({ onStreamReady }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isActive, setIsActive] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    useImperativeHandle(ref, () => ({
      getVideoElement: () => videoRef.current,
    }));

    const startCamera = async () => {
      try {
        setError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          streamRef.current = stream;
          setIsActive(true);
          onStreamReady?.();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'カメラにアクセスできません');
      }
    };

    const stopCamera = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setIsActive(false);
    };

    useEffect(() => {
      return () => {
        stopCamera();
      };
    }, []);

    return (
      <div className="relative w-full max-w-md mx-auto aspect-video bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${isActive ? '' : 'hidden'}`}
        />

        {!isActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[hsl(var(--secondary))]">
            {error ? (
              <>
                <VideoOff className="w-12 h-12 text-red-400" />
                <p className="text-sm text-red-400 text-center px-4">{error}</p>
                <button
                  onClick={startCamera}
                  className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] rounded-lg hover:bg-[hsl(var(--primary)/0.9)] transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  再試行
                </button>
              </>
            ) : (
              <>
                <Video className="w-12 h-12 text-[hsl(var(--muted-foreground))]" />
                <button
                  onClick={startCamera}
                  className="flex items-center gap-2 px-6 py-3 bg-[hsl(var(--primary))] rounded-lg hover:bg-[hsl(var(--primary)/0.9)] transition-colors font-medium"
                >
                  <Video className="w-5 h-5" />
                  カメラを起動
                </button>
              </>
            )}
          </div>
        )}

        {isActive && (
          <button
            onClick={stopCamera}
            className="absolute top-3 right-3 p-2 bg-black/50 rounded-lg hover:bg-black/70 transition-colors"
            title="カメラを停止"
          >
            <VideoOff className="w-5 h-5" />
          </button>
        )}
      </div>
    );
  }
);

CameraView.displayName = 'CameraView';
