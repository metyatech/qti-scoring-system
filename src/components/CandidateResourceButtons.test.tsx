import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import CandidateResourceButtons from "@/components/CandidateResourceButtons";

const response = (payload: unknown, ok = true): Response => ({
  ok,
  json: vi.fn(async () => payload)
} as unknown as Response);

describe("CandidateResourceButtons", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders nothing when there are no resources", async () => {
    globalThis.fetch = vi.fn(async () => response({ success: true, resources: [] })) as typeof fetch;
    await act(async () => {
      root.render(<CandidateResourceButtons workspaceId="exam" resultFile="r.xml" />);
    });
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows the resource label and POSTs on click while loading", async () => {
    let resolvePost: (value: Response) => void = () => undefined;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const fetchSpy = vi.fn((url: string, init?: RequestInit) =>
      init?.method === "POST" ? post : Promise.resolve(response({ resources: [{ id: "submission", label: "提出物を開く", type: "folder" }] }))
    );
    globalThis.fetch = fetchSpy as typeof fetch;
    await act(async () => {
      root.render(<CandidateResourceButtons workspaceId="exam" resultFile="r.xml" />);
    });
    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toBe("提出物を開く");
    await act(async () => { button.click(); });
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("準備中...");
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/workspaces/exam/candidate-resources",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ resultFile: "r.xml", resourceId: "submission" }) })
    );
    resolvePost(response({ success: true }));
    await act(async () => { await post; });
    expect(button.disabled).toBe(false);
  });

  it("reports API errors near the action", async () => {
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? response({ error: "提出 ZIP の SHA-256 が変わっています" }, false) : response({ resources: [{ id: "submission", label: "提出物を開く", type: "folder" }] })
    ) as typeof fetch;
    await act(async () => {
      root.render(<CandidateResourceButtons workspaceId="exam" resultFile="r.xml" />);
    });
    await act(async () => { (container.querySelector("button") as HTMLButtonElement).click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("SHA-256");
  });

  it("does not apply a stale response after resultFile changes", async () => {
    const pending: Array<(value: Response) => void> = [];
    globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => { pending.push(resolve); })) as typeof fetch;
    await act(async () => {
      root.render(<CandidateResourceButtons workspaceId="exam" resultFile="old.xml" />);
    });
    await act(async () => {
      root.render(<CandidateResourceButtons workspaceId="exam" resultFile="new.xml" />);
    });
    await act(async () => { pending[1]?.(response({ resources: [{ id: "new", label: "新しい提出物", type: "folder" }] })); });
    await act(async () => { pending[0]?.(response({ resources: [{ id: "old", label: "古い提出物", type: "folder" }] })); });
    expect(container.textContent).toContain("新しい提出物");
    expect(container.textContent).not.toContain("古い提出物");
  });
});
