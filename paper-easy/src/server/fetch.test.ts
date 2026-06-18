import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./fetch";

describe("fetchWithRetry", () => {
  it("aborts a request after the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_input: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    ) as typeof fetch;

    const request = fetchWithRetry("https://example.test/hangs", {}, fetchImpl, {
      timeoutMs: 25,
      retries: 0,
      retryBaseDelayMs: 1
    });
    const expectation = expect(request).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("retries a transient HTTP failure and returns the successful response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 })) as unknown as typeof fetch;

    const response = await fetchWithRetry("https://example.test/retry", {}, fetchImpl, {
      timeoutMs: 100,
      retries: 2,
      retryBaseDelayMs: 0
    });

    expect(await response.text()).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when transient failures exhaust retries", async () => {
    const fetchImpl = vi.fn(async () => new Response("busy", { status: 503 })) as typeof fetch;

    await expect(
      fetchWithRetry("https://example.test/exhausted", {}, fetchImpl, {
        timeoutMs: 100,
        retries: 2,
        retryBaseDelayMs: 0
      })
    ).rejects.toThrow("503 after 2 retries");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
