import { Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Message } from '../hooks/usePromptAPI';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 p-4 ${isUser ? 'bg-[hsl(var(--secondary)/0.3)]' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser
            ? 'bg-[hsl(var(--primary))]'
            : 'bg-gradient-to-br from-purple-500 to-pink-500'
        }`}
      >
        {isUser ? (
          <User className="w-5 h-5 text-white" />
        ) : (
          <Bot className="w-5 h-5 text-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[hsl(var(--muted-foreground))] mb-1">
          {isUser ? 'あなた' : 'Gemini Nano'}
        </div>
        {message.imageData && (
          <img
            src={message.imageData}
            alt="添付画像"
            className="max-w-xs rounded-lg mb-2 border border-[hsl(var(--border))]"
          />
        )}
        <div className="text-[hsl(var(--foreground))] prose prose-sm dark:prose-invert max-w-none">
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          )}
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-[hsl(var(--primary))] animate-pulse" />
          )}
        </div>
        <div className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
          {message.timestamp.toLocaleTimeString('ja-JP')}
        </div>
      </div>
    </div>
  );
}
