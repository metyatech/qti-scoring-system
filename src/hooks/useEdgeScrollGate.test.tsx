import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { useEdgeScrollGate } from "@/hooks/useEdgeScrollGate";
import type { EdgeScrollGateState } from "@/hooks/useEdgeScrollGate";

type CapturedGate = EdgeScrollGateState;

type HarnessProps = {
  totalCount: number;
  currentIndex: number;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
};

const Harness: React.FC<HarnessProps> = ({
  totalCount,
  currentIndex,
  scrollTop,
  clientHeight,
  scrollHeight,
  onNavigatePrevious,
  onNavigateNext,
}) => {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const { gate, onWheel, resetGate } = useEdgeScrollGate({
    scrollRef: scrollRef as React.RefObject<HTMLDivElement | null>,
    currentIndex,
    totalCount,
    onNavigatePrevious,
    onNavigateNext,
  });

  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    Object.defineProperty(node, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: () => undefined,
    });
    Object.defineProperty(node, "clientHeight", {
      configurable: true,
      get: () => clientHeight,
    });
    Object.defineProperty(node, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
  }, [scrollTop, clientHeight, scrollHeight]);

  return (
    <div>
      <div
        ref={scrollRef}
        data-testid="scroll-region"
        onWheel={(event) => {
          onWheel(event);
        }}
      />
      <div data-testid="gate">{gate ? `${gate.direction}:${gate.kind}:${gate.message}` : "none"}</div>
      <button type="button" data-testid="reset" onClick={() => resetGate()}>
        reset
      </button>
    </div>
  );
};

const renderHarness = (root: Root, props: HarnessProps) => {
  act(() => {
    root.render(<Harness {...props} />);
  });
};

const dispatchWheel = (root: Root, deltaY: number, ctrlKey = false) => {
  const region = document.querySelector('[data-testid="scroll-region"]');
  if (!region) throw new Error("scroll-region not mounted");
  let preventDefaultCalled = false;
  // jsdom does not construct WheelEvent with deltaY reliably, so dispatch a
  // generic Event and attach the properties via Object.defineProperty.
  const event = new Event("wheel", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "deltaY", { value: deltaY, configurable: true });
  Object.defineProperty(event, "ctrlKey", { value: ctrlKey, configurable: true });
  const originalPreventDefault = event.preventDefault.bind(event);
  event.preventDefault = () => {
    preventDefaultCalled = true;
    originalPreventDefault();
  };
  act(() => {
    region.dispatchEvent(event);
  });
  return preventDefaultCalled;
};

const readGate = (): CapturedGate => {
  const node = document.querySelector('[data-testid="gate"]');
  if (!node || !node.textContent) throw new Error("gate node missing");
  const text = node.textContent;
  if (text === "none") return null;
  const [direction, kind, ...rest] = text.split(":");
  return {
    direction: direction as "previous" | "next",
    kind: kind as "confirm" | "boundary",
    message: rest.join(":"),
  };
};

describe("useEdgeScrollGate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  const baseProps = () => ({
    totalCount: 5,
    currentIndex: 1,
    scrollTop: 0,
    clientHeight: 200,
    scrollHeight: 1000,
    onNavigatePrevious: vi.fn(),
    onNavigateNext: vi.fn(),
  });

  it("opens a confirm gate on the first bottom-edge scroll and does not navigate", () => {
    const props = baseProps();
    props.scrollTop = 800; // atBottom: 800 + 200 = 1000
    renderHarness(root, props);

    const prevented = dispatchWheel(root, 100);
    expect(prevented).toBe(true);
    expect(props.onNavigateNext).not.toHaveBeenCalled();

    const gate = readGate();
    expect(gate?.direction).toBe("next");
    expect(gate?.kind).toBe("confirm");
    expect(gate?.message).toContain("次の受講者へ進むには、もう一度スクロール");
  });

  it("navigates next when a second edge scroll arrives after the min confirm delay", () => {
    const props = baseProps();
    props.scrollTop = 800;
    renderHarness(root, props);

    dispatchWheel(root, 100);
    expect(props.onNavigateNext).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200); // > MIN_CONFIRM_DELAY_MS (180)
    });

    dispatchWheel(root, 100);
    expect(props.onNavigateNext).toHaveBeenCalledTimes(1);
    expect(readGate()).toBeNull();
  });

  it("does not navigate when the second edge scroll arrives within the min confirm delay", () => {
    const props = baseProps();
    props.scrollTop = 800;
    renderHarness(root, props);

    dispatchWheel(root, 100);
    expect(props.onNavigateNext).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(50); // < MIN_CONFIRM_DELAY_MS (180)
    });

    dispatchWheel(root, 100);
    expect(props.onNavigateNext).not.toHaveBeenCalled();

    const gate = readGate();
    expect(gate?.kind).toBe("confirm");
    expect(gate?.direction).toBe("next");
  });

  it("auto-closes the confirm gate after GATE_TIMEOUT_MS", () => {
    const props = baseProps();
    props.scrollTop = 800;
    renderHarness(root, props);

    dispatchWheel(root, 100);
    expect(readGate()?.kind).toBe("confirm");

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(readGate()).toBeNull();
  });

  it("opens a previous-direction confirm gate at the top edge and navigates on the second scroll", () => {
    const props = baseProps();
    props.scrollTop = 0;
    renderHarness(root, props);

    const prevented = dispatchWheel(root, -100);
    expect(prevented).toBe(true);
    expect(props.onNavigatePrevious).not.toHaveBeenCalled();

    const gate = readGate();
    expect(gate?.direction).toBe("previous");
    expect(gate?.kind).toBe("confirm");

    act(() => {
      vi.advanceTimersByTime(200);
    });

    dispatchWheel(root, -100);
    expect(props.onNavigatePrevious).toHaveBeenCalledTimes(1);
  });

  it("does nothing at mid-scroll positions", () => {
    const props = baseProps();
    props.scrollTop = 400; // 400 + 200 = 600, not at bottom
    renderHarness(root, props);

    const prevented = dispatchWheel(root, 100);
    expect(prevented).toBe(false);
    expect(props.onNavigateNext).not.toHaveBeenCalled();
    expect(readGate()).toBeNull();
  });

  it("shows a boundary message at index 0 when scrolling up", () => {
    const props = baseProps();
    props.currentIndex = 0;
    props.scrollTop = 0;
    renderHarness(root, props);

    dispatchWheel(root, -100);
    expect(props.onNavigatePrevious).not.toHaveBeenCalled();
    const gate = readGate();
    expect(gate?.direction).toBe("previous");
    expect(gate?.kind).toBe("boundary");
    expect(gate?.message).toBe("最初の受講者です");
  });

  it("shows a boundary message at the last candidate when scrolling down", () => {
    const props = baseProps();
    props.currentIndex = 4;
    props.scrollTop = 800;
    renderHarness(root, props);

    dispatchWheel(root, 100);
    expect(props.onNavigateNext).not.toHaveBeenCalled();
    const gate = readGate();
    expect(gate?.direction).toBe("next");
    expect(gate?.kind).toBe("boundary");
    expect(gate?.message).toBe("最後の受講者です");
  });

  it("ignores wheel events with ctrlKey (browser zoom)", () => {
    const props = baseProps();
    props.scrollTop = 800;
    renderHarness(root, props);

    const prevented = dispatchWheel(root, 100, true);
    expect(prevented).toBe(false);
    expect(props.onNavigateNext).not.toHaveBeenCalled();
    expect(readGate()).toBeNull();
  });
});
