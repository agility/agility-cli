import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { UrlRedirectionMapper } from "../url-redirection-mapper";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-url-redir-mapper-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let testCounter = 0;
let currentSrc: string;
let currentTgt: string;

function makeMapper(): UrlRedirectionMapper {
  testCounter++;
  currentSrc = `src-redir-${testCounter}`;
  currentTgt = `tgt-redir-${testCounter}`;
  return new UrlRedirectionMapper(currentSrc, currentTgt);
}

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

// ─── constructor ──────────────────────────────────────────────────────────────

describe("UrlRedirectionMapper constructor", () => {
  it("constructs without throwing", () => {
    expect(() => makeMapper()).not.toThrow();
  });
});

// ─── addMapping — new entry ───────────────────────────────────────────────────

describe("UrlRedirectionMapper.addMapping — new entry", () => {
  it("adds a new mapping and persists it", () => {
    const mapper = makeMapper();
    mapper.addMapping(10, 20, "/old-path");

    const found = mapper.getMapping(10, "source");
    expect(found).not.toBeNull();
    expect(found!.sourceUrlRedirectionID).toBe(10);
    expect(found!.targetUrlRedirectionID).toBe(20);
    expect(found!.originUrl).toBe("/old-path");
    expect(found!.sourceGuid).toBe(currentSrc);
    expect(found!.targetGuid).toBe(currentTgt);
  });

  it("stores multiple distinct mappings", () => {
    const mapper = makeMapper();
    mapper.addMapping(1, 100, "/a");
    mapper.addMapping(2, 200, "/b");

    expect(mapper.getMapping(1, "source")).not.toBeNull();
    expect(mapper.getMapping(2, "source")).not.toBeNull();
  });

  it("does not create a duplicate when the same sourceUrlRedirectionID is added twice", () => {
    const mapper = makeMapper();
    mapper.addMapping(5, 50, "/url-1");
    mapper.addMapping(5, 99, "/url-1-updated");

    // There must still be exactly one mapping for source ID 5.
    const bySource = mapper.getMapping(5, "source");
    expect(bySource).not.toBeNull();
    expect(bySource!.targetUrlRedirectionID).toBe(99);

    // The old target ID (50) must not appear as a distinct entry.
    const byOldTarget = mapper.getMapping(50, "target");
    expect(byOldTarget).toBeNull();
  });

  it("updates targetUrlRedirectionID in place when sourceUrlRedirectionID already exists", () => {
    const mapper = makeMapper();
    mapper.addMapping(7, 70, "/page");
    mapper.addMapping(7, 77, "/page-new");

    const m = mapper.getMapping(7, "source")!;
    expect(m.targetUrlRedirectionID).toBe(77);
    expect(m.originUrl).toBe("/page-new");
  });
});

// ─── getMapping — by source ───────────────────────────────────────────────────

describe("UrlRedirectionMapper.getMapping — by source", () => {
  it("returns null when no mappings exist", () => {
    const mapper = makeMapper();
    expect(mapper.getMapping(999, "source")).toBeNull();
  });

  it("returns the mapping when found by sourceUrlRedirectionID", () => {
    const mapper = makeMapper();
    mapper.addMapping(11, 22, "/test");
    const m = mapper.getMapping(11, "source");
    expect(m).not.toBeNull();
    expect(m!.sourceUrlRedirectionID).toBe(11);
  });

  it("returns null for an ID that was not added", () => {
    const mapper = makeMapper();
    mapper.addMapping(11, 22, "/test");
    expect(mapper.getMapping(99, "source")).toBeNull();
  });
});

// ─── getMapping — by target ───────────────────────────────────────────────────

describe("UrlRedirectionMapper.getMapping — by target", () => {
  it("returns null when no mappings exist", () => {
    const mapper = makeMapper();
    expect(mapper.getMapping(999, "target")).toBeNull();
  });

  it("returns the mapping when found by targetUrlRedirectionID", () => {
    const mapper = makeMapper();
    mapper.addMapping(33, 44, "/target-test");
    const m = mapper.getMapping(44, "target");
    expect(m).not.toBeNull();
    expect(m!.targetUrlRedirectionID).toBe(44);
  });

  it("returns null for a target ID that was not added", () => {
    const mapper = makeMapper();
    mapper.addMapping(33, 44, "/target-test");
    expect(mapper.getMapping(55, "target")).toBeNull();
  });
});

// ─── persistence (saveMappingFile / loadMapping) ──────────────────────────────

describe("UrlRedirectionMapper — mapping persistence", () => {
  it("persists mappings so a new mapper instance can reload them", () => {
    const src = `persist-src-${testCounter + 100}`;
    const tgt = `persist-tgt-${testCounter + 100}`;
    const mapper1 = new UrlRedirectionMapper(src, tgt);
    mapper1.addMapping(60, 600, "/persist-me");

    const mapper2 = new UrlRedirectionMapper(src, tgt);
    const found = mapper2.getMapping(60, "source");
    expect(found).not.toBeNull();
    expect(found!.targetUrlRedirectionID).toBe(600);
  });
});
