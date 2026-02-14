import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { useHighlightCodeBlocks } from "@/hooks/useHighlightCodeBlocks";
import * as highlight from "@/utils/highlight";

describe("useHighlightCodeBlocks", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let rafId = 0;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    rafCallbacks = new Map();
    rafId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafId += 1;
      rafCallbacks.set(rafId, cb);
      return rafId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      rafCallbacks.delete(id);
    });
    vi.spyOn(highlight, "scheduleHighlightCodeBlocks").mockReturnValue({
      cancel: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    delete (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT;
  });

  const TestComponent = ({
    tick,
    enabled = true,
  }: {
    tick: number;
    enabled?: boolean;
  }) => {
    const ref = React.useRef<HTMLDivElement>(null);
    const deps = React.useMemo(() => [tick], [tick]);
    useHighlightCodeBlocks(ref, deps, enabled);
    return (
      <div ref={ref}>
        <pre>
          <code>const x = 1;</code>
        </pre>
      </div>
    );
  };

  it("batches highlight calls per animation frame", () => {
    act(() => {
      root.render(<TestComponent tick={0} />);
    });
    act(() => {
      root.render(<TestComponent tick={1} />);
    });
    act(() => {
      root.render(<TestComponent tick={2} />);
    });

    expect(rafCallbacks.size).toBe(1);
    for (const [id, cb] of rafCallbacks) {
      rafCallbacks.delete(id);
      cb(0);
    }

    expect(highlight.scheduleHighlightCodeBlocks).toHaveBeenCalledTimes(1);
  });

  it("does not schedule when disabled", () => {
    act(() => {
      root.render(<TestComponent tick={0} enabled={false} />);
    });

    expect(rafCallbacks.size).toBe(0);
    expect(highlight.scheduleHighlightCodeBlocks).not.toHaveBeenCalled();
  });

  it("cancels scheduled work on unmount", () => {
    const cancel = vi.fn();
    (
      highlight.scheduleHighlightCodeBlocks as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockReturnValueOnce({
      cancel,
    });

    act(() => {
      root.render(<TestComponent tick={0} />);
    });

    expect(rafCallbacks.size).toBe(1);

    for (const [id, cb] of rafCallbacks) {
      rafCallbacks.delete(id);
      cb(0);
    }

    act(() => {
      root.unmount();
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.size).toBe(0);
  });
});
