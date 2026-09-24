import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { resetState, setState, state } from "core/state";
import { resolveContainerSyncScope } from "lib/containers/resolve-container-sync-scope";
import { GuidDataLoader } from "../guid-data-loader";

/**
 * Selective container sync filtering (PROD-2547).
 *
 * These run the real path end to end — resolve the scope off disk, build the dependency trees,
 * then filter a load with them — over the case the ticket describes:
 *
 *   container 200 "AON Home Links"          model HomeLinks   content 1, which links to 2
 *   container 201 "Mega Millions Home Links" model HomeLinks   content 3
 *   container 300 "Games"                    model Game        content 2, and unrelated 4
 *   container 900 "Unrelated"                model Unrelated   content 9
 */

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-gdl-containers-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  // The dependency tree builder constructs an AssetMapper, which needs both guids.
  state.targetGuid = "target-guid-c";
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

function layDownInstance(guid: string, locales = ["en-us"]): void {
  const guidDir = path.join(tmpDir, guid);

  ["models", "containers", "templates", "galleries", path.join("assets", "json")].forEach((dir) =>
    fs.mkdirSync(path.join(guidDir, dir), { recursive: true })
  );

  write(path.join(guidDir, "models", "10.json"), { id: 10, referenceName: "HomeLinks", fields: [] });
  write(path.join(guidDir, "models", "11.json"), { id: 11, referenceName: "Game", fields: [] });
  write(path.join(guidDir, "models", "99.json"), { id: 99, referenceName: "Unrelated", fields: [] });

  write(path.join(guidDir, "containers", "200.json"), {
    contentViewID: 200,
    contentDefinitionID: 10,
    referenceName: "AONHomeLinks",
    title: "AON Home Links",
  });
  write(path.join(guidDir, "containers", "201.json"), {
    contentViewID: 201,
    contentDefinitionID: 10,
    referenceName: "MegaMillionsHomeLinks",
    title: "Mega Millions Home Links",
  });
  write(path.join(guidDir, "containers", "300.json"), {
    contentViewID: 300,
    contentDefinitionID: 11,
    referenceName: "Games",
    title: "Games",
  });
  write(path.join(guidDir, "containers", "900.json"), {
    contentViewID: 900,
    contentDefinitionID: 99,
    referenceName: "UnrelatedList",
    title: "Unrelated",
  });

  write(path.join(guidDir, "templates", "500.json"), { pageTemplateID: 500, pageTemplateName: "Lottery" });

  locales.forEach((locale) => {
    const localeDir = path.join(guidDir, locale);
    ["item", "page", "urlredirections"].forEach((dir) => fs.mkdirSync(path.join(localeDir, dir), { recursive: true }));

    write(path.join(localeDir, "item", "1.json"), {
      contentID: 1,
      properties: { definitionName: "HomeLinks", referenceName: "AONHomeLinks" },
      fields: { game: { contentid: 2, fulllist: false } },
    });
    write(path.join(localeDir, "item", "2.json"), {
      contentID: 2,
      properties: { definitionName: "Game", referenceName: "Games" },
      fields: {},
    });
    write(path.join(localeDir, "item", "3.json"), {
      contentID: 3,
      properties: { definitionName: "HomeLinks", referenceName: "MegaMillionsHomeLinks" },
      fields: {},
    });
    write(path.join(localeDir, "item", "4.json"), {
      contentID: 4,
      properties: { definitionName: "Game", referenceName: "Games" },
      fields: {},
    });
    write(path.join(localeDir, "item", "9.json"), {
      contentID: 9,
      properties: { definitionName: "Unrelated", referenceName: "UnrelatedList" },
      fields: {},
    });

    write(path.join(localeDir, "page", "10.json"), {
      pageID: 10,
      name: "page-10",
      templateName: "Lottery",
      zones: { MainContentZone: [{ module: "Mod", item: { contentid: 1, fulllist: false } }] },
    });

    write(path.join(localeDir, "urlredirections", "urlredirections.json"), {
      items: [{ id: 1, originUrl: "/a", destinationUrl: "/b" }],
    });
  });
}

async function scopeFor(guid: string, selectors: string[], locales = ["en-us"]) {
  state.sourceGuid = guid;
  return await resolveContainerSyncScope({
    sourceGuid: guid,
    targetGuid: state.targetGuid,
    locales,
    selectors,
  });
}

async function load(guid: string, locale: string, selectors: string[], locales = ["en-us"]) {
  const containerScope = await scopeFor(guid, selectors, locales);
  return await new GuidDataLoader(guid).loadGuidEntities(locale, { containerScope });
}

const asc = (a: number, b: number) => a - b;

// ─── tests ────────────────────────────────────────────────────────────────────

describe("GuidDataLoader.loadGuidEntities — --containers scope", () => {
  it("keeps the selected container and leaves its same-model sibling behind", async () => {
    const guid = "container-scope-siblings-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", ["AONHomeLinks"]);

    expect(entities.containers.map((c: any) => c.contentViewID)).toContain(200);
    expect(entities.containers.map((c: any) => c.contentViewID)).not.toContain(201);
  });

  it("keeps the content in the selected container, and what it links to", async () => {
    const guid = "container-scope-content-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", ["AONHomeLinks"]);

    // 1 lives in the container, 2 is linked from 1. 3 is the sibling's, 4 is an unlinked item in
    // the Games container, 9 is unrelated.
    expect(entities.content.map((c: any) => c.contentID).sort(asc)).toEqual([1, 2]);
  });

  it("brings in the container a linked item lives in", async () => {
    const guid = "container-scope-linked-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", ["AONHomeLinks"]);

    expect(entities.containers.map((c: any) => c.contentViewID).sort(asc)).toEqual([200, 300]);
  });

  it("keeps the models behind every in-scope container", async () => {
    const guid = "container-scope-models-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", ["AONHomeLinks"]);

    expect(entities.models.map((m: any) => m.referenceName).sort()).toEqual(["Game", "HomeLinks"]);
  });

  it("never syncs pages, templates or URL redirections", async () => {
    const guid = "container-scope-untouched-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", ["AONHomeLinks"]);

    expect(entities.pages).toHaveLength(0);
    expect(entities.templates).toHaveLength(0);
    expect(entities.urlRedirections).toHaveLength(0);
  });

  it("matches a container by its CMS title", async () => {
    const guid = "container-scope-title-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", ["AON Home Links"]);

    expect(entities.containers.map((c: any) => c.contentViewID)).toContain(200);
  });

  it("matches a container by its ID", async () => {
    const guid = "container-scope-id-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", ["200"]);

    expect(entities.containers.map((c: any) => c.contentViewID)).toContain(200);
  });

  it("syncs two named containers on the same model together", async () => {
    const guid = "container-scope-both-guid-u";
    layDownInstance(guid);

    const entities = await load(guid, "en-us", ["AONHomeLinks", "MegaMillionsHomeLinks"]);

    expect(entities.containers.map((c: any) => c.contentViewID)).toEqual(expect.arrayContaining([200, 201]));
    expect(entities.content.map((c: any) => c.contentID).sort(asc)).toEqual([1, 2, 3]);
  });

  it("halts the run when a selector matches nothing", async () => {
    const guid = "container-scope-bad-selector-guid-u";
    layDownInstance(guid);

    await expect(load(guid, "en-us", ["NoSuchContainer"])).rejects.toThrow(/Container validation failed/);
  });

  it("filters content per locale but containers against every locale's scope", async () => {
    const guid = "container-scope-locales-guid-u";
    layDownInstance(guid, ["en-us", "fr-ca"]);

    const containerScope = await scopeFor(guid, ["AONHomeLinks"], ["en-us", "fr-ca"]);
    const loader = new GuidDataLoader(guid);

    const enUs = await loader.loadGuidEntities("en-us", { containerScope });
    const frCa = await loader.loadGuidEntities("fr-ca", { containerScope });

    expect(enUs.content.map((c: any) => c.contentID).sort(asc)).toEqual([1, 2]);
    expect(frCa.content.map((c: any) => c.contentID).sort(asc)).toEqual([1, 2]);
    // The guid-level container phase runs once, with the first locale, so it has to see the union.
    expect(enUs.containers.map((c: any) => c.contentViewID).sort(asc)).toEqual([200, 300]);
  });

  it("leaves the load unfiltered when no scope is supplied", async () => {
    const guid = "container-scope-unfiltered-guid-u";
    layDownInstance(guid);
    state.sourceGuid = guid;

    const entities = await new GuidDataLoader(guid).loadGuidEntities("en-us");

    expect(entities.containers).toHaveLength(4);
    expect(entities.pages).toHaveLength(1);
  });
});
