import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { ModelMapper } from "lib/mappers/model-mapper";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-model-mapper-"));
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

function makeMapper(): ModelMapper {
  testCounter++;
  currentSrc = `src-${testCounter}`;
  currentTgt = `tgt-${testCounter}`;
  return new ModelMapper(currentSrc, currentTgt);
}

function makeModel(overrides: Record<string, any> = {}): any {
  return {
    id: 1,
    referenceName: "MyModel",
    lastModifiedDate: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe("ModelMapper constructor", () => {
  it("constructs without throwing", () => {
    expect(() => makeMapper()).not.toThrow();
  });
});

// ─── getModelMapping ──────────────────────────────────────────────────────────

describe("ModelMapper.getModelMapping", () => {
  it("returns null when no mapping exists", () => {
    const mapper = makeMapper();
    expect(mapper.getModelMapping(makeModel({ id: 999 }), "source")).toBeNull();
  });

  it("finds mapping by source id after addMapping", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeModel({ id: 10 }), makeModel({ id: 20 }));
    expect(mapper.getModelMapping(makeModel({ id: 10 }), "source")).not.toBeNull();
  });

  it("finds mapping by target id after addMapping", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeModel({ id: 10 }), makeModel({ id: 20 }));
    const found = mapper.getModelMapping(makeModel({ id: 20 }), "target");
    expect(found!.targetID).toBe(20);
  });
});

// ─── getModelMappingByID ──────────────────────────────────────────────────────

describe("ModelMapper.getModelMappingByID", () => {
  it("returns null for unknown ID", () => {
    const mapper = makeMapper();
    expect(mapper.getModelMappingByID(999, "source")).toBeNull();
  });

  it("returns mapping by source ID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeModel({ id: 5 }), makeModel({ id: 6 }));
    expect(mapper.getModelMappingByID(5, "source")).not.toBeNull();
  });

  it("returns mapping by target ID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeModel({ id: 5 }), makeModel({ id: 6 }));
    expect(mapper.getModelMappingByID(6, "target")).not.toBeNull();
  });
});

// ─── getModelMappingByReferenceName ──────────────────────────────────────────

describe("ModelMapper.getModelMappingByReferenceName", () => {
  it("returns null when no mapping exists", () => {
    const mapper = makeMapper();
    expect(mapper.getModelMappingByReferenceName("Unknown", "source")).toBeNull();
  });

  it("finds by source referenceName (case insensitive)", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeModel({ id: 10, referenceName: "BlogPost" }),
      makeModel({ id: 20, referenceName: "BlogPostTarget" })
    );
    expect(mapper.getModelMappingByReferenceName("blogpost", "source")).not.toBeNull();
    expect(mapper.getModelMappingByReferenceName("BLOGPOST", "source")).not.toBeNull();
  });

  it("finds by target referenceName (case insensitive)", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeModel({ id: 10, referenceName: "BlogPost" }),
      makeModel({ id: 20, referenceName: "BlogPostTarget" })
    );
    expect(mapper.getModelMappingByReferenceName("blogposttarget", "target")).not.toBeNull();
  });
});

// ─── getMappedEntity ──────────────────────────────────────────────────────────

describe("ModelMapper.getMappedEntity", () => {
  it("returns null when mapping is null", () => {
    const mapper = makeMapper();
    expect(mapper.getMappedEntity(null as any, "source")).toBeNull();
  });

  it("returns null when the model file does not exist on disk", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeModel({ id: 10 }), makeModel({ id: 20 }));
    const mapping = mapper.getModelMappingByID(20, "target")!;
    expect(mapper.getMappedEntity(mapping, "target")).toBeNull();
  });

  it("returns model data when the file exists", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeModel({ id: 10 }), makeModel({ id: 20 }));
    const mapping = mapper.getModelMappingByID(20, "target")!;

    const modelDir = path.join(tmpDir, currentTgt, "models");
    fs.mkdirSync(modelDir, { recursive: true });
    const modelData = { id: 20, referenceName: "MyModel", lastModifiedDate: "2024-01-01T00:00:00Z" };
    fs.writeFileSync(path.join(modelDir, "20.json"), JSON.stringify(modelData));

    const result = mapper.getMappedEntity(mapping, "target");
    expect(result).not.toBeNull();
    expect((result as any).id).toBe(20);
  });
});

// ─── addMapping / updateMapping ───────────────────────────────────────────────

describe("ModelMapper.addMapping", () => {
  it("adds a new mapping", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeModel({ id: 10 }), makeModel({ id: 20 }));
    expect(mapper.getModelMappingByID(20, "target")).not.toBeNull();
  });

  it("updates existing mapping when target already exists", () => {
    const mapper = makeMapper();
    const tgt = makeModel({ id: 20 });
    mapper.addMapping(makeModel({ id: 10, referenceName: "OldModel" }), tgt);
    mapper.addMapping(makeModel({ id: 11, referenceName: "NewModel" }), tgt);
    const found = mapper.getModelMappingByID(20, "target")!;
    expect(found.sourceID).toBe(11);
    expect(found.sourceReferenceName).toBe("NewModel");
  });
});

// ─── hasSourceChanged ─────────────────────────────────────────────────────────

describe("ModelMapper.hasSourceChanged", () => {
  it("returns false when sourceModel is null", () => {
    const mapper = makeMapper();
    expect(mapper.hasSourceChanged(null)).toBe(false);
  });

  it("returns false when no mapping exists", () => {
    const mapper = makeMapper();
    expect(mapper.hasSourceChanged(makeModel({ id: 999 }))).toBe(false);
  });

  it("returns false when date has not changed", () => {
    const mapper = makeMapper();
    const date = "2024-01-01T00:00:00Z";
    const src = makeModel({ id: 10, lastModifiedDate: date });
    mapper.addMapping(src, makeModel({ id: 20 }));
    expect(mapper.hasSourceChanged(makeModel({ id: 10, lastModifiedDate: date }))).toBe(false);
  });

  it("returns true when source date is newer than mapped date", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeModel({ id: 10, lastModifiedDate: "2024-01-01T00:00:00Z" }), makeModel({ id: 20 }));
    expect(mapper.hasSourceChanged(makeModel({ id: 10, lastModifiedDate: "2025-06-01T00:00:00Z" }))).toBe(true);
  });
});

// ─── hasTargetChanged ─────────────────────────────────────────────────────────

describe("ModelMapper.hasTargetChanged", () => {
  it("returns false when targetModel is null", () => {
    const mapper = makeMapper();
    expect(mapper.hasTargetChanged(null)).toBe(false);
  });

  it("returns false when no mapping exists", () => {
    const mapper = makeMapper();
    expect(mapper.hasTargetChanged(makeModel({ id: 999 }))).toBe(false);
  });

  it("returns false when date has not changed", () => {
    const mapper = makeMapper();
    const date = "2024-03-01T00:00:00Z";
    mapper.addMapping(makeModel({ id: 10 }), makeModel({ id: 20, lastModifiedDate: date }));
    expect(mapper.hasTargetChanged(makeModel({ id: 20, lastModifiedDate: date }))).toBe(false);
  });

  it("returns true when target date is newer than mapped date", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeModel({ id: 10 }), makeModel({ id: 20, lastModifiedDate: "2024-01-01T00:00:00Z" }));
    expect(mapper.hasTargetChanged(makeModel({ id: 20, lastModifiedDate: "2025-12-01T00:00:00Z" }))).toBe(true);
  });
});
