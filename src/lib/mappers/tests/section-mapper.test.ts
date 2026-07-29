import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { SectionMapper } from "lib/mappers/section-mapper";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-section-mapper-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

let testCounter = 0;
let currentSrc: string;
let currentTgt: string;

function makeMapper(): SectionMapper {
  testCounter++;
  currentSrc = `src-${testCounter}`;
  currentTgt = `tgt-${testCounter}`;
  return new SectionMapper(currentSrc, currentTgt);
}

function makeSection(overrides: Record<string, any> = {}): any {
  return {
    pageItemTemplateID: 1,
    pageItemTemplateReferenceName: "Main",
    itemOrder: 0,
    contentViewID: 100,
    ...overrides,
  };
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe("SectionMapper constructor", () => {
  it("constructs without throwing", () => {
    expect(() => makeMapper()).not.toThrow();
  });
});

// ─── getSectionMapping ────────────────────────────────────────────────────────

describe("SectionMapper.getSectionMapping", () => {
  it("returns null when section is null", () => {
    const mapper = makeMapper();
    expect(mapper.getSectionMapping(null as any, "source")).toBeNull();
  });

  it("returns null when no mapping exists", () => {
    const mapper = makeMapper();
    expect(mapper.getSectionMapping(makeSection({ pageItemTemplateID: 999 }), "source")).toBeNull();
  });

  it("finds mapping by source pageItemTemplateID after addMapping", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeSection({ pageItemTemplateID: 10, pageItemTemplateReferenceName: "SourceMain" }),
      makeSection({ pageItemTemplateID: 20, pageItemTemplateReferenceName: "TargetMain" })
    );
    const found = mapper.getSectionMapping(makeSection({ pageItemTemplateID: 10 }), "source");
    expect(found).not.toBeNull();
    expect(found!.targetPageItemTemplateID).toBe(20);
  });

  it("finds mapping by target pageItemTemplateID after addMapping", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeSection({ pageItemTemplateID: 10 }), makeSection({ pageItemTemplateID: 20 }));
    const found = mapper.getSectionMapping(makeSection({ pageItemTemplateID: 20 }), "target");
    expect(found!.sourcePageItemTemplateID).toBe(10);
  });
});

// ─── getSectionMappingByID ────────────────────────────────────────────────────

describe("SectionMapper.getSectionMappingByID", () => {
  it("returns null for unknown ID", () => {
    const mapper = makeMapper();
    expect(mapper.getSectionMappingByID(999, "source")).toBeNull();
  });

  it("returns mapping by source ID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeSection({ pageItemTemplateID: 5 }), makeSection({ pageItemTemplateID: 6 }));
    expect(mapper.getSectionMappingByID(5, "source")).not.toBeNull();
  });

  it("returns mapping by target ID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeSection({ pageItemTemplateID: 5 }), makeSection({ pageItemTemplateID: 6 }));
    expect(mapper.getSectionMappingByID(6, "target")).not.toBeNull();
  });

  // PROD-2350: the whole point of the ID mapping — a rename on either side shouldn't break
  // the lookup once the mapping has been established.
  it("still resolves after the source section is renamed", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeSection({ pageItemTemplateID: 5, pageItemTemplateReferenceName: "OldName" }),
      makeSection({ pageItemTemplateID: 6, pageItemTemplateReferenceName: "Main" })
    );
    const found = mapper.getSectionMappingByID(5, "source");
    expect(found!.targetPageItemTemplateID).toBe(6);
  });
});

// ─── addMapping / updateMapping ───────────────────────────────────────────────

describe("SectionMapper.addMapping", () => {
  it("adds a new mapping", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeSection({ pageItemTemplateID: 10 }), makeSection({ pageItemTemplateID: 20 }));
    expect(mapper.getSectionMappingByID(20, "target")).not.toBeNull();
  });

  it("updates existing mapping when target already exists", () => {
    const mapper = makeMapper();
    const tgt = makeSection({ pageItemTemplateID: 20 });
    mapper.addMapping(makeSection({ pageItemTemplateID: 10, pageItemTemplateReferenceName: "Old" }), tgt);
    mapper.addMapping(makeSection({ pageItemTemplateID: 11, pageItemTemplateReferenceName: "New" }), tgt);
    const found = mapper.getSectionMappingByID(20, "target")!;
    expect(found.sourcePageItemTemplateID).toBe(11);
    expect(found.sourceReferenceName).toBe("New");
  });

  it("throws when source and target already point at different mappings", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeSection({ pageItemTemplateID: 1 }), makeSection({ pageItemTemplateID: 2 }));
    mapper.addMapping(makeSection({ pageItemTemplateID: 3 }), makeSection({ pageItemTemplateID: 4 }));
    expect(() =>
      mapper.addMapping(makeSection({ pageItemTemplateID: 1 }), makeSection({ pageItemTemplateID: 4 }))
    ).toThrow(/Invalid Mappings detected/);
  });

  it("persists across mapper instances for the same guid pair", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeSection({ pageItemTemplateID: 10 }), makeSection({ pageItemTemplateID: 20 }));

    const reloaded = new SectionMapper(currentSrc, currentTgt);
    expect(reloaded.getSectionMappingByID(10, "source")).not.toBeNull();
  });
});
