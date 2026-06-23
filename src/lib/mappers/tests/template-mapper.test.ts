import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { TemplateMapper } from "lib/mappers/template-mapper";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-template-mapper-"));
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

function makeMapper(): TemplateMapper {
  testCounter++;
  currentSrc = `src-${testCounter}`;
  currentTgt = `tgt-${testCounter}`;
  return new TemplateMapper(currentSrc, currentTgt);
}

function makeTemplate(overrides: Record<string, any> = {}): any {
  return {
    pageTemplateID: 1,
    pageTemplateName: "OneCol",
    ...overrides,
  };
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe("TemplateMapper constructor", () => {
  it("constructs without throwing", () => {
    expect(() => makeMapper()).not.toThrow();
  });
});

// ─── getTemplateMapping ───────────────────────────────────────────────────────

describe("TemplateMapper.getTemplateMapping", () => {
  it("returns null when template is null", () => {
    const mapper = makeMapper();
    expect(mapper.getTemplateMapping(null as any, "source")).toBeNull();
  });

  it("returns null when no mapping exists for the template", () => {
    const mapper = makeMapper();
    expect(mapper.getTemplateMapping(makeTemplate({ pageTemplateID: 999 }), "source")).toBeNull();
  });

  it("finds mapping by source pageTemplateID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeTemplate({ pageTemplateID: 10 }), makeTemplate({ pageTemplateID: 20 }));
    expect(mapper.getTemplateMapping(makeTemplate({ pageTemplateID: 10 }), "source")).not.toBeNull();
  });

  it("finds mapping by target pageTemplateID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeTemplate({ pageTemplateID: 10 }), makeTemplate({ pageTemplateID: 20 }));
    const found = mapper.getTemplateMapping(makeTemplate({ pageTemplateID: 20 }), "target");
    expect(found!.targetPageTemplateID).toBe(20);
  });
});

// ─── getTemplateMappingByPageTemplateID ───────────────────────────────────────

describe("TemplateMapper.getTemplateMappingByPageTemplateID", () => {
  it("returns null for unknown ID", () => {
    const mapper = makeMapper();
    expect(mapper.getTemplateMappingByPageTemplateID(999, "source")).toBeNull();
  });

  it("returns mapping by source pageTemplateID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeTemplate({ pageTemplateID: 5 }), makeTemplate({ pageTemplateID: 6 }));
    expect(mapper.getTemplateMappingByPageTemplateID(5, "source")).not.toBeNull();
  });

  it("returns mapping by target pageTemplateID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeTemplate({ pageTemplateID: 5 }), makeTemplate({ pageTemplateID: 6 }));
    expect(mapper.getTemplateMappingByPageTemplateID(6, "target")).not.toBeNull();
  });
});

// ─── getTemplateMappingByPageTemplateName ─────────────────────────────────────

describe("TemplateMapper.getTemplateMappingByPageTemplateName", () => {
  it("returns null when no mapping exists", () => {
    const mapper = makeMapper();
    expect(mapper.getTemplateMappingByPageTemplateName("Unknown", "source")).toBeNull();
  });

  it("finds by source pageTemplateName", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeTemplate({ pageTemplateID: 10, pageTemplateName: "TwoCol" }),
      makeTemplate({ pageTemplateID: 20, pageTemplateName: "TwoColTarget" })
    );
    expect(mapper.getTemplateMappingByPageTemplateName("TwoCol", "source")).not.toBeNull();
  });

  it("finds by target pageTemplateName", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeTemplate({ pageTemplateID: 10, pageTemplateName: "TwoCol" }),
      makeTemplate({ pageTemplateID: 20, pageTemplateName: "TwoColTarget" })
    );
    expect(mapper.getTemplateMappingByPageTemplateName("TwoColTarget", "target")).not.toBeNull();
  });

  it("returns null for a name that does not match any mapping", () => {
    const mapper = makeMapper();
    mapper.addMapping(
      makeTemplate({ pageTemplateID: 10, pageTemplateName: "TwoCol" }),
      makeTemplate({ pageTemplateID: 20, pageTemplateName: "TwoColTarget" })
    );
    expect(mapper.getTemplateMappingByPageTemplateName("ThreeCol", "source")).toBeNull();
  });
});

// ─── getMappedEntity ──────────────────────────────────────────────────────────

describe("TemplateMapper.getMappedEntity", () => {
  it("returns null when mapping is null", () => {
    const mapper = makeMapper();
    expect(mapper.getMappedEntity(null as any, "source")).toBeNull();
  });

  it("returns null when the template file does not exist", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeTemplate({ pageTemplateID: 10 }), makeTemplate({ pageTemplateID: 20 }));
    const mapping = mapper.getTemplateMappingByPageTemplateID(20, "target")!;
    expect(mapper.getMappedEntity(mapping, "target")).toBeNull();
  });

  it("returns template data when the file exists", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeTemplate({ pageTemplateID: 10 }), makeTemplate({ pageTemplateID: 20 }));
    const mapping = mapper.getTemplateMappingByPageTemplateID(20, "target")!;

    const tplDir = path.join(tmpDir, currentTgt, "templates");
    fs.mkdirSync(tplDir, { recursive: true });
    const tplData = { pageTemplateID: 20, pageTemplateName: "OneCol" };
    fs.writeFileSync(path.join(tplDir, "20.json"), JSON.stringify(tplData));

    const result = mapper.getMappedEntity(mapping, "target");
    expect(result).not.toBeNull();
    expect((result as any).pageTemplateID).toBe(20);
  });
});

// ─── addMapping / updateMapping ───────────────────────────────────────────────

describe("TemplateMapper.addMapping", () => {
  it("adds a new mapping", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeTemplate({ pageTemplateID: 10 }), makeTemplate({ pageTemplateID: 20 }));
    expect(mapper.getTemplateMappingByPageTemplateID(20, "target")).not.toBeNull();
  });

  it("updates existing mapping when target already exists", () => {
    const mapper = makeMapper();
    const tgt = makeTemplate({ pageTemplateID: 20 });
    mapper.addMapping(makeTemplate({ pageTemplateID: 10, pageTemplateName: "OldTpl" }), tgt);
    mapper.addMapping(makeTemplate({ pageTemplateID: 11, pageTemplateName: "NewTpl" }), tgt);
    const found = mapper.getTemplateMappingByPageTemplateID(20, "target")!;
    expect(found.sourcePageTemplateID).toBe(11);
    expect(found.sourcePageTemplateName).toBe("NewTpl");
  });
});

// ─── hasTemplateChanged ──────────────────────────────────────────────────────

function makeSection(overrides: Record<string, any> = {}): any {
  return {
    pageItemTemplateID: 3,
    pageTemplateID: 3,
    pageItemTemplateName: "main",
    pageItemTemplateReferenceName: "main",
    pageItemTemplateType: 0,
    itemOrder: 1,
    ...overrides,
  };
}

describe("TemplateMapper.hasTemplateChanged", () => {
  it("returns false when either template is null", () => {
    const mapper = makeMapper();
    expect(mapper.hasTemplateChanged(null, makeTemplate())).toBe(false);
    expect(mapper.hasTemplateChanged(makeTemplate(), null)).toBe(false);
  });

  it("returns false when name and sections match", () => {
    const mapper = makeMapper();
    const source = makeTemplate({ contentSectionDefinitions: [makeSection()] });
    const target = makeTemplate({ contentSectionDefinitions: [makeSection()] });
    expect(mapper.hasTemplateChanged(source, target)).toBe(false);
  });

  it("ignores per-instance IDs", () => {
    const mapper = makeMapper();
    const source = makeTemplate({
      pageTemplateID: 3,
      contentSectionDefinitions: [makeSection({ pageItemTemplateID: 3, contentViewID: 7, itemContainerID: 9 })],
    });
    const target = makeTemplate({
      pageTemplateID: 88,
      contentSectionDefinitions: [makeSection({ pageItemTemplateID: 55, contentViewID: 70, itemContainerID: 90 })],
    });
    expect(mapper.hasTemplateChanged(source, target)).toBe(false);
  });

  it("returns true when the source has an extra zone", () => {
    const mapper = makeMapper();
    const source = makeTemplate({
      contentSectionDefinitions: [
        makeSection(),
        makeSection({ pageItemTemplateName: "sidebar", pageItemTemplateReferenceName: "sidebar", itemOrder: 2 }),
      ],
    });
    const target = makeTemplate({ contentSectionDefinitions: [makeSection()] });
    expect(mapper.hasTemplateChanged(source, target)).toBe(true);
  });

  it("returns true when a zone is renamed", () => {
    const mapper = makeMapper();
    const source = makeTemplate({
      contentSectionDefinitions: [makeSection({ pageItemTemplateReferenceName: "renamed" })],
    });
    const target = makeTemplate({ contentSectionDefinitions: [makeSection()] });
    expect(mapper.hasTemplateChanged(source, target)).toBe(true);
  });

  it("returns true when zone order differs", () => {
    const mapper = makeMapper();
    const source = makeTemplate({ contentSectionDefinitions: [makeSection({ itemOrder: 2 })] });
    const target = makeTemplate({ contentSectionDefinitions: [makeSection({ itemOrder: 1 })] });
    expect(mapper.hasTemplateChanged(source, target)).toBe(true);
  });

  it("ignores section array ordering when itemOrder matches", () => {
    const mapper = makeMapper();
    const main = makeSection();
    const sidebar = makeSection({ pageItemTemplateName: "sidebar", pageItemTemplateReferenceName: "sidebar", itemOrder: 2 });
    const source = makeTemplate({ contentSectionDefinitions: [main, sidebar] });
    const target = makeTemplate({ contentSectionDefinitions: [sidebar, main] });
    expect(mapper.hasTemplateChanged(source, target)).toBe(false);
  });

  it("returns true when the template is renamed", () => {
    const mapper = makeMapper();
    expect(mapper.hasTemplateChanged(makeTemplate({ pageTemplateName: "New" }), makeTemplate())).toBe(true);
  });
});
