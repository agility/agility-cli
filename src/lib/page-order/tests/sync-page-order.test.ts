import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { state, resetState, setState } from "../../../core/state";
import { preflightReport } from "../../preflight/preflight-report";
import { fromManagementSitemap, planPageMoves, runSyncPageOrder, TreeNode } from "../sync-page-order";
import { recordHeldPage, resetHeldPages } from "../held-pages";

// A nested sitemap from [pageID, children?] tuples.
type Spec = number | [number, Spec[]];
const tree = (specs: Spec[]): TreeNode[] =>
  specs.map((s) => (typeof s === "number" ? { pageID: s, children: [] } : { pageID: s[0], children: tree(s[1]) }));

// Source n maps to target n unless a map is given.
const identity = (id: number) => id;
const mapOf = (pairs: Array<[number, number]>) => {
  const m = new Map(pairs);
  return (id: number) => m.get(id);
};

// Apply planned moves to one parent's child list, as the move endpoint would.
const apply = (children: number[], moves: { pageID: number; placeBeforePageID: number }[]) => {
  let out = [...children];
  for (const m of moves) {
    out = out.filter((id) => id !== m.pageID);
    const at = m.placeBeforePageID > 0 ? out.indexOf(m.placeBeforePageID) : out.length;
    out.splice(at, 0, m.pageID);
  }
  return out;
};

describe("planPageMoves", () => {
  it("moves the one page out of place among its siblings, before its next source sibling", () => {
    // The reported case: the source has 8 fourth, the target has it last.
    const source = tree([[7, [15, 13, 11, 8, 10, 9]]]);
    const target = tree([[7, [15, 13, 11, 10, 9, 8]]]);

    const plan = planPageMoves(source, target, identity);

    expect(plan.moves).toEqual([{ pageID: 8, parentPageID: 7, placeBeforePageID: 10, reason: "order" }]);
    expect(plan.unresolvedParents).toEqual([]);
  });

  it("moves nothing when the target is already in the source's order", () => {
    const plan = planPageMoves(tree([[1, [2, 3, 4]]]), tree([[1, [2, 3, 4]]]), identity);

    expect(plan.moves).toEqual([]);
  });

  it("ignores target-only pages: in order when the synced pages are in order around them", () => {
    const plan = planPageMoves(tree([[1, [2, 3]]]), tree([[1, [900, 2, 901, 3]]]), identity);

    expect(plan.moves).toEqual([]);
  });

  it("places a page moved to the end of the source last (-1)", () => {
    const plan = planPageMoves(tree([[1, [3, 4, 2]]]), tree([[1, [2, 3, 4]]]), identity);

    expect(plan.moves).toEqual([{ pageID: 2, parentPageID: 1, placeBeforePageID: -1, reason: "order" }]);
  });

  it("works through the source order from the end, so each anchor is already in place", () => {
    // Reversed: one page stays, the others move, and applying the moves in order gives the source's order.
    const plan = planPageMoves(tree([[1, [2, 3, 4]]]), tree([[1, [4, 3, 2]]]), identity);

    expect(plan.moves).toHaveLength(2);
    expect(apply([4, 3, 2], plan.moves)).toEqual([2, 3, 4]);
  });

  it("moves a page that is under another parent on the target, parent first", () => {
    const source = tree([
      [1, [3]],
      [2, []],
    ]);
    const target = tree([1, [2, [3]]]);

    const plan = planPageMoves(source, target, identity);

    expect(plan.moves).toEqual([{ pageID: 3, parentPageID: 1, placeBeforePageID: -1, reason: "parent" }]);
  });

  it("moves root pages with parent -1", () => {
    const plan = planPageMoves(tree([1, 2]), tree([2, 1]), identity);

    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0].parentPageID).toBe(-1);
    expect(apply([2, 1], plan.moves)).toEqual([1, 2]);
  });

  it("maps source page IDs to target page IDs", () => {
    const toTarget = mapOf([
      [1, 101],
      [2, 102],
      [3, 103],
    ]);
    const plan = planPageMoves(tree([[1, [2, 3]]]), tree([[101, [103, 102]]]), toTarget);

    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0].parentPageID).toBe(101);
    expect(apply([103, 102], plan.moves)).toEqual([102, 103]);
  });

  it("leaves unmapped pages and pages not on the target to the page phase", () => {
    const toTarget = mapOf([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4], // mapped, but not on the target
    ]);
    // 5 is not mapped at all.
    const plan = planPageMoves(tree([[1, [5, 4, 3, 2]]]), tree([[1, [2, 3]]]), toTarget);

    expect(plan.moves.map((m) => m.pageID).every((id) => id === 2 || id === 3)).toBe(true);
    expect(apply([2, 3], plan.moves)).toEqual([3, 2]);
  });

  it("skips a parent that isn't on the target", () => {
    const plan = planPageMoves(tree([[1, [2, 3]]]), tree([2, 3]), mapOf([[2, 2], [3, 3]]));

    expect(plan.moves).toEqual([]);
  });

  it("keeps a fixed page in place and moves the others around it", () => {
    const plan = planPageMoves(tree([[1, [2, 3, 4]]]), tree([[1, [4, 2, 3]]]), identity, new Set([4]));

    expect(plan.moves.find((m) => m.pageID === 4)).toBeUndefined();
    expect(apply([4, 2, 3], plan.moves)).toEqual([2, 3, 4]);
    expect(plan.unresolvedParents).toEqual([]);
  });

  it("reports a parent it can't fully order because two fixed pages are out of order", () => {
    const plan = planPageMoves(tree([[1, [2, 3, 4]]]), tree([[1, [3, 2, 4]]]), identity, new Set([2, 3]));

    expect(plan.moves).toEqual([]);
    expect(plan.unresolvedParents).toEqual([1]);
  });

  it("orders movable pages around a fixed page that is already in place", () => {
    const plan = planPageMoves(tree([[1, [2, 3, 4]]]), tree([[1, [3, 2, 4]]]), identity, new Set([3]));

    expect(plan.moves).toEqual([{ pageID: 2, parentPageID: 1, placeBeforePageID: 3, reason: "order" }]);
    expect(plan.unresolvedParents).toEqual([]);
  });

  it("ignores dynamic page items (nodes with a contentID)", () => {
    const source: TreeNode[] = [{ pageID: 1, children: [{ pageID: 3, contentID: 50 }, { pageID: 2 }, { pageID: 3 }] }];
    const plan = planPageMoves(source, tree([[1, [2, 3]]]), identity);

    expect(plan.moves).toEqual([]);
  });
});

describe("fromManagementSitemap", () => {
  it("reads childPages and drops entries without a numeric pageID", () => {
    expect(fromManagementSitemap([{ pageID: 1, childPages: [{ pageID: 2, childPages: null }, { name: "x" }] }, null])).toEqual([
      { pageID: 1, children: [{ pageID: 2, children: [] }] },
    ]);
  });

  it("handles a missing sitemap", () => {
    expect(fromManagementSitemap(undefined)).toEqual([]);
  });
});

describe("runSyncPageOrder", () => {
  const SRC = "src-1";
  const TGT = "tgt-1";
  const LOCALES = ["en-us", "pt-br"];
  let root: string;
  let api: any;
  let targetChildren: number[];
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const writeJson = (rel: string, data: any) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };

  const sourceOrder = [15, 13, 11, 8, 10, 9];

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    root = fs.mkdtempSync(path.join(os.tmpdir(), "page-order-"));
    targetChildren = [15, 13, 11, 10, 9, 8];

    for (const locale of LOCALES) {
      writeJson(`${SRC}/${locale}/nestedsitemap/website.json`, [
        { pageID: 7, name: "parent", path: "/parent", children: sourceOrder.map((id) => ({ pageID: id, name: `p${id}`, path: `/parent/p${id}` })) },
      ]);
      // Source n maps to target 100 + n.
      writeJson(
        `mappings/${SRC}-${TGT}/${locale}/page/mappings.json`,
        [7, ...sourceOrder].map((n) => ({
          sourceGuid: SRC,
          targetGuid: TGT,
          sourcePageID: n,
          targetPageID: 100 + n,
          sourceVersionID: 1,
          targetVersionID: 10,
          sourcePageTemplateName: "t",
          targetPageTemplateName: "t",
        }))
      );
      [7, ...sourceOrder].forEach((n) => {
        writeJson(`${SRC}/${locale}/page/${n}.json`, { pageID: n, name: `p${n}`, properties: { state: 2 } });
        writeJson(`${TGT}/${locale}/page/${100 + n}.json`, { pageID: 100 + n, name: `p${n}`, properties: { state: 2 } });
      });
    }

    api = {
      pageMethods: {
        // The live sitemap reflects the moves made so far.
        getSitemap: jest.fn(async () => [
          { name: "Website", pages: [{ pageID: 107, childPages: targetChildren.map((n) => ({ pageID: 100 + n, childPages: [] })) }] },
        ]),
        movePage: jest.fn(async (pageID: number, _guid: string, _locale: string, _parent: number, before: number) => {
          const id = pageID - 100;
          targetChildren = targetChildren.filter((n) => n !== id);
          const at = before > 0 ? targetChildren.indexOf(before - 100) : targetChildren.length;
          targetChildren.splice(at, 0, id);
          return { moved: true };
        }),
        getPage: jest.fn(async (pageID: number) => ({ pageID, name: `p${pageID - 100}`, properties: { versionID: 11 } })),
      },
    };

    resetState();
    setState({ rootPath: root, sourceGuid: SRC, targetGuid: TGT, locales: LOCALES.join(","), isSync: true });
    state.cachedApiClient = api;
    preflightReport.reset();
    resetHeldPages();
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const run = () => runSyncPageOrder({ sourceGuid: SRC, targetGuid: TGT, locales: LOCALES });

  it("moves the out-of-place page once, not again for the second locale", async () => {
    const result = await run();

    expect(api.pageMethods.movePage).toHaveBeenCalledTimes(1);
    expect(api.pageMethods.movePage).toHaveBeenCalledWith(108, TGT, "en-us", 107, 110);
    expect(targetChildren).toEqual(sourceOrder);
    expect(result).toMatchObject({ successful: 1, failed: 0, status: "success" });
  });

  it("moves the recorded target version forward in every locale, so the move isn't read as a target change", async () => {
    await run();

    for (const locale of LOCALES) {
      const mappings = JSON.parse(fs.readFileSync(path.join(root, `mappings/${SRC}-${TGT}/${locale}/page/mappings.json`), "utf8"));
      expect(mappings.find((m: any) => m.targetPageID === 108).targetVersionID).toBe(11);
    }
  });

  it("queues the moved page for republishing in each locale where it is published on both sides", async () => {
    await run();

    for (const locale of LOCALES) {
      expect(state.otherLocaleStagingRegistry.get(locale)?.get(108)).toMatchObject({ cause: "page move", savedLocale: "en-us" });
    }
  });

  it("doesn't move a page the page phase held, without --overwrite; the others move around it", async () => {
    recordHeldPage(8);

    await run();

    expect(api.pageMethods.movePage.mock.calls.map((c: any[]) => c[0])).not.toContain(108);
    expect(targetChildren).toEqual(sourceOrder);
  });

  it("moves a held page with --overwrite", async () => {
    recordHeldPage(8);
    setState({ overwrite: true });

    await run();

    expect(api.pageMethods.movePage).toHaveBeenCalledWith(108, TGT, "en-us", 107, 110);
  });

  it("previews the move once under --preflight and moves nothing", async () => {
    setState({ preflight: true });

    const result = await run();

    expect(api.pageMethods.movePage).not.toHaveBeenCalled();
    expect(result.successful).toBe(1);
  });

  it("counts a move the API says was a no-op as skipped", async () => {
    api.pageMethods.movePage.mockResolvedValue({ moved: false });

    const result = await run();

    expect(result).toMatchObject({ successful: 0, skipped: 2, failed: 0 });
  });

  it("reports a failed move without stopping the run", async () => {
    api.pageMethods.movePage.mockRejectedValue(new Error("boom"));

    const result = await run();

    expect(result.status).toBe("error");
    expect(result.failed).toBeGreaterThan(0);
    expect(result.failureDetails![0].error).toContain("boom");
  });

  it("fails the locale when the target sitemap can't be read", async () => {
    api.pageMethods.getSitemap.mockRejectedValue(new Error("503"));

    const result = await run();

    expect(result).toMatchObject({ failed: 2, status: "error" });
    expect(api.pageMethods.movePage).not.toHaveBeenCalled();
  });
});
