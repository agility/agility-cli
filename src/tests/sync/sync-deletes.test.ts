/**
 * --syncDeletes end to end: sync, delete something in the source, re-sync with the flag, and the
 * target loses exactly that — through the real orchestrator, mappings and all.
 */
import * as fs from "fs";
import * as path from "path";
import { SyncHarness } from "./helpers/run-sync";
import { installNetworkStubs, InstalledNetworkStubs } from "./helpers/network-stubs";

jest.mock("lib/pushers/batch-polling", () => ({
  pollBatchUntilComplete: jest.fn(),
  extractContentBatchResults: jest.fn(),
  extractPageBatchResults: jest.fn(),
}));

const POST_MODEL = {
  id: 10,
  displayName: "Post",
  referenceName: "Post",
  lastModifiedDate: "2025-01-01T00:00:00.000",
  contentDefinitionTypeName: "Content List",
  fields: [{ type: "Text", name: "Title", label: "Title", required: true }],
};

const AUTHOR_MODEL = {
  id: 11,
  displayName: "Author",
  referenceName: "Author",
  lastModifiedDate: "2025-01-01T00:00:00.000",
  contentDefinitionTypeName: "Content List",
  fields: [{ type: "Text", name: "Name", label: "Name", required: true }],
};

const NEWS_MODEL = {
  id: 12,
  displayName: "News",
  referenceName: "News",
  lastModifiedDate: "2025-01-01T00:00:00.000",
  contentDefinitionTypeName: "Content List",
  fields: [{ type: "Text", name: "Headline", label: "Headline", required: true }],
};

const POSTS_CONTAINER = {
  contentViewID: 200,
  referenceName: "Posts",
  title: "Posts",
  contentDefinitionID: 10,
  contentDefinitionName: "Post",
  lastModifiedDate: "01/01/2025 12:00AM",
  isShared: false,
};

const AUTHORS_CONTAINER = {
  contentViewID: 201,
  referenceName: "Authors",
  title: "Authors",
  contentDefinitionID: 11,
  contentDefinitionName: "Author",
  lastModifiedDate: "01/01/2025 12:00AM",
  isShared: false,
};

function fixture() {
  return {
    source: {
      "models/10.json": POST_MODEL,
      "models/11.json": AUTHOR_MODEL,
      "models/12.json": NEWS_MODEL,
      "containers/200.json": POSTS_CONTAINER,
      "containers/201.json": AUTHORS_CONTAINER,
    },
  };
}

describe("--syncDeletes through the orchestrator", () => {
  let harness: SyncHarness;
  let net: InstalledNetworkStubs;

  beforeEach(() => {
    net = installNetworkStubs();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    harness?.cleanup();
    net.restore();
    jest.restoreAllMocks();
  });

  function deleteFromSource(rel: string) {
    fs.rmSync(path.join(harness.rootPath, harness.sourceGuid, rel));
  }

  it("deletes the target counterparts of source deletes and drops their mappings", async () => {
    harness = new SyncHarness({ elements: "Models,Containers", fixture: fixture() });
    await harness.run();
    const authorTarget = harness.readMappings("models")!.find((m) => m.sourceID === 11)!.targetID;
    const authorsContainerTarget = harness.readMappings("containers")!.find((m) => m.sourceContentViewID === 201)!.targetContentViewID;

    deleteFromSource("models/11.json");
    deleteFromSource("containers/201.json");
    harness.stateOverrides = { syncDeletes: true };
    const run2 = await harness.resync();

    const target = harness.fake.instance(harness.targetGuid);
    expect(target.models.has(authorTarget)).toBe(false);
    expect(target.containers.has(authorsContainerTarget)).toBe(false);
    expect(target.models.size).toBe(2);
    // Container before its model.
    const order = harness.fake.calls.map((c) => c.method);
    expect(order.indexOf("containerMethods.deleteContainer")).toBeLessThan(order.indexOf("modelMethods.deleteModel"));

    expect(harness.readMappings("models")!.map((m) => m.sourceID).sort()).toEqual([10, 12]);
    expect(harness.readMappings("containers")!.map((m) => m.sourceContentViewID)).toEqual([200]);
    expect(run2.phases.find((p) => p.operation === "syncDeletes")).toMatchObject({ successful: 2, failed: 0 });
  });

  it("leaves source deletes alone without the flag", async () => {
    harness = new SyncHarness({ elements: "Models,Containers", fixture: fixture() });
    await harness.run();

    deleteFromSource("models/12.json");
    const run2 = await harness.resync();

    expect(harness.fake.instance(harness.targetGuid).models.size).toBe(3);
    expect(harness.fake.callsTo("modelMethods.deleteModel")).toEqual([]);
    expect(run2.phases.find((p) => p.operation === "syncDeletes")).toBeUndefined();
  });

  it("keeps a model that a target-only container still uses", async () => {
    harness = new SyncHarness({ elements: "Models,Containers", fixture: fixture() });
    await harness.run();
    const newsTarget = harness.readMappings("models")!.find((m) => m.sourceID === 12)!.targetID;
    // Someone built a list on the target from the News model.
    harness.fake.seedContainer(harness.targetGuid, {
      contentViewID: 8999,
      referenceName: "TargetNews",
      contentDefinitionID: newsTarget,
      lastModifiedDate: "01/01/2025 12:00AM",
    });

    deleteFromSource("models/12.json");
    harness.stateOverrides = { syncDeletes: true };
    const run2 = await harness.resync();

    expect(harness.fake.instance(harness.targetGuid).models.has(newsTarget)).toBe(true);
    expect(run2.phases.find((p) => p.operation === "syncDeletes")).toMatchObject({ successful: 0, skipped: 1 });
    const warning = run2.results[0].warningDetails.find((w: any) => w.name === "News");
    expect(warning?.error).toContain("container TargetNews");
  });

  it("previews deletes under --preflight without writing", async () => {
    harness = new SyncHarness({ elements: "Models,Containers", fixture: fixture() });
    await harness.run();
    const before = harness.readAllMappings();

    deleteFromSource("models/12.json");
    harness.stateOverrides = { syncDeletes: true, preflight: true };
    await harness.resync();

    expect(harness.fake.callsTo("modelMethods.deleteModel")).toEqual([]);
    expect(harness.readAllMappings()).toEqual(before);
  });

  it("refuses --syncDeletes on a scoped run before writing anything", async () => {
    harness = new SyncHarness({
      elements: "Models,Containers",
      fixture: fixture(),
      stateOverrides: { syncDeletes: true, models: "Post" },
    });

    const run = await harness.run();

    expect(run.results[0].failed[0].error).toContain("Sync deletes validation failed");
    expect(harness.fake.calls.filter((c) => !c.method.startsWith("get"))).toEqual([]);
  });
});
