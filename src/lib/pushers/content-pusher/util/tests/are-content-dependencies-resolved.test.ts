import { resetState } from "core/state";
import { areContentDependenciesResolved } from "../are-content-dependencies-resolved";

jest.mock("lib/mappers/content-item-mapper", () => ({
  ContentItemMapper: jest.fn().mockImplementation(() => ({
    getContentItemMappingByContentID: jest.fn().mockReturnValue(null),
  })),
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

function makeContentItem(overrides: any = {}): any {
  return {
    contentID: 1,
    properties: { definitionName: "BlogPost", referenceName: "blog-post" },
    fields: {},
    ...overrides,
  };
}

function makeModel(referenceName: string): any {
  return { referenceName, fields: [] };
}

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

// ─── no fields ────────────────────────────────────────────────────────────────

describe("areContentDependenciesResolved — no fields", () => {
  it("returns true when fields is absent", () => {
    const item = makeContentItem({ fields: undefined });
    expect(areContentDependenciesResolved(item, makeMapper(false), [])).toBe(true);
  });

  it("returns true when fields is null", () => {
    const item = makeContentItem({ fields: null });
    expect(areContentDependenciesResolved(item, makeMapper(false), [])).toBe(true);
  });
});

// ─── no model found ───────────────────────────────────────────────────────────

describe("areContentDependenciesResolved — no model found", () => {
  it("returns true when model is not in the models list", () => {
    const item = makeContentItem({ fields: { contentid: 5 } });
    const models: any[] = [makeModel("OtherModel")];
    const mapper = makeMapper(false);
    expect(areContentDependenciesResolved(item, mapper, models)).toBe(true);
    expect(mapper.getContentItemMappingByContentID).not.toHaveBeenCalled();
  });

  it("returns true when models list is empty", () => {
    const item = makeContentItem({ fields: { contentid: 5 } });
    expect(areContentDependenciesResolved(item, makeMapper(false), [])).toBe(true);
  });
});

// ─── all references resolved ──────────────────────────────────────────────────

describe("areContentDependenciesResolved — all references resolved", () => {
  it("returns true when contentid field is resolved by mapper", () => {
    const item = makeContentItem({ fields: { relatedContent: { contentid: 5 } } });
    const models = [makeModel("BlogPost")];
    expect(areContentDependenciesResolved(item, makeMapper(true), models)).toBe(true);
  });

  it("returns true when fields have no content references", () => {
    const item = makeContentItem({ fields: { title: "Hello", body: "World" } });
    const models = [makeModel("BlogPost")];
    expect(areContentDependenciesResolved(item, makeMapper(false), models)).toBe(true);
  });

  it("returns true for empty fields object", () => {
    const item = makeContentItem({ fields: {} });
    const models = [makeModel("BlogPost")];
    expect(areContentDependenciesResolved(item, makeMapper(false), models)).toBe(true);
  });
});

// ─── unresolved references ────────────────────────────────────────────────────

describe("areContentDependenciesResolved — unresolved references", () => {
  it("returns false when contentid field is not resolved by mapper", () => {
    const item = makeContentItem({ fields: { relatedContent: { contentid: 5 } } });
    const models = [makeModel("BlogPost")];
    expect(areContentDependenciesResolved(item, makeMapper(false), models)).toBe(false);
  });

  it("returns false when sortids contain an unresolved id", () => {
    const item = makeContentItem({ fields: { items: { sortids: "10,20,30" } } });
    const models = [makeModel("BlogPost")];
    const mapper = makePartialMapper([10, 30]);
    expect(areContentDependenciesResolved(item, mapper, models)).toBe(false);
  });

  it("returns false when a nested contentID is unresolved", () => {
    const item = makeContentItem({
      fields: { nested: { deeper: { contentID: 77 } } },
    });
    const models = [makeModel("BlogPost")];
    expect(areContentDependenciesResolved(item, makeMapper(false), models)).toBe(false);
  });
});

// ─── model matching ───────────────────────────────────────────────────────────

describe("areContentDependenciesResolved — model matching", () => {
  it("matches model by definitionName from properties", () => {
    const item: any = {
      contentID: 1,
      properties: { definitionName: "SpecialModel" },
      fields: { link: { contentid: 99 } },
    };
    const models = [makeModel("SpecialModel"), makeModel("OtherModel")];
    expect(areContentDependenciesResolved(item, makeMapper(false), models)).toBe(false);
  });

  it("returns true (assume resolved) when item has no properties", () => {
    const item: any = { contentID: 1, fields: { contentid: 5 } };
    const models = [makeModel("BlogPost")];
    // No properties.definitionName → model.find returns undefined → returns true
    expect(areContentDependenciesResolved(item, makeMapper(false), models)).toBe(true);
  });
});
