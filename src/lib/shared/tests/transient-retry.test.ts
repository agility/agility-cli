import { isTransientError, withTransientRetry } from "../transient-retry";

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const netError = (code: string) => Object.assign(new Error(code), { code });
const noSleep = () => Promise.resolve();

describe("isTransientError (PROD-3449)", () => {
  it.each([408, 429, 502, 503, 504])("retries HTTP %i", (status) => {
    expect(isTransientError(httpError(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 500])("doesn't retry HTTP %i", (status) => {
    expect(isTransientError(httpError(status))).toBe(false);
  });

  it("retries dropped connections, not other errors", () => {
    expect(isTransientError(netError("ECONNRESET"))).toBe(true);
    expect(isTransientError(netError("ENOTFOUND"))).toBe(true);
    expect(isTransientError(new Error("Local asset file not found"))).toBe(false);
  });
});

describe("withTransientRetry (PROD-3449)", () => {
  it("retries a 503 until it succeeds, waiting the given delays", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue("ok");
    const sleep = jest.fn(noSleep);
    const onRetry = jest.fn();

    await expect(withTransientRetry(fn, { delaysMs: [10, 20, 40], sleep, onRetry })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
    expect(onRetry.mock.calls.map((c) => c[1])).toEqual([1, 2]);
  });

  it("gives up after the last delay and rethrows the last error", async () => {
    const err = httpError(503);
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withTransientRetry(fn, { delaysMs: [1, 1], sleep: noSleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("doesn't retry a non-transient error", async () => {
    const fn = jest.fn().mockRejectedValue(httpError(400));

    await expect(withTransientRetry(fn, { delaysMs: [1, 1], sleep: noSleep })).rejects.toThrow("HTTP 400");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
