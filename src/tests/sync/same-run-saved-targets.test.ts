/**
 * Entities saved earlier in a run must be what later phases read, not the target as pulled.
 *
 * The mappers read the target off disk, and the disk holds the target as it was pulled at the
 * start of the run. A template that gains a zone in the template phase is therefore missing that
 * zone when the page phase translates zone names against it, and the page's modules for the new
 * zone overflow into the template's first zone (seen on a real instance: a home page banner
 * landed in the main content zone).
 */
import { SyncHarness } from "./helpers/run-sync";
import { installNetworkStubs, InstalledNetworkStubs } from "./helpers/network-stubs";
import {
  ALL_ELEMENTS,
  FIXTURE_LOCALE,
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

describe("same-run saved targets", () => {
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

  it("places a module in a zone the template gained earlier in the same run", async () => {
    const postModule = { module: "PostModule", item: { contentid: 500 } };
    const fixture = fullInstanceFixture();
    fixture.source[`${FIXTURE_LOCALE}/page/800.json`] = { ...PAGE_HOME, zones: { Main: [postModule] } };

    harness = new SyncHarness({ elements: ALL_ELEMENTS, fixture, overwrite: true });
    await harness.run();

    // The source template gains a Banner zone ahead of Main, and the page moves its module there.
    harness.editSourceFile("templates/700.json", {
      ...TEMPLATE_STANDARD,
      contentSectionDefinitions: [
        { pageItemTemplateID: 72, pageItemTemplateReferenceName: "Banner", itemOrder: 0, contentViewID: -1 },
        { pageItemTemplateID: 71, pageItemTemplateReferenceName: "Main", itemOrder: 1, contentViewID: -1 },
      ],
    });
    harness.editSourceFile(`${FIXTURE_LOCALE}/page/800.json`, {
      ...PAGE_HOME,
      zones: { Banner: [postModule], Main: [] },
      properties: { ...PAGE_HOME.properties, versionID: 951, modified: "2026-02-02T00:00:00.000" },
    });

    await harness.resync();

    const targetContentID = harness.readMappings("item", FIXTURE_LOCALE)![0].targetContentID;
    const pageSaves = harness.fake.callsTo("pageMethods.savePage");
    expect(pageSaves).toHaveLength(1);
    const zones = pageSaves[0].payload.zones;

    expect(zones.Banner).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ contentid: targetContentID }) }),
    ]);
    expect(zones.Main).toEqual([]);
  });
});
