import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { ContainerMapper } from "lib/mappers/container-mapper";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-container-mapper-"));
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

function makeMapper(): ContainerMapper {
  testCounter++;
  return new ContainerMapper(`src-${testCounter}`, `tgt-${testCounter}`);
}

function makeContainer(overrides: Record<string, any> = {}): any {
  return {
    contentViewID: 100,
    referenceName: "MyContainer",
    lastModifiedDate: "01/01/2024 10:00AM",
    ...overrides,
  };
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe("ContainerMapper constructor", () => {
  it("constructs without throwing", () => {
    expect(() => makeMapper()).not.toThrow();
  });
});

// ─── getContainerMapping ──────────────────────────────────────────────────────

describe("ContainerMapper.getContainerMapping", () => {
  it("returns null when no mapping exists", () => {
    const mapper = makeMapper();
    expect(mapper.getContainerMapping(makeContainer({ contentViewID: 999 }), "source")).toBeNull();
  });

  it("finds mapping by source contentViewID after addMapping", () => {
    const mapper = makeMapper();
    const src = makeContainer({ contentViewID: 10 });
    const tgt = makeContainer({ contentViewID: 20 });
    mapper.addMapping(src, tgt);
    expect(mapper.getContainerMapping(src, "source")).not.toBeNull();
  });

  it("finds mapping by target contentViewID after addMapping", () => {
    const mapper = makeMapper();
    const src = makeContainer({ contentViewID: 10 });
    const tgt = makeContainer({ contentViewID: 20 });
    mapper.addMapping(src, tgt);
    const found = mapper.getContainerMapping(tgt, "target");
    expect(found).not.toBeNull();
    expect(found!.targetContentViewID).toBe(20);
  });
});

// ─── getContainerMappingByContentViewID ───────────────────────────────────────

describe("ContainerMapper.getContainerMappingByContentViewID", () => {
  it("returns null for unknown ID", () => {
    const mapper = makeMapper();
    expect(mapper.getContainerMappingByContentViewID(999, "source")).toBeNull();
  });

  it("returns mapping by source contentViewID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeContainer({ contentViewID: 5 }), makeContainer({ contentViewID: 6 }));
    expect(mapper.getContainerMappingByContentViewID(5, "source")).not.toBeNull();
  });

  it("returns mapping by target contentViewID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeContainer({ contentViewID: 5 }), makeContainer({ contentViewID: 6 }));
    expect(mapper.getContainerMappingByContentViewID(6, "target")).not.toBeNull();
  });
});

// ─── getContainerMappingByReferenceName ───────────────────────────────────────

describe("ContainerMapper.getContainerMappingByReferenceName", () => {
  it("returns null when no mapping exists", () => {
    const mapper = makeMapper();
    expect(mapper.getContainerMappingByReferenceName("Unknown", "source")).toBeNull();
  });

  it("finds by source referenceName (case insensitive)", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeContainer({ contentViewID: 10, referenceName: "MyList" }),
      makeContainer({ contentViewID: 20, referenceName: "MyListTarget" })
    );
    expect(mapper.getContainerMappingByReferenceName("mylist", "source")).not.toBeNull();
    expect(mapper.getContainerMappingByReferenceName("MYLIST", "source")).not.toBeNull();
  });

  it("finds by target referenceName (case insensitive)", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeContainer({ contentViewID: 10, referenceName: "MyList" }),
      makeContainer({ contentViewID: 20, referenceName: "MyListTarget" })
    );
    expect(mapper.getContainerMappingByReferenceName("mylisttarget", "target")).not.toBeNull();
  });
});

// ─── addMapping / updateMapping ───────────────────────────────────────────────

describe("ContainerMapper.addMapping", () => {
  it("adds a new mapping when target does not exist", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeContainer({ contentViewID: 10 }), makeContainer({ contentViewID: 20 }));
    expect(mapper.getContainerMappingByContentViewID(20, "target")).not.toBeNull();
  });

  it("updates an existing mapping when called again with the same target", () => {
    const mapper = makeMapper();
    const tgt = makeContainer({ contentViewID: 20 });
    mapper.addMapping(makeContainer({ contentViewID: 10, referenceName: "OldRef" }), tgt);
    mapper.addMapping(makeContainer({ contentViewID: 11, referenceName: "NewRef" }), tgt);
    const found = mapper.getContainerMappingByContentViewID(20, "target");
    expect(found!.sourceContentViewID).toBe(11);
    expect(found!.sourceReferenceName).toBe("NewRef");
  });
});

// ─── hasSourceChanged ─────────────────────────────────────────────────────────

describe("ContainerMapper.hasSourceChanged", () => {
  it("returns false when sourceContainer is null", () => {
    const mapper = makeMapper();
    expect(mapper.hasSourceChanged(null)).toBe(false);
  });

  it("returns false when no mapping exists", () => {
    const mapper = makeMapper();
    expect(mapper.hasSourceChanged(makeContainer({ contentViewID: 999 }))).toBe(false);
  });

  it("returns false when date has not changed", () => {
    const mapper = makeMapper();
    const date = "01/15/2024 02:30PM";
    const src = makeContainer({ contentViewID: 10, lastModifiedDate: date });
    mapper.addMapping(src, makeContainer({ contentViewID: 20 }));
    expect(mapper.hasSourceChanged(makeContainer({ contentViewID: 10, lastModifiedDate: date }))).toBe(false);
  });

  it("returns true when source date is newer than mapped date", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeContainer({ contentViewID: 10, lastModifiedDate: "01/01/2024 10:00AM" }),
      makeContainer({ contentViewID: 20 })
    );
    expect(mapper.hasSourceChanged(makeContainer({ contentViewID: 10, lastModifiedDate: "06/01/2025 10:00AM" }))).toBe(
      true
    );
  });
});

// ─── hasTargetChanged ─────────────────────────────────────────────────────────

describe("ContainerMapper.hasTargetChanged", () => {
  it("returns false when targetContainer is null", () => {
    const mapper = makeMapper();
    expect(mapper.hasTargetChanged(null)).toBe(false);
  });

  it("returns false when no mapping exists", () => {
    const mapper = makeMapper();
    expect(mapper.hasTargetChanged(makeContainer({ contentViewID: 999 }))).toBe(false);
  });

  it("returns false when date has not changed", () => {
    const mapper = makeMapper();
    const date = "03/10/2024 09:00AM";
    mapper.addMapping(
      makeContainer({ contentViewID: 10 }),
      makeContainer({ contentViewID: 20, lastModifiedDate: date })
    );
    expect(mapper.hasTargetChanged(makeContainer({ contentViewID: 20, lastModifiedDate: date }))).toBe(false);
  });

  it("returns true when target date is newer than mapped date", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeContainer({ contentViewID: 10 }),
      makeContainer({ contentViewID: 20, lastModifiedDate: "01/01/2024 10:00AM" })
    );
    expect(mapper.hasTargetChanged(makeContainer({ contentViewID: 20, lastModifiedDate: "12/01/2025 10:00AM" }))).toBe(
      true
    );
  });
});
