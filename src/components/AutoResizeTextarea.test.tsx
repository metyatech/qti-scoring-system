import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import AutoResizeTextarea from "@/components/AutoResizeTextarea";

describe("AutoResizeTextarea", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafCallbacks: FrameRequestCallback[];
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;
  let cancelledFrames: number[];

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    rafCallbacks = [];
    cancelledFrames = [];
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    let nextFrameId = 1;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      rafCallbacks.push(cb);
      return id;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => {
      cancelledFrames.push(handle);
    }) as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  const flushFrames = () => {
    act(() => {
      const callbacks = rafCallbacks;
      rafCallbacks = [];
      for (const cb of callbacks) cb(performance.now());
    });
  };

  const renderTextarea = (props: {
    value: string;
    onChange: (value: string) => void;
    onBlur?: (value: string) => void;
  }) => {
    act(() => {
      root.render(
        <AutoResizeTextarea
          value={props.value}
          onChange={props.onChange}
          onBlur={props.onBlur}
        />
      );
    });
  };

  it("schedules a resize via requestAnimationFrame after mount", () => {
    const textarea = document.createElement("textarea");
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => 88,
    });
    container.appendChild(textarea);

    const Wrapper: React.FC = () => {
      const [value, setValue] = React.useState("hello");
      return (
        <AutoResizeTextarea
          value={value}
          onChange={setValue}
        />
      );
    };

    act(() => {
      root.render(<Wrapper />);
    });

    // The effect schedules exactly one rAF callback before paint. The callback
    // has not yet executed so the textarea (rendered by AutoResizeTextarea)
    // should still have its initial default height.
    expect(rafCallbacks.length).toBe(1);

    const renderedTextarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(renderedTextarea).toBeTruthy();
    Object.defineProperty(renderedTextarea, "scrollHeight", {
      configurable: true,
      get: () => 88,
    });

    flushFrames();
    expect(renderedTextarea.style.height).toBe("88px");
  });

  it("resizes synchronously on the input event", () => {
    renderTextarea({ value: "initial", onChange: () => undefined });

    const renderedTextarea = container.querySelector("textarea") as HTMLTextAreaElement;
    Object.defineProperty(renderedTextarea, "scrollHeight", {
      configurable: true,
      get: () => 64,
    });

    act(() => {
      // Re-fire the input event manually — the resize must happen
      // synchronously without waiting for rAF.
      renderedTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(renderedTextarea.style.height).toBe("64px");
  });

  it("cancels the pending rAF when unmounting", () => {
    renderTextarea({ value: "initial", onChange: () => undefined });
    expect(rafCallbacks.length).toBe(1);

    act(() => {
      root.unmount();
    });

    expect(cancelledFrames.length).toBeGreaterThan(0);
  });

  it("schedules a new resize when the external value changes", () => {
    const Wrapper: React.FC<{ value: string }> = ({ value }) => (
      <AutoResizeTextarea value={value} onChange={() => undefined} />
    );

    act(() => {
      root.render(<Wrapper value="one" />);
    });
    flushFrames();
    expect(rafCallbacks.length).toBe(0);

    act(() => {
      root.render(<Wrapper value="two" />);
    });
    expect(rafCallbacks.length).toBe(1);
  });
});
