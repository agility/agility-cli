import {
  collectAllReferenceNames,
  findDeletedLinkedListReferences,
  buildDeletedLinkedListMessage,
} from "../detect-deleted-linked-list-references";

describe("collectAllReferenceNames", () => {
  it("returns empty array for null/undefined/empty", () => {
    expect(collectAllReferenceNames(null)).toEqual([]);
    expect(collectAllReferenceNames(undefined)).toEqual([]);
    expect(collectAllReferenceNames({})).toEqual([]);
  });

  it("collects referencename (lowercase) and referenceName (camelCase)", () => {
    const fields = {
      cards: { referencename: "winnersgallery_linkcard", fulllist: true },
      other: { referenceName: "another_list" },
    };
    expect(collectAllReferenceNames(fields).sort()).toEqual(["another_list", "winnersgallery_linkcard"]);
  });

  it("collects references regardless of fulllist flag", () => {
    const fields = { link: { referencename: "some_list", fulllist: false } };
    expect(collectAllReferenceNames(fields)).toEqual(["some_list"]);
  });

  it("dedupes repeated reference names", () => {
    const fields = [{ referencename: "dup" }, { referencename: "dup" }];
    expect(collectAllReferenceNames(fields)).toEqual(["dup"]);
  });
});

describe("findDeletedLinkedListReferences", () => {
  it("returns references not present in the live source container set", () => {
    const fields = {
      a: { referencename: "winnersgallery_linkcard_deleted" },
      b: { referencename: "live_list" },
    };
    const live = new Set(["live_list"]);
    expect(findDeletedLinkedListReferences(fields, live)).toEqual(["winnersgallery_linkcard_deleted"]);
  });

  it("is case-insensitive against the live set", () => {
    const fields = { a: { referencename: "Live_List" } };
    const live = new Set(["live_list"]);
    expect(findDeletedLinkedListReferences(fields, live)).toEqual([]);
  });

  it("returns empty when all references are live", () => {
    const fields = { a: { referencename: "live_list" } };
    expect(findDeletedLinkedListReferences(fields, new Set(["live_list"]))).toEqual([]);
  });
});

describe("buildDeletedLinkedListMessage", () => {
  it("produces a clear, actionable message and preserves the original error", () => {
    const msg = buildDeletedLinkedListMessage(
      "winnersgallery_linkcard",
      ["winnersgallery_linkcard_linke909a7"],
      "Cannot create this item winnersgallery_linkcard_linke909a7 does not exist"
    );
    expect(msg).toContain("Content item 'winnersgallery_linkcard' references a deleted linked list");
    expect(msg).toContain("'winnersgallery_linkcard_linke909a7'");
    expect(msg).toContain("clear the stale reference in the source or restore the list");
    expect(msg).toContain("original error: Cannot create this item");
  });

  it("uses plural wording for multiple deleted lists", () => {
    const msg = buildDeletedLinkedListMessage("item", ["a", "b"], "err");
    expect(msg).toContain("references deleted linked lists 'a', 'b'");
  });
});
