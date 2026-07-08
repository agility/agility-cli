import { preflightReport, PreflightEntry } from "../preflight-report";
import { resetState, setState } from "core/state";

beforeEach(() => {
  resetState();
  preflightReport.reset();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── isEnabled ────────────────────────────────────────────────────────────────

describe("isEnabled", () => {
  it("returns false when state.preflight is false (default)", () => {
    expect(preflightReport.isEnabled()).toBe(false);
  });

  it("returns true when state.preflight is true", () => {
    setState({ preflight: true });
    expect(preflightReport.isEnabled()).toBe(true);
  });
});

// ─── record / getEntries ──────────────────────────────────────────────────────

describe("record", () => {
  it("is a no-op when preflight is disabled", () => {
    preflightReport.record({ phase: "Models", action: "create", name: "my-model" });
    expect(preflightReport.getEntries()).toHaveLength(0);
  });

  it("records an entry when preflight is enabled", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "my-model" });
    expect(preflightReport.getEntries()).toHaveLength(1);
  });

  it("records multiple entries in order", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "model-1" });
    preflightReport.record({ phase: "Models", action: "update", name: "model-2" });
    preflightReport.record({ phase: "Content", action: "skip", name: "content-1", locale: "en-us" });

    const entries = preflightReport.getEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0].name).toBe("model-1");
    expect(entries[1].name).toBe("model-2");
    expect(entries[2].name).toBe("content-1");
  });

  it("stores all optional fields on the entry", () => {
    setState({ preflight: true });
    const entry: PreflightEntry = {
      phase: "Content",
      action: "conflict",
      name: "my-item",
      locale: "fr-ca",
      detail: "target is newer",
    };
    preflightReport.record(entry);
    const recorded = preflightReport.getEntries()[0];
    expect(recorded).toEqual(entry);
  });

  it("remains no-op across multiple calls when preflight is disabled", () => {
    for (let i = 0; i < 5; i++) {
      preflightReport.record({ phase: "Models", action: "create", name: `item-${i}` });
    }
    expect(preflightReport.getEntries()).toHaveLength(0);
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe("reset", () => {
  it("clears all recorded entries", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "m1" });
    preflightReport.record({ phase: "Models", action: "update", name: "m2" });

    preflightReport.reset();
    expect(preflightReport.getEntries()).toHaveLength(0);
  });

  it("can be called on an empty report without error", () => {
    expect(() => preflightReport.reset()).not.toThrow();
  });
});

// ─── hasConflicts ─────────────────────────────────────────────────────────────

describe("hasConflicts", () => {
  it("returns false when there are no entries", () => {
    setState({ preflight: true });
    expect(preflightReport.hasConflicts()).toBe(false);
  });

  it("returns false when there are entries but none are conflicts", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "m1" });
    preflightReport.record({ phase: "Models", action: "update", name: "m2" });
    preflightReport.record({ phase: "Content", action: "skip", name: "c1" });
    expect(preflightReport.hasConflicts()).toBe(false);
  });

  it("returns true when at least one entry has action=conflict", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "m1" });
    preflightReport.record({ phase: "Content", action: "conflict", name: "bad-item" });
    expect(preflightReport.hasConflicts()).toBe(true);
  });
});

// ─── getTotals ────────────────────────────────────────────────────────────────

describe("getTotals", () => {
  it("returns all-zeros totals when there are no entries", () => {
    setState({ preflight: true });
    expect(preflightReport.getTotals()).toEqual({ create: 0, update: 0, skip: 0, conflict: 0 });
  });

  it("correctly counts each action type", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "m1" });
    preflightReport.record({ phase: "Models", action: "create", name: "m2" });
    preflightReport.record({ phase: "Content", action: "update", name: "c1" });
    preflightReport.record({ phase: "Content", action: "skip", name: "c2" });
    preflightReport.record({ phase: "Content", action: "skip", name: "c3" });
    preflightReport.record({ phase: "Pages", action: "conflict", name: "p1" });

    expect(preflightReport.getTotals()).toEqual({ create: 2, update: 1, skip: 2, conflict: 1 });
  });

  it("counts only the actions that appear", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "update", name: "m1" });

    expect(preflightReport.getTotals()).toEqual({ create: 0, update: 1, skip: 0, conflict: 0 });
  });
});

// ─── getPhaseSummaries ────────────────────────────────────────────────────────

describe("getPhaseSummaries", () => {
  it("returns empty array when there are no entries", () => {
    setState({ preflight: true });
    expect(preflightReport.getPhaseSummaries()).toEqual([]);
  });

  it("groups entries by phase with correct per-action counts", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "m1" });
    preflightReport.record({ phase: "Models", action: "update", name: "m2" });
    preflightReport.record({ phase: "Models", action: "create", name: "m3" });
    preflightReport.record({ phase: "Content", action: "skip", name: "c1" });

    const summaries = preflightReport.getPhaseSummaries();
    expect(summaries).toHaveLength(2);

    const modelsSummary = summaries.find((s) => s.phase === "Models");
    expect(modelsSummary).toBeDefined();
    expect(modelsSummary!.create).toBe(2);
    expect(modelsSummary!.update).toBe(1);
    expect(modelsSummary!.skip).toBe(0);
    expect(modelsSummary!.conflict).toBe(0);
    expect(modelsSummary!.entries).toHaveLength(3);

    const contentSummary = summaries.find((s) => s.phase === "Content");
    expect(contentSummary).toBeDefined();
    expect(contentSummary!.skip).toBe(1);
  });

  it("preserves first-seen phase insertion order", () => {
    setState({ preflight: true });
    // Record in a deliberate, non-alphabetical order
    preflightReport.record({ phase: "Pages", action: "create", name: "p1" });
    preflightReport.record({ phase: "Models", action: "create", name: "m1" });
    preflightReport.record({ phase: "Containers", action: "update", name: "ct1" });

    const summaries = preflightReport.getPhaseSummaries();
    expect(summaries.map((s) => s.phase)).toEqual(["Pages", "Models", "Containers"]);
  });

  it("includes each entry in the phase entries array", () => {
    setState({ preflight: true });
    const e1: PreflightEntry = { phase: "Assets", action: "skip", name: "logo.png" };
    const e2: PreflightEntry = { phase: "Assets", action: "create", name: "hero.jpg" };
    preflightReport.record(e1);
    preflightReport.record(e2);

    const summary = preflightReport.getPhaseSummaries()[0];
    expect(summary.entries).toContainEqual(e1);
    expect(summary.entries).toContainEqual(e2);
  });
});

// ─── renderTable ──────────────────────────────────────────────────────────────

describe("renderTable", () => {
  it("always contains PREFLIGHT in the header", () => {
    setState({ preflight: true });
    const output = preflightReport.renderTable();
    expect(output).toContain("PREFLIGHT");
  });

  it("includes phase names when entries have been recorded", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "m1" });
    preflightReport.record({ phase: "Content", action: "update", name: "c1" });

    const output = preflightReport.renderTable();
    expect(output).toContain("Models");
    expect(output).toContain("Content");
  });

  it("includes item names in the output", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "unique-model-name" });

    const output = preflightReport.renderTable();
    expect(output).toContain("unique-model-name");
  });

  it("includes a conflict warning when conflicts exist", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Content", action: "conflict", name: "conflicted-item" });

    const output = preflightReport.renderTable();
    expect(output).toContain("Conflicts detected");
  });

  it("does NOT include conflict warning when there are no conflicts", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "m1" });
    preflightReport.record({ phase: "Content", action: "skip", name: "c1" });

    const output = preflightReport.renderTable();
    expect(output).not.toContain("Conflicts detected");
  });

  it("indicates nothing to do when there are no entries", () => {
    setState({ preflight: true });
    const output = preflightReport.renderTable();
    expect(output).toContain("Nothing to do");
  });

  it("includes count totals in the footer", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "m1" });
    preflightReport.record({ phase: "Models", action: "update", name: "m2" });

    const output = preflightReport.renderTable();
    expect(output).toContain("TOTAL");
  });
});

// ─── print ────────────────────────────────────────────────────────────────────

describe("print", () => {
  it("outputs the rendered table", () => {
    setState({ preflight: true });
    preflightReport.record({ phase: "Models", action: "create", name: "m1" });

    preflightReport.print();

    const allOutput = (console.log as jest.Mock).mock.calls.flat().join("\n");
    expect(allOutput).toContain("PREFLIGHT");
    expect(allOutput).toContain("TOTAL");
  });
});
