/**
 * All eight push phases, driven end to end, twice.
 *
 * `full-sync.test.ts` covers models and containers in depth. This suite covers *breadth*:
 * every entity type the orchestrator pushes — models, galleries, assets, containers, URL
 * redirections, templates, content and pages — created on a fresh sync and then proven inert
 * on a re-sync with no source change.
 *
 * Assertions pin **positive** counts, never just the absence of writes. A phase reporting
 * `successful`/`failed`/`skipped` all zero has not "done nothing safely" — it has matched no
 * branch at all, which is a silent drop and reads identically to a clean skip if you only
 * assert that nothing was written.
 */
import { SyncHarness } from "./helpers/run-sync";
import { installNetworkStubs, InstalledNetworkStubs } from "./helpers/network-stubs";
import { ALL_ELEMENTS, ALL_OPERATIONS, FIXTURE_LOCALE, fullInstanceFixture, MODEL_POST } from "./helpers/full-instance-fixture";

jest.mock("lib/pushers/batch-polling", () => ({
  pollBatchUntilComplete: jest.fn(),
  extractContentBatchResults: jest.fn(),
  extractPageBatchResults: jest.fn(),
}));

// Asset upload posts multipart form-data through axios directly, bypassing the API client.
jest.mock("axios", () => ({ post: jest.fn(), get: jest.fn(), default: { post: jest.fn() } }));

// URL redirections build their own URL and call global fetch.
jest.mock("lib/pushers/url-redirection-api", () => ({
  MAX_URL_REDIRECTION_BATCH_SIZE: 250,
  saveUrlRedirections: jest.fn(),
}));

describe("full instance — all eight phases", () => {
  let harness: SyncHarness;
  let net: InstalledNetworkStubs;

  function makeHarness() {
    return new SyncHarness({ elements: ALL_ELEMENTS, fixture: fullInstanceFixture() });
  }

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
    it("runs every one of the eight phases", async () => {
      harness = makeHarness();

      const run = await harness.run();

      // A phase missing from the run entirely is the failure mode where an --elements typo,
      // or an unreachable loop, removes a whole entity type without anything going red.
      expect(run.phases.map((p) => p.operation)).toEqual([...ALL_OPERATIONS]);
      expect(run.ranPhases.map((p) => p.operation)).toEqual([...ALL_OPERATIONS]);
    });

    it("creates exactly one entity in each phase and fails none", async () => {
      harness = makeHarness();

      const run = await harness.run();

      run.phases.forEach((phase) => {
        expect({ op: phase.operation, ok: phase.successful, failed: phase.failed }).toEqual({
          op: phase.operation,
          ok: 1,
          failed: 0,
        });
      });
    });

    it("stores every entity on the target", async () => {
      harness = makeHarness();

      await harness.run();
      const target = harness.fake.instance(harness.targetGuid);

      expect(target.models.size).toBe(1);
      expect(target.galleries.size).toBe(1);
      expect(target.assets).toHaveLength(1);
      expect(target.containers.size).toBe(1);
      expect(target.urlRedirections.size).toBe(1);
      expect(target.templates.size).toBe(1);
      expect(target.content.size).toBe(1);
      expect(target.pages.size).toBe(1);
    });

    it("writes a mapping for every entity type", async () => {
      harness = makeHarness();

      await harness.run();

      expect(harness.readMappings("models")).toHaveLength(1);
      expect(harness.readMappings("containers")).toHaveLength(1);
      expect(harness.readMappings("galleries")).toHaveLength(1);
      expect(harness.readMappings("templates")).toHaveLength(1);
      expect(harness.readMappings("item", FIXTURE_LOCALE)).toHaveLength(1);
      expect(harness.readMappings("page", FIXTURE_LOCALE)).toHaveLength(1);
    });

    it("remaps the content item onto its new target id", async () => {
      harness = makeHarness();

      await harness.run();
      const mapping = (harness.readMappings("item", FIXTURE_LOCALE) ?? [])[0];
      const targetIds = Array.from(harness.fake.instance(harness.targetGuid).content.keys());

      expect(mapping.sourceContentID).toBe(500);
      // The recorded target ID must be the one the store actually holds; a mapping pointing at
      // an ID nothing has is how later phases end up referencing content that isn't there.
      expect(targetIds).toContain(`${FIXTURE_LOCALE}:${mapping.targetContentID}`);
    });

    it("reaches no network", async () => {
      harness = makeHarness();

      await harness.run();

      expect(net.fetchCalls).toEqual([]);
    });
  });

  // ─── B. Idempotent re-sync ─────────────────────────────────────────────────

  describe("B. re-sync with no source change", () => {
    it("accounts for every entity as an explicit skip in every phase", async () => {
      harness = makeHarness();
      await harness.run();

      const run2 = await harness.resync();

      run2.phases.forEach((phase) => {
        expect({ op: phase.operation, ok: phase.successful, skip: phase.skipped, failed: phase.failed }).toEqual({
          op: phase.operation,
          ok: 0,
          skip: 1,
          failed: 0,
        });
      });
    });

    it("issues no writes of any kind on the second run", async () => {
      harness = makeHarness();
      await harness.run();

      await harness.resync();

      const writes = harness.fake.calls.filter((c) => /save|axios\.post/i.test(c.method));
      expect(writes.map((c) => c.method)).toEqual([]);
    });

    it("leaves the mapping tree identical to run 1", async () => {
      harness = makeHarness();
      await harness.run();
      const before = harness.readAllMappings();

      await harness.resync();

      expect(harness.readAllMappings()).toEqual(before);
    });

    it("creates no duplicate entities on the target", async () => {
      harness = makeHarness();
      await harness.run();
      const target = harness.fake.instance(harness.targetGuid);
      const before = {
        models: target.models.size,
        galleries: target.galleries.size,
        assets: target.assets.length,
        containers: target.containers.size,
        redirections: target.urlRedirections.size,
        templates: target.templates.size,
        content: target.content.size,
        pages: target.pages.size,
      };

      await harness.resync();

      expect({
        models: target.models.size,
        galleries: target.galleries.size,
        assets: target.assets.length,
        containers: target.containers.size,
        redirections: target.urlRedirections.size,
        templates: target.templates.size,
        content: target.content.size,
        pages: target.pages.size,
      }).toEqual(before);
    });
  });

  // ─── C. Incremental ────────────────────────────────────────────────────────

  describe("C. re-sync after one source entity changes", () => {
    it("updates the changed model and leaves every other phase skipping", async () => {
      harness = makeHarness();
      await harness.run();

      harness.editSourceFile("models/10.json", {
        ...MODEL_POST,
        displayName: "Post (renamed)",
        lastModifiedDate: "2026-02-02T00:00:00.000",
      });
      const run2 = await harness.resync();

      const models = run2.phases.find((p) => p.operation === "pushModels")!;
      expect(models.successful).toBe(1);

      run2.phases
        .filter((p) => p.operation !== "pushModels")
        .forEach((phase) => {
          expect({ op: phase.operation, ok: phase.successful, skip: phase.skipped }).toEqual({
            op: phase.operation,
            ok: 0,
            skip: 1,
          });
        });
    });

    it("adds no mapping rows for an update", async () => {
      harness = makeHarness();
      await harness.run();
      const before = harness.readAllMappings();

      harness.editSourceFile("models/10.json", {
        ...MODEL_POST,
        displayName: "Post (renamed)",
        lastModifiedDate: "2026-02-02T00:00:00.000",
      });
      await harness.resync();

      const after = harness.readAllMappings();
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());

      // readAllMappings keys are relative to <root>/mappings, so they carry the
      // "<source>-<target>/" pair directory. Match on the suffix rather than hardcoding it.
      const modelsKey = Object.keys(after).find((k) => k.endsWith("models/mappings.json"))!;
      expect(modelsKey).toBeDefined();
      expect(after[modelsKey]).toHaveLength(before[modelsKey].length);
      // Same source model, same target model — an update must not re-point the mapping.
      expect(after[modelsKey][0].targetID).toBe(before[modelsKey][0].targetID);
    });
  });
});
