/**
 * All nine push phases, driven end to end, twice.
 *
 * `full-sync.test.ts` covers models and containers in depth. This suite covers *breadth*:
 * every entity type the orchestrator pushes — models, galleries, assets, containers, URL
 * redirections, templates, content and pages — created on a fresh sync and then proven inert
 * on a re-sync with no source change. (The ninth phase, component availability, runs here with
 * nothing to do; `component-availability.test.ts` covers it.)
 *
 * Assertions pin **positive** counts, never just the absence of writes. A phase reporting
 * `successful`/`failed`/`skipped` all zero has not "done nothing safely" — it has matched no
 * branch at all, which is a silent drop and reads identically to a clean skip if you only
 * assert that nothing was written.
 */
import * as fs from "fs";
import * as path from "path";
import { SyncHarness } from "./helpers/run-sync";
import { installNetworkStubs, InstalledNetworkStubs } from "./helpers/network-stubs";
import {
  ALL_ELEMENTS,
  ALL_OPERATIONS,
  FIXTURE_LOCALE,
  IDLE_OPERATIONS,
  fullInstanceFixture,
  MODEL_POST,
} from "./helpers/full-instance-fixture";

// The post-push page order (PROD-3164) and list order (PROD-2992) phases run after the eight push
// phases; they're asserted on their own.
const PAGE_ORDER = "pageOrder";
const LIST_ORDER = "listOrder";
// Component availability (PROD-2914) runs last, after page order and list order.
const AVAILABILITY = "pushModelAvailability";
const RUN_ORDER = [...ALL_OPERATIONS.filter((op) => op !== AVAILABILITY), PAGE_ORDER, LIST_ORDER, AVAILABILITY];
const pushPhases = <T extends { operation: string }>(phases: T[]) =>
  phases.filter((p) => p.operation !== LIST_ORDER && p.operation !== PAGE_ORDER);

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

describe("full instance — all nine phases", () => {
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
    it("runs every one of the nine phases", async () => {
      harness = makeHarness();

      const run = await harness.run();

      // A phase missing from the run entirely is the failure mode where an --elements typo,
      // or an unreachable loop, removes a whole entity type without anything going red.
      expect(run.phases.map((p) => p.operation)).toEqual(RUN_ORDER);
      expect(run.ranPhases.map((p) => p.operation)).toEqual(RUN_ORDER);
    });

    it("runs page order after the push phases without failing or moving anything", async () => {
      harness = makeHarness();
      const run = await harness.run();
      const pageOrder = run.phases.find((p) => p.operation === PAGE_ORDER)!;
      // One new page, placed when it was created: nothing is out of place.
      expect(pageOrder.failed).toBe(0);
      expect(harness.fake.callsTo("pageMethods.movePage")).toHaveLength(0);
    });

    it("runs list order after the push phases without failing", async () => {
      harness = makeHarness();

      const run = await harness.run();
      const listOrder = run.phases.find((p) => p.operation === LIST_ORDER)!;

      // One new item in a one-item list: the phase asks for the source order and nothing moves.
      expect(listOrder.failed).toBe(0);
      expect(harness.fake.callsTo("contentMethods.setContentListItemOrder")).toHaveLength(1);
    });

    it("creates exactly one entity in each phase and fails none", async () => {
      harness = makeHarness();

      const run = await harness.run();

      pushPhases(run.phases).forEach((phase) => {
        expect({ op: phase.operation, ok: phase.successful, failed: phase.failed }).toEqual({
          op: phase.operation,
          ok: IDLE_OPERATIONS.includes(phase.operation) ? 0 : 1,
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

      pushPhases(run2.phases).forEach((phase) => {
        expect({ op: phase.operation, ok: phase.successful, skip: phase.skipped, failed: phase.failed }).toEqual({
          op: phase.operation,
          ok: 0,
          skip: IDLE_OPERATIONS.includes(phase.operation) ? 0 : 1,
          failed: 0,
        });
      });
    });

    it("issues no writes of any kind on the second run", async () => {
      harness = makeHarness();
      await harness.run();

      await harness.resync();

      const writes = harness.fake.calls.filter((c) => /save|axios\.post|setContentListItemOrder/i.test(c.method));
      expect(writes.map((c) => c.method)).toEqual([]);
    });

    it("leaves list order alone: the target is already in the source's order", async () => {
      harness = makeHarness();
      await harness.run();

      const run2 = await harness.resync();

      // resync() starts a fresh call log, so this is run 2's calls only.
      expect(harness.fake.callsTo("contentMethods.setContentListItemOrder")).toHaveLength(0);
      expect(run2.phases.find((p) => p.operation === LIST_ORDER)).toMatchObject({ successful: 0, failed: 0, skipped: 0 });
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

      pushPhases(run2.phases)
        .filter((p) => p.operation !== "pushModels")
        .forEach((phase) => {
          expect({ op: phase.operation, ok: phase.successful, skip: phase.skipped }).toEqual({
            op: phase.operation,
            ok: 0,
            skip: IDLE_OPERATIONS.includes(phase.operation) ? 0 : 1,
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
  // ─── D. Source not ready (PROD-3212) ──────────────────────────────────────

  describe("D. re-sync when the source pull comes back empty", () => {
    // What a source whose Fetch API (preview) isn't ready looks like on disk: no items, no pages.
    const emptySourcePull = (h: SyncHarness) => {
      for (const kind of ["item", "page", "sitemap", "nestedsitemap"]) {
        fs.rmSync(path.join(h.rootPath, h.sourceGuid, FIXTURE_LOCALE, kind), { recursive: true, force: true });
      }
    };

    it("stops before writing anything, instead of succeeding with nothing synced", async () => {
      harness = makeHarness();
      await harness.run();
      emptySourcePull(harness);

      const run2 = await harness.resync();

      // A run-level failure: push reports it in the ERROR SUMMARY and exits 1.
      const failed = run2.results.flatMap((r) => r.failed);
      expect(failed).toEqual([
        expect.objectContaining({ error: expect.stringMatching(/^Source validation failed.*no content items for en-us.*no pages for en-us/) }),
      ]);
      expect(run2.ranPhases).toEqual([]);

      const writes = harness.fake.calls.filter((c) => /save|delete|move|axios\.post|setContentListItemOrder/i.test(c.method));
      expect(writes.map((c) => c.method)).toEqual([]);
    });

    it("stops a preflight the same way", async () => {
      harness = makeHarness();
      await harness.run();
      emptySourcePull(harness);
      harness.stateOverrides = { preflight: true };

      const run2 = await harness.resync();

      expect(run2.results.flatMap((r) => r.failed)).toEqual([
        expect.objectContaining({ error: expect.stringContaining("Source validation failed") }),
      ]);
    });
  });
});
