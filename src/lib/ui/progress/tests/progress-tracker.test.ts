import { resetState } from "core/state";
import { ProgressTracker } from "lib/ui/progress/progress-tracker";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── initializeSteps ──────────────────────────────────────────────────────────

describe("ProgressTracker.initializeSteps", () => {
  it("creates steps with pending status and 0 percentage", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["Step A", "Step B"]);

    const all = tracker.getAllSteps();
    expect(all).toHaveLength(2);
    all.forEach((s) => {
      expect(s.status).toBe("pending");
      expect(s.percentage).toBe(0);
    });
  });

  it("sets step names correctly", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["Alpha", "Beta", "Gamma"]);
    expect(tracker.getStepByName("Beta")).not.toBeNull();
  });
});

// ─── startStep / updateStepProgress ───────────────────────────────────────────

describe("ProgressTracker.startStep", () => {
  it('sets step status to "progress"', () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["Step 1"]);
    tracker.startStep(0);

    expect(tracker.getStep(0)?.status).toBe("progress");
  });

  it("is a no-op for out-of-bounds index", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["Step 1"]);
    expect(() => tracker.startStep(99)).not.toThrow();
  });
});

describe("ProgressTracker.updateStepProgress", () => {
  it("clamps percentage to 0–100", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["S1"]);

    tracker.updateStepProgress(0, 150);
    expect(tracker.getStep(0)?.percentage).toBe(100);

    tracker.updateStepProgress(0, -20);
    expect(tracker.getStep(0)?.percentage).toBe(0);
  });

  it('sets endTime and percentage=100 when status is "success"', () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["S1"]);
    tracker.updateStepProgress(0, 50, "success");

    const step = tracker.getStep(0)!;
    expect(step.status).toBe("success");
    expect(step.percentage).toBe(100);
    expect(step.endTime).toBeDefined();
  });

  it('sets endTime when status is "error"', () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["S1"]);
    tracker.updateStepProgress(0, 30, "error");

    expect(tracker.getStep(0)?.endTime).toBeDefined();
  });
});

// ─── completeStep / failStep ───────────────────────────────────────────────────

describe("ProgressTracker.completeStep", () => {
  it("marks step as success with 100%", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["S1"]);
    tracker.completeStep(0);

    const step = tracker.getStep(0)!;
    expect(step.status).toBe("success");
    expect(step.percentage).toBe(100);
  });
});

describe("ProgressTracker.failStep", () => {
  it("marks step as error and stores error message", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["S1"]);
    tracker.failStep(0, "something went wrong");

    const step = tracker.getStep(0)!;
    expect(step.status).toBe("error");
    expect(step.error).toBe("something went wrong");
  });

  it("is a no-op for out-of-bounds index", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["S1"]);
    expect(() => tracker.failStep(99)).not.toThrow();
  });
});

// ─── getOverallProgress ────────────────────────────────────────────────────────

describe("ProgressTracker.getOverallProgress", () => {
  it("returns 0 when no steps are initialised", () => {
    const tracker = new ProgressTracker();
    expect(tracker.getOverallProgress()).toBe(0);
  });

  it("returns 0 when all steps are at 0%", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    expect(tracker.getOverallProgress()).toBe(0);
  });

  it("returns 100 when all steps complete", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    tracker.completeStep(0);
    tracker.completeStep(1);
    expect(tracker.getOverallProgress()).toBe(100);
  });

  it("returns floor of average across steps", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    tracker.updateStepProgress(0, 50);
    tracker.updateStepProgress(1, 100, "success");
    // average of 50 and 100 = 75
    expect(tracker.getOverallProgress()).toBe(75);
  });
});

// ─── getSummary ────────────────────────────────────────────────────────────────

describe("ProgressTracker.getSummary", () => {
  it("returns correct counts for mixed states", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B", "C", "D"]);
    tracker.completeStep(0);
    tracker.completeStep(1);
    tracker.failStep(2);
    // step D remains pending

    const summary = tracker.getSummary();
    expect(summary.totalSteps).toBe(4);
    expect(summary.successfulSteps).toBe(2);
    expect(summary.errorSteps).toBe(1);
    expect(summary.pendingSteps).toBe(1);
  });

  it("overallSuccess is true only when all steps succeed and none pending/error", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    tracker.completeStep(0);
    tracker.completeStep(1);

    expect(tracker.getSummary().overallSuccess).toBe(true);
  });

  it("overallSuccess is false when any step fails", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    tracker.completeStep(0);
    tracker.failStep(1);

    expect(tracker.getSummary().overallSuccess).toBe(false);
  });

  it("overallSuccess is false when some steps are still pending", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    tracker.completeStep(0);

    expect(tracker.getSummary().overallSuccess).toBe(false);
  });

  it("includes totalDuration and durationFormatted", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A"]);
    const summary = tracker.getSummary();

    expect(summary.totalDuration).toBeGreaterThanOrEqual(0);
    expect(typeof summary.durationFormatted).toBe("string");
    expect(summary.durationFormatted.length).toBeGreaterThan(0);
  });
});

// ─── getStep / getStepByName / getStepIndex ───────────────────────────────────

describe("ProgressTracker step accessors", () => {
  it("getStep returns null for out-of-bounds index", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A"]);
    expect(tracker.getStep(-1)).toBeNull();
    expect(tracker.getStep(99)).toBeNull();
  });

  it("getStepByName returns null when name not found", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A"]);
    expect(tracker.getStepByName("NonExistent")).toBeNull();
  });

  it("getStepIndex returns -1 for unknown name", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A"]);
    expect(tracker.getStepIndex("Unknown")).toBe(-1);
  });

  it("getStepIndex returns correct index", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["First", "Second", "Third"]);
    expect(tracker.getStepIndex("Second")).toBe(1);
  });
});

// ─── isComplete / hasErrors / getFailedSteps / getCompletedSteps ──────────────

describe("ProgressTracker state queries", () => {
  it("isComplete returns false while some steps are pending", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    tracker.completeStep(0);
    expect(tracker.isComplete()).toBe(false);
  });

  it("isComplete returns true when all steps are success or error", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    tracker.completeStep(0);
    tracker.failStep(1);
    expect(tracker.isComplete()).toBe(true);
  });

  it("hasErrors returns false when no errors", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A"]);
    tracker.completeStep(0);
    expect(tracker.hasErrors()).toBe(false);
  });

  it("hasErrors returns true when a step failed", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    tracker.completeStep(0);
    tracker.failStep(1);
    expect(tracker.hasErrors()).toBe(true);
  });

  it("getFailedSteps returns only errored steps", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B", "C"]);
    tracker.completeStep(0);
    tracker.failStep(1);
    const failed = tracker.getFailedSteps();
    expect(failed).toHaveLength(1);
    expect(failed[0].name).toBe("B");
  });

  it("getCompletedSteps returns only successful steps", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    tracker.completeStep(0);
    tracker.failStep(1);
    const completed = tracker.getCompletedSteps();
    expect(completed).toHaveLength(1);
    expect(completed[0].name).toBe("A");
  });

  it("getPendingSteps returns only pending steps", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B", "C"]);
    tracker.completeStep(0);
    const pending = tracker.getPendingSteps();
    expect(pending).toHaveLength(2);
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe("ProgressTracker.reset", () => {
  it("resets all steps to pending with 0 percentage", () => {
    const tracker = new ProgressTracker();
    tracker.initializeSteps(["A", "B"]);
    tracker.completeStep(0);
    tracker.failStep(1, "oops");

    tracker.reset();

    tracker.getAllSteps().forEach((s) => {
      expect(s.status).toBe("pending");
      expect(s.percentage).toBe(0);
      expect(s.error).toBeUndefined();
    });
  });
});

// ─── operationName ────────────────────────────────────────────────────────────

describe("ProgressTracker operation name", () => {
  it("uses provided operation name", () => {
    const tracker = new ProgressTracker("MyOp");
    expect(tracker.getOperationName()).toBe("MyOp");
  });

  it('defaults to "Operation"', () => {
    const tracker = new ProgressTracker();
    expect(tracker.getOperationName()).toBe("Operation");
  });

  it("setOperationName updates the name", () => {
    const tracker = new ProgressTracker();
    tracker.setOperationName("NewName");
    expect(tracker.getOperationName()).toBe("NewName");
  });
});

// ─── formatSummary ────────────────────────────────────────────────────────────

describe("ProgressTracker.formatSummary", () => {
  it("returns at least one line", () => {
    const tracker = new ProgressTracker("Push");
    tracker.initializeSteps(["A"]);
    tracker.completeStep(0);
    const lines = tracker.formatSummary();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("Push");
  });

  it("includeDetails adds failed/successful sections", () => {
    const tracker = new ProgressTracker("Sync");
    tracker.initializeSteps(["A", "B"]);
    tracker.completeStep(0);
    tracker.failStep(1, "boom");

    const lines = tracker.formatSummary(true);
    const text = lines.join("\n");
    expect(text).toContain("Failed");
    expect(text).toContain("Successful");
  });
});
