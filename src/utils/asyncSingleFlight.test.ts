import { describe, expect, it, vi } from "vitest";

import { createSingleFlight } from "./asyncSingleFlight";

describe("createSingleFlight", () => {
  it("runs only one concurrent invocation", async () => {
    const singleFlight = createSingleFlight<number>();
    const deferred: { resolve: (value: number) => void } = {
      resolve: () => undefined,
    };
    const fn = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          deferred.resolve = resolve;
        })
    );

    const first = singleFlight(fn);
    const second = singleFlight(fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    deferred.resolve(42);
    const result = await second;
    expect(result).toBe(42);

    await singleFlight(async () => 7);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("releases the lock on failure and allows retry", async () => {
    const singleFlight = createSingleFlight<number>();
    const error = new Error("boom");

    await expect(
      singleFlight(async () => {
        throw error;
      })
    ).rejects.toThrow("boom");

    const result = await singleFlight(async () => 9);
    expect(result).toBe(9);
  });
});
