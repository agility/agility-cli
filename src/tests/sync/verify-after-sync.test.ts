/**
 * PROD-2552: `agility verify` against the output of a real (hermetic) sync.
 *
 * The sync half is the real push pipeline from full-instance.test.ts, extended with a page that
 * carries two components in one zone. Its target is then projected to disk the way a pull would
 * write it, and verify runs over the two caches with the pull replaced by a no-op — everything
 * else (loaders, mapping files, checks, report) is the real code.
 *
 *  1. Right after the sync, verify passes (exit 0).
 *  2. Swap the two components in the target page's zone — the reported defect — and verify
 *     fails (exit 1) with a componentOrderMismatch naming both sequences.
 */
import * as fs from "fs";
import * as path from "path";
import { SyncHarness } from "./helpers/run-sync";
import { installNetworkStubs, InstalledNetworkStubs } from "./helpers/network-stubs";
import {
  ALL_ELEMENTS,
  CONTENT_HELLO,
  FIXTURE_LOCALE,
  fullInstanceFixture,
  PAGE_HOME,
} from "./helpers/full-instance-fixture";
import { Verify } from "core/verify";
import { EXIT_DIFFERENCES, EXIT_PASS, VerifyReport } from "lib/verify/verify-report";

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

const CONTENT_WORLD = {
  ...CONTENT_HELLO,
  contentID: 501,
  properties: { ...CONTENT_HELLO.properties, versionID: 901, itemOrder: 1 },
  fields: { title: "World" },
};

const PAGE_WITH_ZONE = {
  ...PAGE_HOME,
  zones: {
    Main: [
      { module: "Post", item: { contentid: 500, fulllist: false } },
      { module: "Post", item: { contentid: 501, fulllist: false } },
    ],
  },
};

function fixture() {
  const base = fullInstanceFixture();
  base.source[`${FIXTURE_LOCALE}/item/501.json`] = CONTENT_WORLD;
  base.source[`${FIXTURE_LOCALE}/page/800.json`] = PAGE_WITH_ZONE;
  return base;
}

/** The target's nested sitemap, as a pull would write it: the fake does not keep one. */
function writeTargetSitemap(harness: SyncHarness): void {
  const pageMapping = (harness.readMappings("page", FIXTURE_LOCALE) ?? [])[0];
  const file = path.join(harness.rootPath, harness.targetGuid, FIXTURE_LOCALE, "nestedsitemap", "website.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify([
      {
        title: "Home",
        name: "home",
        pageID: pageMapping.targetPageID,
        menuText: "Home",
        visible: { menu: true, sitemap: true },
        path: "/home",
        redirect: null,
        isFolder: false,
      },
    ])
  );
}

function targetPagePath(harness: SyncHarness): string {
  const pageMapping = (harness.readMappings("page", FIXTURE_LOCALE) ?? [])[0];
  return path.join(harness.rootPath, harness.targetGuid, FIXTURE_LOCALE, "page", `${pageMapping.targetPageID}.json`);
}

async function verify(harness: SyncHarness): Promise<VerifyReport> {
  return new Verify(
    {
      sourceGuid: harness.sourceGuid,
      targetGuid: harness.targetGuid,
      locales: [FIXTURE_LOCALE],
      models: "",
      pages: "",
      containers: "",
      jsonSummary: path.join(harness.rootPath, "verify-report.json"),
      rootPath: harness.rootPath,
    },
    {
      getStatus: async () => ({ inProgress: false, lastContentVersionID: 1, maxChangeDate: "x" }) as any,
      // Hermetic: the caches are already on disk, so the pull is a no-op that reports success.
      pull: async () => ({
        success: true,
        results: [
          { guidProcessed: harness.sourceGuid, failed: [] },
          { guidProcessed: harness.targetGuid, failed: [] },
        ],
      }),
      print: false,
      log: () => {},
    }
  ).run();
}

describe("verify after a hermetic sync", () => {
  let harness: SyncHarness;
  let net: InstalledNetworkStubs;
  let mappingsBefore: Record<string, any>;

  beforeEach(async () => {
    net = installNetworkStubs();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    harness = new SyncHarness({ elements: ALL_ELEMENTS, fixture: fixture() });
    const run = await harness.run();
    expect(run.totals.failed).toBe(0);
    harness.fake.projectToDisk(harness.rootPath, harness.targetGuid);
    writeTargetSitemap(harness);
    mappingsBefore = harness.readAllMappings();
  });

  afterEach(() => {
    harness?.cleanup();
    net.restore();
    jest.restoreAllMocks();
  });

  it("passes right after the sync", async () => {
    const report = await verify(harness);

    expect(report.findings.filter((f) => f.severity === "failure")).toEqual([]);
    expect(report.exitCode).toBe(EXIT_PASS);
    expect(report.totals.entities.zone).toMatchObject({ checked: 1, matched: 1 });
    expect(report.totals.entities.content).toMatchObject({ checked: 2, matched: 2 });
    expect(net.fetchCalls).toEqual([]);
  });

  it("fails with componentOrderMismatch when the target zone is reordered", async () => {
    const file = targetPagePath(harness);
    const targetPage = JSON.parse(fs.readFileSync(file, "utf8"));
    const zone = Object.keys(targetPage.zones)[0];
    targetPage.zones[zone].reverse();
    fs.writeFileSync(file, JSON.stringify(targetPage));

    const report = await verify(harness);

    expect(report.exitCode).toBe(EXIT_DIFFERENCES);
    const failures = report.findings.filter((f) => f.severity === "failure");
    expect(failures.map((f) => f.category)).toEqual(["componentOrderMismatch"]);
    expect(failures[0].actual).toEqual([...(failures[0].expected as string[])].reverse());
  });

  it("leaves the mapping files untouched", async () => {
    await verify(harness);
    expect(harness.readAllMappings()).toEqual(mappingsBefore);
  });
});
