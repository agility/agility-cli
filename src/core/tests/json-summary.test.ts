import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildJsonSummary,
  writeJsonSummary,
  resolveCliVersion,
  JSON_SUMMARY_SCHEMA_VERSION,
  BuildJsonSummaryInput,
  JsonSummaryPhase,
} from "../json-summary";

/** A complete, boring input. Individual tests override only the field under test. */
function makeInput(overrides: Partial<BuildJsonSummaryInput> = {}): BuildJsonSummaryInput {
  return {
    command: "sync",
    success: true,
    exitCode: 0,
    source: "source-u",
    target: "target-u",
    options: {
      preflight: false,
      overwrite: false,
      autoPublish: "",
      elements: ["Models", "Content"],
      locales: ["en-us"],
      channel: "website",
    },
    phases: [],
    failures: [],
    warnings: [],
    operationErrors: [],
    autoPublishErrors: [],
    preflight: null,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    finishedAt: new Date("2026-01-01T00:00:10.000Z"),
    elapsedMs: 10_000,
    logFiles: [],
    cliVersion: "1.2.3-test",
    ...overrides,
  };
}

function phase(overrides: Partial<JsonSummaryPhase> = {}): JsonSummaryPhase {
  return {
    operation: "pushModels",
    description: "Push content models and field definitions",
    successful: 0,
    failed: 0,
    skipped: 0,
    status: "success",
    ...overrides,
  };
}

// ─── buildJsonSummary — totals ───────────────────────────────────────────────

describe("buildJsonSummary — totals", () => {
  it("sums counts across every phase", () => {
    const summary = buildJsonSummary(
      makeInput({
        phases: [
          phase({ operation: "pushModels", successful: 3, failed: 1, skipped: 2 }),
          phase({ operation: "pushContainers", successful: 5, failed: 0, skipped: 1 }),
          phase({ operation: "pushContent", locale: "en-us", successful: 10, failed: 2, skipped: 0 }),
        ],
      })
    );

    expect(summary.totals).toEqual({ successful: 18, failed: 3, skipped: 3 });
  });

  it("returns zeroed totals when no phase ran", () => {
    expect(buildJsonSummary(makeInput({ phases: [] })).totals).toEqual({
      successful: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("counts a locale-scoped phase once per locale rather than collapsing it", () => {
    const summary = buildJsonSummary(
      makeInput({
        phases: [
          phase({ operation: "pushContent", locale: "en-us", successful: 4 }),
          phase({ operation: "pushContent", locale: "fr-ca", successful: 6 }),
        ],
      })
    );

    expect(summary.phases).toHaveLength(2);
    expect(summary.totals.successful).toBe(10);
  });
});

// ─── buildJsonSummary — the success/failed disagreement is preserved ─────────

describe("buildJsonSummary — success signal", () => {
  // The run's verdict and its item counts are computed independently, so they can disagree.
  // The summary records both rather than deriving one from the other, letting a consumer
  // compare them instead of trusting whichever this file picked.
  it("keeps a reported success even when phases recorded failures", () => {
    const summary = buildJsonSummary(
      makeInput({ success: true, exitCode: 0, phases: [phase({ failed: 7 })] })
    );

    expect(summary.success).toBe(true);
    expect(summary.exitCode).toBe(0);
    expect(summary.totals.failed).toBe(7);
  });

  it("records a non-zero exit code verbatim", () => {
    expect(buildJsonSummary(makeInput({ success: false, exitCode: 1 })).exitCode).toBe(1);
  });
});

// ─── buildJsonSummary — auto-publish split (PROD-2311) ──────────────────────

describe("buildJsonSummary — auto-publish classification", () => {
  it("separates blocking publish failures from post-publish bookkeeping", () => {
    const summary = buildJsonSummary(
      makeInput({
        autoPublishErrors: [
          { type: "publish", error: "publish failed", locale: "en-us" },
          { type: "fatal", error: "crashed" },
          { type: "mapping", error: "mapping refresh skipped" },
          { type: "refresh", error: "target refresh failed" },
        ],
      })
    );

    expect(summary.autoPublish.errors.map((e) => e.type)).toEqual(["publish", "fatal"]);
    expect(summary.autoPublish.warnings.map((e) => e.type)).toEqual(["mapping", "refresh"]);
  });

  it("yields empty groups when auto-publish reported nothing", () => {
    const summary = buildJsonSummary(makeInput({ autoPublishErrors: [] }));
    expect(summary.autoPublish).toEqual({ errors: [], warnings: [] });
  });
});

// ─── buildJsonSummary — shape guarantees the harnesses rely on ──────────────

describe("buildJsonSummary — shape", () => {
  it("stamps the schema version", () => {
    expect(buildJsonSummary(makeInput()).schemaVersion).toBe(JSON_SUMMARY_SCHEMA_VERSION);
  });

  it("quarantines every volatile field under `run`, so golden files can drop one key", () => {
    const a = buildJsonSummary(
      makeInput({
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:10.000Z"),
        elapsedMs: 10_000,
        logFiles: ["/tmp/run-a.txt"],
        cliVersion: "1.0.0",
      })
    );
    const b = buildJsonSummary(
      makeInput({
        startedAt: new Date("2026-06-06T12:00:00.000Z"),
        finishedAt: new Date("2026-06-06T12:09:59.000Z"),
        elapsedMs: 999,
        logFiles: ["/tmp/run-b.txt"],
        cliVersion: "2.0.0",
      })
    );

    const { run: _runA, ...restA } = a;
    const { run: _runB, ...restB } = b;
    expect(restA).toEqual(restB);
    expect(a.run).not.toEqual(b.run);
  });

  it("records preflight as null when preflight did not run", () => {
    expect(buildJsonSummary(makeInput({ preflight: null })).preflight).toBeNull();
  });

  it("carries the preflight plan through when it did", () => {
    const summary = buildJsonSummary(
      makeInput({
        preflight: {
          totals: { create: 2, update: 1, skip: 0, conflict: 1 },
          hasConflicts: true,
          phases: [{ phase: "Models", create: 2, update: 1, skip: 0, conflict: 1 }],
          entries: [{ phase: "Models", action: "conflict", name: "LinkCard" }],
        },
      })
    );

    expect(summary.preflight?.hasConflicts).toBe(true);
    expect(summary.preflight?.totals.create).toBe(2);
  });

  it("distinguishes a phase that never ran from one that ran and did nothing", () => {
    const summary = buildJsonSummary(
      makeInput({
        phases: [
          phase({ operation: "pushAssets", status: "notRun" }),
          phase({ operation: "pushModels", status: "success" }),
        ],
      })
    );

    expect(summary.phases.map((p) => p.status)).toEqual(["notRun", "success"]);
    // Both contribute zero — status is the only thing that tells them apart.
    expect(summary.totals).toEqual({ successful: 0, failed: 0, skipped: 0 });
  });

  it("serializes to JSON without loss", () => {
    const summary = buildJsonSummary(
      makeInput({
        phases: [phase({ successful: 1 })],
        failures: [{ name: "Broken", error: "no mapping", type: "page", pageID: 7 }],
      })
    );

    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});

// ─── writeJsonSummary ────────────────────────────────────────────────────────

describe("writeJsonSummary", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agility-json-summary-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes parseable JSON to the given path", () => {
    const target = path.join(tmp, "summary.json");
    const result = writeJsonSummary(target, buildJsonSummary(makeInput()));

    expect(result.written).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(parsed.schemaVersion).toBe(JSON_SUMMARY_SCHEMA_VERSION);
    expect(parsed.source).toBe("source-u");
  });

  it("creates missing parent directories", () => {
    const target = path.join(tmp, "nested", "deeper", "summary.json");
    expect(writeJsonSummary(target, buildJsonSummary(makeInput())).written).toBe(true);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("ends the file with a newline", () => {
    const target = path.join(tmp, "summary.json");
    writeJsonSummary(target, buildJsonSummary(makeInput()));
    expect(fs.readFileSync(target, "utf8").endsWith("\n")).toBe(true);
  });

  it("reports failure instead of throwing when the path cannot be written", () => {
    // A path whose parent is an existing *file* can never be a directory.
    const blocker = path.join(tmp, "not-a-dir");
    fs.writeFileSync(blocker, "x");
    const target = path.join(blocker, "summary.json");

    const result = writeJsonSummary(target, buildJsonSummary(makeInput()));

    expect(result.written).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ─── resolveCliVersion ───────────────────────────────────────────────────────

describe("resolveCliVersion", () => {
  it("finds the package version by walking up from the module", () => {
    // The log file carries no version today, so a CI artifact cannot say which CLI produced
    // it. This is the field that closes that gap — it must not silently degrade.
    expect(resolveCliVersion()).not.toBe("unknown");
  });

  it("returns a version string", () => {
    expect(typeof resolveCliVersion()).toBe("string");
    expect(resolveCliVersion().length).toBeGreaterThan(0);
  });
});

// ─── buildAbortSummary / emitAbortSummary ────────────────────────────────────

describe("buildAbortSummary", () => {
  const { buildAbortSummary, emitAbortSummary } = require("../json-summary");

  function abortInput(overrides: any = {}) {
    return {
      command: "sync" as const,
      reason: "Authentication failed",
      source: "src-u",
      target: "tgt-u",
      options: {
        preflight: false,
        overwrite: false,
        autoPublish: "",
        elements: ["Models"],
        locales: [],
        channel: "website",
      },
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      cliVersion: "1.2.3-test",
      ...overrides,
    };
  }

  it("reports failure with a non-zero exit code", () => {
    const summary = buildAbortSummary(abortInput());
    expect(summary.success).toBe(false);
    expect(summary.exitCode).toBe(1);
  });

  it("records the reason as an operation-level abort", () => {
    const summary = buildAbortSummary(abortInput({ reason: "no such instance" }));
    expect(summary.operationErrors).toEqual([{ type: "abort", error: "no such instance" }]);
  });

  it("emits zero phases, which is how a harness tells an abort from a real run", () => {
    const summary = buildAbortSummary(abortInput());
    expect(summary.phases).toEqual([]);
    expect(summary.totals).toEqual({ successful: 0, failed: 0, skipped: 0 });
  });

  it("uses the same schema as a completed run", () => {
    expect(buildAbortSummary(abortInput()).schemaVersion).toBe(JSON_SUMMARY_SCHEMA_VERSION);
  });

  describe("emitAbortSummary", () => {
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agility-abort-summary-"));
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("no-ops when the flag is not set", () => {
      expect(emitAbortSummary({ isSync: true }, "boom").written).toBe(false);
    });

    it("writes a summary from the run state when the flag is set", () => {
      const out = path.join(tmp, "abort.json");
      const result = emitAbortSummary(
        { jsonSummary: out, isSync: true, sourceGuid: "src-u", targetGuid: "tgt-u", elements: "Models,Content" },
        "Authentication failed"
      );

      expect(result.written).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
      expect(parsed.command).toBe("sync");
      expect(parsed.source).toBe("src-u");
      expect(parsed.options.elements).toEqual(["Models", "Content"]);
      expect(parsed.operationErrors[0].error).toBe("Authentication failed");
    });

    it("records the command as push when the run was not a sync", () => {
      const out = path.join(tmp, "abort.json");
      emitAbortSummary({ jsonSummary: out, isSync: false }, "boom");
      expect(JSON.parse(fs.readFileSync(out, "utf8")).command).toBe("push");
    });

    it("reports a write failure rather than throwing", () => {
      const blocker = path.join(tmp, "not-a-dir");
      fs.writeFileSync(blocker, "x");
      const result = emitAbortSummary({ jsonSummary: path.join(blocker, "abort.json") }, "boom");
      expect(result.written).toBe(false);
    });
  });
});
