import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { resetState, setState, state } from "core/state";
import { GuidDataLoader } from "../guid-data-loader";

/**
 * Selective page sync filtering (PROD-2546).
 *
 * Each test lays down a small instance on disk and checks what survives the scope:
 *
 *   page 10 (/my-lottery)       template "Lottery"   content 1 (Hero)
 *                                                      which links to content 2 (Related)
 *   page 11 (/my-lottery/rules) template "Lottery"   content 3 (Rules)
 *   page 99 (/elsewhere)        template "Other"     content 9 (Unrelated)
 */

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-gdl-pages-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  // The dependency tree builder constructs an AssetMapper, which needs both guids.
  state.targetGuid = "target-guid-u";
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function write(file: string, data: any): void {
  fs.writeFileSync(file, JSON.stringify(data));
}

function layDownInstance(guid: string, locale = "en-us"): void {
  const guidDir = path.join(tmpDir, guid);
  const localeDir = path.join(guidDir, locale);

  ["models", "containers", "templates", "galleries", path.join("assets", "json")].forEach((dir) =>
    fs.mkdirSync(path.join(guidDir, dir), { recursive: true })
  );
  ["item", "page", "urlredirections"].forEach((dir) => fs.mkdirSync(path.join(localeDir, dir), { recursive: true }));

  write(path.join(guidDir, "models", "1.json"), { id: 1, referenceName: "Hero", fields: [] });
  write(path.join(guidDir, "models", "2.json"), { id: 2, referenceName: "Related", fields: [] });
  write(path.join(guidDir, "models", "3.json"), { id: 3, referenceName: "Rules", fields: [] });
  write(path.join(guidDir, "models", "9.json"), { id: 9, referenceName: "Unrelated", fields: [] });

  write(path.join(guidDir, "containers", "100.json"), {
    contentViewID: 100,
    contentDefinitionID: 1,
    referenceName: "heroList",
  });
  write(path.join(guidDir, "containers", "900.json"), {
    contentViewID: 900,
    contentDefinitionID: 9,
    referenceName: "unrelatedList",
  });

  write(path.join(guidDir, "templates", "500.json"), { pageTemplateID: 500, pageTemplateName: "Lottery" });
  write(path.join(guidDir, "templates", "600.json"), { pageTemplateID: 600, pageTemplateName: "Other" });

  write(path.join(localeDir, "item", "1.json"), {
    contentID: 1,
    properties: { definitionName: "Hero", referenceName: "heroList" },
    fields: { related: { contentid: 2, fulllist: false } },
  });
  write(path.join(localeDir, "item", "2.json"), {
    contentID: 2,
    properties: { definitionName: "Related", referenceName: "relatedList" },
    fields: {},
  });
  write(path.join(localeDir, "item", "3.json"), {
    contentID: 3,
    properties: { definitionName: "Rules", referenceName: "rulesList" },
    fields: {},
  });
  write(path.join(localeDir, "item", "9.json"), {
    contentID: 9,
    properties: { definitionName: "Unrelated", referenceName: "unrelatedList" },
    fields: {},
  });

  const page = (pageID: number, templateName: string, contentid: number) => ({
    pageID,
    name: `page-${pageID}`,
    templateName,
    zones: { MainContentZone: [{ module: "Mod", item: { contentid, fulllist: false } }] },
  });
  write(path.join(localeDir, "page", "10.json"), page(10, "Lottery", 1));
  write(path.join(localeDir, "page", "11.json"), page(11, "Lottery", 3));
  write(path.join(localeDir, "page", "99.json"), page(99, "Other", 9));

  write(path.join(localeDir, "urlredirections", "urlredirections.json"), {
    items: [{ id: 1, originUrl: "/a", destinationUrl: "/b" }],
  });
}

function makeScope(pageIDsByLocale: { [locale: string]: number[] }): any {
  const byLocale = new Map<string, any>();
  const allPageIDs = new Set<number>();

  Object.keys(pageIDsByLocale).forEach((locale) => {
    const pageIDs = new Set<number>(pageIDsByLocale[locale]);
    pageIDs.forEach((id) => allPageIDs.add(id));
    byLocale.set(locale, {
      locale,
      pageIDs,
      traversePageIDs: new Set<number>(),
      matches: [],
      unmatched: [],
      ancestors: [],
    });
  });

  return { selectors: ["/my-lottery"], byLocale, allPageIDs, sitemapsByLocale: {} };
}

function load(guid: string, locale: string, pageIDsByLocale?: { [locale: string]: number[] }) {
  state.sourceGuid = guid;
  const loader = new GuidDataLoader(guid);
  return pageIDsByLocale
    ? loader.loadGuidEntities(locale, { pageScope: makeScope(pageIDsByLocale) })
    : loader.loadGuidEntities(locale);
}

const asc = (a: number, b: number) => a - b;

// ─── tests ────────────────────────────────────────────────────────────────────

describe("GuidDataLoader.loadGuidEntities — --pages scope", () => {
  it("keeps only the in-scope pages", async () => {
    const guid = "page-scope-pages-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", { "en-us": [10, 11] });

    expect(entities.pages.map((p: any) => p.pageID).sort(asc)).toEqual([10, 11]);
  });

  it("keeps the content those pages reference, following linked content", async () => {
    const guid = "page-scope-content-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", { "en-us": [10, 11] });

    // 1 sits on the page, 2 is linked from 1, 3 sits on the child page; 9 belongs to page 99.
    expect(entities.content.map((c: any) => c.contentID).sort(asc)).toEqual([1, 2, 3]);
  });

  it("keeps only the models behind the in-scope content", async () => {
    const guid = "page-scope-models-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", { "en-us": [10, 11] });

    expect(entities.models.map((m: any) => m.referenceName).sort()).toEqual(["Hero", "Related", "Rules"]);
  });

  it("keeps only the containers behind the in-scope content", async () => {
    const guid = "page-scope-containers-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", { "en-us": [10, 11] });

    expect(entities.containers.map((c: any) => c.contentViewID)).toEqual([100]);
  });

  it("keeps the templates the in-scope pages use", async () => {
    const guid = "page-scope-templates-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", { "en-us": [10, 11] });

    expect(entities.templates.map((t: any) => t.pageTemplateID)).toEqual([500]);
  });

  it("never syncs URL redirections, which have nothing to do with a page subtree", async () => {
    const guid = "page-scope-redirects-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", { "en-us": [10, 11] });

    expect(entities.urlRedirections).toHaveLength(0);
  });

  it("returns nothing for a locale with no pages in scope", async () => {
    const guid = "page-scope-empty-locale-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", { "en-us": [] });

    expect(entities.pages).toHaveLength(0);
    expect(entities.content).toHaveLength(0);
    expect(entities.models).toHaveLength(0);
  });

  it("includes an instance-wide model that only a page in another locale needs", async () => {
    // The guid-level push phases run once, with the first locale. Scoping models to that single
    // locale would drop a model that only a fr-ca page depends on.
    const guid = "page-scope-multi-locale-guid-u";
    layDownInstance(guid, "en-us");
    layDownInstance(guid, "fr-ca");

    write(path.join(tmpDir, guid, "fr-ca", "page", "77.json"), {
      pageID: 77,
      name: "page-77",
      templateName: "Other",
      zones: { MainContentZone: [{ module: "Mod", item: { contentid: 9, fulllist: false } }] },
    });

    const entities = await load(guid, "en-us", { "en-us": [10], "fr-ca": [77] });

    // Instance-wide entities are unioned across locales.
    expect(entities.models.map((m: any) => m.referenceName).sort()).toEqual(["Hero", "Related", "Unrelated"]);
    expect(entities.templates.map((t: any) => t.pageTemplateID).sort(asc)).toEqual([500, 600]);

    // Locale-scoped entities stay scoped to the locale being loaded.
    expect(entities.pages.map((p: any) => p.pageID)).toEqual([10]);
    expect(entities.content.map((c: any) => c.contentID).sort(asc)).toEqual([1, 2]);
  });

  it("still resolves dependencies that --elements would otherwise have hidden", async () => {
    // --elements narrows which push PHASES run; it must not hide a dependency from the scope
    // builder, or the pages phase would run against a half-built tree.
    const guid = "page-scope-elements-guid-u";
    layDownInstance(guid);
    state.elements = "Pages";

    const entities = await load(guid, "en-us", { "en-us": [10] });

    expect(entities.pages.map((p: any) => p.pageID)).toEqual([10]);
    expect(entities.content.map((c: any) => c.contentID).sort(asc)).toEqual([1, 2]);
    expect(entities.templates.map((t: any) => t.pageTemplateID)).toEqual([500]);
  });

  it("leaves everything untouched when no scope is supplied", async () => {
    const guid = "page-scope-unscoped-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us");

    expect(entities.pages).toHaveLength(3);
    expect(entities.content).toHaveLength(4);
    expect(entities.models).toHaveLength(4);
    expect(entities.urlRedirections).toHaveLength(1);
  });
});
