import { useEffect, useMemo, useRef, useState } from 'react';

type IncrementalOptions = {
  batchSize?: number;
  delayMs?: number;
  initialBatchSize?: number;
  resetKey?: unknown;
};

type IncrementalState<T> = {
  visibleItems: T[];
  isComplete: boolean;
};

export const useIncrementalList = <T,>(
  items: T[],
  options: IncrementalOptions = {}
): IncrementalState<T> => {
  const batchSize = options.batchSize ?? 30;
  const delayMs = options.delayMs ?? 0;
  const initialBatchSize = options.initialBatchSize ?? batchSize;
  const resetKey = options.resetKey;

  const prevItemsRef = useRef(items);
  const prevResetKeyRef = useRef(resetKey);
  const [visibleCount, setVisibleCount] = useState(() => Math.min(initialBatchSize, items.length));

  useEffect(() => {
    const itemsChanged = prevItemsRef.current !== items;
    const resetKeyChanged = resetKey !== undefined && prevResetKeyRef.current !== resetKey;
    prevItemsRef.current = items;
    prevResetKeyRef.current = resetKey;

    setVisibleCount((prev) => {
      const nextInitial = Math.min(initialBatchSize, items.length);
      if (resetKeyChanged || (resetKey === undefined && itemsChanged)) {
        return nextInitial;
      }
      if (items.length < prev) return items.length;
      if (prev === 0 && items.length > 0) return nextInitial;
      return prev;
    });
  }, [items, items.length, initialBatchSize, resetKey]);

  useEffect(() => {
    if (visibleCount >= items.length) return;
    const timer = window.setTimeout(() => {
      setVisibleCount((prev) => Math.min(items.length, prev + batchSize));
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [batchSize, delayMs, items.length, visibleCount]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const isComplete = visibleCount >= items.length;

  return { visibleItems, isComplete };
};
