import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';

import ReportDownloadButton from '@/components/ReportDownloadButton';

const makeDeferred = () => {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('ReportDownloadButton', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('disables button and ignores concurrent clicks while downloading', async () => {
    const deferred = makeDeferred();
    const fetchSpy = vi.fn(() => deferred.promise as Promise<Response>);
    globalThis.fetch = fetchSpy as typeof fetch;
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
      root.render(
        <ReportDownloadButton
          workspaceId="ws-1"
          workspaceName="WS"
        />
      );
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain('レポート生成中');

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const response = {
      ok: true,
      blob: vi.fn(async () => new Blob(['data'])),
    } as unknown as Response;
    deferred.resolve(response);
    await act(async () => {
      await deferred.promise;
    });

    expect(button?.disabled).toBe(false);
  });

  it('re-enables button and reports error on failure', async () => {
    const deferred = makeDeferred();
    const fetchSpy = vi.fn(() => deferred.promise as Promise<Response>);
    const onError = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;

    await act(async () => {
      root.render(
        <ReportDownloadButton
          workspaceId="ws-2"
          workspaceName="WS2"
          onError={onError}
        />
      );
    });

    const button = container.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(button?.disabled).toBe(true);

    const response = {
      ok: false,
      json: vi.fn(async () => ({ error: 'boom' })),
    } as unknown as Response;
    deferred.resolve(response);
    await act(async () => {
      await deferred.promise;
    });

    expect(onError).toHaveBeenCalledWith('boom');
    expect(button?.disabled).toBe(false);
  });
});
