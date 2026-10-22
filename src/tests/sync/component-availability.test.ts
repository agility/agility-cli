/**
 * Component availability (PROD-2914), driven end to end through the fake instance.
 *
 * The fake does what the Management API does with the rules: it only takes them for a component
 * model, and a page save is rejected when it adds a NEW placement of a disabled component, or one
 * outside the component's page model and zone rules. Existing placements are grandfathered.
 *
 * That is what makes the order of the sync matter. On a new target every placement is new, so a
 * source page whose placement is older than the source's rules would be rejected if the rules (or
 * the disabled model) reached the target before the pages. The sync pushes them last.
 */
import { SyncHarness } from "./helpers/run-sync";
import { installNetworkStubs, InstalledNetworkStubs } from "./helpers/network-stubs";
import {
  ALL_ELEMENTS,
  FIXTURE_LOCALE,
  MODEL_POST,
  PAGE_HOME,
  TEMPLATE_STANDARD,
  fullInstanceFixture,
} from "./helpers/full-instance-fixture";

jest.mock("lib/pushers/batch-polling", () => ({
  pollBatchUntilComplete: jest.fn(),
  extractContentBatchResults: jest.fn(),
  extractPageBatchResults: jest.fn(),
}));

jest.mock("axios", () => ({ post: jest.fn(), get: jest.fn(), default: { post: jest.fn() } }));

jest.mock("lib/pushers/url-redirection-api", () => ({
  MAX_URL_REDIRECTION_BATCH_SIZE: 250,
  saveUrlRedirections: jest.fn(),
}));

/** The fixture's Post model as a component model (contentDefinitionTypeID 2), disabled on the source. */
const COMPONENT_POST = { ...MODEL_POST, contentDefinitionTypeID: 2, isVisible: false };

/** Two zones, so a rule can allow one and not the other. */
const TEMPLATE_TWO_ZONES = {
  ...TEMPLATE_STANDARD,
  contentSectionDefinitions: [
    { pageItemTemplateID: 71, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: -1 },
    { pageItemTemplateID: 72, pageItemTemplateReferenceName: "Hero", itemOrder: 1, contentViewID: -1 },
  ],
};

const POST_MODULE = { module: "PostModule", item: { contentid: 500 } };

/** The page holds the component in Main, from before the source's rule said "Hero only". */
const PAGE_WITH_POST = { ...PAGE_HOME, zones: { Main: [POST_MODULE] } };

/** Source rules: only the Hero zone of Standard. The who rules are there to prove they never travel. */
const AVAILABILITY_POST = {
  modelID: 10,
  modelReferenceName: "Post",
  addableBy: { permissions: ["Administrator"], users: [], teams: [] },
  allowedIn: {
    sitemaps: [],
    pageModels: [],
    zones: [{ zoneID: 72, pageModelID: 700, pageModelName: "Standard", referenceName: "Hero", name: "Hero" }],
  },
};

function componentFixture(model: any = COMPONENT_POST) {
  const fixture = fullInstanceFixture();
  fixture.source["models/10.json"] = { ...model };
  fixture.source["templates/700.json"] = { ...TEMPLATE_TWO_ZONES };
  fixture.source[`${FIXTURE_LOCALE}/page/800.json`] = { ...PAGE_WITH_POST };
  fixture.source["model-availability/10.json"] = { ...AVAILABILITY_POST };
  return fixture;
}

function makeHarness(opts: { overwrite?: boolean; model?: any } = {}): SyncHarness {
  const harness = new SyncHarness({
    elements: ALL_ELEMENTS,
    fixture: componentFixture(opts.model),
    overwrite: opts.overwrite ?? false,
  });
  // A real sync pulls the target first; an empty, migrated target answers "no rules".
  harness.fake.projectToDisk(harness.rootPath, harness.targetGuid);
  return harness;
}

describe("component availability sync (PROD-2914)", () => {
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

  describe("fresh sync into an empty target", () => {
    it.each([
      ["a disabled component outside its placement rules", COMPONENT_POST],
      ["an enabled component outside its placement rules", { ...COMPONENT_POST, isVisible: true }],
    ])("saves the page that holds %s", async (_label, model) => {
      harness = makeHarness({ model });

      const run = await harness.run();

      const pages = run.phases.find((p) => p.operation === "pushPages")!;
      expect({ ok: pages.successful, failed: pages.failed }).toEqual({ ok: 1, failed: 0 });
      expect(run.totals.failed).toBe(0);
      const [page] = Array.from(harness.fake.instance(harness.targetGuid).pages.values());
      expect(page.zones.Main).toHaveLength(1);
    });

    it("disables the new model and sets its placement rules only after the pages", async () => {
      harness = makeHarness();

      await harness.run();

      const methods = harness.fake.calls.map((c) => c.method);
      const pageSave = methods.indexOf("pageMethods.savePage");
      const rulesSave = methods.indexOf("modelMethods.saveModelAvailability");
      const disable = harness.fake.calls.findIndex(
        (c) => c.method === "modelMethods.saveModel" && c.payload?.isVisible === false
      );
      expect(pageSave).toBeGreaterThanOrEqual(0);
      expect(rulesSave).toBeGreaterThan(pageSave);
      expect(disable).toBeGreaterThan(pageSave);

      // Created enabled: no model save before the pages carries isVisible at all.
      harness.fake.calls
        .slice(0, pageSave)
        .filter((c) => c.method === "modelMethods.saveModel")
        .forEach((c) => expect("isVisible" in c.payload).toBe(false));
    });

    it("leaves the target with the source's disabled state and placement rules, and its own who rules", async () => {
      harness = makeHarness();

      const run = await harness.run();
      const target = harness.fake.instance(harness.targetGuid);
      const targetModelID = harness.readMappings("models")![0].targetID;
      const targetTemplate = Array.from(target.templates.values())[0];
      const targetHero = targetTemplate.contentSectionDefinitions.find(
        (z: any) => z.pageItemTemplateReferenceName === "Hero"
      );

      const availability = run.phases.find((p) => p.operation === "pushModelAvailability")!;
      expect({ ok: availability.successful, failed: availability.failed }).toEqual({ ok: 2, failed: 0 });
      expect(target.models.get(targetModelID).isVisible).toBe(false);
      const saved = target.availability.get(targetModelID);
      expect(saved.addableBy).toBeNull();
      expect(saved.allowedIn.sitemaps).toEqual([]);
      expect(saved.allowedIn.pageModels).toEqual([]);
      // Remapped onto the target: its page model ID, the names, and never a source ID.
      expect(saved.allowedIn.zones).toHaveLength(1);
      expect(saved.allowedIn.zones[0]).toMatchObject({
        zoneID: targetHero.pageItemTemplateID,
        pageModelID: targetTemplate.pageTemplateID,
        pageModelName: "Standard",
        referenceName: "Hero",
        name: "Hero",
      });
      expect(targetHero.pageItemTemplateID).not.toBe(72);
    });
  });

  describe("re-sync with no source change", () => {
    it("writes no model or rules, and the disable doesn't read as a target change", async () => {
      harness = makeHarness();
      await harness.run();

      const run2 = await harness.resync();

      const writes = harness.fake.calls.filter((c) => /^modelMethods\.save/.test(c.method));
      expect(writes.map((c) => c.method)).toEqual([]);
      expect(run2.totals.failed).toBe(0);
      const models = run2.phases.find((p) => p.operation === "pushModels")!;
      const availability = run2.phases.find((p) => p.operation === "pushModelAvailability")!;
      expect({ ok: models.successful, skip: models.skipped }).toEqual({ ok: 0, skip: 1 });
      expect({ ok: availability.successful, skip: availability.skipped }).toEqual({ ok: 0, skip: 1 });
      // No "target model has changed" hold-back: the model phase skips as unchanged.
      expect(run2.results.flatMap((r) => r.warningDetails).map((w) => w.error)).not.toContainEqual(
        expect.stringMatching(/target model has changed/)
      );
    });
  });

  describe("a later sync that adds a placement", () => {
    it("reports the page the target's rules reject, with the rule's reason", async () => {
      harness = makeHarness({ overwrite: true });
      await harness.run();

      // The page moves its component to Hero: a new placement, of a component the target has
      // disabled since the first sync.
      harness.editSourceFile(`${FIXTURE_LOCALE}/page/800.json`, {
        ...PAGE_WITH_POST,
        zones: { Hero: [POST_MODULE], Main: [] },
        properties: { ...PAGE_HOME.properties, versionID: 951, modified: "2026-02-02T00:00:00.000" },
      });
      const run2 = await harness.resync();

      const pages = run2.phases.find((p) => p.operation === "pushPages")!;
      expect(pages.failed).toBe(1);
      const errors = run2.results.flatMap((r) => r.failureDetails).map((f) => f.error);
      expect(errors).toContainEqual(
        expect.stringContaining(
          'Rejected by a component availability rule: The "Post" component is disabled on this instance.'
        )
      );
    });
  });
});
