"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  useEdgeScrollGate,
  type EdgeScrollGateDirection,
} from "@/hooks/useEdgeScrollGate";

type EdgeScrollCandidateNavigatorProps = {
  currentIndex: number;
  totalCount: number;
  resetKey: string;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
  children: React.ReactNode;
};

/**
 * Wraps the single candidate card in item-view with a scroll region that
 * intercepts wheel events at its top/bottom edges. Scrolling inside the card
 * never changes the candidate; only an intentional two-stage edge scroll
 * advances or retreats. When `resetKey` changes (candidate or item switched
 * programmatically) the scroll region is reset to the top and any open gate
 * is cleared.
 */
export default function EdgeScrollCandidateNavigator({
  currentIndex,
  totalCount,
  resetKey,
  onNavigatePrevious,
  onNavigateNext,
  children,
}: EdgeScrollCandidateNavigatorProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastResetKeyRef = useRef<string | null>(null);

  // Stash navigation callbacks behind stable refs so the underlying
  // `useEdgeScrollGate` hook can read the latest callback without
  // re-creating its handlers on every parent re-render. The blur step
  // before navigating is critical: the existing `onBlur` save handler is the
  // only path that persists comments, and a focused textarea that never
  // blurs would silently drop its value when we switch candidates.
  const prevNavRef = useRef(onNavigatePrevious);
  const nextNavRef = useRef(onNavigateNext);
  useEffect(() => {
    prevNavRef.current = onNavigatePrevious;
  }, [onNavigatePrevious]);
  useEffect(() => {
    nextNavRef.current = onNavigateNext;
  }, [onNavigateNext]);

  const navigatePrevious = useCallback(() => {
    blurTextareaInside(scrollRef.current);
    prevNavRef.current();
  }, []);

  const navigateNext = useCallback(() => {
    blurTextareaInside(scrollRef.current);
    nextNavRef.current();
  }, []);

  const { gate, onWheel, resetGate } = useEdgeScrollGate({
    scrollRef: scrollRef as React.RefObject<HTMLDivElement | null>,
    currentIndex,
    totalCount,
    onNavigatePrevious: navigatePrevious,
    onNavigateNext: navigateNext,
  });

  // When the wrapped content changes (item or candidate switch), reset the
  // scroll position to the top and close any open gate so the new content
  // starts in a clean state.
  useEffect(() => {
    if (lastResetKeyRef.current === null) {
      lastResetKeyRef.current = resetKey;
      return;
    }
    if (lastResetKeyRef.current === resetKey) return;
    lastResetKeyRef.current = resetKey;
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = 0;
    }
    resetGate();
  }, [resetKey, resetGate]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      onWheel(event);
    },
    [onWheel]
  );

  const toneClass =
    gate?.kind === "boundary"
      ? "bg-gray-100 border-gray-300 text-gray-700"
      : "bg-yellow-100 border-yellow-300 text-yellow-800";

  return (
    <div
      ref={scrollRef}
      data-testid="item-card-scroll-region"
      tabIndex={0}
      onWheel={handleWheel}
      className="relative overflow-y-auto overscroll-contain max-h-[calc(100vh-14rem)] focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {children}
      {gate !== null && (
        <div
          role="status"
          aria-live="polite"
          data-testid="edge-scroll-gate-message"
          data-gate-direction={gate.direction}
          data-gate-kind={gate.kind}
          className={`sticky bottom-0 left-0 right-0 mt-4 px-3 py-2 border rounded-md text-sm text-center ${toneClass}`}
        >
          {gate.message}
        </div>
      )}
    </div>
  );
}

/**
 * If a textarea inside the scroll region is currently focused, blur it so
 * that the comment save handler runs before we navigate. Without this, a
 * textarea that lost focus only by being unmounted would never fire its
 * `onBlur` and the latest draft would be silently dropped.
 */
function blurTextareaInside(scrollContainer: HTMLDivElement | null) {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (
    active instanceof HTMLTextAreaElement &&
    scrollContainer?.contains(active)
  ) {
    active.blur();
  }
}

// Re-exported for testing convenience only; the production tree imports the
// type from `@/hooks/useEdgeScrollGate` directly.
export type { EdgeScrollGateDirection };
