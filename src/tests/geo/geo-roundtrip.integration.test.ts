/**
 * PROD-2729: round-trip page GEO/AEO fields between two instances with a real `agility sync`.
 *
 * What it proves:
 *  1. A static page and a dynamic page carrying `geo` and the GEO `seo` keys (title, canonicalUrl,
 *     robots, ogImage) arrive on the target with the same values.
 *  2. A page whose GEO data the Management API rejects (e.g. invalid structuredData) does not fail
 *     the sync: the page is saved without it, the target keeps its existing GEO data, and the run
 *     summary carries a `geoNotCopied` warning for that page.
 *
 * It can only pass once Phase 1 rollout stage 3 is on the environment the instances live on: the
 * CLI pulls pages through the Fetch API, which only carries GEO data from stage 3, and the
 * Management API must accept and return it (stage 2, with both instances in
 * `AppSettings:GeoFieldsInstances`). It SKIPS unless every required variable below is set.
 *
 * Fixtures (set up by hand on the SOURCE instance, then published, because the test never writes
 * to the source):
 *  - GEO_STATIC_PAGE_ID:  a static page with `geo` and at least one GEO seo key set.
 *  - GEO_DYNAMIC_PAGE_ID: a dynamic page with the same.
 *  - GEO_INVALID_PAGE_ID: a page whose GEO data the Management API rejects, e.g. structuredData
 *    that isn't a JSON object/array, or schemaType "Article". The Management API won't save that,
 *    so write it through a path that doesn't validate (the classic editor, or the DB on dev).
 *
 * Dynamic-list items (the MVP's item half), a second, independent block run with a sync scoped to
 * one container:
 *  3. An item in a list that backs a dynamic page, carrying `geo`, arrives on the target with the
 *     same `geo`.
 *  4. Optionally, an item in the same list whose GEO data the Management API rejects is saved
 *     without it (the target keeps its own), with a `geoNotCopied` warning, and the rest of its
 *     batch is not failed.
 * Fixtures: GEO_ITEM_CONTAINER (the list's reference name; keep it small, the whole list is synced),
 * GEO_ITEM_ID (an item in it with `geo` set) and, optionally, GEO_INVALID_ITEM_ID (an item in it
 * with invalid GEO data, written the same way as GEO_INVALID_PAGE_ID).
 *
 * Required env vars:
 *  - AGILITY_TOKEN        personal access token with access to both instances
 *  - GEO_SOURCE_GUID      source instance GUID (dev, e.g. "xxxxxxxx-d")
 *  - GEO_TARGET_GUID      target instance GUID (dev)
 *  - GEO_STATIC_PAGE_ID, GEO_DYNAMIC_PAGE_ID, GEO_INVALID_PAGE_ID   source page IDs (page block)
 *  - GEO_ITEM_CONTAINER, GEO_ITEM_ID                                 (item block; each block skips on its own)
 * Optional: GEO_LOCALE (default en-us), GEO_CHANNEL (default website), GEO_WORK_DIR (where the CLI
 * keeps its files and mappings between runs; default a fixed folder under the OS temp dir).
 *
 * Run: npm run build && npm run test:integration -- src/tests/geo
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as mgmtApi from "@agility/management-sdk";
import { Auth } from "core/auth";
import { resetState, setState } from "core/state";
import { PageMapper } from "lib/mappers/page-mapper";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";

const env = process.env;
const TOKEN = env.AGILITY_TOKEN;
const SOURCE = env.GEO_SOURCE_GUID;
const TARGET = env.GEO_TARGET_GUID;
const LOCALE = env.GEO_LOCALE || "en-us";
const CHANNEL = env.GEO_CHANNEL || "website";
const STATIC_PAGE_ID = Number(env.GEO_STATIC_PAGE_ID);
const DYNAMIC_PAGE_ID = Number(env.GEO_DYNAMIC_PAGE_ID);
const INVALID_PAGE_ID = Number(env.GEO_INVALID_PAGE_ID);

const ITEM_CONTAINER = env.GEO_ITEM_CONTAINER;
const ITEM_ID = Number(env.GEO_ITEM_ID);
const INVALID_ITEM_ID = Number(env.GEO_INVALID_ITEM_ID) || 0;

const configured = !!TOKEN && !!SOURCE && !!TARGET && STATIC_PAGE_ID > 0 && DYNAMIC_PAGE_ID > 0 && INVALID_PAGE_ID > 0;
const itemsConfigured = !!TOKEN && !!SOURCE && !!TARGET && !!ITEM_CONTAINER && ITEM_ID > 0;

const describeIfConfigured = configured ? describe : describe.skip;

const GEO_SEO_KEYS = ["title", "canonicalUrl", "robots", "ogImage"];
const CLI = path.resolve(__dirname, "../../../dist/index.js");

/** The GEO part of a page: `geo` plus the GEO seo keys, with unset keys left out. */
function geoPart(page: any): { geo: any; seo: Record<string, any> } {
  const seo: Record<string, any> = {};
  for (const key of GEO_SEO_KEYS) {
    if (page?.seo?.[key] !== undefined && page?.seo?.[key] !== null) seo[key] = page.seo[key];
  }
  return { geo: page?.geo ?? null, seo };
}

describeIfConfigured("GEO fields round trip (PROD-2729)", () => {
  jest.setTimeout(20 * 60 * 1000);

  const auth = new Auth();
  let workDir: string;
  let source: mgmtApi.ApiClient;
  let target: mgmtApi.ApiClient;

  function client(guid: string): mgmtApi.ApiClient {
    return new mgmtApi.ApiClient({ token: TOKEN!, baseUrl: auth.determineBaseUrl(guid) } as mgmtApi.Options);
  }

  /** The source page as the CLI will pull it: from the Fetch API (preview), not the Management API. */
  async function fetchSourcePage(pageID: number): Promise<any> {
    const keyResponse = await fetch(`${auth.determineBaseUrl(SOURCE)}/oauth/GetPreviewKey?guid=${SOURCE}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Cache-Control": "no-cache" },
    });
    if (!keyResponse.ok) throw new Error(`GetPreviewKey failed: HTTP ${keyResponse.status}`);
    const key = (await keyResponse.text()).replace(/^"|"$/g, "");
    const response = await fetch(
      `${auth.determineFetchUrl(SOURCE)}/${SOURCE}/preview/${LOCALE}/page/${pageID}?contentLinkDepth=0`,
      { headers: { APIKey: key } }
    );
    if (!response.ok) throw new Error(`Fetch API page ${pageID}: HTTP ${response.status}`);
    return response.json();
  }

  function targetPageID(sourcePageID: number): number | undefined {
    setState({ rootPath: path.join(workDir, "agility-files") });
    const mapping = new PageMapper(SOURCE!, TARGET!, LOCALE).getPageMappingByPageID(sourcePageID, "source");
    return mapping?.targetPageID > 0 ? mapping.targetPageID : undefined;
  }

  function runSync(summaryPath: string) {
    fs.rmSync(summaryPath, { force: true });
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        "sync",
        `--sourceGuid=${SOURCE}`,
        `--targetGuid=${TARGET}`,
        `--token=${TOKEN}`,
        `--locales=${LOCALE}`,
        `--channel=${CHANNEL}`,
        `--pages=${[STATIC_PAGE_ID, DYNAMIC_PAGE_ID, INVALID_PAGE_ID].join(",")}`,
        // The fixtures may have been synced before; overwrite so a target-side edit can't skip them.
        "--overwrite",
        "--headless",
        `--jsonSummary=${summaryPath}`,
      ],
      { cwd: workDir, encoding: "utf8", env: { ...process.env }, maxBuffer: 64 * 1024 * 1024 }
    );
    if (!fs.existsSync(summaryPath)) {
      throw new Error(`sync wrote no summary (exit ${result.status}).\n${result.stdout}\n${result.stderr}`);
    }
    return { exitCode: result.status, summary: JSON.parse(fs.readFileSync(summaryPath, "utf8")) };
  }

  let sourcePages: Record<number, any>;
  let invalidTargetBefore: { geo: any; seo: Record<string, any> };
  let run: { exitCode: number | null; summary: any };

  beforeAll(async () => {
    if (!fs.existsSync(CLI)) throw new Error(`Build the CLI first (npm run build): ${CLI} is missing`);
    resetState();
    // A stable folder, kept between runs: the CLI's mapping files live in it, and without them
    // every run would create the fixture pages on the target again.
    workDir = env.GEO_WORK_DIR || path.join(os.tmpdir(), `agility-geo-roundtrip-${SOURCE}-${TARGET}`);
    fs.mkdirSync(workDir, { recursive: true });
    source = client(SOURCE!);
    target = client(TARGET!);

    // Precondition: the source pages carry GEO data in the Fetch API output (stage 3).
    sourcePages = {};
    for (const id of [STATIC_PAGE_ID, DYNAMIC_PAGE_ID, INVALID_PAGE_ID]) {
      sourcePages[id] = await fetchSourcePage(id);
      if (!sourcePages[id]?.geo) {
        throw new Error(
          `Source page ${id} has no geo in the Fetch API output. Is stage 3 deployed, and was the page re-published after its GEO data was saved?`
        );
      }
    }
    // Sanity: the dynamic fixture really is dynamic, as the Management API sees it.
    const dynamicPage = await source.pageMethods.getPage(DYNAMIC_PAGE_ID, SOURCE!, LOCALE);
    if (!dynamicPage?.dynamic?.referenceName) {
      throw new Error(`GEO_DYNAMIC_PAGE_ID ${DYNAMIC_PAGE_ID} is not a dynamic page`);
    }

    // What the target has for the invalid fixture before this run. On a first run the page is
    // created by this sync, so it starts with no GEO data.
    const previousTargetID = targetPageID(INVALID_PAGE_ID);
    invalidTargetBefore = previousTargetID
      ? geoPart(await target.pageMethods.getPage(previousTargetID, TARGET!, LOCALE))
      : { geo: null, seo: {} };

    run = runSync(path.join(workDir, "summary.json"));
  });

  it("does not fail any of the fixture pages", () => {
    const failedIDs = (run.summary.failures || []).filter((f: any) => f.type === "page").map((f: any) => f.pageID);
    expect(failedIDs).not.toContain(STATIC_PAGE_ID);
    expect(failedIDs).not.toContain(DYNAMIC_PAGE_ID);
    expect(failedIDs).not.toContain(INVALID_PAGE_ID);
  });

  it.each([
    ["static", () => STATIC_PAGE_ID],
    ["dynamic", () => DYNAMIC_PAGE_ID],
  ])("copies geo and the GEO seo keys for the %s page", async (_kind, idOf) => {
    const sourceID = idOf();
    const targetID = targetPageID(sourceID);
    expect(targetID).toBeDefined();

    const targetPage = await target.pageMethods.getPage(targetID!, TARGET!, LOCALE);
    expect(geoPart(targetPage)).toEqual(geoPart(sourcePages[sourceID]));
  });

  it("reports the invalid page as 'GEO not copied' and keeps the target's GEO data", async () => {
    const warning = (run.summary.warnings || []).find(
      (w: any) => w.code === "geoNotCopied" && w.pageID === INVALID_PAGE_ID
    );
    expect(warning).toBeDefined();
    expect(warning.error).toMatch(/^GEO not copied: /);

    // The page itself still synced.
    const targetID = targetPageID(INVALID_PAGE_ID);
    expect(targetID).toBeDefined();
    const after = geoPart(await target.pageMethods.getPage(targetID!, TARGET!, LOCALE));
    // The rejected values never reach the target.
    expect(after).not.toEqual(geoPart(sourcePages[INVALID_PAGE_ID]));
    expect(after).toEqual(invalidTargetBefore);
  });
});

if (!configured) {
  // Keep jest from reporting "Your test suite must contain at least one test".
  describe("GEO fields round trip (PROD-2729)", () => {
    it.skip("needs AGILITY_TOKEN, GEO_SOURCE_GUID, GEO_TARGET_GUID and the three GEO_*_PAGE_ID fixtures", () => {});
  });
}

(itemsConfigured ? describe : describe.skip)("GEO fields round trip, dynamic-list items (PROD-2729)", () => {
  jest.setTimeout(20 * 60 * 1000);

  const auth = new Auth();
  let workDir: string;
  let target: mgmtApi.ApiClient;
  let sourceItems: Record<number, any>;
  let invalidTargetBefore: any;
  let run: { exitCode: number | null; summary: any };

  /** The source item as the CLI will pull it: from the Fetch API (preview). */
  async function fetchSourceItem(contentID: number): Promise<any> {
    const keyResponse = await fetch(`${auth.determineBaseUrl(SOURCE)}/oauth/GetPreviewKey?guid=${SOURCE}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Cache-Control": "no-cache" },
    });
    if (!keyResponse.ok) throw new Error(`GetPreviewKey failed: HTTP ${keyResponse.status}`);
    const key = (await keyResponse.text()).replace(/^"|"$/g, "");
    const response = await fetch(
      `${auth.determineFetchUrl(SOURCE)}/${SOURCE}/preview/${LOCALE}/item/${contentID}?contentLinkDepth=0`,
      { headers: { APIKey: key } }
    );
    if (!response.ok) throw new Error(`Fetch API item ${contentID}: HTTP ${response.status}`);
    return response.json();
  }

  function targetContentID(sourceContentID: number): number | undefined {
    setState({ rootPath: path.join(workDir, "agility-files") });
    const mapping = new ContentItemMapper(SOURCE!, TARGET!, LOCALE).getContentItemMappingByContentID(
      sourceContentID,
      "source"
    );
    return mapping && mapping.targetContentID > 0 ? mapping.targetContentID : undefined;
  }

  beforeAll(async () => {
    if (!fs.existsSync(CLI)) throw new Error(`Build the CLI first (npm run build): ${CLI} is missing`);
    resetState();
    workDir = env.GEO_WORK_DIR || path.join(os.tmpdir(), `agility-geo-roundtrip-${SOURCE}-${TARGET}`);
    fs.mkdirSync(workDir, { recursive: true });
    target = new mgmtApi.ApiClient({ token: TOKEN!, baseUrl: auth.determineBaseUrl(TARGET!) } as mgmtApi.Options);

    // Precondition: the source items carry GEO data in the Fetch API output.
    sourceItems = {};
    for (const id of [ITEM_ID, INVALID_ITEM_ID].filter((x) => x > 0)) {
      sourceItems[id] = await fetchSourceItem(id);
      if (!sourceItems[id]?.geo) {
        throw new Error(
          `Source item ${id} has no geo in the Fetch API output. Is the Fetch API item half deployed, is the item in a dynamic page list, and was it re-published after its GEO data was saved?`
        );
      }
    }

    const previousInvalid = INVALID_ITEM_ID > 0 ? targetContentID(INVALID_ITEM_ID) : undefined;
    invalidTargetBefore = previousInvalid
      ? (((await target.contentMethods.getContentItem(previousInvalid, TARGET!, LOCALE)) as any)?.geo ?? null)
      : null;

    const summaryPath = path.join(workDir, "summary-items.json");
    fs.rmSync(summaryPath, { force: true });
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        "sync",
        `--sourceGuid=${SOURCE}`,
        `--targetGuid=${TARGET}`,
        `--token=${TOKEN}`,
        `--locales=${LOCALE}`,
        `--containers=${ITEM_CONTAINER}`,
        "--overwrite",
        "--headless",
        `--jsonSummary=${summaryPath}`,
      ],
      { cwd: workDir, encoding: "utf8", env: { ...process.env }, maxBuffer: 64 * 1024 * 1024 }
    );
    if (!fs.existsSync(summaryPath)) {
      throw new Error(`sync wrote no summary (exit ${result.status}).\n${result.stdout}\n${result.stderr}`);
    }
    run = { exitCode: result.status, summary: JSON.parse(fs.readFileSync(summaryPath, "utf8")) };
  });

  it("does not fail the fixture items", () => {
    const failedIDs = (run.summary.failures || [])
      .filter((f: any) => f.type === "content")
      .map((f: any) => f.contentID);
    expect(failedIDs).not.toContain(ITEM_ID);
    if (INVALID_ITEM_ID > 0) expect(failedIDs).not.toContain(INVALID_ITEM_ID);
  });

  it("copies the item's geo", async () => {
    const targetID = targetContentID(ITEM_ID);
    expect(targetID).toBeDefined();
    const targetItem: any = await target.contentMethods.getContentItem(targetID!, TARGET!, LOCALE);
    expect(targetItem?.geo ?? null).toEqual(sourceItems[ITEM_ID].geo);
  });

  (INVALID_ITEM_ID > 0 ? it : it.skip)(
    "reports the invalid item as 'GEO not copied' and keeps the target's GEO data",
    async () => {
      const warning = (run.summary.warnings || []).find(
        (w: any) => w.code === "geoNotCopied" && w.contentID === INVALID_ITEM_ID
      );
      expect(warning).toBeDefined();
      expect(warning.error).toMatch(/^GEO not copied: /);

      const targetID = targetContentID(INVALID_ITEM_ID);
      expect(targetID).toBeDefined();
      const after: any = await target.contentMethods.getContentItem(targetID!, TARGET!, LOCALE);
      expect(after?.geo ?? null).not.toEqual(sourceItems[INVALID_ITEM_ID].geo);
      expect(after?.geo ?? null).toEqual(invalidTargetBefore);
    }
  );
});
