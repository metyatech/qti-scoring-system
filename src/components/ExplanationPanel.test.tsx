import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, Root } from "react-dom/client";
import ExplanationPanel from "@/components/ExplanationPanel";

describe("ExplanationPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT;
  });

  it("is collapsed by default and toggles open/closed", () => {
    const explanationHtml = "<p>Explanation body</p>";

    act(() => {
      root.render(<ExplanationPanel html={explanationHtml} />);
    });

    expect(container.textContent).toContain("解説を表示");
    expect(container.innerHTML).not.toContain(explanationHtml);

    const toggleRegion = container.querySelector('[role="button"]');
    expect(toggleRegion).not.toBeNull();

    act(() => {
      toggleRegion?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("解説を隠す");
    expect(container.innerHTML).toContain(explanationHtml);

    act(() => {
      toggleRegion?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("解説を表示");
    expect(container.innerHTML).not.toContain(explanationHtml);
  });
});
