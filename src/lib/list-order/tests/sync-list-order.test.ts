import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { state, resetState, setState } from "../../../core/state";
import { preflightReport } from "../../preflight/preflight-report";
import { ListItem, containerMapFrom, contentMapFrom, planListOrders, runSyncListOrder } from "../sync-list-order";

const LOCALE = "en-us";

// contentID, itemOrder (list "links" unless given)
const item = (contentID: number, itemOrder: number | null, referenceName = "links", state = 2): ListItem => ({
  contentID,
  properties: { referenceName, itemOrder, state },
});

// Source n maps to target 100 + n.
const contentMap = (...ids: number[]) => new Map(ids.map((n) => [n, 100 + n] as [number, number]));
const containerMap = new Map([["links", "links"]]);

describe("planListOrders", () => {
  it("sends the source order, mapped, when the target is in another order", () => {
    const plans = planListOrders(
      LOCALE,
      [item(1, 0), item(2, 1), item(3, 2)],
      [item(101, 0), item(103, 1), item(102, 2)],
      contentMap(1, 2, 3),
      containerMap
    );

    expect(plans).toEqual([{ locale: LOCALE, sourceReferenceName: "links", targetReferenceName: "links", contentIDs: [101, 102, 103] }]);
  });

  it("leaves a list alone when the target already sorts that way, gaps and all", () => {
    const plans = planListOrders(LOCALE, [item(1, 0), item(2, 1)], [item(101, 4), item(102, 20)], contentMap(1, 2), containerMap);

    expect(plans).toEqual([]);
  });

  it("reads order by value, not by position in the pull", () => {
    const plans = planListOrders(LOCALE, [item(2, 1), item(1, 0)], [item(102, 1), item(101, 0)], contentMap(1, 2), containerMap);

    expect(plans).toEqual([]);
  });

  it("includes a list that gained an item this run (not in the target pull yet)", () => {
    const plans = planListOrders(LOCALE, [item(1, 0), item(2, 1)], [item(102, 0)], contentMap(1, 2), containerMap);

    expect(plans[0].contentIDs).toEqual([101, 102]);
  });

  it("counts target-only items: in order when they already sit after the synced ones", () => {
    const plans = planListOrders(LOCALE, [item(1, 0), item(2, 1)], [item(101, 0), item(102, 1), item(900, 2)], contentMap(1, 2), containerMap);

    expect(plans).toEqual([]);
  });

  it("reorders when a target-only item sits above a synced one, and doesn't list the target-only item", () => {
    const plans = planListOrders(LOCALE, [item(1, 0), item(2, 1)], [item(900, 0), item(101, 1), item(102, 2)], contentMap(1, 2), containerMap);

    expect(plans[0].contentIDs).toEqual([101, 102]);
  });

  it("treats tied target values as out of order", () => {
    const plans = planListOrders(LOCALE, [item(1, 0), item(2, 1)], [item(101, 3), item(102, 3)], contentMap(1, 2), containerMap);

    expect(plans).toHaveLength(1);
  });

  it("sorts missing source values last, then by content ID", () => {
    const plans = planListOrders(
      LOCALE,
      [item(3, null), item(2, 0), item(1, null)],
      [],
      contentMap(1, 2, 3),
      containerMap
    );

    expect(plans[0].contentIDs).toEqual([102, 101, 103]);
  });

  it("leaves out source items with no mapping, and skips a list with none mapped", () => {
    const plans = planListOrders(
      LOCALE,
      [item(1, 0), item(2, 1), item(5, 0, "other")],
      [item(102, 0)],
      contentMap(2),
      new Map([["links", "links"], ["other", "other"]])
    );

    expect(plans).toEqual([]);
  });

  it("keeps the first position when two source items map to one target item", () => {
    const plans = planListOrders(LOCALE, [item(1, 0), item(2, 1), item(3, 2)], [], new Map([[1, 101], [2, 103], [3, 103]]), containerMap);

    expect(plans[0].contentIDs).toEqual([101, 103]);
  });

  it("ignores deleted items on both sides", () => {
    const plans = planListOrders(
      LOCALE,
      [item(1, 0), item(9, 1, "links", 3), item(2, 2)],
      [item(101, 0), item(102, 1), item(109, 2, "links", 3)],
      contentMap(1, 2, 9),
      containerMap
    );

    expect(plans).toEqual([]);
  });

  it("maps the list through the container mapping, case-insensitively", () => {
    const plans = planListOrders(
      LOCALE,
      [item(1, 0, "FooterLinks"), item(2, 1, "FooterLinks")],
      [item(102, 0, "footerlinks_t"), item(101, 1, "footerlinks_t")],
      contentMap(1, 2),
      new Map([["footerlinks", "FooterLinks_T"]])
    );

    expect(plans).toEqual([
      { locale: LOCALE, sourceReferenceName: "FooterLinks", targetReferenceName: "FooterLinks_T", contentIDs: [101, 102] },
    ]);
  });

  it("skips a list with no container mapping", () => {
    expect(planListOrders(LOCALE, [item(1, 0), item(2, 1)], [], contentMap(1, 2), new Map())).toEqual([]);
  });

  it("only considers the scoped lists, but sends every mapped item in them", () => {
    const plans = planListOrders(
      LOCALE,
      [item(1, 0), item(2, 1), item(3, 0, "other"), item(4, 1, "other")],
      [item(102, 0), item(101, 1), item(104, 0, "other"), item(103, 1, "other")],
      contentMap(1, 2, 3, 4),
      new Map([["links", "links"], ["other", "other"]]),
      new Set(["links"])
    );

    expect(plans.map((p) => [p.targetReferenceName, p.contentIDs])).toEqual([["links", [101, 102]]]);
  });
});

describe("mapping helpers", () => {
  it("contentMapFrom lets the last record for a source win and drops incomplete ones", () => {
    const map = contentMapFrom([
      { sourceContentID: 1, targetContentID: 101 },
      { sourceContentID: 1, targetContentID: 111 },
      { sourceContentID: 2, targetContentID: -1 },
    ]);

    expect(Array.from(map.entries())).toEqual([[1, 111]]);
  });

  it("containerMapFrom keys by lower-case source name and falls back to same-named target lists", () => {
    const map = containerMapFrom([{ sourceReferenceName: "Posts", targetReferenceName: "Posts_T" }], ["Links", "posts"]);

    expect(map.get("posts")).toBe("Posts_T");
    expect(map.get("links")).toBe("Links");
  });
});

describe("runSyncListOrder", () => {
  const SRC = "src-1";
  const TGT = "tgt-1";
  let root: string;
  let api: any;
  let logSpy: jest.SpyInstance;

  const writeJson = (rel: string, data: any) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    root = fs.mkdtempSync(path.join(os.tmpdir(), "list-order-"));

    // Source: links in order 1, 2, 3. Target: 103, 101, 102, plus a target-only 900 on top.
    [1, 2, 3].forEach((n, i) =>
      writeJson(`${SRC}/${LOCALE}/item/${n}.json`, { contentID: n, properties: { state: 2, referenceName: "links", itemOrder: i } })
    );
    [[900, 0], [103, 1], [101, 2], [102, 3]].forEach(([id, order]) =>
      writeJson(`${TGT}/${LOCALE}/item/${id}.json`, { contentID: id, properties: { state: 2, referenceName: "links", itemOrder: order } })
    );
    writeJson(`mappings/${SRC}-${TGT}/${LOCALE}/item/mappings.json`, [1, 2, 3].map((n) => ({ sourceContentID: n, targetContentID: 100 + n })));
    writeJson(`mappings/${SRC}-${TGT}/containers/mappings.json`, [{ sourceReferenceName: "links", targetReferenceName: "links" }]);

    api = {
      contentMethods: {
        setContentListItemOrder: jest.fn(async (_ref: string, _guid: string, _locale: string, ids: number[]) => ({
          contentIDs: [...ids, 900],
          itemsUpdated: 4,
          updatedContentIDs: [...ids, 900],
          skippedContentIDs: [],
        })),
      },
    };

    resetState();
    setState({ rootPath: root, sourceGuid: SRC, targetGuid: TGT, locales: LOCALE, isSync: true });
    state.cachedApiClient = api;
    preflightReport.reset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const run = (scoped?: Map<string, ListItem[]>) => runSyncListOrder({ sourceGuid: SRC, targetGuid: TGT, locales: [LOCALE] }, scoped);

  it("sets the target list to the source order, skipping unknown IDs, and counts it", async () => {
    const result = await run();

    expect(api.contentMethods.setContentListItemOrder).toHaveBeenCalledWith("links", TGT, LOCALE, [101, 102, 103], true);
    expect(result).toMatchObject({ successful: 1, failed: 0, skipped: 0, status: "success" });
  });

  it("counts a list the API says was already in order as skipped", async () => {
    api.contentMethods.setContentListItemOrder.mockResolvedValueOnce({ contentIDs: [101, 102, 103, 900], itemsUpdated: 0, updatedContentIDs: [], skippedContentIDs: [] });

    const result = await run();

    expect(result).toMatchObject({ successful: 0, skipped: 1, failed: 0 });
  });

  it("warns about mapped items the target list doesn't have", async () => {
    api.contentMethods.setContentListItemOrder.mockResolvedValueOnce({ contentIDs: [101, 102, 900], itemsUpdated: 2, updatedContentIDs: [101, 102], skippedContentIDs: [103] });

    const result = await run();

    expect(result.successful).toBe(1);
    expect(result.warningDetails).toHaveLength(1);
    expect(result.warningDetails![0]).toMatchObject({ name: "links", locale: LOCALE });
    expect(result.warningDetails![0].error).toContain("103");
  });

  it("records a failure and carries on when the API refuses", async () => {
    api.contentMethods.setContentListItemOrder.mockRejectedValueOnce(new Error("Unable to set the item order (HTTP 404): not found"));

    const result = await run();

    expect(result).toMatchObject({ failed: 1, status: "error" });
    expect(result.failureDetails![0].error).toContain("HTTP 404");
  });

  it("calls nothing when every list is already in the source order", async () => {
    writeJson(`${TGT}/${LOCALE}/item/900.json`, { contentID: 900, properties: { state: 2, referenceName: "links", itemOrder: 9 } });
    [[101, 0], [102, 1], [103, 2]].forEach(([id, order]) =>
      writeJson(`${TGT}/${LOCALE}/item/${id}.json`, { contentID: id, properties: { state: 2, referenceName: "links", itemOrder: order } })
    );

    const result = await run();

    expect(api.contentMethods.setContentListItemOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({ successful: 0, skipped: 0, failed: 0 });
  });

  it("preflight records the list and calls nothing", async () => {
    state.preflight = true;

    const result = await run();

    expect(api.contentMethods.setContentListItemOrder).not.toHaveBeenCalled();
    expect(result.successful).toBe(1);
    expect(preflightReport.toJSON().entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "List order", action: "update", name: "links", locale: LOCALE })])
    );
  });

  it("a scoped run only orders the lists its content was in", async () => {
    const result = await run(new Map([[LOCALE, [item(1, 0, "other")]]]));

    expect(api.contentMethods.setContentListItemOrder).not.toHaveBeenCalled();
    expect(result.successful).toBe(0);
  });
});
