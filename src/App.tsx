import { useState } from 'react';
import { MessageSquare, Camera, Mic, Paintbrush, Zap } from 'lucide-react';
import { Chat } from './components/Chat';
import { AudioTranscription } from './components/AudioTranscription';
import { PaintCanvas } from './components/PaintCanvas';
import { VoiceTranscriptionPipeline } from './components/VoiceTranscriptionPipeline';

type Mode = 'text' | 'camera' | 'audio' | 'paint' | 'voice-pipeline';

function App() {
  const [mode, setMode] = useState<Mode>('text');

  return (
    <div className="h-full flex flex-col bg-[hsl(var(--background))]">
      {/* Mode Tabs */}
      <div className="flex border-b border-[hsl(var(--border))]">
        <button
          onClick={() => setMode('text')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-medium transition-colors ${
            mode === 'text'
              ? 'text-[hsl(var(--primary))] border-b-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/0.5)]'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          チャット
        </button>
        <button
          onClick={() => setMode('camera')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-medium transition-colors ${
            mode === 'camera'
              ? 'text-[hsl(var(--primary))] border-b-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/0.5)]'
          }`}
        >
          <Camera className="w-4 h-4" />
          カメラ
        </button>
        <button
          onClick={() => setMode('audio')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-medium transition-colors ${
            mode === 'audio'
              ? 'text-[hsl(var(--primary))] border-b-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/0.5)]'
          }`}
        >
          <Mic className="w-4 h-4" />
          文字起こし
        </button>
        <button
          onClick={() => setMode('paint')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-medium transition-colors ${
            mode === 'paint'
              ? 'text-[hsl(var(--primary))] border-b-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/0.5)]'
          }`}
        >
          <Paintbrush className="w-4 h-4" />
          ペイント
        </button>
        <button
          onClick={() => setMode('voice-pipeline')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 text-sm font-medium transition-colors ${
            mode === 'voice-pipeline'
              ? 'text-[hsl(var(--primary))] border-b-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary)/0.5)]'
          }`}
        >
          <Zap className="w-4 h-4" />
          音声パイプライン
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {mode === 'text' && <Chat key="text" cameraMode={false} />}
        {mode === 'camera' && <Chat key="camera" cameraMode={true} />}
        {mode === 'audio' && <AudioTranscription key="audio" />}
        {mode === 'paint' && <PaintCanvas key="paint" />}
        {mode === 'voice-pipeline' && <VoiceTranscriptionPipeline key="voice-pipeline" />}
      </div>
    </div>
  );
}

export default App;
