import { resetState } from "core/state";
import { collectUnresolvedContentReferences } from "../has-unresolved-content-references";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMapper(resolved: boolean): any {
  return {
    getContentItemMappingByContentID: jest
      .fn()
      .mockReturnValue(resolved ? { sourceContentID: 1, targetContentID: 100 } : null),
  };
}

function makePartialMapper(resolvedIds: number[]): any {
  return {
    getContentItemMappingByContentID: jest
      .fn()
      .mockImplementation((id: number) =>
        resolvedIds.includes(id) ? { sourceContentID: id, targetContentID: id + 1000 } : null
      ),
  };
}

// ─── collectUnresolvedContentReferences ────────────────────────────────────────

describe("collectUnresolvedContentReferences", () => {
  it("returns an empty array when there are no references", () => {
    expect(collectUnresolvedContentReferences({ title: "Hello" }, makeMapper(false))).toEqual([]);
  });

  it("returns an empty array for non-object input", () => {
    expect(collectUnresolvedContentReferences(null, makeMapper(false))).toEqual([]);
    expect(collectUnresolvedContentReferences("x", makeMapper(false))).toEqual([]);
  });

  it("collects an unresolved contentid with its field path", () => {
    const result = collectUnresolvedContentReferences({ link: { contentid: 5 } }, makeMapper(false));
    expect(result).toEqual([{ path: "link.contentid", contentID: 5 }]);
  });

  it("collects a nested contentID with a dotted path", () => {
    const result = collectUnresolvedContentReferences({ nested: { deeper: { contentID: 77 } } }, makeMapper(false));
    expect(result).toEqual([{ path: "nested.deeper.contentID", contentID: 77 }]);
  });

  it("uses array index notation in the path", () => {
    const mapper = makePartialMapper([1]);
    const result = collectUnresolvedContentReferences({ items: [{ contentid: 1 }, { contentid: 99 }] }, mapper);
    expect(result).toEqual([{ path: "items[1].contentid", contentID: 99 }]);
  });

  it("collects every unresolved sortid (does not early-exit)", () => {
    const mapper = makePartialMapper([2]);
    const result = collectUnresolvedContentReferences({ list: { sortids: "1,2,3" } }, mapper);
    expect(result).toEqual([
      { path: "list.sortids", contentID: 1 },
      { path: "list.sortids", contentID: 3 },
    ]);
  });

  it("ignores non-positive IDs (0 / -1 = no reference selected)", () => {
    const mapper = makeMapper(false);
    expect(collectUnresolvedContentReferences({ a: { contentid: 0 }, b: { contentID: -1 } }, mapper)).toEqual([]);
    expect(mapper.getContentItemMappingByContentID).not.toHaveBeenCalled();
  });

  it("returns an empty array when all references resolve", () => {
    const result = collectUnresolvedContentReferences({ link: { contentid: 5 }, list: { sortids: "1,2" } }, makeMapper(true));
    expect(result).toEqual([]);
  });
});

// ─── companion-field references (schema-driven, PROD-2446) ────────────────────

describe("collectUnresolvedContentReferences — companion fields (PROD-2446)", () => {
  it("flags an unresolved id living only in an arbitrarily-named companion field", () => {
    const model = {
      fields: [{ name: "linkedDrawGameAsset", settings: { LinkeContentDropdownValueField: "linkedContentId" } }],
    };
    const fields = { linkedDrawGameAsset: "euro-jackpot", linkedContentId: "11875" };
    const result = collectUnresolvedContentReferences(fields, makeMapper(false), "", model);
    expect(result).toEqual([{ path: "linkedContentId", contentID: 11875 }]);
  });

  it("does not flag a companion field whose id is resolved", () => {
    const model = {
      fields: [{ name: "linkedDrawGameAsset", settings: { LinkeContentDropdownValueField: "linkedContentId" } }],
    };
    const fields = { linkedDrawGameAsset: "euro-jackpot", linkedContentId: "11875" };
    const result = collectUnresolvedContentReferences(fields, makeMapper(true), "", model);
    expect(result).toEqual([]);
  });

  it("flags every unresolved id in a grid field's SortIDFieldName companion", () => {
    const model = {
      fields: [{ name: "sharedGridSorted", settings: { SortIDFieldName: "sharedGridSorted_SortField" } }],
    };
    const mapper = makePartialMapper([13086]);
    // Main field itself carries no "sortids" key here, isolating the companion-only path —
    // the combined case (both keys populated) is already covered by content-field-mapper.test.ts.
    const fields = {
      sharedGridSorted: { referencename: "list", fulllist: true },
      sharedGridSorted_SortField: "13086,13087,13088",
    };
    const result = collectUnresolvedContentReferences(fields, mapper, "", model);
    expect(result).toEqual([
      { path: "sharedGridSorted_SortField", contentID: 13087 },
      { path: "sharedGridSorted_SortField", contentID: 13088 },
    ]);
  });

  it("is a no-op when no model is supplied (back-compat)", () => {
    const fields = { linkedDrawGameAsset: "euro-jackpot", linkedContentId: "11875" };
    expect(collectUnresolvedContentReferences(fields, makeMapper(false))).toEqual([]);
  });

  it("only checks companion fields at the top level, not inside nested recursion", () => {
    // A field literally named "linkedContentId" nested somewhere else in the payload should not
    // be double-counted as the companion for a different, unrelated model field pass.
    const model = {
      fields: [{ name: "linkedDrawGameAsset", settings: { LinkeContentDropdownValueField: "linkedContentId" } }],
    };
    const fields = {
      linkedDrawGameAsset: "euro-jackpot",
      linkedContentId: "11875",
      nested: { linkedContentId: "99999" },
    };
    const result = collectUnresolvedContentReferences(fields, makeMapper(false), "", model);
    // top-level companion (11875) flagged once; the nested "linkedContentId" is a plain string
    // field with no contentid/contentID/sortids key, so the structural walk doesn't touch it either
    expect(result).toEqual([{ path: "linkedContentId", contentID: 11875 }]);
  });
});
