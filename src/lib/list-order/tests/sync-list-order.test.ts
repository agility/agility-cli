import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { state, resetState, setState } from "../../../core/state";
import { preflightReport } from "../../preflight/preflight-report";
import {
  ListItem,
  ListOrderRecord,
  containerMapFrom,
  contentMapFrom,
  decideListOrders,
  planListOrders,
  relativeOrderChanged,
  runSyncListOrder,
} from "../sync-list-order";
import { keptTargetChanges } from "../../pushers/kept-target-changes";

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
    const plans = planListOrders(LOCALE, [item(1, 0), item(2, 1)], [item(102, 0)], contentMap(1, 2), containerMap, undefined, new Set([101]));

    expect(plans[0].contentIDs).toEqual([101, 102]);
  });

  it("ignores a stale mapping: a mapped item this run didn't save and the target doesn't have", () => {
    // 101 is mapped but gone from the target; 102 and 103 are already in order.
    const plans = planListOrders(LOCALE, [item(1, 0), item(2, 1), item(3, 2)], [item(102, 0), item(103, 1)], contentMap(1, 2, 3), containerMap);

    expect(plans).toEqual([]);
  });

  it("still reorders around a stale mapping when the rest is out of order", () => {
    const plans = planListOrders(LOCALE, [item(1, 0), item(2, 1), item(3, 2)], [item(103, 0), item(102, 1)], contentMap(1, 2, 3), containerMap);

    expect(plans[0].contentIDs).toEqual([101, 102, 103]);
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
      containerMap,
      undefined,
      new Set([101, 102, 103])
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
    const plans = planListOrders(LOCALE, [item(1, 0), item(2, 1), item(3, 2)], [], new Map([[1, 101], [2, 103], [3, 103]]), containerMap, undefined, new Set([101, 103]));

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

describe("relativeOrderChanged", () => {
  it("compares only the items both orders have", () => {
    expect(relativeOrderChanged([1, 2, 3], [1, 2, 3])).toBe(false);
    expect(relativeOrderChanged([1, 2, 3], [1, 3, 2])).toBe(true);
    // An item added anywhere, or one deleted, isn't a reorder
    expect(relativeOrderChanged([1, 2, 3], [4, 1, 2, 3])).toBe(false);
    expect(relativeOrderChanged([1, 2, 3], [1, 3])).toBe(false);
    expect(relativeOrderChanged([1, 2, 3], [3, 9, 1])).toBe(true);
  });
});

describe("decideListOrders (PROD-3078: which side reordered)", () => {
  // The last run left source 1, 2, 3 and target 101, 102, 103.
  const synced: ListOrderRecord = {
    sourceReferenceName: "links",
    targetReferenceName: "links",
    sourceContentIDs: [1, 2, 3],
    targetContentIDs: [101, 102, 103],
  };
  const inSourceOrder = [item(1, 0), item(2, 1), item(3, 2)];
  const sourceReordered = [item(3, 0), item(1, 1), item(2, 2)];
  const inTargetOrder = [item(101, 0), item(102, 1), item(103, 2)];
  const targetReordered = [item(102, 0), item(101, 1), item(103, 2)];

  const decide = (source: ListItem[], target: ListItem[], records: ListOrderRecord[] = [synced], overwrite = false) =>
    decideListOrders(LOCALE, source, target, contentMap(1, 2, 3), containerMap, undefined, new Set(), records, overwrite);

  it("in order: nothing to send, with the orders to record", () => {
    expect(decide(inSourceOrder, inTargetOrder)).toEqual([
      expect.objectContaining({ action: "in-order", sourceOrder: [1, 2, 3], targetOrder: [101, 102, 103] }),
    ]);
  });

  it("reordered on the source only: sets the source's order", () => {
    expect(decide(sourceReordered, inTargetOrder)).toEqual([
      expect.objectContaining({ action: "reorder", unrecorded: false, contentIDs: [103, 101, 102], targetOrder: [103, 101, 102] }),
    ]);
  });

  it("reordered on the target only: kept", () => {
    expect(decide(inSourceOrder, targetReordered)).toEqual([expect.objectContaining({ action: "keep", targetOrder: [102, 101, 103] })]);
  });

  it("reordered on the target only, with --overwrite: sets the source's order", () => {
    expect(decide(inSourceOrder, targetReordered, [synced], true)).toEqual([
      expect.objectContaining({ action: "reorder", overwritten: "keep", contentIDs: [101, 102, 103] }),
    ]);
  });

  it("reordered on both sides: a conflict, or the source's order with --overwrite", () => {
    expect(decide(sourceReordered, targetReordered)).toEqual([expect.objectContaining({ action: "conflict" })]);
    expect(decide(sourceReordered, targetReordered, [synced], true)).toEqual([
      expect.objectContaining({ action: "reorder", overwritten: "conflict" }),
    ]);
  });

  it("reordered on both sides to the same order: in order", () => {
    expect(decide(sourceReordered, [item(103, 0), item(101, 1), item(102, 2)])).toEqual([
      expect.objectContaining({ action: "in-order" }),
    ]);
  });

  it("an item added on the target, at the top, isn't a target reorder", () => {
    const target = [item(900, 0), ...inTargetOrder.map((i) => item(i.contentID, i.properties!.itemOrder! + 1))];
    expect(decide(inSourceOrder, target)).toEqual([expect.objectContaining({ action: "reorder", unrecorded: false })]);
  });

  it("no record (first run after upgrading): the source's order, as before", () => {
    expect(decide(inSourceOrder, targetReordered, [])).toEqual([
      expect.objectContaining({ action: "reorder", unrecorded: true, contentIDs: [101, 102, 103] }),
    ]);
  });

  it("matches the record by source list name, case-insensitively", () => {
    expect(decide(inSourceOrder, targetReordered, [{ ...synced, sourceReferenceName: "LINKS" }])).toEqual([
      expect.objectContaining({ action: "keep" }),
    ]);
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
  describe("records (PROD-3078)", () => {
    const recordFile = path.join(`mappings/${SRC}-${TGT}`, LOCALE, "listorder", "mappings.json");
    const readRecords = () => JSON.parse(fs.readFileSync(path.join(root, recordFile), "utf8"));
    // What the default fixtures look like once synced: source 1, 2, 3; target 101, 102, 103, then 900.
    const syncedRecord = {
      sourceGuid: SRC,
      targetGuid: TGT,
      sourceReferenceName: "links",
      targetReferenceName: "links",
      sourceContentIDs: [1, 2, 3],
      targetContentIDs: [101, 102, 103, 900],
    };

    beforeEach(() => keptTargetChanges.reset());

    it("records the orders a reorder left, and the order it replaced (the first run, with no record)", async () => {
      await run();

      expect(readRecords()).toEqual([{ ...syncedRecord, targetReplacedContentIDs: [900, 103, 101, 102] }]);
    });

    it("a pull that still shows the replaced order is waited on, not kept as a target reorder", async () => {
      // The last run reordered 900, 103, 101, 102 to 101, 102, 103, 900; the Fetch API hasn't shown it yet.
      writeJson(recordFile, [{ ...syncedRecord, targetReplacedContentIDs: [900, 103, 101, 102] }]);

      const result = await run();

      expect(api.contentMethods.setContentListItemOrder).not.toHaveBeenCalled();
      expect(keptTargetChanges.hasEntries()).toBe(false);
      expect(result).toMatchObject({ successful: 0, skipped: 1 });
      expect(readRecords()).toEqual([{ ...syncedRecord, targetReplacedContentIDs: [900, 103, 101, 102] }]);
    });

    it("drops the replaced order once a pull shows the new one", async () => {
      writeJson(recordFile, [{ ...syncedRecord, targetReplacedContentIDs: [900, 103, 101, 102] }]);
      [[101, 0], [102, 1], [103, 2], [900, 3]].forEach(([id, order]) =>
        writeJson(`${TGT}/${LOCALE}/item/${id}.json`, { contentID: id, properties: { state: 2, referenceName: "links", itemOrder: order } })
      );

      await run();

      expect(readRecords()).toEqual([syncedRecord]);
    });

    it("a reverse sync doesn't put back an order its source shows before the last reorder reached the Fetch API", async () => {
      // The last run (this way round) reordered the source side from 3, 1, 2 to 1, 2, 3 ... seen as
      // a reverse sync's record: the source's replaced order is 3, 1, 2, and the source pull still shows it.
      [3, 1, 2].forEach((n, i) =>
        writeJson(`${SRC}/${LOCALE}/item/${n}.json`, { contentID: n, properties: { state: 2, referenceName: "links", itemOrder: i } })
      );
      writeJson(recordFile, [{ ...syncedRecord, sourceReplacedContentIDs: [3, 1, 2] }]);
      [[101, 0], [102, 1], [103, 2], [900, 3]].forEach(([id, order]) =>
        writeJson(`${TGT}/${LOCALE}/item/${id}.json`, { contentID: id, properties: { state: 2, referenceName: "links", itemOrder: order } })
      );

      await run();

      expect(api.contentMethods.setContentListItemOrder).not.toHaveBeenCalled();
      expect(keptTargetChanges.hasEntries()).toBe(false);
    });

    it("records a list that's already in order without calling the API", async () => {
      [[101, 0], [102, 1], [103, 2], [900, 3]].forEach(([id, order]) =>
        writeJson(`${TGT}/${LOCALE}/item/${id}.json`, { contentID: id, properties: { state: 2, referenceName: "links", itemOrder: order } })
      );

      await run();

      expect(api.contentMethods.setContentListItemOrder).not.toHaveBeenCalled();
      expect(readRecords()).toEqual([syncedRecord]);
    });

    it("keeps a target-only reorder with a warning, and leaves the record alone", async () => {
      // The fixtures' target (900, 103, 101, 102) is a reorder of the recorded 101, 102, 103.
      writeJson(recordFile, [syncedRecord]);

      const result = await run();

      expect(api.contentMethods.setContentListItemOrder).not.toHaveBeenCalled();
      expect(result).toMatchObject({ successful: 0, skipped: 1, failed: 0 });
      expect(keptTargetChanges.getEntries()).toEqual([{ type: "listOrder", name: "links", locale: LOCALE }]);
      expect(readRecords()).toEqual([syncedRecord]);
    });

    it("with --overwrite sets the source's order over a target reorder, and records it", async () => {
      writeJson(recordFile, [{ ...syncedRecord, targetContentIDs: [101, 102, 103] }]);
      state.overwrite = true;

      await run();

      expect(api.contentMethods.setContentListItemOrder).toHaveBeenCalledWith("links", TGT, LOCALE, [101, 102, 103], true);
      expect(keptTargetChanges.hasEntries()).toBe(false);
      expect(readRecords()).toEqual([{ ...syncedRecord, targetReplacedContentIDs: [900, 103, 101, 102] }]);
    });

    it("reports a reorder on both sides as a preflight conflict", async () => {
      writeJson(recordFile, [{ ...syncedRecord, sourceContentIDs: [2, 1, 3] }]);
      state.preflight = true;

      await run();

      expect(api.contentMethods.setContentListItemOrder).not.toHaveBeenCalled();
      expect(preflightReport.hasConflicts()).toBe(true);
    });

    it("labels a first-run reorder in preflight as having no sync record", async () => {
      state.preflight = true;

      await run();

      expect(preflightReport.toJSON().entries).toEqual(
        expect.arrayContaining([expect.objectContaining({ phase: "List order", detail: expect.stringContaining("no sync record yet") })])
      );
    });

    it("reads a reverse sync's records transposed", async () => {
      // The pair was first synced TGT -> SRC, so its mapping folder is TGT-SRC, written that way round.
      const pairDir = `mappings/${TGT}-${SRC}`;
      fs.rmSync(path.join(root, `mappings/${SRC}-${TGT}`), { recursive: true, force: true });
      writeJson(`${pairDir}/${LOCALE}/item/mappings.json`, [1, 2, 3].map((n) => ({ sourceContentID: 100 + n, targetContentID: n })));
      writeJson(`${pairDir}/containers/mappings.json`, [{ sourceReferenceName: "links", targetReferenceName: "links" }]);
      writeJson(`${pairDir}/${LOCALE}/listorder/mappings.json`, [
        {
          sourceGuid: TGT,
          targetGuid: SRC,
          sourceReferenceName: "links",
          targetReferenceName: "links",
          sourceContentIDs: [101, 102, 103, 900],
          targetContentIDs: [1, 2, 3],
        },
      ]);
      state.reverseSync = true;
      state.mappingPair = { sourceGuid: TGT, targetGuid: SRC };

      await run();

      // Read this way round: source 1, 2, 3 unchanged; target 900, 103, 101, 102 reordered since 101, 102, 103, 900.
      expect(keptTargetChanges.getEntries()).toEqual([expect.objectContaining({ type: "listOrder", name: "links" })]);
      expect(api.contentMethods.setContentListItemOrder).not.toHaveBeenCalled();
    });
  });
});
