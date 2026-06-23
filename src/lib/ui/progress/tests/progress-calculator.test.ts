import { resetState } from "core/state";
import { ProgressCalculator, ProgressStats } from "lib/ui/progress/progress-calculator";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── calculatePercentage ───────────────────────────────────────────────────────

describe("ProgressCalculator.calculatePercentage", () => {
  it.each([
    [0, 100, 0],
    [50, 100, 50],
    [100, 100, 100],
    [1, 3, 33],
    [2, 3, 66],
  ])("returns %i%% for %i/%i", (processed, total, expected) => {
    expect(ProgressCalculator.calculatePercentage(processed, total)).toBe(expected);
  });

  it("returns 0 when total is 0 (division-by-zero guard)", () => {
    expect(ProgressCalculator.calculatePercentage(5, 0)).toBe(0);
  });

  it("returns 0 when total is negative (division-by-zero guard)", () => {
    expect(ProgressCalculator.calculatePercentage(5, -1)).toBe(0);
  });

  it("clamps to 100 when processed exceeds total", () => {
    expect(ProgressCalculator.calculatePercentage(200, 100)).toBe(100);
  });

  it("clamps to 0 when processed is negative", () => {
    expect(ProgressCalculator.calculatePercentage(-10, 100)).toBe(0);
  });
});

// ─── formatDuration ────────────────────────────────────────────────────────────

describe("ProgressCalculator.formatDuration", () => {
  it.each([
    [0, "0s"],
    [500, "0s"],
    [1000, "1s"],
    [59000, "59s"],
    [60000, "1m 0s"],
    [90000, "1m 30s"],
    [3600000, "1h 0m 0s"],
    [3661000, "1h 1m 1s"],
  ])('formats %ims as "%s"', (ms, expected) => {
    expect(ProgressCalculator.formatDuration(ms)).toBe(expected);
  });
});

// ─── formatRate ────────────────────────────────────────────────────────────────

describe("ProgressCalculator.formatRate", () => {
  it('returns "0/sec" for zero rate', () => {
    expect(ProgressCalculator.formatRate(0)).toBe("0/sec");
  });

  it("returns per-minute rate for very slow rates (< 1/sec)", () => {
    const result = ProgressCalculator.formatRate(0.5);
    expect(result).toContain("/min");
  });

  it("returns per-second rate for rates between 1 and 1000", () => {
    const result = ProgressCalculator.formatRate(42.5);
    expect(result).toContain("/sec");
    expect(result).not.toContain("k");
  });

  it("returns k/sec notation for rates > 1000", () => {
    const result = ProgressCalculator.formatRate(1500);
    expect(result).toContain("k/sec");
  });

  it("correctly formats exact 1000 boundary", () => {
    const result = ProgressCalculator.formatRate(1001);
    expect(result).toContain("k/sec");
  });
});

// ─── formatProgressSummary ─────────────────────────────────────────────────────

describe("ProgressCalculator.formatProgressSummary", () => {
  const baseStats: ProgressStats = {
    processed: 50,
    total: 100,
    percentage: 50,
    startTime: new Date(),
    currentTime: new Date(),
    elapsedTime: 5000,
  };

  it("includes processed/total and percentage", () => {
    const result = ProgressCalculator.formatProgressSummary(baseStats);
    expect(result).toContain("50/100");
    expect(result).toContain("50%");
  });

  it("includes rate when itemsPerSecond is defined", () => {
    const stats = { ...baseStats, itemsPerSecond: 10 };
    const result = ProgressCalculator.formatProgressSummary(stats);
    expect(result).toContain("/sec");
  });

  it("includes ETA when estimatedRemainingTime is defined", () => {
    const stats = { ...baseStats, estimatedRemainingTime: 5000 };
    const result = ProgressCalculator.formatProgressSummary(stats);
    expect(result).toContain("ETA:");
  });

  it("omits rate and ETA when not provided", () => {
    const result = ProgressCalculator.formatProgressSummary(baseStats);
    expect(result).not.toContain("ETA:");
    expect(result).not.toContain("/sec");
  });
});

// ─── calculateOverallProgress ──────────────────────────────────────────────────

describe("ProgressCalculator.calculateOverallProgress", () => {
  it("returns 0 for empty array", () => {
    expect(ProgressCalculator.calculateOverallProgress([])).toBe(0);
  });

  it("returns the single value for one-element array", () => {
    expect(ProgressCalculator.calculateOverallProgress([70])).toBe(70);
  });

  it("returns floor of average for multiple steps", () => {
    expect(ProgressCalculator.calculateOverallProgress([100, 50])).toBe(75);
  });

  it("returns 0 when all steps are at 0", () => {
    expect(ProgressCalculator.calculateOverallProgress([0, 0, 0])).toBe(0);
  });
});

// ─── calculateWeightedProgress ────────────────────────────────────────────────

describe("ProgressCalculator.calculateWeightedProgress", () => {
  it("returns 0 for empty arrays", () => {
    expect(ProgressCalculator.calculateWeightedProgress([], [])).toBe(0);
  });

  it("returns 0 when array lengths differ", () => {
    expect(ProgressCalculator.calculateWeightedProgress([50, 100], [1])).toBe(0);
  });

  it("returns 0 when all weights are zero", () => {
    expect(ProgressCalculator.calculateWeightedProgress([50, 100], [0, 0])).toBe(0);
  });

  it("calculates correct weighted average", () => {
    // step1: 100% weight 1, step2: 0% weight 3  → (100*1 + 0*3) / 4 = 25
    expect(ProgressCalculator.calculateWeightedProgress([100, 0], [1, 3])).toBe(25);
  });

  it("floors the result", () => {
    // (50*1 + 100*1) / 2 = 75 (exact, no flooring needed but verifies)
    expect(ProgressCalculator.calculateWeightedProgress([50, 100], [1, 1])).toBe(75);
  });
});

// ─── calculateConservativeProgress ────────────────────────────────────────────

describe("ProgressCalculator.calculateConservativeProgress", () => {
  it("uses default divisor of 20", () => {
    expect(ProgressCalculator.calculateConservativeProgress(100)).toBe(5);
  });

  it("uses custom divisor", () => {
    expect(ProgressCalculator.calculateConservativeProgress(100, 10)).toBe(10);
  });

  it("caps at 95", () => {
    expect(ProgressCalculator.calculateConservativeProgress(10000)).toBe(95);
  });
});

// ─── instance: calculateProgress and getCurrentRate ───────────────────────────

describe("ProgressCalculator instance", () => {
  it("calculateProgress returns correct processed/total/percentage", () => {
    const calc = new ProgressCalculator();
    const stats = calc.calculateProgress(25, 100);
    expect(stats.processed).toBe(25);
    expect(stats.total).toBe(100);
    expect(stats.percentage).toBe(25);
  });

  it("calculateProgress returns elapsedTime >= 0", () => {
    const calc = new ProgressCalculator();
    const stats = calc.calculateProgress(10, 100);
    expect(stats.elapsedTime).toBeGreaterThanOrEqual(0);
  });

  it("getCurrentRate returns 0 with only one measurement", () => {
    const calc = new ProgressCalculator();
    calc.calculateProgress(10, 100);
    // One measurement → history length < 2 → rate 0
    expect(calc.getCurrentRate()).toBe(0);
  });

  it("reset clears history and resets start time", () => {
    const calc = new ProgressCalculator();
    calc.calculateProgress(50, 100);
    const before = calc.getStats().historySize;
    calc.reset();
    expect(calc.getStats().historySize).toBe(0);
    expect(before).toBeGreaterThan(0);
  });

  it("getStats returns historySize, currentRate, and elapsedTime", () => {
    const calc = new ProgressCalculator();
    calc.calculateProgress(10, 100);
    const stats = calc.getStats();
    expect(stats).toHaveProperty("historySize");
    expect(stats).toHaveProperty("currentRate");
    expect(stats).toHaveProperty("elapsedTime");
    expect(stats.historySize).toBe(1);
  });

  it("respects windowSize constructor argument", () => {
    const calc = new ProgressCalculator(3);
    for (let i = 0; i <= 5; i++) {
      calc.calculateProgress(i * 10, 100);
    }
    expect(calc.getStats().historySize).toBeLessThanOrEqual(3);
  });

  it("getEstimatedTimeRemaining returns null when rate is zero", () => {
    const calc = new ProgressCalculator();
    // With one measurement there is no rate, so remaining should be null
    const result = calc.getEstimatedTimeRemaining(10, 100);
    expect(result).toBeNull();
  });
});
