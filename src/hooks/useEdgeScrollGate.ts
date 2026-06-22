import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type EdgeScrollGateDirection = "previous" | "next";

export type EdgeScrollGateState =
  | {
      direction: EdgeScrollGateDirection;
      kind: "confirm" | "boundary";
      message: string;
    }
  | null;

export type UseEdgeScrollGateOptions = {
  scrollRef: RefObject<HTMLElement | null>;
  currentIndex: number;
  totalCount: number;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
};

export type UseEdgeScrollGateResult = {
  gate: EdgeScrollGateState;
  onWheel: (event: React.WheelEvent<HTMLElement>) => void;
  resetGate: () => void;
};

const GATE_TIMEOUT_MS = 1500;
const MIN_CONFIRM_DELAY_MS = 180;
const EDGE_EPSILON_PX = 2;

const BOUNDARY_MESSAGE: Record<EdgeScrollGateDirection, string> = {
  previous: "最初の受講者です",
  next: "最後の受講者です",
};

const CONFIRM_MESSAGE: Record<EdgeScrollGateDirection, string> = {
  previous: "前の受講者へ戻るには、もう一度スクロール",
  next: "次の受講者へ進むには、もう一度スクロール",
};

type GateRecord = {
  direction: EdgeScrollGateDirection;
  kind: "confirm" | "boundary";
  message: string;
  startedAt: number;
};

/**
 * Edge-scroll navigation gate.
 *
 * Watches a scrollable region (the current candidate card in item-view) and
 * intercepts wheel events that occur at the top or bottom edge:
 *
 * - Mid-scroll wheel events are ignored (the browser scrolls naturally and
 *   the candidate never changes).
 * - The first wheel at an edge opens a "confirm" gate; a second wheel within
 *   the gate window must wait at least `MIN_CONFIRM_DELAY_MS` before it
 *   actually navigates. This prevents a fast double-flick from skipping a
 *   candidate.
 * - When the candidate is at the boundary (first or last) the gate shows a
 *   "boundary" message instead of navigating. No looping.
 * - `ctrlKey` wheel events (browser zoom) are always passed through.
 *
 * The hook does NOT mutate `scrollRef.current.scrollTop`. Resetting the
 * scroll position is the caller's responsibility (it depends on the React
 * tree that owns the ref).
 */
export const useEdgeScrollGate = (
  options: UseEdgeScrollGateOptions
): UseEdgeScrollGateResult => {
  const {
    scrollRef,
    currentIndex,
    totalCount,
    onNavigatePrevious,
    onNavigateNext,
  } = options;

  const [gate, setGate] = useState<EdgeScrollGateState>(null);
  const gateRef = useRef<GateRecord | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always read the latest navigation callbacks and identity values from a
  // ref so the stable `onWheel` handler can call them without invalidating.
  // Updates happen in an effect to satisfy react-hooks/refs (refs are not
  // for reading during render).
  const callbacksRef = useRef({
    onNavigatePrevious,
    onNavigateNext,
    currentIndex,
    totalCount,
  });
  useEffect(() => {
    callbacksRef.current.onNavigatePrevious = onNavigatePrevious;
    callbacksRef.current.onNavigateNext = onNavigateNext;
    callbacksRef.current.currentIndex = currentIndex;
    callbacksRef.current.totalCount = totalCount;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const closeGate = useCallback(() => {
    gateRef.current = null;
    setGate(null);
    clearTimer();
  }, [clearTimer]);

  const openGate = useCallback(
    (next: GateRecord) => {
      gateRef.current = next;
      setGate({
        direction: next.direction,
        kind: next.kind,
        message: next.message,
      });
      clearTimer();
      // Boundaries never auto-clear differently from confirms; both use the
      // shared timeout so the UI returns to the resting state after the same
      // visible duration.
      timerRef.current = setTimeout(() => {
        gateRef.current = null;
        setGate(null);
        timerRef.current = null;
      }, GATE_TIMEOUT_MS);
    },
    [clearTimer]
  );

  // Always clear pending timers on unmount so a stale `setGate` cannot fire
  // after the consumer has gone away.
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (event.ctrlKey) return;
      if (Math.abs(event.deltaY) < 1) return;

      const direction: EdgeScrollGateDirection =
        event.deltaY > 0 ? "next" : "previous";
      const callbacks = callbacksRef.current;
      const isAtBoundary =
        direction === "next"
          ? callbacks.currentIndex >= callbacks.totalCount - 1
          : callbacks.currentIndex <= 0;

      const element = scrollRef.current;
      if (!element) {
        return;
      }

      const scrollTop = element.scrollTop;
      const clientHeight = element.clientHeight;
      const scrollHeight = element.scrollHeight;
      const atTop = scrollTop <= EDGE_EPSILON_PX;
      const atBottom = scrollTop + clientHeight >= scrollHeight - EDGE_EPSILON_PX;
      const isAtEdge = direction === "next" ? atBottom : atTop;

      if (!isAtEdge) {
        // Mid-scroll: let the browser scroll. A stale gate (from a previous
        // edge flick) must be dismissed so the candidate does not silently
        // change on the next scroll.
        if (gateRef.current !== null) {
          closeGate();
        }
        return;
      }

      // We're at the requested edge. Always swallow the wheel: the browser
      // would otherwise bounce the page or scroll an outer container, which
      // is the very behavior we are replacing.
      event.preventDefault();

      const active = gateRef.current;
      const now =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      if (isAtBoundary) {
        // At the first/last candidate: never navigate. Show the boundary
        // hint and reset any prior confirm gate so a fresh edge flick is
        // required after backing off.
        openGate({
          direction,
          kind: "boundary",
          message: BOUNDARY_MESSAGE[direction],
          startedAt: now,
        });
        return;
      }

      if (active && active.direction === direction && active.kind === "confirm") {
        const elapsed = now - active.startedAt;
        if (elapsed < MIN_CONFIRM_DELAY_MS) {
          // Too soon after the first scroll: keep the gate open but do not
          // navigate. This filters accidental double-flicks.
          return;
        }
        closeGate();
        if (direction === "next") {
          callbacks.onNavigateNext();
        } else {
          callbacks.onNavigatePrevious();
        }
        return;
      }

      // First edge scroll (or a scroll in the opposite direction of an open
      // gate): open a confirm gate without navigating.
      openGate({
        direction,
        kind: "confirm",
        message: CONFIRM_MESSAGE[direction],
        startedAt: now,
      });
    },
    [closeGate, openGate, scrollRef]
  );

  const resetGate = useCallback(() => {
    closeGate();
  }, [closeGate]);

  return { gate, onWheel, resetGate };
};
