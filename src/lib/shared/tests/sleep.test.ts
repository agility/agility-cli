import { resetState } from "core/state";
import { sleep } from "../sleep";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.useFakeTimers();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("sleep", () => {
  it("returns a Promise", () => {
    const result = sleep(100);
    expect(result).toBeInstanceOf(Promise);
  });

  it("resolves after the specified delay", async () => {
    const p = sleep(500);
    jest.advanceTimersByTime(500);
    await expect(p).resolves.toBeUndefined();
  });

  it("does not resolve before the delay elapses", async () => {
    let resolved = false;
    sleep(1000).then(() => {
      resolved = true;
    });

    jest.advanceTimersByTime(999);
    // Flush microtasks without advancing macro timers
    await Promise.resolve();
    expect(resolved).toBe(false);
  });

  it("resolves immediately for 0 ms", async () => {
    const p = sleep(0);
    jest.advanceTimersByTime(0);
    await expect(p).resolves.toBeUndefined();
  });

  it.each([100, 500, 1000, 5000])("resolves after %i ms", async (ms) => {
    const p = sleep(ms);
    jest.advanceTimersByTime(ms);
    await expect(p).resolves.toBeUndefined();
  });
});
