import * as fs from "fs";
import * as os from "os";
import * as path from "path";

jest.mock("../../pushers/url-redirection-api", () => ({
  MAX_URL_REDIRECTION_BATCH_SIZE: 250,
  deleteUrlRedirections: jest.fn(async (_guid: string, ids: number[]) => ({ deleted: ids, notFound: [] })),
}));

import { state, resetState, setState } from "../../../core/state";
import { preflightReport } from "../../preflight/preflight-report";
import { runSyncDeletes } from "../sync-deletes";
import { deleteUrlRedirections } from "../../pushers/url-redirection-api";

const SRC = "src-1";
const TGT = "tgt-1";
const LOCALE = "en-us";

function writeJson(file: string, data: any) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function notFound(): any {
  const error: any = new Error("Unable to retrieve");
  error.innerError = { response: { status: 404, data: "not found" } };
  return error;
}

interface Fixture {
  root: string;
  deleted: string[];
  api: any;
}

/**
 * One source/target pair with a mapped entity of every kind, some deleted in the source.
 *
 * Source IDs are n, target IDs are 100 + n; target-only entities are 900+.
 */
function buildFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-deletes-"));
  const src = (rel: string, data: any) => writeJson(path.join(root, SRC, rel), data);
  const tgt = (rel: string, data: any) => writeJson(path.join(root, TGT, rel), data);
  const map = (rel: string, data: any[]) => writeJson(path.join(root, "mappings", `${SRC}-${TGT}`, rel, "mappings.json"), data);

  // ── source: only the live entities remain after the pull ──
  src(`${LOCALE}/item/1.json`, { contentID: 1, properties: { state: 2, versionID: 1, referenceName: "posts" } });
  src(`${LOCALE}/page/10.json`, { pageID: 10, name: "home", properties: { state: 2, versionID: 1 }, zones: {} });
  src("models/20.json", { id: 20, referenceName: "Post", lastModifiedDate: "2026-01-01T00:00:00" });
  src("containers/30.json", { contentViewID: 30, referenceName: "posts", lastModifiedDate: "01/01/2026 10:00AM" });
  src("templates/40.json", { pageTemplateID: 40, pageTemplateName: "Main" });
  src("assets/json/1.json", { assetMedias: [{ mediaID: 50, fileName: "a.png", dateModified: "2026-01-01T00:00:00" }] });
  src("galleries/60.json", { mediaGroupingID: 60, name: "Live", modifiedOn: "01/01/2026 10:00AM" });
  src(`${LOCALE}/urlredirections/urlredirections.json`, { items: [{ id: 70, originUrl: "/live" }] });

  // ── target ──
  const item = (id: number, extra: any = {}) => ({
    contentID: id,
    properties: { state: 2, versionID: 1, referenceName: "posts", definitionName: "Post" },
    fields: {},
    ...extra,
  });
  [101, 102, 103, 104, 105].forEach((id) => tgt(`${LOCALE}/item/${id}.json`, item(id)));
  // target-only item linking to 105
  tgt(`${LOCALE}/item/900.json`, item(900, { fields: { related: { contentid: 105 } } }));
  [110, 111, 112, 113].forEach((id) =>
    tgt(`${LOCALE}/page/${id}.json`, { pageID: id, name: `page-${id}`, templateName: "Main", properties: { versionID: 1 }, zones: {} })
  );
  tgt(`${LOCALE}/page/950.json`, { pageID: 950, name: "native-child", templateName: "Main", properties: { versionID: 1 }, zones: {} });
  tgt(`${LOCALE}/page/960.json`, { pageID: 960, name: "native-page", templateName: "Old", properties: { versionID: 1 }, zones: {} });
  tgt("models/120.json", { id: 120, referenceName: "Post", lastModifiedDate: "2026-01-01T00:00:00" });
  tgt("models/121.json", { id: 121, referenceName: "Gone", lastModifiedDate: "2026-01-01T00:00:00" });
  tgt("models/122.json", { id: 122, referenceName: "InUse", lastModifiedDate: "2026-01-01T00:00:00" });
  tgt("containers/130.json", { contentViewID: 130, referenceName: "posts", contentDefinitionID: 120, lastModifiedDate: "01/01/2026 10:00AM" });
  tgt("containers/131.json", { contentViewID: 131, referenceName: "empty", contentDefinitionID: 121, lastModifiedDate: "01/01/2026 10:00AM" });
  tgt("containers/990.json", { contentViewID: 990, referenceName: "native", contentDefinitionID: 122, lastModifiedDate: "01/01/2026 10:00AM" });
  tgt("templates/140.json", { pageTemplateID: 140, pageTemplateName: "Main" });
  tgt("templates/141.json", { pageTemplateID: 141, pageTemplateName: "Old" });
  tgt("assets/json/1.json", {
    assetMedias: [
      { mediaID: 150, fileName: "a.png", dateModified: "2026-01-01T00:00:00" },
      { mediaID: 151, fileName: "b.png", url: "https://cdn/b.png", dateModified: "2026-01-01T00:00:00" },
    ],
  });
  tgt("galleries/160.json", { mediaGroupingID: 160, name: "Live", modifiedOn: "01/01/2026 10:00AM" });
  tgt("galleries/161.json", { mediaGroupingID: 161, name: "Gone", modifiedOn: "01/01/2026 10:00AM" });
  tgt(`${LOCALE}/urlredirections/urlredirections.json`, { items: [{ id: 170 }, { id: 171 }] });

  // ── mappings ──
  map(`${LOCALE}/item`, [1, 2, 3, 4, 5].map((n) => ({ sourceContentID: n, targetContentID: 100 + n, sourceVersionID: 1, targetVersionID: 1 })));
  map(`${LOCALE}/page`, [10, 11, 12, 13].map((n) => ({ sourcePageID: n, targetPageID: 100 + n, sourceVersionID: 1, targetVersionID: 1 })));
  map("models", [20, 21, 22].map((n) => ({ sourceID: n, targetID: 100 + n, targetLastModifiedDate: "2026-01-01T00:00:00" })));
  map("containers", [30, 31].map((n) => ({ sourceContentViewID: n, targetContentViewID: 100 + n, targetLastModifiedDate: "01/01/2026 10:00AM" })));
  map("templates", [40, 41].map((n) => ({ sourcePageTemplateID: n, targetPageTemplateID: 100 + n })));
  map("assets", [50, 51].map((n) => ({ sourceMediaID: n, targetMediaID: 100 + n, targetDateModified: "2026-01-01T00:00:00" })));
  map("galleries", [60, 61].map((n) => ({ sourceMediaGroupingID: n, targetMediaGroupingID: 100 + n, targetModifiedOn: "01/01/2026 10:00AM" })));
  map("urlredirections", [70, 71].map((n) => ({ sourceUrlRedirectionID: n, targetUrlRedirectionID: 100 + n, originUrl: `/r${n}` })));

  const deleted: string[] = [];
  const targetVersion: Record<number, number> = { 104: 9 }; // 104 was edited on the target since the sync
  const api = {
    contentMethods: {
      getContentItem: jest.fn(async (id: number, guid: string) => {
        if (guid === SRC) {
          if (id === 3) return { contentID: 3, properties: { state: 7 } };
          throw notFound();
        }
        if (deleted.includes(`content:${id}`)) throw notFound();
        return { contentID: id, properties: { state: 2, versionID: targetVersion[id] ?? 1, referenceName: "posts" } };
      }),
      deleteContent: jest.fn(async (id: number) => {
        deleted.push(`content:${id}`);
        return [1];
      }),
    },
    pageMethods: {
      getPage: jest.fn(async (id: number, guid: string) => {
        if (guid === SRC) throw notFound();
        if (deleted.includes(`page:${id}`)) throw notFound();
        return { pageID: id, name: `page-${id}`, properties: { state: 2, versionID: 1 } };
      }),
      getSitemap: jest.fn(async () => [
        {
          pages: [
            { pageID: 110, childPages: [] },
            { pageID: 111, childPages: [{ pageID: 112, childPages: [] }] },
            { pageID: 113, childPages: [{ pageID: 950, childPages: [] }] },
            { pageID: 960, childPages: [] },
          ],
        },
      ]),
      deletePage: jest.fn(async (id: number) => {
        deleted.push(`page:${id}`);
        return [2];
      }),
      deletePageTemplate: jest.fn(async (_guid: string, _locale: string, id: number) => {
        deleted.push(`template:${id}`);
        return "ok";
      }),
    },
    batchMethods: { getBatch: jest.fn(async () => ({ batchState: 3, items: [] })) },
    containerMethods: {
      deleteContainer: jest.fn(async (id: number) => {
        deleted.push(`container:${id}`);
        return "ok";
      }),
    },
    modelMethods: {
      deleteModel: jest.fn(async (id: number) => {
        deleted.push(`model:${id}`);
        return "ok";
      }),
    },
    assetMethods: {
      deleteFile: jest.fn(async (id: number) => {
        deleted.push(`asset:${id}`);
        return "ok";
      }),
      deleteGallery: jest.fn(async (_guid: string, id: number) => {
        deleted.push(`gallery:${id}`);
        return "ok";
      }),
    },
  };

  return { root, deleted, api };
}

const ALL_ELEMENTS = ["Galleries", "Assets", "Models", "Containers", "Content", "Templates", "Pages", "UrlRedirections"];

function configure(fixture: Fixture, extra: Record<string, any> = {}) {
  resetState();
  setState({ rootPath: fixture.root, sourceGuid: SRC, targetGuid: TGT, locales: LOCALE, isSync: true, syncDeletes: true, ...extra });
  state.cachedApiClient = fixture.api;
  preflightReport.reset();
}

function run() {
  return runSyncDeletes({ sourceGuid: SRC, targetGuid: TGT, locales: [LOCALE], elements: ALL_ELEMENTS });
}

function readMapping(fixture: Fixture, rel: string): any[] {
  return JSON.parse(fs.readFileSync(path.join(fixture.root, "mappings", `${SRC}-${TGT}`, rel, "mappings.json"), "utf8"));
}

function actions(result: Awaited<ReturnType<typeof run>>) {
  const out: Record<string, string> = {};
  result.candidates.forEach((c) => (out[`${c.kind}:${c.targetID}`] = c.action));
  return out;
}

let logSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  (deleteUrlRedirections as jest.Mock).mockClear();
});
afterEach(() => logSpy.mockRestore());

describe("runSyncDeletes", () => {
  it("plans every kind: deletes what is safe, keeps what is unpublished, changed or still used", async () => {
    const fixture = buildFixture();
    configure(fixture);
    const result = await run();

    expect(actions(result)).toEqual({
      "urlRedirection:171": "delete",
      "page:111": "delete",
      "page:112": "delete",
      "page:113": "blocked", // native child page 950 stays
      "content:102": "delete",
      "content:103": "keep", // unpublished in the source
      "content:104": "conflict", // edited on the target
      "content:105": "blocked", // linked from native item 900
      "container:131": "delete",
      "template:141": "blocked", // native page 960 uses it
      "model:121": "delete",
      "model:122": "blocked", // native container 990 uses it
      "asset:151": "delete",
      "gallery:161": "delete",
    });
    expect(result.candidates.find((c) => c.targetID === 103)?.reason).toContain("unpublished");
    expect(result.candidates.find((c) => c.targetID === 105)?.reason).toContain("content posts #900");
  });

  it("deletes children before parents and removes only the deleted mappings", async () => {
    const fixture = buildFixture();
    configure(fixture);
    const result = await run();

    expect(fixture.deleted).toEqual(
      expect.arrayContaining(["page:112", "page:111", "content:102", "container:131", "model:121", "asset:151", "gallery:161"])
    );
    expect(fixture.deleted.indexOf("page:112")).toBeLessThan(fixture.deleted.indexOf("page:111"));
    expect(fixture.deleted).not.toContain("content:104");
    expect(fixture.deleted).not.toContain("template:141");
    expect(deleteUrlRedirections).toHaveBeenCalledWith(TGT, [171]);

    expect(readMapping(fixture, `${LOCALE}/item`).map((r) => r.targetContentID)).toEqual([101, 103, 104, 105]);
    expect(readMapping(fixture, `${LOCALE}/page`).map((r) => r.targetPageID)).toEqual([110, 113]);
    expect(readMapping(fixture, "models").map((r) => r.targetID)).toEqual([120, 122]);
    expect(readMapping(fixture, "urlredirections").map((r) => r.targetUrlRedirectionID)).toEqual([170]);

    expect(result.successful).toBe(8);
    expect(result.failed).toBe(0);
    expect(result.warningDetails!.map((w) => w.name).sort()).toEqual(["InUse", "Old", "page-113", "posts #104", "posts #105"].sort());
  });

  it("deletes a target edited since the sync only with --overwrite", async () => {
    const fixture = buildFixture();
    configure(fixture, { overwrite: true });
    const result = await run();
    expect(actions(result)["content:104"]).toBe("delete");
    expect(fixture.deleted).toContain("content:104");
  });

  it("writes nothing under --preflight and reports the plan", async () => {
    const fixture = buildFixture();
    configure(fixture, { preflight: true });
    const before = readMapping(fixture, `${LOCALE}/item`);
    await run();

    expect(fixture.deleted).toEqual([]);
    expect(deleteUrlRedirections).not.toHaveBeenCalled();
    expect(readMapping(fixture, `${LOCALE}/item`)).toEqual(before);
    const totals = preflightReport.getTotals();
    expect(totals.delete).toBe(8);
    expect(totals.conflict).toBe(1);
    expect(preflightReport.getEntries().find((e) => e.name === "posts #102")).toMatchObject({
      phase: "Delete Content",
      action: "delete",
      locale: LOCALE,
    });
  });

  it("counts a target that disappeared before its delete (e.g. with its page) as done", async () => {
    const fixture = buildFixture();
    configure(fixture);
    fixture.api.pageMethods.deletePage.mockImplementation(async (id: number) => {
      fixture.deleted.push(`page:${id}`);
      if (id === 111) fixture.deleted.push("content:102"); // page delete took its zone content along
      return [2];
    });
    const result = await run();
    expect(fixture.api.contentMethods.deleteContent).not.toHaveBeenCalledWith(102, expect.anything(), expect.anything(), expect.anything(), expect.anything());
    expect(result.failed).toBe(0);
    expect(readMapping(fixture, `${LOCALE}/item`).map((r) => r.targetContentID)).not.toContain(102);
  });

  it("reports a failed delete and keeps its mapping", async () => {
    const fixture = buildFixture();
    configure(fixture);
    fixture.api.modelMethods.deleteModel.mockRejectedValue(new Error("model in use"));
    const result = await run();
    expect(result.failed).toBe(1);
    expect(result.status).toBe("error");
    expect(result.failureDetails![0]).toMatchObject({ name: "Gone", type: "model" });
    expect(readMapping(fixture, "models").map((r) => r.targetID)).toContain(121);
  });

  it("does not delete anything of a kind whose source list is empty", async () => {
    const fixture = buildFixture();
    configure(fixture);
    fs.rmSync(path.join(fixture.root, SRC, "models"), { recursive: true });
    const result = await run();
    expect(actions(result)["model:121"]).toBe("keep");
    expect(fixture.deleted).not.toContain("model:121");
  });

  it("only considers the kinds in --elements", async () => {
    const fixture = buildFixture();
    configure(fixture);
    const result = await runSyncDeletes({ sourceGuid: SRC, targetGuid: TGT, locales: [LOCALE], elements: ["Content"] });
    expect(new Set(result.candidates.map((c) => c.kind))).toEqual(new Set(["content"]));
  });
});

describe("mass-delete guard", () => {
  function massFixture(): Fixture {
    const fixture = buildFixture();
    const records = Array.from({ length: 12 }, (_, i) => ({
      sourceContentID: 200 + i,
      targetContentID: 300 + i,
      sourceVersionID: 1,
      targetVersionID: 1,
    }));
    records.forEach((r) =>
      writeJson(path.join(fixture.root, TGT, LOCALE, "item", `${r.targetContentID}.json`), {
        contentID: r.targetContentID,
        properties: { state: 2, versionID: 1, referenceName: "posts" },
        fields: {},
      })
    );
    writeJson(path.join(fixture.root, "mappings", `${SRC}-${TGT}`, LOCALE, "item", "mappings.json"), [
      { sourceContentID: 1, targetContentID: 101, sourceVersionID: 1, targetVersionID: 1 },
      ...records,
    ]);
    return fixture;
  }

  it("refuses to delete anything when one kind would lose most of its mapped entities", async () => {
    const fixture = massFixture();
    configure(fixture);
    const result = await run();
    expect(result.massDeleteRefused).toBe(true);
    expect(result.failed).toBe(1);
    expect(fixture.deleted).toEqual([]);
    expect(result.failureDetails![0].error).toContain("--allowMassDeletes");
  });

  it("goes ahead with --allowMassDeletes", async () => {
    const fixture = massFixture();
    configure(fixture, { allowMassDeletes: true });
    const result = await run();
    expect(result.massDeleteRefused).toBe(false);
    expect(fixture.deleted.filter((d) => d.startsWith("content:3"))).toHaveLength(12);
  });
});
