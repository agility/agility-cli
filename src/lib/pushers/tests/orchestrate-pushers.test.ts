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
    await expect(pushers.instanceOrchestrator()).rejects.toThrow(/No source or target GUID/);
  });

  it("throws when no targetGuid is set", async () => {
    setState({ sourceGuid: "src-guid-u" });
    const pushers = new Pushers();
    await expect(pushers.instanceOrchestrator()).rejects.toThrow(/No source or target GUID/);
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

// ─── selective page sync (PROD-2546) ───────────────────────────────────────

describe("Pushers.instanceOrchestrator — --pages scope", () => {
  function makeEntities(): any {
    return {
      pages: [{ pageID: 10 }],
      templates: [{ pageTemplateID: 1, pageTemplateName: "T" }],
      containers: [{ contentViewID: 1 }],
      lists: [],
      models: [{ id: 1, referenceName: "ModelA" }],
      content: [{ contentID: 1 }],
      assets: [{ mediaID: 1 }],
      galleries: [{ galleryID: 1 }],
      urlRedirections: [],
    };
  }

  async function stubAllHandlers(): Promise<void> {
    const { PUSH_OPERATIONS } = await import("../push-operations-config");
    for (const key of Object.keys(PUSH_OPERATIONS)) {
      jest
        .spyOn(PUSH_OPERATIONS[key], "handler")
        .mockResolvedValue({ status: "success", successful: 0, failed: 0, skipped: 0 } as any);
    }
  }

  async function stubDataLoader(): Promise<jest.SpyInstance> {
    const { GuidDataLoader } = await import("../guid-data-loader");
    return jest.spyOn(GuidDataLoader.prototype, "loadGuidEntities").mockResolvedValue(makeEntities());
  }

  /** A sitemap with one root-level page (no ancestors, so no mapping is required). */
  async function stubSitemaps(): Promise<void> {
    const { SitemapHierarchy } = await import("../page-pusher/sitemap-hierarchy");
    jest.spyOn(SitemapHierarchy.prototype, "loadAllSitemaps").mockReturnValue({
      website: [
        {
          title: "My Lottery",
          name: "my-lottery",
          pageID: 10,
          menuText: "My Lottery",
          visible: { menu: true, sitemap: true },
          path: "/my-lottery",
          redirect: null,
          isFolder: false,
        },
      ],
    } as any);
  }

  it("rejects --pages combined with --models", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us", pages: "/my-lottery", models: "ModelA" });
    await stubDataLoader();
    await stubAllHandlers();
    await stubSitemaps();

    const results = await new Pushers().instanceOrchestrator();

    expect(results[0].failed[0].error).toMatch(/cannot be combined with --models/);
  });

  it("rejects --pages combined with --models-with-deps", async () => {
    setState({
      sourceGuid: "src-u",
      targetGuid: "tgt-u",
      locales: "en-us",
      pages: "/my-lottery",
      modelsWithDeps: "ModelA",
    });
    await stubDataLoader();
    await stubAllHandlers();
    await stubSitemaps();

    const results = await new Pushers().instanceOrchestrator();

    expect(results[0].failed[0].error).toMatch(/cannot be combined with --models/);
  });

  it("aborts before any pusher runs when a selector matches no page", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us", pages: "/typo" });
    await stubDataLoader();
    await stubAllHandlers();
    await stubSitemaps();

    const started: string[] = [];
    const results = await new Pushers({ onOperationStart: (name) => started.push(name) }).instanceOrchestrator();

    expect(results[0].failed[0].error).toMatch(/No page matched/);
    expect(started).toEqual([]);
  });

  it("hands the resolved scope to the source data loader, but not the target one", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us", pages: "/my-lottery" });
    const loadSpy = await stubDataLoader();
    await stubAllHandlers();
    await stubSitemaps();

    await new Pushers().instanceOrchestrator();

    const withScope = loadSpy.mock.calls.filter((call) => (call[1] as any)?.pageScope);
    const withoutScope = loadSpy.mock.calls.filter((call) => !(call[1] as any)?.pageScope);
    expect(withScope.length).toBeGreaterThan(0);
    expect(withoutScope.length).toBeGreaterThan(0);
    expect((withScope[0][1] as any).pageScope.allPageIDs.has(10)).toBe(true);
  });

  it("publishes the resolved scope on state so the page pusher can narrow its sitemap walk", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us", pages: "/my-lottery" });
    await stubDataLoader();
    await stubAllHandlers();
    await stubSitemaps();

    await new Pushers().instanceOrchestrator();

    expect(Array.from(state.pageScope!.byLocale.get("en-us")!.pageIDs)).toEqual([10]);
  });

  it("prints the page tree before any pusher runs", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us", pages: "/my-lottery" });
    await stubDataLoader();
    await stubAllHandlers();
    await stubSitemaps();

    const logSpy = jest.spyOn(console, "log");
    let printedBeforeFirstPush: string | null = null;
    await new Pushers({
      onOperationStart: () => {
        if (printedBeforeFirstPush === null) {
          printedBeforeFirstPush = logSpy.mock.calls.map((c) => String(c[0])).join(" | ");
        }
      },
    }).instanceOrchestrator();

    expect(printedBeforeFirstPush).toContain("PAGE SCOPE");
    expect(printedBeforeFirstPush).toContain("/my-lottery");
  });

  it("leaves the loader unfiltered when --pages is not set", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us" });
    const loadSpy = await stubDataLoader();
    await stubAllHandlers();

    await new Pushers().instanceOrchestrator();

    expect(loadSpy.mock.calls.every((call) => call[1] === undefined)).toBe(true);
    expect(state.pageScope).toBeUndefined();
  });
});

// ─── selective container sync (PROD-2547) ──────────────────────────────────

describe("Pushers.instanceOrchestrator — --containers scope", () => {
  const CONTAINERS = [
    { contentViewID: 200, contentDefinitionID: 10, referenceName: "AONHomeLinks", title: "AON Home Links" },
    {
      contentViewID: 201,
      contentDefinitionID: 10,
      referenceName: "MegaMillionsHomeLinks",
      title: "Mega Millions Home Links",
    },
  ];

  function makeEntities(): any {
    return {
      pages: [],
      templates: [],
      containers: CONTAINERS,
      lists: [],
      models: [{ id: 10, referenceName: "HomeLinks" }],
      content: [{ contentID: 1, properties: { definitionName: "HomeLinks", referenceName: "AONHomeLinks" } }],
      assets: [],
      galleries: [],
      urlRedirections: [],
    };
  }

  async function stubAllHandlers(): Promise<void> {
    const { PUSH_OPERATIONS } = await import("../push-operations-config");
    for (const key of Object.keys(PUSH_OPERATIONS)) {
      jest
        .spyOn(PUSH_OPERATIONS[key], "handler")
        .mockResolvedValue({ status: "success", successful: 0, failed: 0, skipped: 0 } as any);
    }
  }

  async function stubDataLoader(): Promise<jest.SpyInstance> {
    const { GuidDataLoader } = await import("../guid-data-loader");
    // The scope resolver builds its trees from the unfiltered load, so both entry points are stubbed.
    jest.spyOn(GuidDataLoader.prototype, "loadCompleteGuidEntities").mockResolvedValue(makeEntities());
    return jest.spyOn(GuidDataLoader.prototype, "loadGuidEntities").mockResolvedValue(makeEntities());
  }

  it("rejects --containers combined with --models", async () => {
    setState({
      sourceGuid: "src-u",
      targetGuid: "tgt-u",
      locales: "en-us",
      containers: "AONHomeLinks",
      models: "HomeLinks",
    });
    await stubDataLoader();
    await stubAllHandlers();

    const results = await new Pushers().instanceOrchestrator();

    expect(results[0].failed[0].error).toMatch(/cannot be combined with --models/);
  });

  it("rejects --containers combined with --models-with-deps", async () => {
    setState({
      sourceGuid: "src-u",
      targetGuid: "tgt-u",
      locales: "en-us",
      containers: "AONHomeLinks",
      modelsWithDeps: "HomeLinks",
    });
    await stubDataLoader();
    await stubAllHandlers();

    const results = await new Pushers().instanceOrchestrator();

    expect(results[0].failed[0].error).toMatch(/cannot be combined with --models/);
  });

  it("rejects --containers combined with --pages", async () => {
    setState({
      sourceGuid: "src-u",
      targetGuid: "tgt-u",
      locales: "en-us",
      containers: "AONHomeLinks",
      pages: "/my-lottery",
    });
    await stubDataLoader();
    await stubAllHandlers();

    const results = await new Pushers().instanceOrchestrator();

    expect(results[0].failed[0].error).toMatch(/cannot be combined with --containers/);
  });

  it("aborts before any pusher runs when a selector matches no container", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us", containers: "NoSuchContainer" });
    await stubDataLoader();
    await stubAllHandlers();

    const started: string[] = [];
    const results = await new Pushers({
      onOperationStart: (name: string) => started.push(name),
    }).instanceOrchestrator();

    expect(results[0].failed[0].error).toMatch(/Container validation failed/);
    expect(started).toEqual([]);
  });

  it("hands the resolved scope to the source data loader, but not the target one", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us", containers: "AONHomeLinks" });
    const loadSpy = await stubDataLoader();
    await stubAllHandlers();

    await new Pushers().instanceOrchestrator();

    const withScope = loadSpy.mock.calls.filter((call) => (call[1] as any)?.containerScope);
    const withoutScope = loadSpy.mock.calls.filter((call) => !(call[1] as any)?.containerScope);
    expect(withScope.length).toBeGreaterThan(0);
    expect(withoutScope.length).toBeGreaterThan(0);
    expect((withScope[0][1] as any).containerScope.allContainerIDs.has(200)).toBe(true);
  });

  it("resolves the named container and reports the sibling it leaves behind", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us", containers: "AONHomeLinks" });
    const loadSpy = await stubDataLoader();
    await stubAllHandlers();

    await new Pushers().instanceOrchestrator();

    const scope = loadSpy.mock.calls.find((call) => (call[1] as any)?.containerScope)?.[1] as any;
    expect(scope.containerScope.matches.map((m: any) => m.contentViewID)).toEqual([200]);
    expect(scope.containerScope.siblings.map((s: any) => s.contentViewID)).toEqual([201]);
  });

  it("prints the container scope before any pusher runs", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us", containers: "AONHomeLinks" });
    await stubDataLoader();
    await stubAllHandlers();

    const logSpy = jest.spyOn(console, "log");
    let printedBeforeFirstPush: string | null = null;
    await new Pushers({
      onOperationStart: () => {
        if (printedBeforeFirstPush === null) {
          printedBeforeFirstPush = logSpy.mock.calls.map((c) => String(c[0])).join(" | ");
        }
      },
    }).instanceOrchestrator();

    expect(printedBeforeFirstPush).toContain("CONTAINER SCOPE");
    expect(printedBeforeFirstPush).toContain("AON Home Links");
  });

  it("leaves the loader unfiltered when --containers is not set", async () => {
    setState({ sourceGuid: "src-u", targetGuid: "tgt-u", locales: "en-us" });
    const loadSpy = await stubDataLoader();
    await stubAllHandlers();

    await new Pushers().instanceOrchestrator();

    expect(loadSpy.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  });
});
