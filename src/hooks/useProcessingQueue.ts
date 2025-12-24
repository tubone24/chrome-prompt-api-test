import { useState, useRef, useCallback, useEffect } from 'react';

export interface QueueItem<T> {
  id: string;
  data: T;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  addedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  error: number;
  total: number;
}

export interface UseProcessingQueueOptions {
  maxConcurrent?: number;
  onItemComplete?: (item: QueueItem<unknown>) => void;
  onItemError?: (item: QueueItem<unknown>, error: Error) => void;
  onQueueEmpty?: () => void;
}

export function useProcessingQueue<T>(
  processor: (data: T, itemId: string) => Promise<void>,
  options: UseProcessingQueueOptions = {}
) {
  const {
    maxConcurrent = 2,
    onItemComplete,
    onItemError,
    onQueueEmpty,
  } = options;

  const [items, setItems] = useState<QueueItem<T>[]>([]);
  const processingCountRef = useRef(0);
  const isProcessingRef = useRef(false);
  const processorRef = useRef(processor);

  // プロセッサーの参照を更新
  useEffect(() => {
    processorRef.current = processor;
  }, [processor]);

  // キューの統計情報
  const stats: QueueStats = {
    pending: items.filter(i => i.status === 'pending').length,
    processing: items.filter(i => i.status === 'processing').length,
    completed: items.filter(i => i.status === 'completed').length,
    error: items.filter(i => i.status === 'error').length,
    total: items.length,
  };

  // 次のアイテムを処理
  const processNext = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      while (true) {
        // 同時実行数のチェック
        if (processingCountRef.current >= maxConcurrent) {
          break;
        }

        // 次の待機中アイテムを取得
        const pendingItem = items.find(i => i.status === 'pending');
        if (!pendingItem) {
          // キューが空になった
          if (processingCountRef.current === 0 && onQueueEmpty) {
            onQueueEmpty();
          }
          break;
        }

        // 処理開始
        processingCountRef.current++;
        const itemId = pendingItem.id;

        setItems(prev =>
          prev.map(i =>
            i.id === itemId
              ? { ...i, status: 'processing' as const, startedAt: new Date() }
              : i
          )
        );

        // 非同期で処理を実行（待機せずに次のアイテムを処理可能にする）
        (async () => {
          try {
            await processorRef.current(pendingItem.data, itemId);
            setItems(prev =>
              prev.map(i =>
                i.id === itemId
                  ? { ...i, status: 'completed' as const, completedAt: new Date() }
                  : i
              )
            );
            if (onItemComplete) {
              onItemComplete(pendingItem as QueueItem<unknown>);
            }
          } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            setItems(prev =>
              prev.map(i =>
                i.id === itemId
                  ? { ...i, status: 'error' as const, error: error.message, completedAt: new Date() }
                  : i
              )
            );
            if (onItemError) {
              onItemError(pendingItem as QueueItem<unknown>, error);
            }
          } finally {
            processingCountRef.current--;
            // 処理完了後、次のアイテムを処理
            processNext();
          }
        })();
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [items, maxConcurrent, onItemComplete, onItemError, onQueueEmpty]);

  // アイテムを追加
  const enqueue = useCallback((data: T, id?: string): string => {
    const itemId = id ?? crypto.randomUUID();
    const newItem: QueueItem<T> = {
      id: itemId,
      data,
      status: 'pending',
      addedAt: new Date(),
    };

    setItems(prev => [...prev, newItem]);

    // 次のティックで処理を開始
    setTimeout(() => processNext(), 0);

    return itemId;
  }, [processNext]);

  // キューをクリア（処理中のものは完了を待つ）
  const clear = useCallback(() => {
    setItems(prev => prev.filter(i => i.status === 'processing'));
  }, []);

  // 完了したアイテムを削除
  const clearCompleted = useCallback(() => {
    setItems(prev => prev.filter(i => i.status !== 'completed' && i.status !== 'error'));
  }, []);

  // 特定のアイテムを削除
  const remove = useCallback((itemId: string) => {
    setItems(prev => prev.filter(i => i.id !== itemId || i.status === 'processing'));
  }, []);

  // アイテムの状態変更を監視して処理を開始
  useEffect(() => {
    if (stats.pending > 0 && processingCountRef.current < maxConcurrent) {
      processNext();
    }
  }, [stats.pending, maxConcurrent, processNext]);

  return {
    items,
    stats,
    enqueue,
    clear,
    clearCompleted,
    remove,
    isProcessing: stats.processing > 0,
    isPending: stats.pending > 0,
    isIdle: stats.pending === 0 && stats.processing === 0,
  };
}

// セマフォ実装（単純な同時実行数制限）
export function useSemaphore(maxConcurrent: number = 2) {
  const countRef = useRef(0);
  const waitingRef = useRef<Array<() => void>>([]);

  const acquire = useCallback((): Promise<void> => {
    return new Promise(resolve => {
      if (countRef.current < maxConcurrent) {
        countRef.current++;
        resolve();
      } else {
        waitingRef.current.push(resolve);
      }
    });
  }, [maxConcurrent]);

  const release = useCallback(() => {
    if (waitingRef.current.length > 0) {
      const next = waitingRef.current.shift();
      if (next) next();
    } else {
      countRef.current = Math.max(0, countRef.current - 1);
    }
  }, []);

  const withSemaphore = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }, [acquire, release]);

  return {
    acquire,
    release,
    withSemaphore,
    activeCount: countRef.current,
    waitingCount: waitingRef.current.length,
  };
}

// デバウンス付きの処理実行
export function useDebouncedProcessor<T>(
  processor: (items: T[]) => Promise<void>,
  delay: number = 500
) {
  const bufferRef = useRef<T[]>([]);
  const timerRef = useRef<number | null>(null);
  const processorRef = useRef(processor);

  useEffect(() => {
    processorRef.current = processor;
  }, [processor]);

  const add = useCallback((item: T) => {
    bufferRef.current.push(item);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(async () => {
      const items = [...bufferRef.current];
      bufferRef.current = [];
      timerRef.current = null;
      await processorRef.current(items);
    }, delay);
  }, [delay]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (bufferRef.current.length > 0) {
      const items = [...bufferRef.current];
      bufferRef.current = [];
      await processorRef.current(items);
    }
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    add,
    flush,
    pendingCount: bufferRef.current.length,
  };
}
