import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state } from "core/state";
import { Pushers } from "../orchestrate-pushers";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-orch-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── constructor ──────────────────────────────────────────────────────────────

describe("Pushers constructor", () => {
  it("constructs without throwing with no config", () => {
    expect(() => new Pushers()).not.toThrow();
  });

  it("constructs without throwing with empty config", () => {
    expect(() => new Pushers({})).not.toThrow();
  });

  it("constructs without throwing with onOperationStart callback", () => {
    const config = { onOperationStart: jest.fn() };
    expect(() => new Pushers(config)).not.toThrow();
  });

  it("constructs without throwing when state has sourceGuid set", () => {
    setState({ sourceGuid: "src-guid-u", targetGuid: "tgt-guid-u" });
    expect(() => new Pushers()).not.toThrow();
  });
});

// ─── getPushSummary ───────────────────────────────────────────────────────────

describe("Pushers.getPushSummary", () => {
  it("returns summary shape with expected keys", () => {
    const pushers = new Pushers();
    const summary = pushers.getPushSummary();

    expect(summary).toHaveProperty("totalOperations");
    expect(summary).toHaveProperty("successfulOperations");
    expect(summary).toHaveProperty("failedOperations");
    expect(summary).toHaveProperty("overallSuccess");
    expect(summary).toHaveProperty("duration");
  });

  it("returns overallSuccess as true by default", () => {
    const pushers = new Pushers();
    const summary = pushers.getPushSummary();
    expect(summary.overallSuccess).toBe(true);
  });

  it("returns non-negative duration", () => {
    const pushers = new Pushers();
    const summary = pushers.getPushSummary();
    expect(summary.duration).toBeGreaterThanOrEqual(0);
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe("Pushers.reset", () => {
  it("does not throw when called", () => {
    const pushers = new Pushers();
    expect(() => pushers.reset()).not.toThrow();
  });

  it("duration increases after reset + time passes", () => {
    const pushers = new Pushers();
    const summaryBefore = pushers.getPushSummary();
    pushers.reset();
    const summaryAfter = pushers.getPushSummary();
    // Both should be >= 0 and after reset the startTime is fresh
    expect(summaryAfter.duration).toBeGreaterThanOrEqual(0);
  });
});

// ─── updateConfig ─────────────────────────────────────────────────────────────

describe("Pushers.updateConfig", () => {
  it("does not throw when updating config", () => {
    const pushers = new Pushers();
    expect(() => pushers.updateConfig({ onOperationStart: jest.fn() })).not.toThrow();
  });

  it("allows partial config updates", () => {
    const cb = jest.fn();
    const pushers = new Pushers({ onOperationComplete: cb });
    expect(() => pushers.updateConfig({ onOperationStart: jest.fn() })).not.toThrow();
  });
});

// ─── instanceOrchestrator — guard clause: missing GUIDs ──────────────────────

describe("Pushers.instanceOrchestrator — guard clause", () => {
  it("throws when no sourceGuid is set", async () => {
    const pushers = new Pushers();
    // state has no sourceGuid after resetState
    await expect(pushers.instanceOrchestrator()).rejects.toThrow(/No source or target GUIDs/);
  });

  it("throws when no targetGuid is set", async () => {
    setState({ sourceGuid: "src-guid-u" });
    const pushers = new Pushers();
    await expect(pushers.instanceOrchestrator()).rejects.toThrow(/No source or target GUIDs/);
  });
});

// ─── executePushOperation — skips on empty data ───────────────────────────────

describe("Pushers.executePushOperation — empty data skip", () => {
  it("returns zero counts when elementData is empty array", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u" });
    const pushers = new Pushers();

    const { PUSH_OPERATIONS } = await import("../push-operations-config");
    const config = PUSH_OPERATIONS.models;

    const emptySource: any = {
      pages: [],
      templates: [],
      containers: [],
      lists: [],
      models: [],
      content: [],
      assets: [],
      galleries: [],
    };
    const emptyTarget: any = { ...emptySource };

    const result = await pushers.executePushOperation({
      config,
      sourceData: emptySource,
      targetData: emptyTarget,
      locale: "en-us",
      elements: ["Models"],
    });

    expect(result.success).toBe(0);
    expect(result.failures).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("returns zero counts when element is not in requested elements", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u" });
    const pushers = new Pushers();

    const { PUSH_OPERATIONS } = await import("../push-operations-config");
    const config = PUSH_OPERATIONS.models;

    const sourceData: any = {
      pages: [],
      templates: [],
      containers: [],
      lists: [],
      models: [{ id: 1, referenceName: "TestModel" }],
      content: [],
      assets: [],
      galleries: [],
    };

    const result = await pushers.executePushOperation({
      config,
      sourceData,
      targetData: { ...sourceData },
      locale: "en-us",
      elements: ["Pages"], // Models not in requested elements
    });

    expect(result.success).toBe(0);
    expect(result.failures).toBe(0);
  });
});

// ─── executePushOperation — callbacks ─────────────────────────────────────────

describe("Pushers.executePushOperation — callbacks", () => {
  it("calls onOperationStart when data is non-empty", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u" });
    const onOperationStart = jest.fn();
    const pushers = new Pushers({ onOperationStart });

    const { PUSH_OPERATIONS } = await import("../push-operations-config");
    const config = {
      ...PUSH_OPERATIONS.models,
      handler: jest.fn().mockResolvedValue({ status: "success", successful: 0, failed: 0, skipped: 0 }),
    };

    const sourceData: any = {
      pages: [],
      templates: [],
      containers: [],
      lists: [],
      models: [{ id: 1, referenceName: "TestModel" }],
      content: [],
      assets: [],
      galleries: [],
    };

    await pushers.executePushOperation({
      config,
      sourceData,
      targetData: { ...sourceData },
      locale: "en-us",
      elements: ["Models"],
    });

    expect(onOperationStart).toHaveBeenCalledWith("pushModels", "src-u", "tgt-u");
  });

  it("calls onOperationComplete when data is non-empty", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u" });
    const onOperationComplete = jest.fn();
    const pushers = new Pushers({ onOperationComplete });

    const { PUSH_OPERATIONS } = await import("../push-operations-config");
    const config = {
      ...PUSH_OPERATIONS.models,
      handler: jest.fn().mockResolvedValue({ status: "success", successful: 1, failed: 0, skipped: 0 }),
    };

    const sourceData: any = {
      pages: [],
      templates: [],
      containers: [],
      lists: [],
      models: [{ id: 1, referenceName: "TestModel" }],
      content: [],
      assets: [],
      galleries: [],
    };

    await pushers.executePushOperation({
      config,
      sourceData,
      targetData: { ...sourceData },
      locale: "en-us",
      elements: ["Models"],
    });

    expect(onOperationComplete).toHaveBeenCalledWith("pushModels", "src-u", "tgt-u", true);
  });
});

// ─── PROD-2202: models pushed first (validation fails fast, before galleries/assets) ─────

describe("Pushers.instanceOrchestrator — models-first ordering (PROD-2202)", () => {
  // Non-empty data for every element type so every push operation is actually invoked
  // (executePushOperation skips an op whose dataKey array is empty).
  function makeEntities(): any {
    return {
      pages: [{ pageID: 1 }],
      templates: [{ pageTemplateID: 1, pageTemplateName: "T" }],
      containers: [{ contentViewID: 1 }],
      lists: [],
      models: [{ id: 1, referenceName: "ModelA" }],
      content: [{ contentID: 1 }],
      assets: [{ mediaID: 1 }],
      galleries: [{ galleryID: 1 }],
    };
  }

  // Replace every real pusher handler with a no-op success so no live push runs, and
  // return the handler-name→spy map so tests can assert which ran (and which did not).
  async function stubAllHandlers(): Promise<Record<string, jest.SpyInstance>> {
    const { PUSH_OPERATIONS } = await import("../push-operations-config");
    const spies: Record<string, jest.SpyInstance> = {};
    for (const key of Object.keys(PUSH_OPERATIONS)) {
      spies[PUSH_OPERATIONS[key].name] = jest
        .spyOn(PUSH_OPERATIONS[key], "handler")
        .mockResolvedValue({ status: "success", successful: 0, failed: 0, skipped: 0 } as any);
    }
    return spies;
  }

  async function stubDataLoader(): Promise<void> {
    const { GuidDataLoader } = await import("../guid-data-loader");
    jest.spyOn(GuidDataLoader.prototype, "loadGuidEntities").mockResolvedValue(makeEntities());
  }

  it("invokes the models push before galleries and assets", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us" });
    await stubDataLoader();
    await stubAllHandlers();

    const order: string[] = [];
    const pushers = new Pushers({
      onOperationStart: (name) => order.push(name),
    });

    await pushers.instanceOrchestrator();

    // Models is the very first operation, and precedes both galleries and assets.
    expect(order[0]).toBe("pushModels");
    expect(order.indexOf("pushModels")).toBeLessThan(order.indexOf("pushGalleries"));
    expect(order.indexOf("pushModels")).toBeLessThan(order.indexOf("pushAssets"));
  });

  it("preserves the downstream relative order after models (Models→Galleries→Assets→Containers→…)", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us" });
    await stubDataLoader();
    await stubAllHandlers();

    const order: string[] = [];
    const pushers = new Pushers({ onOperationStart: (name) => order.push(name) });

    await pushers.instanceOrchestrator();

    // Guid-level ops run in this order; content/pages run afterwards in the locale loop.
    expect(order).toEqual([
      "pushModels",
      "pushGalleries",
      "pushAssets",
      "pushContainers",
      "pushTemplates",
      "pushContent",
      "pushPages",
    ]);
  });

  it("a model-validation failure aborts the sync before galleries or assets are pushed", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us" });
    await stubDataLoader();
    const spies = await stubAllHandlers();

    // Models validation halts the sync (the rename/reassignment mismatch surfaced by pushModels).
    spies["pushModels"].mockRejectedValue(new Error("Model validation failed: mapping inconsistency for model"));

    const pushers = new Pushers();
    const results = await pushers.instanceOrchestrator();

    // The models handler ran and threw; galleries/assets were never reached — the target is untouched.
    expect(spies["pushModels"]).toHaveBeenCalledTimes(1);
    expect(spies["pushGalleries"]).not.toHaveBeenCalled();
    expect(spies["pushAssets"]).not.toHaveBeenCalled();

    // The failure is recorded on the guid orchestration result and carries the validation message.
    expect(results[0].failed).toEqual([
      expect.objectContaining({
        operation: "guid-orchestration",
        error: expect.stringContaining("Model validation failed"),
      }),
    ]);
  });

  it("a template-validation failure aborts the sync before content or pages are pushed (PROD-1492)", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us" });
    await stubDataLoader();
    const spies = await stubAllHandlers();

    // Templates run as a guid-level op; a mapping inconsistency must halt the sync just like models.
    spies["pushTemplates"].mockRejectedValue(
      new Error('Page template validation failed: mapping inconsistency for template "LeftSideBarTemplate" (ID: 2).')
    );

    const pushers = new Pushers();
    const results = await pushers.instanceOrchestrator();

    // The templates handler ran and threw; content/pages in the locale loop were never reached.
    expect(spies["pushTemplates"]).toHaveBeenCalledTimes(1);
    expect(spies["pushContent"]).not.toHaveBeenCalled();
    expect(spies["pushPages"]).not.toHaveBeenCalled();

    // The failure is recorded on the guid orchestration result and carries the validation message.
    expect(results[0].failed).toEqual([
      expect.objectContaining({
        operation: "guid-orchestration",
        error: expect.stringContaining("Page template validation failed"),
      }),
    ]);
  });
});
