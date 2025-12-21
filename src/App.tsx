import { useState } from 'react';
import { MessageSquare, Camera } from 'lucide-react';
import { Chat } from './components/Chat';

type Mode = 'text' | 'camera';

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
          テキストチャット
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
          カメラ認識
        </button>
      </div>

      {/* Chat Content */}
      <div className="flex-1 overflow-hidden">
        {mode === 'text' ? (
          <Chat key="text" cameraMode={false} />
        ) : (
          <Chat key="camera" cameraMode={true} />
        )}
      </div>
    </div>
  );
}

export default App;
