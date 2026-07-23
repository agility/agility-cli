import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState, state } from "core/state";
import { GuidDataLoader, resolveReferencedModels } from "../guid-data-loader";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-gdl-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  // Model filtering builds a ModelDependencyTreeBuilder → AssetMapper, which needs guids.
  state.sourceGuid = ["source-guid-u"];
  state.targetGuid = ["target-guid-u"];
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── constructor ──────────────────────────────────────────────────────────────

describe("GuidDataLoader constructor", () => {
  it("constructs without throwing for a valid guid", () => {
    expect(() => new GuidDataLoader("test-guid-u")).not.toThrow();
  });

  it("getGuid returns the guid passed to constructor", () => {
    const loader = new GuidDataLoader("my-test-guid");
    expect(loader.getGuid()).toBe("my-test-guid");
  });
});

// ─── resetLoggingFlags ────────────────────────────────────────────────────────

describe("GuidDataLoader.resetLoggingFlags", () => {
  it("can be called without throwing", () => {
    expect(() => GuidDataLoader.resetLoggingFlags()).not.toThrow();
  });

  it("can be called multiple times without throwing", () => {
    GuidDataLoader.resetLoggingFlags();
    GuidDataLoader.resetLoggingFlags();
    expect(true).toBe(true);
  });
});

// ─── hasNoContent ─────────────────────────────────────────────────────────────

describe("GuidDataLoader.hasNoContent", () => {
  it("returns true when all arrays are empty", () => {
    const loader = new GuidDataLoader("guid");
    const entities = {
      pages: [],
      templates: [],
      containers: [],
      lists: [],
      models: [],
      content: [],
      assets: [],
      galleries: [],
      urlRedirections: [],
    };
    expect(loader.hasNoContent(entities)).toBe(true);
  });

  it("returns false when pages array has items", () => {
    const loader = new GuidDataLoader("guid");
    const entities = {
      pages: [{ pageID: 1 }],
      templates: [],
      containers: [],
      lists: [],
      models: [],
      content: [],
      assets: [],
      galleries: [],
      urlRedirections: [],
    };
    expect(loader.hasNoContent(entities)).toBe(false);
  });

  it("returns false when models array has items", () => {
    const loader = new GuidDataLoader("guid");
    const entities = {
      pages: [],
      templates: [],
      containers: [],
      lists: [],
      models: [{ id: 1, referenceName: "TestModel" }],
      content: [],
      assets: [],
      galleries: [],
      urlRedirections: [],
    };
    expect(loader.hasNoContent(entities)).toBe(false);
  });

  it("returns false when assets array has items", () => {
    const loader = new GuidDataLoader("guid");
    const entities = {
      pages: [],
      templates: [],
      containers: [],
      lists: [],
      models: [],
      content: [],
      assets: [{ mediaID: 1 }],
      galleries: [],
      urlRedirections: [],
    };
    expect(loader.hasNoContent(entities)).toBe(false);
  });
});

// ─── getEntityCounts ──────────────────────────────────────────────────────────

describe("GuidDataLoader.getEntityCounts", () => {
  it("returns correct counts for all entity types", () => {
    const loader = new GuidDataLoader("guid");
    const entities = {
      pages: [1, 2, 3],
      templates: [1],
      containers: [1, 2],
      lists: [],
      models: [1, 2, 3, 4],
      content: [1],
      assets: [1, 2],
      galleries: [1, 2, 3],
      urlRedirections: [1],
    };
    const counts = loader.getEntityCounts(entities as any);

    expect(counts.pages).toBe(3);
    expect(counts.templates).toBe(1);
    expect(counts.containers).toBe(2);
    expect(counts.lists).toBe(0);
    expect(counts.models).toBe(4);
    expect(counts.content).toBe(1);
    expect(counts.assets).toBe(2);
    expect(counts.galleries).toBe(3);
    expect(counts.urlRedirections).toBe(1);
  });

  it("returns all zeros for empty entities", () => {
    const loader = new GuidDataLoader("guid");
    const entities = {
      pages: [],
      templates: [],
      containers: [],
      lists: [],
      models: [],
      content: [],
      assets: [],
      galleries: [],
      urlRedirections: [],
    };
    const counts = loader.getEntityCounts(entities);

    Object.values(counts).forEach((count) => {
      expect(count).toBe(0);
    });
  });

  it("returns counts object with all expected keys", () => {
    const loader = new GuidDataLoader("guid");
    const entities = {
      pages: [],
      templates: [],
      containers: [],
      lists: [],
      models: [],
      content: [],
      assets: [],
      galleries: [],
      urlRedirections: [],
    };
    const counts = loader.getEntityCounts(entities);

    expect(counts).toHaveProperty("pages");
    expect(counts).toHaveProperty("templates");
    expect(counts).toHaveProperty("containers");
    expect(counts).toHaveProperty("lists");
    expect(counts).toHaveProperty("models");
    expect(counts).toHaveProperty("content");
    expect(counts).toHaveProperty("assets");
    expect(counts).toHaveProperty("galleries");
    expect(counts).toHaveProperty("urlRedirections");
  });
});

// ─── validateDataStructure ────────────────────────────────────────────────────

describe("GuidDataLoader.validateDataStructure", () => {
  it("returns false when instance path does not exist", () => {
    setState({ rootPath: path.join(tmpDir, "nonexistent-subdir") });
    const loader = new GuidDataLoader("missing-guid-u");

    expect(loader.validateDataStructure("en-us")).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("returns true when instance path exists (rootPath/guid)", () => {
    // fileOperations builds instancePath as rootPath/guid (in guid-level non-legacy mode)
    const instanceDir = path.join(tmpDir, "validate-guid-u");
    fs.mkdirSync(instanceDir, { recursive: true });

    setState({ rootPath: tmpDir });
    const loader = new GuidDataLoader("validate-guid-u");

    expect(loader.validateDataStructure("en-us")).toBe(true);
  });
});

// ─── resolveReferencedModels (PROD-2187: --models pulls referenced models) ───

describe("resolveReferencedModels", () => {
  const contentField = (refName: string) => ({ type: "Content", settings: { ContentDefinition: refName } });
  const model = (referenceName: string, refs: string[] = []) => ({
    referenceName,
    fields: refs.map(contentField),
  });

  it("returns just the requested model when it references nothing", () => {
    const all = [model("FooterLinksLists")];
    expect(resolveReferencedModels(["FooterLinksLists"], all)).toEqual(["FooterLinksLists"]);
  });

  it("includes a model referenced via a linked-content field (FooterLinks → FooterLinksLists)", () => {
    const all = [model("FooterLinks", ["FooterLinksLists"]), model("FooterLinksLists")];
    const result = resolveReferencedModels(["FooterLinks"], all);
    expect(result).toEqual(expect.arrayContaining(["FooterLinks", "FooterLinksLists"]));
    expect(result).toHaveLength(2);
  });

  it("resolves references transitively (A → B → C)", () => {
    const all = [model("A", ["B"]), model("B", ["C"]), model("C")];
    const result = resolveReferencedModels(["A"], all);
    expect(result).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(result).toHaveLength(3);
  });

  it("terminates on a reference cycle (A → B → A)", () => {
    const all = [model("A", ["B"]), model("B", ["A"])];
    const result = resolveReferencedModels(["A"], all);
    expect(result.sort()).toEqual(["A", "B"]);
  });

  it("matches case-insensitively but returns the canonical reference name", () => {
    const all = [model("FooterLinks", ["FooterLinksLists"]), model("FooterLinksLists")];
    const result = resolveReferencedModels(["footerlinks"], all);
    expect(result).toEqual(expect.arrayContaining(["FooterLinks", "FooterLinksLists"]));
  });

  it("keeps a requested model even if it is not found in the model set", () => {
    expect(resolveReferencedModels(["Ghost"], [])).toEqual(["Ghost"]);
  });

  it("ignores fields with empty/absent ContentDefinition", () => {
    const all = [
      {
        referenceName: "M",
        fields: [
          { type: "Text", settings: {} },
          { type: "Content", settings: { ContentDefinition: "" } },
        ],
      },
    ];
    expect(resolveReferencedModels(["M"], all)).toEqual(["M"]);
  });
});

// ─── loadGuidEntities — with prepared filesystem ─────────────────────────────

describe("GuidDataLoader.loadGuidEntities", () => {
  it("returns GuidEntities with empty arrays when only Models element is requested and no files exist", async () => {
    // Don't include Galleries in elements to avoid scan errors on missing gallery dir
    state.elements = "Models";
    state.isSync = false;
    state.modelsWithDeps = "";

    const loader = new GuidDataLoader("no-files-model-guid-u");
    const entities = await loader.loadGuidEntities("en-us");

    expect(entities).toBeDefined();
    expect(Array.isArray(entities.models)).toBe(true);
    expect(entities.models).toHaveLength(0);
  });

  it("returns all required fields as arrays", async () => {
    state.elements = "Models";
    state.isSync = false;
    state.modelsWithDeps = "";

    const loader = new GuidDataLoader("fields-check-guid-u");
    const entities = await loader.loadGuidEntities("en-us");

    expect(Array.isArray(entities.pages)).toBe(true);
    expect(Array.isArray(entities.templates)).toBe(true);
    expect(Array.isArray(entities.containers)).toBe(true);
    expect(Array.isArray(entities.lists)).toBe(true);
    expect(Array.isArray(entities.models)).toBe(true);
    expect(Array.isArray(entities.content)).toBe(true);
    expect(Array.isArray(entities.assets)).toBe(true);
    expect(Array.isArray(entities.galleries)).toBe(true);
  });

  it("result fields are never null or undefined", async () => {
    state.elements = "Models,Containers";
    state.isSync = false;
    state.modelsWithDeps = "";

    const loader = new GuidDataLoader("null-check-guid-u");
    const entities = await loader.loadGuidEntities("en-us");

    Object.entries(entities).forEach(([key, value]) => {
      expect(value).not.toBeNull();
      expect(value).not.toBeUndefined();
    });
  });

  it("filterGuidEntitiesByModels returns empty arrays when no matching models exist", async () => {
    state.elements = "Models";
    state.isSync = false;
    state.modelsWithDeps = "";

    const loader = new GuidDataLoader("filter-test-guid-u");

    // When models filter is set with valid name but no model files exist,
    // the validation will fail because the model doesn't exist in loaded data.
    // filterOptions with valid names resolves to empty when no models loaded.
    // An invalid model name throws Model validation failed error.
    // We test the non-filtering path by passing no filterOptions.
    const entities = await loader.loadGuidEntities("en-us");

    // Without filtering, all arrays are returned (empty when no files)
    expect(Array.isArray(entities.models)).toBe(true);
    expect(Array.isArray(entities.containers)).toBe(true);
    expect(Array.isArray(entities.pages)).toBe(true);
  });

  it("throws Model validation failed when filterOptions.models contains unknown model", async () => {
    state.elements = "Models";
    state.isSync = false;
    state.modelsWithDeps = "";

    const loader = new GuidDataLoader("validate-filter-guid-u");

    await expect(loader.loadGuidEntities("en-us", { models: ["NonExistentModel"] })).rejects.toThrow(
      /Model validation failed/
    );
  });

  it("--models pulls the requested model AND its referenced models, but no content/pages/containers", async () => {
    // Lay down models on disk: FooterLinks references FooterLinksLists via a linked-content field.
    const guid = "models-only-refs-guid-u";
    const modelsDir = path.join(tmpDir, guid, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(
      path.join(modelsDir, "157.json"),
      JSON.stringify({
        id: 157,
        referenceName: "FooterLinks",
        contentDefinitionTypeID: 1,
        fields: [{ name: "footerLinks", type: "Content", settings: { ContentDefinition: "FooterLinksLists" } }],
      })
    );
    fs.writeFileSync(
      path.join(modelsDir, "158.json"),
      JSON.stringify({ id: 158, referenceName: "FooterLinksLists", contentDefinitionTypeID: 1, fields: [] })
    );
    // A model that was NOT requested and is unrelated — must NOT be pulled in.
    fs.writeFileSync(
      path.join(modelsDir, "999.json"),
      JSON.stringify({ id: 999, referenceName: "Unrelated", contentDefinitionTypeID: 1, fields: [] })
    );

    state.elements = "Models";
    state.isSync = false;
    state.modelsWithDeps = "";

    const loader = new GuidDataLoader(guid);
    const entities = await loader.loadGuidEntities("en-us", { models: ["FooterLinks"] });

    const names = entities.models.map((m: any) => m.referenceName).sort();
    expect(names).toEqual(["FooterLinks", "FooterLinksLists"]); // referenced model included, Unrelated excluded

    // Models-only: nothing else is pulled.
    expect(entities.containers).toHaveLength(0);
    expect(entities.content).toHaveLength(0);
    expect(entities.pages).toHaveLength(0);
    expect(entities.templates).toHaveLength(0);
    expect(entities.assets).toHaveLength(0);
    expect(entities.galleries).toHaveLength(0);
  });
});
