/**
 * Golden snapshots of a full sync.
 *
 * The other two suites assert specific properties — idempotency, remapping, per-phase counts.
 * Those only cover what someone thought to check. This one records *everything the CLI did*:
 * the ordered API conversation, the per-phase outcome and the mapping tree. Any change to what
 * the CLI sends shows up as a reviewable diff instead of passing silently.
 *
 * **When one of these fails, read the diff before reaching for `-u`.** A snapshot that has
 * changed is the suite working: either the change is intended and you accept it, or it is a
 * regression nothing else would have caught. Updating without reading defeats the tier.
 *
 *   npx jest src/tests/sync/golden.test.ts -u
 */
import { SyncHarness } from "./helpers/run-sync";
import { installNetworkStubs, InstalledNetworkStubs } from "./helpers/network-stubs";
import { buildGoldenSnapshot } from "./helpers/golden";
import { ALL_ELEMENTS, fullInstanceFixture, MODEL_POST } from "./helpers/full-instance-fixture";

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

describe("golden — full instance sync", () => {
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

  it("fresh sync — full API conversation and mapping tree", async () => {
    harness = new SyncHarness({ elements: ALL_ELEMENTS, fixture: fullInstanceFixture() });

    const run = await harness.run();

    expect(buildGoldenSnapshot(harness, run)).toMatchSnapshot();
  });

  it("re-sync with no source change — should be an empty conversation", async () => {
    harness = new SyncHarness({ elements: ALL_ELEMENTS, fixture: fullInstanceFixture() });
    await harness.run();

    const run2 = await harness.resync();

    // The most valuable snapshot in the suite: every phase skipping, no calls, and a mapping
    // tree byte-identical to run 1. A regression that reintroduces writes on run 2 shows up
    // here as new entries in `calls` even if the counts still look plausible.
    expect(buildGoldenSnapshot(harness, run2)).toMatchSnapshot();
  });

  it("incremental — one model edited, methods only", async () => {
    harness = new SyncHarness({ elements: ALL_ELEMENTS, fixture: fullInstanceFixture() });
    await harness.run();

    harness.editSourceFile("models/10.json", {
      ...MODEL_POST,
      displayName: "Post (renamed)",
      lastModifiedDate: "2026-02-02T00:00:00.000",
    });
    const run2 = await harness.resync();

    // methodsOnly: this scenario is about which calls happen, not their contents, so the
    // payload-free form stays readable and does not churn on unrelated fixture edits.
    expect(buildGoldenSnapshot(harness, run2, { methodsOnly: true })).toMatchSnapshot();
  });

  it("is reproducible — two identical runs produce the same snapshot", async () => {
    // Guards the property the whole tier rests on. IDs come from fixed per-kind ranges and
    // timestamps from a per-instance counter, so two separate harnesses must agree exactly.
    // If this fails, every other snapshot here is noise waiting to happen.
    const first = new SyncHarness({ elements: ALL_ELEMENTS, fixture: fullInstanceFixture() });
    const firstSnapshot = buildGoldenSnapshot(first, await first.run());
    first.cleanup();

    const second = new SyncHarness({ elements: ALL_ELEMENTS, fixture: fullInstanceFixture() });
    const secondSnapshot = buildGoldenSnapshot(second, await second.run());
    second.cleanup();

    expect(secondSnapshot).toEqual(firstSnapshot);
  });
});
