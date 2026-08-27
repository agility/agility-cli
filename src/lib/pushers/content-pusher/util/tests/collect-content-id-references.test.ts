import { collectContentIDReferences } from "../collect-content-id-references";

describe("collectContentIDReferences", () => {
  it("returns [] for empty / non-object input", () => {
    expect(collectContentIDReferences({})).toEqual([]);
    expect(collectContentIDReferences(null)).toEqual([]);
    expect(collectContentIDReferences(undefined)).toEqual([]);
  });

  it("collects a single-item contentid reference (the PROD-2341 drawGame shape)", () => {
    const fields = { drawGame: { contentid: 11868, fulllist: false } };
    expect(collectContentIDReferences(fields)).toEqual([11868]);
  });

  it("collects the camelCase contentID key as well", () => {
    expect(collectContentIDReferences({ ref: { contentID: 42 } })).toEqual([42]);
  });

  it("collects each id from a comma-separated sortids string", () => {
    expect(collectContentIDReferences({ list: { sortids: "3, 7, 11" } })).toEqual([3, 7, 11]);
  });

  it("ignores 0 / negative ids (no reference selected)", () => {
    expect(collectContentIDReferences({ a: { contentid: 0 }, b: { contentid: -1 } })).toEqual([]);
    expect(collectContentIDReferences({ list: { sortids: "0,-1,5" } })).toEqual([5]);
  });

  it("ignores an empty linked-content field with no contentid", () => {
    // item 12000 in the source: { fulllist: false } with no contentid
    expect(collectContentIDReferences({ drawGame: { fulllist: false } })).toEqual([]);
  });

  it("walks nested objects and arrays", () => {
    const fields = {
      outer: [{ inner: { contentid: 1 } }, { inner: { contentid: 2 } }],
      other: { deep: { deeper: { contentID: 3 } } },
    };
    expect(collectContentIDReferences(fields).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("collects both contentid and sortids across a single item's fields", () => {
    const fields = {
      single: { contentid: 100, fulllist: false },
      multi: { sortids: "200,300" },
    };
    expect(collectContentIDReferences(fields).sort((a, b) => a - b)).toEqual([100, 200, 300]);
  });

  it("does not treat a whole-list reference (referencename + fulllist) as a contentid ref", () => {
    // Whole-list refs are handled by collectListReferenceNames, not here.
    expect(collectContentIDReferences({ items: { referencename: "somelist", fulllist: true } })).toEqual([]);
  });

  // PROD-2446: a reference that lives ONLY in a LinkeContentDropdownValueField/SortIDFieldName
  // companion field (PROD-2431/2435/2442) is a bare string under an arbitrary key — invisible to
  // the structural walk above without the model to name it.
  describe("companion-field references (schema-driven, PROD-2446)", () => {
    it("collects an id living only in an arbitrarily-named companion field", () => {
      const model = {
        fields: [{ name: "linkedDrawGameAsset", settings: { LinkeContentDropdownValueField: "linkedContentId" } }],
      };
      const fields = { linkedDrawGameAsset: "euro-jackpot", linkedContentId: "11875" };
      expect(collectContentIDReferences(fields, model)).toEqual([11875]);
    });

    it("collects comma-separated ids from a grid field's SortIDFieldName companion", () => {
      const model = {
        fields: [{ name: "sharedGridSorted", settings: { SortIDFieldName: "sharedGridSorted_SortField" } }],
      };
      const fields = { sharedGridSorted: { referencename: "list", fulllist: true }, sharedGridSorted_SortField: "3,7,11" };
      expect(collectContentIDReferences(fields, model).sort((a, b) => a - b)).toEqual([3, 7, 11]);
    });

    it("is a no-op when no model is supplied (back-compat)", () => {
      const fields = { linkedDrawGameAsset: "euro-jackpot", linkedContentId: "11875" };
      expect(collectContentIDReferences(fields)).toEqual([]);
    });

    it("tolerates a sentinel setting that names no real field", () => {
      const model = { fields: [{ name: "posts", settings: { LinkeContentDropdownValueField: "CREATENEW" } }] };
      const fields = { posts: { referencename: "posts-list", fulllist: true } };
      expect(collectContentIDReferences(fields, model)).toEqual([]);
    });
  });
});
