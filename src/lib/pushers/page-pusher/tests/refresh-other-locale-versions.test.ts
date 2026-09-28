import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { PageMapper } from "lib/mappers/page-mapper";
import { refreshOtherLocaleVersions } from "../refresh-other-locale-versions";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-refresh-locale-"));
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

// ─── helpers ──────────────────────────────────────────────────────────────────

let testCounter = 0;
let SRC: string;
let TGT: string;

function nextPair() {
  testCounter++;
  SRC = `src-rl-${testCounter}`;
  TGT = `tgt-rl-${testCounter}`;
}

function makePage(pageID: number, versionID: number): any {
  return { pageID, name: "how-it-works", templateName: "Main", properties: { versionID } };
}

/** Write the pulled target page file for a locale (what the run read at start). */
function writePulledTargetPage(locale: string, pageID: number, versionID: number) {
  const dir = path.join(tmpDir, TGT, locale, "page");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${pageID}.json`), JSON.stringify(makePage(pageID, versionID)));
}

/** Seed a locale's mapping record: source page 176 v{sourceVersion} -> target page 98 v{targetVersion}. */
function seedMapping(locale: string, sourceVersion: number, targetVersion: number) {
  new PageMapper(SRC, TGT, locale).addMapping(makePage(176, sourceVersion), makePage(98, targetVersion));
}

function recordFor(locale: string) {
  return new PageMapper(SRC, TGT, locale).getPageMappingByPageID(98, "target")!;
}

function makeApiClient(versionsByLocale: Record<string, number>): any {
  return {
    pageMethods: {
      getPage: jest.fn(async (pageID: number, _guid: string, locale: string) => makePage(pageID, versionsByLocale[locale])),
    },
  };
}

// ─── refreshOtherLocaleVersions ───────────────────────────────────────────────

describe("refreshOtherLocaleVersions (PROD-2628)", () => {
  it("moves an in-sync other locale's target version forward when the save bumped it", async () => {
    nextPair();
    // en-us was saved earlier in this run (recorded 1349); pulled en-us page was at 958
    seedMapping("en-us", 4071, 1349);
    writePulledTargetPage("en-us", 98, 958);
    // es-us has just been saved -> 1362, which also gave en-us version 1362 on the server
    seedMapping("es-us", 4071, 1362);
    const apiClient = makeApiClient({ "en-us": 1362 });

    const refreshed = await refreshOtherLocaleVersions({
      targetPageID: 98,
      savedLocale: "es-us",
      locales: ["en-us", "es-us"],
      sourceGuid: SRC,
      targetGuid: TGT,
      apiClient,
    });

    expect(refreshed).toEqual(["en-us"]);
    expect(recordFor("en-us").targetVersionID).toBe(1362);
    // source side and the saved locale are untouched
    expect(recordFor("en-us").sourceVersionID).toBe(4071);
    expect(recordFor("es-us").targetVersionID).toBe(1362);
    expect(apiClient.pageMethods.getPage).toHaveBeenCalledWith(98, TGT, "en-us");
    expect(apiClient.pageMethods.getPage).not.toHaveBeenCalledWith(98, TGT, "es-us");
  });

  it("the next run then sees no target change for the other locale", async () => {
    nextPair();
    seedMapping("en-us", 4071, 1349);
    writePulledTargetPage("en-us", 98, 958);
    seedMapping("es-us", 4071, 1362);

    await refreshOtherLocaleVersions({
      targetPageID: 98,
      savedLocale: "es-us",
      locales: ["en-us", "es-us"],
      sourceGuid: SRC,
      targetGuid: TGT,
      apiClient: makeApiClient({ "en-us": 1362 }),
    });

    // next run pulls en-us at 1362
    const mapper = new PageMapper(SRC, TGT, "en-us");
    const record = mapper.getPageMappingByPageID(98, "target");
    expect(mapper.hasTargetChanged(makePage(98, 1362), record)).toBeNull();
  });

  it("leaves a locale with an independent target edit alone so it still conflicts", async () => {
    nextPair();
    // en-us mapping recorded 958 but the pulled en-us page is already at 1100: edited outside the CLI
    seedMapping("en-us", 4071, 958);
    writePulledTargetPage("en-us", 98, 1100);
    seedMapping("es-us", 4071, 1362);
    const apiClient = makeApiClient({ "en-us": 1362 });

    const refreshed = await refreshOtherLocaleVersions({
      targetPageID: 98,
      savedLocale: "es-us",
      locales: ["en-us", "es-us"],
      sourceGuid: SRC,
      targetGuid: TGT,
      apiClient,
    });

    expect(refreshed).toEqual([]);
    expect(recordFor("en-us").targetVersionID).toBe(958);
    expect(apiClient.pageMethods.getPage).not.toHaveBeenCalled();
  });

  it("does nothing when the save did not change the other locale's version", async () => {
    nextPair();
    seedMapping("en-us", 3126, 1350);
    writePulledTargetPage("en-us", 98, 864);
    seedMapping("es-us", 4193, 1400);

    const refreshed = await refreshOtherLocaleVersions({
      targetPageID: 98,
      savedLocale: "es-us",
      locales: ["en-us", "es-us"],
      sourceGuid: SRC,
      targetGuid: TGT,
      apiClient: makeApiClient({ "en-us": 1350 }),
    });

    expect(refreshed).toEqual([]);
    expect(recordFor("en-us").targetVersionID).toBe(1350);
  });

  it("skips locales with no mapping record or no pulled page, and single-locale runs", async () => {
    nextPair();
    seedMapping("en-us", 4071, 1349);
    // es-us has a mapping but no pulled target page; fr-ca has neither
    seedMapping("es-us", 4071, 1300);
    const apiClient = makeApiClient({ "es-us": 1362, "fr-ca": 5 });

    const refreshed = await refreshOtherLocaleVersions({
      targetPageID: 98,
      savedLocale: "en-us",
      locales: ["en-us", "es-us", "fr-ca"],
      sourceGuid: SRC,
      targetGuid: TGT,
      apiClient,
    });
    expect(refreshed).toEqual([]);
    expect(apiClient.pageMethods.getPage).not.toHaveBeenCalled();

    const single = await refreshOtherLocaleVersions({
      targetPageID: 98,
      savedLocale: "en-us",
      locales: ["en-us"],
      sourceGuid: SRC,
      targetGuid: TGT,
      apiClient,
    });
    expect(single).toEqual([]);
  });

  it("never throws when re-reading the page fails", async () => {
    nextPair();
    seedMapping("en-us", 4071, 1349);
    writePulledTargetPage("en-us", 98, 958);
    const apiClient = { pageMethods: { getPage: jest.fn().mockRejectedValue(new Error("boom")) } } as any;

    await expect(
      refreshOtherLocaleVersions({
        targetPageID: 98,
        savedLocale: "es-us",
        locales: ["en-us", "es-us"],
        sourceGuid: SRC,
        targetGuid: TGT,
        apiClient,
      })
    ).resolves.toEqual([]);
    expect(recordFor("en-us").targetVersionID).toBe(1349);
  });
});
