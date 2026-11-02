import {
  collectFieldReferences,
  decideAction,
  DeleteCandidate,
  findCandidates,
  findMassDeletes,
  indexSitemap,
  mappingPairs,
  modelFieldModelReferences,
  pageZoneContentIDs,
  pageZoneModuleNames,
} from "../delete-plan";

const facts = (over: Partial<Parameters<typeof decideAction>[0]> = {}) => ({
  sourceDeleted: true as const,
  targetExists: true,
  targetChanged: false,
  ...over,
});

describe("decideAction", () => {
  it("deletes when the source is deleted and the target is untouched", () => {
    expect(decideAction(facts(), false).action).toBe("delete");
  });

  it("keeps everything when the source delete is not confirmed", () => {
    const result = decideAction(facts({ sourceDeleted: "unpublished in the source, not deleted" }), true);
    expect(result).toEqual({ action: "keep", reason: "unpublished in the source, not deleted" });
  });

  it("only drops the mapping when a live source still owns the target", () => {
    const result = decideAction(facts({ sharedWithSourceID: 42, targetChanged: true }), true);
    expect(result.action).toBe("unmap");
    expect(result.reason).toContain("42");
  });

  it("only drops the mapping when the target is already gone", () => {
    expect(decideAction(facts({ targetExists: false }), false).action).toBe("unmap");
  });

  it("is a conflict when the target changed and --overwrite is off", () => {
    expect(decideAction(facts({ targetChanged: true }), false).action).toBe("conflict");
  });

  it("deletes a changed target under --overwrite", () => {
    const result = decideAction(facts({ targetChanged: true }), true);
    expect(result.action).toBe("delete");
    expect(result.reason).toContain("--overwrite");
  });

  it("blocks before anything else that would delete, even under --overwrite", () => {
    const result = decideAction(facts({ targetChanged: true, blockedBy: "still used by page home" }), true);
    expect(result).toEqual({ action: "blocked", reason: "still used by page home" });
  });
});

describe("mappingPairs / findCandidates", () => {
  const records = [
    { sourceContentID: 1, targetContentID: 101 },
    { sourceContentID: 2, targetContentID: 102 },
    { sourceContentID: 3, targetContentID: 101 }, // dead duplicate onto a live target
    { sourceContentID: null, targetContentID: 103 }, // unusable
    { sourceContentID: "4", targetContentID: "104" }, // string ids still count
  ];

  it("reads each kind's id fields and drops unusable records", () => {
    const pairs = mappingPairs("content", records);
    expect(pairs.map((p) => [p.sourceID, p.targetID])).toEqual([
      [1, 101],
      [2, 102],
      [3, 101],
      [4, 104],
    ]);
  });

  it("returns records whose source is gone, and the targets still owned by a live source", () => {
    const { candidates, liveTargets } = findCandidates(mappingPairs("content", records), new Set([1]));
    expect(candidates.map((c) => c.sourceID)).toEqual([2, 3, 4]);
    expect(liveTargets.get(101)).toBe(1);
    expect(liveTargets.has(102)).toBe(false);
  });

  it("uses the guid-level field names", () => {
    expect(mappingPairs("model", [{ sourceID: 5, targetID: 50 }])[0]).toMatchObject({ sourceID: 5, targetID: 50 });
    expect(mappingPairs("container", [{ sourceContentViewID: 6, targetContentViewID: 60 }])).toHaveLength(1);
    expect(mappingPairs("gallery", [{ sourceMediaGroupingID: 7, targetMediaGroupingID: 70 }])).toHaveLength(1);
    expect(mappingPairs("urlRedirection", [{ sourceUrlRedirectionID: 8, targetUrlRedirectionID: 80 }])).toHaveLength(1);
  });
});

describe("findMassDeletes", () => {
  const candidates = (n: number, action: DeleteCandidate["action"] = "delete"): DeleteCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      kind: "content",
      sourceID: i + 1,
      targetID: i + 1001,
      name: `item ${i}`,
      record: {},
      action,
      reason: "",
    }));

  it("flags a kind losing more than half of many mapped entities", () => {
    expect(findMassDeletes([{ kind: "content", locale: "en-us", mapped: 20, candidates: candidates(11) }])).toEqual([
      { kind: "content", locale: "en-us", deletes: 11, mapped: 20 },
    ]);
  });

  it("allows small deletes even when they are most of the kind", () => {
    expect(findMassDeletes([{ kind: "model", mapped: 4, candidates: candidates(4) }])).toEqual([]);
  });

  it("allows many deletes when they are a minority", () => {
    expect(findMassDeletes([{ kind: "content", mapped: 100, candidates: candidates(40) }])).toEqual([]);
  });

  it("counts only actual deletes", () => {
    expect(findMassDeletes([{ kind: "content", mapped: 20, candidates: candidates(15, "conflict") }])).toEqual([]);
  });
});

describe("collectFieldReferences", () => {
  it("finds linked content in every shape", () => {
    const refs = collectFieldReferences({
      single: { contentid: 11, fulllist: false },
      list: { referencename: "Posts_List", sortids: "12,13" },
      upper: { ContentID: "14" },
      scalar: "15",
      csv: "16, 17",
      nested: [{ inner: { contentID: 18 } }],
      text: "Hello 19 world",
    });
    expect(Array.from(refs.contentIDs).sort((a, b) => a - b)).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
    expect(Array.from(refs.containers)).toEqual(["posts_list"]);
  });

  it("finds galleries", () => {
    expect(Array.from(collectFieldReferences({ photos: { galleryid: 3 } }).galleryIDs)).toEqual([3]);
  });

  it("tolerates missing fields", () => {
    expect(collectFieldReferences(undefined).contentIDs.size).toBe(0);
  });
});

describe("page and model helpers", () => {
  const page = {
    zones: {
      main: [
        { module: "RichText", item: { contentid: 5 } },
        { module: "Hero", item: { contentID: "6" } },
      ],
      side: [{ module: "Nav", item: {} }],
    },
  };

  it("reads zone content and module names", () => {
    expect(pageZoneContentIDs(page)).toEqual([5, 6]);
    expect(pageZoneModuleNames(page)).toEqual(["richtext", "hero", "nav"]);
  });

  it("reads model-to-model field references", () => {
    const model = { fields: [{ settings: { ContentDefinition: "Author" } }, { settings: {} }] };
    expect(modelFieldModelReferences(model)).toEqual(["author"]);
  });

  it("indexes a sitemap into parents and depths", () => {
    const { parentOf, depthOf } = indexSitemap([
      { pages: [{ pageID: 1, childPages: [{ pageID: 2, childPages: [{ pageID: 3, childPages: [] }] }] }] },
      { pages: [{ pageID: 9, childPages: null }] },
    ]);
    expect(parentOf.get(1)).toBeNull();
    expect(parentOf.get(3)).toBe(2);
    expect(depthOf.get(3)).toBe(2);
    expect(depthOf.get(9)).toBe(0);
  });
});
