/**
 * End-to-end hermetic sync: the whole orchestrator, twice.
 *
 * The existing scenario suite drives three pipelines directly (ContentBatchProcessor,
 * pushModels, pushContainers) and represents a "second sync" by hand-authoring mapping files,
 * so the orchestrator is never actually run twice.
 *
 * This suite runs the real `instanceOrchestrator()` against a temp filesystem and a stateful
 * fake, twice, with a re-pull in between. The oracle is idempotency: **no source change means
 * the second run writes nothing.**
 */
import { SyncHarness } from "./helpers/run-sync";
import { installNetworkStubs, InstalledNetworkStubs } from "./helpers/network-stubs";

// These factories are inlined rather than imported from network-stubs: jest hoists
// `jest.mock` above the import statements, so a factory referencing an imported binding
// throws "Cannot read properties of undefined" before a single test runs.
jest.mock("lib/pushers/batch-polling", () => ({
  pollBatchUntilComplete: jest.fn().mockResolvedValue({}),
  extractContentBatchResults: jest.fn().mockReturnValue([]),
}));

const POST_MODEL = {
  id: 10,
  displayName: "Post",
  referenceName: "Post",
  description: "Defines a blog post.",
  lastModifiedDate: "2025-01-01T00:00:00.000",
  contentDefinitionTypeName: "Content List",
  fields: [
    { type: "Text", name: "Title", label: "Title", required: true },
    { type: "Text", name: "Slug", label: "URL Slug", required: true },
  ],
};

const AUTHOR_MODEL = {
  id: 11,
  displayName: "Author",
  referenceName: "Author",
  lastModifiedDate: "2025-01-01T00:00:00.000",
  contentDefinitionTypeName: "Content List",
  fields: [{ type: "Text", name: "Name", label: "Name", required: true }],
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

function baseFixture() {
  return {
    source: {
      "models/10.json": POST_MODEL,
      "models/11.json": AUTHOR_MODEL,
      "containers/200.json": POSTS_CONTAINER,
    },
  };
}

describe("full sync — models and containers", () => {
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

  // ─── A. Fresh sync ─────────────────────────────────────────────────────────

  describe("A. fresh sync into an empty target", () => {
    it("creates every source model on the target", async () => {
      harness = new SyncHarness({ elements: "Models", fixture: baseFixture() });

      const run = await harness.run();

      expect(run.phases.find((p) => p.operation === "pushModels")?.successful).toBe(2);
      expect(harness.fake.instance(harness.targetGuid).models.size).toBe(2);
    });

    it("writes one mapping per source model, mapped exactly once", async () => {
      harness = new SyncHarness({ elements: "Models", fixture: baseFixture() });

      await harness.run();
      const mappings = harness.readMappings("models") ?? [];

      expect(mappings).toHaveLength(2);
      expect(mappings.map((m) => m.sourceID).sort()).toEqual([10, 11]);
      // Assert uniqueness, not just the count: a source entity mapped twice still yields the
      // expected length once a later run adds a row, so the count alone would not notice.
      expect(new Set(mappings.map((m) => m.sourceID)).size).toBe(mappings.length);
    });

    it("maps each source model to a distinct target id", async () => {
      harness = new SyncHarness({ elements: "Models", fixture: baseFixture() });

      await harness.run();
      const targetIds = (harness.readMappings("models") ?? []).map((m) => m.targetID);

      expect(new Set(targetIds).size).toBe(targetIds.length);
    });

    it("creates the container and points it at the mapped model, not the source model id", async () => {
      harness = new SyncHarness({ elements: "Models,Containers", fixture: baseFixture() });

      await harness.run();

      const modelMappings = harness.readMappings("models") ?? [];
      const postTargetId = modelMappings.find((m) => m.sourceID === 10)?.targetID;
      const containers = Array.from(harness.fake.instance(harness.targetGuid).containers.values());

      expect(containers).toHaveLength(1);
      expect(postTargetId).toBeDefined();
      // Carrying the source's contentDefinitionID (10) across would point the container at
      // whatever model happens to hold id 10 on the target — the classic remap failure.
      expect(containers[0].contentDefinitionID).toBe(postTargetId);
    });

    it("reaches no network", async () => {
      harness = new SyncHarness({ elements: "Models,Containers", fixture: baseFixture() });

      await harness.run();

      expect(net.fetchCalls).toEqual([]);
    });
  });

  // ─── B. Idempotent re-sync — the regression oracle ─────────────────────────

  describe("B. re-sync with no source change", () => {
    it("creates no new models on the second run", async () => {
      harness = new SyncHarness({ elements: "Models", fixture: baseFixture() });
      await harness.run();
      const afterFirst = harness.fake.instance(harness.targetGuid).models.size;

      await harness.resync();

      expect(harness.fake.instance(harness.targetGuid).models.size).toBe(afterFirst);
    });

    it("does not duplicate mappings", async () => {
      harness = new SyncHarness({ elements: "Models,Containers", fixture: baseFixture() });
      await harness.run();

      await harness.resync();
      const mappings = harness.readMappings("models") ?? [];

      expect(mappings).toHaveLength(2);
      expect(new Set(mappings.map((m) => m.sourceID)).size).toBe(2);
    });

    it("leaves the mapping tree identical to run 1", async () => {
      harness = new SyncHarness({ elements: "Models,Containers", fixture: baseFixture() });
      await harness.run();
      const before = harness.readAllMappings();

      await harness.resync();

      // The single assertion that covers duplicate mappings, false conflicts,
      // version-comparison drift and ID remapping across every phase at once.
      expect(harness.readAllMappings()).toEqual(before);
    });

    it("keeps target ids stable across runs", async () => {
      harness = new SyncHarness({ elements: "Models", fixture: baseFixture() });
      await harness.run();
      const before = (harness.readMappings("models") ?? []).map((m) => `${m.sourceID}->${m.targetID}`).sort();

      await harness.resync();
      const after = (harness.readMappings("models") ?? []).map((m) => `${m.sourceID}->${m.targetID}`).sort();

      // A recreate-instead-of-update regression shows up here as a changed target id, even
      // when the counts look identical.
      expect(after).toEqual(before);
    });

    it("accounts for every model as an explicit skip, not a silent drop", async () => {
      harness = new SyncHarness({ elements: "Models", fixture: baseFixture() });
      await harness.run();

      const run2 = await harness.resync();
      const models = run2.phases.find((p) => p.operation === "pushModels")!;

      // Asserting only "nothing was written" cannot tell a correct skip from a model that
      // matched no branch at all and was never acted on — successful, skipped and failed all
      // zero. Pin the positive number instead: both models must be *accounted for* as skips.
      expect(models.skipped).toBe(2);
      expect(models.successful).toBe(0);
      expect(models.failed).toBe(0);
    });

    it("issues no writes at all on the second run", async () => {
      harness = new SyncHarness({ elements: "Models,Containers", fixture: baseFixture() });
      await harness.run();

      await harness.resync();

      // resetCalls() runs inside resync(), so this is run 2 alone.
      const writes = [
        ...harness.fake.callsTo("modelMethods.saveModel"),
        ...harness.fake.callsTo("containerMethods.saveContainer"),
      ];
      expect(writes).toEqual([]);
    });
  });

  // ─── C. Incremental — one model edited ─────────────────────────────────────

  describe("C. re-sync after one source model changes", () => {
    it("updates only the changed model", async () => {
      harness = new SyncHarness({ elements: "Models", fixture: baseFixture() });
      await harness.run();

      // Edit Post on the source, exactly as an author would: new content, newer timestamp.
      harness.editSourceFile("models/10.json", {
        ...POST_MODEL,
        displayName: "Post (renamed)",
        lastModifiedDate: "2026-02-02T00:00:00.000",
      });

      await harness.resync();

      const saved = harness.fake.callsTo("modelMethods.saveModel");
      expect(saved).toHaveLength(1);
      expect(saved[0].payload.referenceName).toBe("Post");
    });

    it("adds no mapping rows for an update", async () => {
      harness = new SyncHarness({ elements: "Models", fixture: baseFixture() });
      await harness.run();
      const before = harness.readMappings("models") ?? [];

      harness.editSourceFile("models/10.json", {
        ...POST_MODEL,
        displayName: "Post (renamed)",
        lastModifiedDate: "2026-02-02T00:00:00.000",
      });
      await harness.resync();

      const after = harness.readMappings("models") ?? [];
      expect(after).toHaveLength(before.length);
      expect(after.find((m) => m.sourceID === 10)?.targetID).toBe(
        before.find((m) => m.sourceID === 10)?.targetID
      );
    });
  });
});
