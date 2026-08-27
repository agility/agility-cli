import { resetState } from "core/state";
import { getContentItemTypes } from "../get-content-item-types";

jest.mock("lib/mappers/container-mapper", () => ({
  ContainerMapper: jest.fn(),
}));

jest.mock("lib/mappers/model-mapper", () => ({
  ModelMapper: jest.fn(),
}));

jest.mock("lib/mappers/content-item-mapper", () => ({
  ContentItemMapper: jest.fn(),
}));

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

let nextId = 1;
function makeItem(referenceName: string, definitionName: string, fields: any = {}): any {
  return {
    contentID: nextId++,
    properties: { referenceName, definitionName },
    fields,
  };
}

function makeValidOpts(): {
  containerMapper: any;
  modelMapper: any;
  referenceMapper: any;
  logger: any;
} {
  return {
    containerMapper: {
      getContainerMappingByReferenceName: jest.fn().mockReturnValue({ sourceContentViewID: 1 }),
      getMappedEntity: jest.fn().mockReturnValue({ contentViewID: 1 }),
    },
    modelMapper: {
      getModelMappingByReferenceName: jest.fn().mockReturnValue({ sourceID: 10 }),
      getMappedEntity: jest.fn().mockReturnValue({ id: 10 }),
    },
    referenceMapper: {},
    logger: {},
  };
}

function makeInvalidOpts(): {
  containerMapper: any;
  modelMapper: any;
  referenceMapper: any;
  logger: any;
} {
  return {
    containerMapper: {
      getContainerMappingByReferenceName: jest.fn().mockReturnValue(null),
      getMappedEntity: jest.fn().mockReturnValue(null),
    },
    modelMapper: {
      getModelMappingByReferenceName: jest.fn().mockReturnValue(null),
      getMappedEntity: jest.fn().mockReturnValue(null),
    },
    referenceMapper: {},
    logger: {},
  };
}

beforeEach(() => {
  nextId = 1;
});

// ─── empty input ──────────────────────────────────────────────────────────────

describe("getContentItemTypes — empty input", () => {
  it("returns empty arrays when contentItems is empty", () => {
    const result = getContentItemTypes([], makeValidOpts());
    expect(result.normalContentItems).toHaveLength(0);
    expect(result.linkedContentItems).toHaveLength(0);
    expect(result.skippedItems).toHaveLength(0);
  });
});

// ─── skipped items (no valid mappings) ────────────────────────────────────────

describe("getContentItemTypes — skipped items", () => {
  it("adds item to skippedItems when mappings are invalid", () => {
    const item = makeItem("container-a", "ModelA");
    const result = getContentItemTypes([item], makeInvalidOpts());
    expect(result.skippedItems).toHaveLength(1);
    expect(result.skippedItems[0]).toBe(item);
    expect(result.normalContentItems).toHaveLength(0);
    expect(result.linkedContentItems).toHaveLength(0);
  });

  it("skips some and classifies others when mappings are mixed", () => {
    const validItem = makeItem("valid-container", "ValidModel");
    const invalidItem = makeItem("invalid-container", "InvalidModel");

    const mixedOpts = {
      containerMapper: {
        getContainerMappingByReferenceName: jest
          .fn()
          .mockImplementation((ref: string) => (ref === "valid-container" ? { sourceContentViewID: 1 } : null)),
        getMappedEntity: jest.fn().mockImplementation((mapping: any) => (mapping ? { contentViewID: 1 } : null)),
      },
      modelMapper: {
        getModelMappingByReferenceName: jest
          .fn()
          .mockImplementation((ref: string) => (ref === "validmodel" ? { sourceID: 10 } : null)),
        getMappedEntity: jest.fn().mockImplementation((mapping: any) => (mapping ? { id: 10 } : null)),
      },
      referenceMapper: {},
      logger: {},
    };

    const result = getContentItemTypes([validItem, invalidItem], mixedOpts as any);
    expect(result.skippedItems).toHaveLength(1);
    expect(result.normalContentItems).toHaveLength(1);
    expect(result.normalContentItems[0]).toBe(validItem);
  });
});

// ─── normal items (no fullList references) ────────────────────────────────────

describe("getContentItemTypes — normal items", () => {
  it("classifies an item as normal when it has no fullList references", () => {
    const item = makeItem("container-a", "ModelA", { title: "Hello" });
    const result = getContentItemTypes([item], makeValidOpts());
    expect(result.normalContentItems).toHaveLength(1);
    expect(result.normalContentItems[0]).toBe(item);
    expect(result.linkedContentItems).toHaveLength(0);
  });

  it("classifies multiple items without references as normal", () => {
    const items = [
      makeItem("container-a", "ModelA"),
      makeItem("container-b", "ModelB"),
      makeItem("container-c", "ModelC"),
    ];
    const result = getContentItemTypes(items, makeValidOpts());
    expect(result.normalContentItems).toHaveLength(3);
    expect(result.linkedContentItems).toHaveLength(0);
    expect(result.skippedItems).toHaveLength(0);
  });
});

// ─── linked items (have fullList references) ──────────────────────────────────

describe("getContentItemTypes — linked items", () => {
  it("moves a referenced item from normal to linked when another item points to it with fullList=true", () => {
    const linkedItem = makeItem("linked-ref", "ModelLinked");
    const parentItem = makeItem("parent-ref", "ModelParent", {
      items: { referenceName: "linked-ref", fullList: true },
    });

    const result = getContentItemTypes([linkedItem, parentItem], makeValidOpts());
    expect(result.linkedContentItems).toHaveLength(1);
    expect(result.linkedContentItems[0]).toBe(linkedItem);
    expect(result.normalContentItems).toHaveLength(1);
    expect(result.normalContentItems[0]).toBe(parentItem);
  });

  it("handles lowercase referencename/fulllist properties", () => {
    const linkedItem = makeItem("linked-lower", "ModelLinked");
    const parentItem = makeItem("parent-ref", "ModelParent", {
      items: { referencename: "linked-lower", fulllist: true },
    });

    const result = getContentItemTypes([linkedItem, parentItem], makeValidOpts());
    expect(result.linkedContentItems).toHaveLength(1);
    expect(result.linkedContentItems[0]).toBe(linkedItem);
  });

  it('item already in linkedSet is not re-added to normalSet when its own loop iteration runs', () => {
    // parent is first in the array — when processed, it marks linkedItem as linked
    // linkedItem comes second — without the fix, its loop iteration would add it back to normalSet
    const linkedItem = makeItem('linked-ref', 'ModelLinked');
    const parentItem = makeItem('parent-ref', 'ModelParent', {
      items: { referenceName: 'linked-ref', fullList: true },
    });

    const result = getContentItemTypes([parentItem, linkedItem], makeValidOpts());
    expect(result.linkedContentItems).toHaveLength(1);
    expect(result.linkedContentItems[0]).toBe(linkedItem);
    expect(result.normalContentItems).toHaveLength(1);
    expect(result.normalContentItems[0]).toBe(parentItem);
    // linkedItem must not appear in normalContentItems
    expect(result.normalContentItems).not.toContain(linkedItem);
  });

  it('item referenced by multiple parents ends up as linked only once', () => {
    const sharedItem = makeItem('shared-ref', 'ModelShared');
    const parent1 = makeItem('parent-1', 'ModelParent', {
      items: { referenceName: 'shared-ref', fullList: true },
    });
    const parent2 = makeItem("parent-2", "ModelParent", {
      items: { referenceName: "shared-ref", fullList: true },
    });

    const result = getContentItemTypes([sharedItem, parent1, parent2], makeValidOpts());
    expect(result.linkedContentItems).toHaveLength(1);
  });

  it("an item with fullList=false is not treated as linked", () => {
    const candidateItem = makeItem("candidate-ref", "ModelCandidate");
    const parentItem = makeItem("parent-ref", "ModelParent", {
      items: { referenceName: "candidate-ref", fullList: false },
    });

    const result = getContentItemTypes([candidateItem, parentItem], makeValidOpts());
    expect(result.linkedContentItems).toHaveLength(0);
    expect(result.normalContentItems).toHaveLength(2);
  });
});

// ─── single-item content references (PROD-2341) ───────────────────────────────

describe("getContentItemTypes — single-item content references", () => {
  it("promotes a contentid-referenced item to linked (the drawGame case) while the referencing item stays normal", () => {
    // Mirrors PROD-2341: GameBanner.drawGame = { contentid: <DrawGameAssetsSchema item>, fulllist: false }
    const target = makeItem("drawgamesassets", "DrawGameAssetsSchema");
    const gameBanner = makeItem("gamebanner", "GameBanner", {
      drawGame: { contentid: target.contentID, fulllist: false },
    });

    const result = getContentItemTypes([gameBanner, target], makeValidOpts());

    expect(result.linkedContentItems).toHaveLength(1);
    expect(result.linkedContentItems[0]).toBe(target);
    expect(result.normalContentItems).toHaveLength(1);
    expect(result.normalContentItems[0]).toBe(gameBanner);
    // The referenced item must NOT remain in the normal (pushed-second) bucket.
    expect(result.normalContentItems).not.toContain(target);
  });

  it("promotes every sortids-referenced item to linked", () => {
    const a = makeItem("list-a", "ModelA");
    const b = makeItem("list-b", "ModelB");
    const parent = makeItem("parent", "ModelParent", {
      picks: { sortids: `${a.contentID},${b.contentID}` },
    });

    const result = getContentItemTypes([parent, a, b], makeValidOpts());

    const linkedIds = result.linkedContentItems.map((i) => i.contentID);
    expect(linkedIds).toContain(a.contentID);
    expect(linkedIds).toContain(b.contentID);
    expect(result.normalContentItems).toHaveLength(1);
    expect(result.normalContentItems[0]).toBe(parent);
  });

  it("does not promote anything for an empty linked field (contentid 0 / -1 / absent)", () => {
    const emptyObj = makeItem("empty-obj", "ModelEmpty", { drawGame: { fulllist: false } });
    const zero = makeItem("zero-ref", "ModelZero", { drawGame: { contentid: 0, fulllist: false } });
    const neg = makeItem("neg-ref", "ModelNeg", { drawGame: { contentid: -1, fulllist: false } });

    const result = getContentItemTypes([emptyObj, zero, neg], makeValidOpts());

    expect(result.linkedContentItems).toHaveLength(0);
    expect(result.normalContentItems).toHaveLength(3);
  });

  it("does not crash or promote when the referenced contentid is not in the push set", () => {
    const orphanRef = makeItem("orphan", "ModelOrphan", {
      drawGame: { contentid: 999999, fulllist: false },
    });

    const result = getContentItemTypes([orphanRef], makeValidOpts());

    expect(result.normalContentItems).toHaveLength(1);
    expect(result.normalContentItems[0]).toBe(orphanRef);
    expect(result.linkedContentItems).toHaveLength(0);
    expect(result.skippedItems).toHaveLength(0);
  });

  it("follows a mixed chain: contentid ref whose target then whole-list references another item", () => {
    const deep = makeItem("deep-list", "ModelDeep");
    const mid = makeItem("mid", "ModelMid", {
      nested: { referenceName: "deep-list", fullList: true },
    });
    const top = makeItem("top", "ModelTop", {
      drawGame: { contentid: mid.contentID, fulllist: false },
    });

    const result = getContentItemTypes([top, mid, deep], makeValidOpts());

    expect(result.normalContentItems).toHaveLength(1);
    expect(result.normalContentItems[0]).toBe(top);
    const linkedIds = result.linkedContentItems.map((i) => i.contentID);
    expect(linkedIds).toContain(mid.contentID);
    expect(linkedIds).toContain(deep.contentID);
  });

  // PROD-2446: a reference living only in a LinkeContentDropdownValueField/SortIDFieldName
  // companion field (PROD-2431/2435/2442) is invisible to the structural contentid/sortids walk —
  // without the referencing item's own model, the referenced item was never promoted to push-first.
  it("promotes an item referenced only through a companion field (PROD-2446)", () => {
    const target = makeItem("drawgamesassets", "DrawGameAssetsSchema");
    const playslip = makeItem("playslipsection", "PlaylipSection", {
      // main field holds the container reference name, per the LinkedContentDropdown contract —
      // the actual selected id lives only in the companion field
      linkedDrawGameAsset: "drawgamesassets",
      linkedContentId: `${target.contentID}`,
    });

    const opts = makeValidOpts();
    opts.modelMapper.getMappedEntity = jest.fn().mockReturnValue({
      id: 10,
      fields: [{ name: "linkedDrawGameAsset", settings: { LinkeContentDropdownValueField: "linkedContentId" } }],
    });

    const result = getContentItemTypes([playslip, target], opts);

    expect(result.linkedContentItems).toHaveLength(1);
    expect(result.linkedContentItems[0]).toBe(target);
    expect(result.normalContentItems).toHaveLength(1);
    expect(result.normalContentItems[0]).toBe(playslip);
  });
});

// ─── reference to unknown item ────────────────────────────────────────────────

describe("getContentItemTypes — reference to unknown referenceName", () => {
  it("does not crash when a referenced referenceName is not found in contentItems", () => {
    const parentItem = makeItem("parent-ref", "ModelParent", {
      items: { referenceName: "ghost-ref", fullList: true },
    });

    const result = getContentItemTypes([parentItem], makeValidOpts());
    expect(result.normalContentItems).toHaveLength(1);
    expect(result.linkedContentItems).toHaveLength(0);
    expect(result.skippedItems).toHaveLength(0);
  });
});

// ─── recursive / nested references ───────────────────────────────────────────

describe("getContentItemTypes — recursive references", () => {
  it("marks transitively referenced items as linked", () => {
    const deepItem = makeItem("deep-ref", "ModelDeep");
    const midItem = makeItem("mid-ref", "ModelMid", {
      nested: { referenceName: "deep-ref", fullList: true },
    });
    const topItem = makeItem("top-ref", "ModelTop", {
      items: { referenceName: "mid-ref", fullList: true },
    });

    const result = getContentItemTypes([deepItem, midItem, topItem], makeValidOpts());
    expect(result.normalContentItems).toHaveLength(1);
    expect(result.normalContentItems[0]).toBe(topItem);
    expect(result.linkedContentItems).toHaveLength(2);
    const linkedIds = result.linkedContentItems.map((i) => i.contentID);
    expect(linkedIds).toContain(deepItem.contentID);
    expect(linkedIds).toContain(midItem.contentID);
  });

  it("handles circular references without infinite loop", () => {
    const itemA = makeItem("ref-a", "ModelA", {
      loop: { referenceName: "ref-b", fullList: true },
    });
    const itemB = makeItem("ref-b", "ModelB", {
      loop: { referenceName: "ref-a", fullList: true },
    });

    expect(() => getContentItemTypes([itemA, itemB], makeValidOpts())).not.toThrow();
  });
});
