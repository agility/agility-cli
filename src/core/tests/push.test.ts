import { Push, hasBlockingAutoPublishErrors } from "../push";
import { resetState, setState } from "../state";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── Constructor ──────────────────────────────────────────────────────────────

describe("Push constructor", () => {
  it("creates an instance without throwing", () => {
    expect(() => new Push()).not.toThrow();
  });
});

// ─── pushInstances – guard clauses ───────────────────────────────────────────

describe("Push.pushInstances", () => {
  it("throws when neither sourceGuid nor targetGuid are set", async () => {
    const push = new Push();
    await expect(push.pushInstances()).rejects.toThrow("No source or target GUID specified");
  });

  it("resolves (passes the GUID guard) when sourceGuid and targetGuid are both set", async () => {
    setState({ sourceGuid: "source-guid-u", targetGuid: "target-guid-u" });
    const push = new Push();
    // Should not throw the GUID guard error — it may resolve or fail later for other reasons
    const result = await push.pushInstances().catch((err: Error) => err);
    if (result instanceof Error) {
      expect(result.message).not.toContain("No source or target GUID specified");
    } else {
      expect(result).toBeDefined();
    }
  });
});

// ─── PROD-2310: auto-publish errors feed the exit code ───────────────────────

describe("hasBlockingAutoPublishErrors", () => {
  it("returns false for an empty error set", () => {
    expect(hasBlockingAutoPublishErrors([])).toBe(false);
  });

  it("returns true when a real publish failure is present", () => {
    expect(
      hasBlockingAutoPublishErrors([{ locale: "en-us", type: "publish", error: "boom" }])
    ).toBe(true);
  });

  it("returns true when a fatal auto-publish error is present", () => {
    expect(hasBlockingAutoPublishErrors([{ locale: "all", type: "fatal", error: "crash" }])).toBe(true);
  });

  it("does not treat post-publish bookkeeping (mapping/refresh) as blocking", () => {
    expect(
      hasBlockingAutoPublishErrors([
        { locale: "en-us", type: "mapping", error: "stale" },
        { locale: "en-us", type: "refresh", error: "skipped" },
      ])
    ).toBe(false);
  });

  it("returns true when a real failure is mixed with bookkeeping errors", () => {
    expect(
      hasBlockingAutoPublishErrors([
        { locale: "en-us", type: "mapping", error: "stale" },
        { locale: "en-us", type: "publish", error: "boom" },
      ])
    ).toBe(true);
  });
});

// ─── --jsonSummary: the run is written as a machine-readable artifact ─────────

describe("Push.pushInstances — --jsonSummary", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");

  let tmp: string;

  /**
   * Drive pushInstances without touching the network: stub the pull, and have the
   * orchestrator return a canned PushResults so only the summary path is under test.
   */
  async function runPush(pushResults: any[], extraState: Record<string, any> = {}) {
    const { Pull } = require("../pull");
    jest.spyOn(Pull.prototype, "pullInstances").mockResolvedValue(undefined as any);

    const { Pushers } = require("../../lib/pushers/orchestrate-pushers");
    jest.spyOn(Pushers.prototype, "instanceOrchestrator").mockResolvedValue(pushResults);

    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", ...extraState });
    const push = new Push();
    return push.pushInstances();
  }

  function pushResult(overrides: any = {}) {
    return {
      successful: [],
      failed: [],
      skipped: [],
      totalDuration: 5,
      sourceGuidProcessed: "src-u",
      targetGuidProcessed: "tgt-u",
      totalSuccess: 0,
      totalFailures: 0,
      totalSkipped: 0,
      publishableContentIds: [],
      publishablePageIds: [],
      publishableContentIdsByLocale: new Map(),
      publishablePageIdsByLocale: new Map(),
      failureDetails: [],
      warningDetails: [],
      phases: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agility-push-summary-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.exitCode;
  });

  it("writes nothing when the flag is not set", async () => {
    await runPush([pushResult()]);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it("writes a parseable summary to the given path", async () => {
    const out = path.join(tmp, "summary.json");
    await runPush([pushResult()], { jsonSummary: out });

    expect(fs.existsSync(out)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(parsed.source).toBe("src-u");
    expect(parsed.target).toBe("tgt-u");
    expect(parsed.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it("carries the per-phase breakdown through from the orchestrator", async () => {
    const out = path.join(tmp, "summary.json");
    await runPush(
      [
        pushResult({
          phases: [
            { operation: "pushModels", description: "Models", successful: 2, failed: 0, skipped: 1, status: "success" },
            { operation: "pushContent", description: "Content", locale: "en-us", successful: 5, failed: 1, skipped: 0, status: "error" },
          ],
        }),
      ],
      { jsonSummary: out }
    );

    const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(parsed.phases).toHaveLength(2);
    expect(parsed.totals).toEqual({ successful: 7, failed: 1, skipped: 1 });
    expect(parsed.phases[1].locale).toBe("en-us");
  });

  it("records item-level failure details behind the counts", async () => {
    const out = path.join(tmp, "summary.json");
    await runPush(
      [
        pushResult({
          totalFailures: 1,
          failureDetails: [{ name: "Broken", error: "no mapping", type: "page", pageID: 7 }],
        }),
      ],
      { jsonSummary: out }
    );

    const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(parsed.failures).toEqual([{ name: "Broken", error: "no mapping", type: "page", pageID: 7 }]);
  });

  it("records non-blocking warnings separately from failures (PROD-2316)", async () => {
    const out = path.join(tmp, "summary.json");
    await runPush(
      [pushResult({ warningDetails: [{ name: "Home", error: "Dropped Component Hero — unresolved" }] })],
      { jsonSummary: out }
    );

    const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.failures).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("records preflight as null when preflight did not run", async () => {
    const out = path.join(tmp, "summary.json");
    await runPush([pushResult()], { jsonSummary: out });
    expect(JSON.parse(fs.readFileSync(out, "utf8")).preflight).toBeNull();
  });

  it("includes the preflight plan when preflight ran", async () => {
    const out = path.join(tmp, "summary.json");
    await runPush([pushResult()], { jsonSummary: out, preflight: true });

    const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(parsed.preflight).not.toBeNull();
    expect(parsed.options.preflight).toBe(true);
  });

  it("creates parent directories that do not exist yet", async () => {
    const out = path.join(tmp, "reports", "nested", "summary.json");
    await runPush([pushResult()], { jsonSummary: out });
    expect(fs.existsSync(out)).toBe(true);
  });

  it("records the CLI version, which the push log does not carry", async () => {
    const out = path.join(tmp, "summary.json");
    await runPush([pushResult()], { jsonSummary: out });
    expect(JSON.parse(fs.readFileSync(out, "utf8")).run.cliVersion).not.toBe("unknown");
  });

  it("still writes a summary when the orchestrator throws", async () => {
    // The crash path is exactly when a machine-readable record matters most.
    const out = path.join(tmp, "summary.json");
    const { Pull } = require("../pull");
    jest.spyOn(Pull.prototype, "pullInstances").mockResolvedValue(undefined as any);
    const { Pushers } = require("../../lib/pushers/orchestrate-pushers");
    jest.spyOn(Pushers.prototype, "instanceOrchestrator").mockRejectedValue(new Error("Model validation failed"));

    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", jsonSummary: out });
    await expect(new Push().pushInstances()).rejects.toThrow("Model validation failed");

    const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(parsed.success).toBe(false);
    expect(parsed.exitCode).toBe(1);
    expect(parsed.phases).toEqual([]);
    expect(parsed.operationErrors).toEqual([{ type: "fatal", error: "Model validation failed" }]);
  });

  it("does not fail the run when the summary path cannot be written", async () => {
    // A reporting artifact must never turn a good sync into a failure.
    const blocker = path.join(tmp, "not-a-dir");
    fs.writeFileSync(blocker, "x");

    const result = await runPush([pushResult()], { jsonSummary: path.join(blocker, "summary.json") });

    expect(result.success).toBe(true);
  });
});
