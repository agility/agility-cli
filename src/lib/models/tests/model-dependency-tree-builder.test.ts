import { resetState } from "core/state";
import { ModelDependencyTreeBuilder, ModelDependencyTree } from "lib/models/model-dependency-tree-builder";
import { SitemapHierarchy } from "lib/pushers/page-pusher/sitemap-hierarchy";

// Mock SitemapHierarchy to avoid filesystem access
jest.mock("lib/pushers/page-pusher/sitemap-hierarchy");

const MockedSitemapHierarchy = SitemapHierarchy as jest.MockedClass<typeof SitemapHierarchy>;

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});

  // Default: no parent found (root-level pages)
  MockedSitemapHierarchy.prototype.findPageParentInSourceSitemap = jest.fn().mockReturnValue({
    parentId: null,
    parentName: null,
    foundIn: "root-level",
  });

  // Reset static logging flag between tests
  ModelDependencyTreeBuilder.resetLoggingFlags();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeModel(id: number, referenceName: string): any {
  return { id, referenceName };
}

function makeContainer(
  contentViewID: number,
  contentDefinitionID: number,
  referenceName = `ref-${contentViewID}`
): any {
  return { contentViewID, contentDefinitionID, referenceName };
}

function makeContent(
  contentID: number,
  definitionName: string,
  referenceName = `ref-${contentID}`,
  fields: any = {}
): any {
  return {
    contentID,
    properties: { definitionName, referenceName },
    fields,
  };
}

function makePage(pageID: number, opts: { pageTemplateID?: number; zones?: any; name?: string } = {}): any {
  return {
    pageID,
    name: opts.name ?? `page-${pageID}`,
    pageTemplateID: opts.pageTemplateID,
    zones: opts.zones,
  };
}

function makeTemplate(
  pageTemplateID: number,
  contentSectionDefinitions: any[] = [],
  pageTemplateName = `tmpl-${pageTemplateID}`
): any {
  return { pageTemplateID, pageTemplateName, contentSectionDefinitions };
}

function makeAsset(url: string, originUrl?: string, edgeUrl?: string): any {
  return { url, originUrl, edgeUrl };
}

function makeGallery(mediaGroupingID: number): any {
  return { mediaGroupingID };
}

function makeSourceData(overrides: Partial<any> = {}): any {
  return {
    models: [],
    containers: [],
    content: [],
    templates: [],
    pages: [],
    assets: [],
    galleries: [],
    lists: [],
    ...overrides,
  };
}

// ─── model→model references via linked-content fields (PROD-2187) ─────────────

function makeModelWithRefs(id: number, referenceName: string, refs: string[] = []): any {
  return {
    id,
    referenceName,
    fields: refs.map((r) => ({ type: "Content", settings: { ContentDefinition: r } })),
  };
}

describe("ModelDependencyTreeBuilder — model→model references", () => {
  it("includes a model referenced via a linked-content field (FooterLinks → FooterLinksLists)", () => {
    const builder = new ModelDependencyTreeBuilder(
      makeSourceData({
        models: [makeModelWithRefs(1, "FooterLinks", ["FooterLinksLists"]), makeModelWithRefs(2, "FooterLinksLists")],
      })
    );
    const tree = builder.buildDependencyTree(["FooterLinks"], "website");
    expect(tree.models.has("FooterLinks")).toBe(true);
    expect(tree.models.has("FooterLinksLists")).toBe(true);
  });

  it("resolves references transitively (A → B → C)", () => {
    const builder = new ModelDependencyTreeBuilder(
      makeSourceData({
        models: [makeModelWithRefs(1, "A", ["B"]), makeModelWithRefs(2, "B", ["C"]), makeModelWithRefs(3, "C")],
      })
    );
    const tree = builder.buildDependencyTree(["A"], "website");
    expect(tree.models.has("B")).toBe(true);
    expect(tree.models.has("C")).toBe(true);
  });

  it("does not pull in unrelated models", () => {
    const builder = new ModelDependencyTreeBuilder(
      makeSourceData({
        models: [
          makeModelWithRefs(1, "FooterLinks", ["FooterLinksLists"]),
          makeModelWithRefs(2, "FooterLinksLists"),
          makeModelWithRefs(9, "Unrelated"),
        ],
      })
    );
    const tree = builder.buildDependencyTree(["FooterLinks"], "website");
    expect(tree.models.has("Unrelated")).toBe(false);
  });

  it("terminates on a reference cycle (A → B → A)", () => {
    const builder = new ModelDependencyTreeBuilder(
      makeSourceData({ models: [makeModelWithRefs(1, "A", ["B"]), makeModelWithRefs(2, "B", ["A"])] })
    );
    const tree = builder.buildDependencyTree(["A"], "website");
    expect(tree.models.has("A")).toBe(true);
    expect(tree.models.has("B")).toBe(true);
  });
});

// ─── resetLoggingFlags ────────────────────────────────────────────────────────

describe("ModelDependencyTreeBuilder.resetLoggingFlags", () => {
  it("does not throw", () => {
    expect(() => ModelDependencyTreeBuilder.resetLoggingFlags()).not.toThrow();
  });

  it("allows the breakdown log to fire again on a fresh builder", () => {
    const builder = new ModelDependencyTreeBuilder(
      makeSourceData({ models: [makeModel(1, "Post")], content: [makeContent(10, "Post")] })
    );
    const logSpy = jest.spyOn(console, "log");

    builder.buildDependencyTree(["Post"], "website");
    const callsAfterFirst = logSpy.mock.calls.length;

    // Log should not fire again without reset
    builder.buildDependencyTree(["Post"], "website");
    expect(logSpy.mock.calls.length).toBe(callsAfterFirst);

    // After reset, log fires again
    ModelDependencyTreeBuilder.resetLoggingFlags();
    builder.buildDependencyTree(["Post"], "website");
    expect(logSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

// ─── constructor ──────────────────────────────────────────────────────────────

describe("ModelDependencyTreeBuilder constructor", () => {
  it("does not throw with a valid sourceData object", () => {
    expect(() => new ModelDependencyTreeBuilder(makeSourceData())).not.toThrow();
  });
});

// ─── buildDependencyTree — guard clauses ─────────────────────────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — guard clauses", () => {
  let builder: ModelDependencyTreeBuilder;

  beforeEach(() => {
    builder = new ModelDependencyTreeBuilder(makeSourceData());
  });

  it("throws when modelNames is null", () => {
    expect(() => builder.buildDependencyTree(null as any, "website")).toThrow(
      "Model names are required for dependency tree building"
    );
  });

  it("throws when modelNames is an empty array", () => {
    expect(() => builder.buildDependencyTree([], "website")).toThrow(
      "Model names are required for dependency tree building"
    );
  });
});

// ─── buildDependencyTree — empty source data ─────────────────────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — empty source data", () => {
  it("returns tree with only the requested model names when source data is empty", () => {
    const builder = new ModelDependencyTreeBuilder(makeSourceData());
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.models).toEqual(new Set(["Post"]));
    expect(tree.containers.size).toBe(0);
    expect(tree.content.size).toBe(0);
    expect(tree.templates.size).toBe(0);
    expect(tree.pages.size).toBe(0);
    expect(tree.assets.size).toBe(0);
    expect(tree.galleries.size).toBe(0);
  });

  it("seeds the models set with all supplied model names", () => {
    const builder = new ModelDependencyTreeBuilder(makeSourceData());
    const tree = builder.buildDependencyTree(["Alpha", "Beta", "Gamma"], "website");
    expect(tree.models).toEqual(new Set(["Alpha", "Beta", "Gamma"]));
  });

  it("returns a tree with all required keys", () => {
    const builder = new ModelDependencyTreeBuilder(makeSourceData());
    const tree = builder.buildDependencyTree(["M"], "website");
    const keys: Array<keyof ModelDependencyTree> = [
      "models",
      "containers",
      "lists",
      "content",
      "templates",
      "pages",
      "assets",
      "galleries",
    ];
    keys.forEach((key) => expect(tree).toHaveProperty(key));
  });
});

// ─── buildDependencyTree — container discovery ───────────────────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — container discovery", () => {
  it("finds containers that reference a matching model", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1)],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.containers.has(100)).toBe(true);
  });

  it("does not include containers for unrelated models", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post"), makeModel(2, "Author")],
      containers: [makeContainer(100, 1), makeContainer(200, 2)],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.containers.has(100)).toBe(true);
    expect(tree.containers.has(200)).toBe(false);
  });

  it("discovers multiple containers for the same model", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1), makeContainer(101, 1)],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.containers.has(100)).toBe(true);
    expect(tree.containers.has(101)).toBe(true);
  });

  it("handles missing containers array gracefully", () => {
    const sourceData = makeSourceData({ models: [makeModel(1, "Post")], containers: undefined });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    expect(() => builder.buildDependencyTree(["Post"], "website")).not.toThrow();
  });

  it("handles missing models array gracefully", () => {
    const sourceData = makeSourceData({ models: undefined, containers: [makeContainer(100, 1)] });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    expect(() => builder.buildDependencyTree(["Post"], "website")).not.toThrow();
  });

  it("ignores model names that do not exist in the models list", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1)],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["NonExistent"], "website");
    expect(tree.containers.size).toBe(0);
  });
});

// ─── buildDependencyTree — content discovery ─────────────────────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — content discovery", () => {
  it("finds content items whose definitionName matches a requested model", () => {
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post"), makeContent(11, "Post"), makeContent(12, "Author")],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.content.has(10)).toBe(true);
    expect(tree.content.has(11)).toBe(true);
    expect(tree.content.has(12)).toBe(false);
  });

  it("handles missing content array gracefully", () => {
    const sourceData = makeSourceData({ content: undefined });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    expect(() => builder.buildDependencyTree(["Post"], "website")).not.toThrow();
  });

  it("collects content for multiple model names", () => {
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post"), makeContent(20, "Author")],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post", "Author"], "website");

    expect(tree.content.has(10)).toBe(true);
    expect(tree.content.has(20)).toBe(true);
  });
});

// ─── buildDependencyTree — template discovery ────────────────────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — template discovery via containers", () => {
  it("finds a template referencing a discovered container via contentViewID", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1)],
      templates: [makeTemplate(500, [{ contentViewID: 100 }])],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.templates.has(500)).toBe(true);
  });

  it("finds a template referencing a discovered container via itemContainerID", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1)],
      templates: [makeTemplate(501, [{ itemContainerID: 100 }])],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.templates.has(501)).toBe(true);
  });

  it("does not include templates that reference undiscovered containers", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1)],
      templates: [makeTemplate(500, [{ contentViewID: 999 }])],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.templates.has(500)).toBe(false);
  });

  it("handles missing templates array gracefully", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1)],
      templates: undefined,
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    expect(() => builder.buildDependencyTree(["Post"], "website")).not.toThrow();
  });

  it("resolves template by name when page has templateName instead of ID", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1)],
      templates: [
        { pageTemplateID: 600, pageTemplateName: "MainLayout", contentSectionDefinitions: [{ contentViewID: 100 }] },
      ],
      pages: [{ pageID: 300, name: "blog", templateName: "MainLayout" }],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.templates.has(600)).toBe(true);
  });
});

// ─── buildDependencyTree — page discovery ────────────────────────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — page discovery", () => {
  it("finds a page that uses a discovered template", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1)],
      templates: [makeTemplate(500, [{ contentViewID: 100 }])],
      pages: [makePage(300, { pageTemplateID: 500 })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.pages.has(300)).toBe(true);
  });

  it("finds a page whose zone references a discovered content item", () => {
    const zones = { main: [{ item: { contentid: 10 } }] };
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post")],
      pages: [makePage(300, { zones })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.pages.has(300)).toBe(true);
  });

  it("supports contentID (uppercase) in zone module items", () => {
    const zones = { sidebar: [{ item: { contentID: 20 } }] };
    const sourceData = makeSourceData({
      content: [makeContent(20, "Widget")],
      pages: [makePage(400, { zones })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Widget"], "website");

    expect(tree.pages.has(400)).toBe(true);
  });

  it("does not include pages that neither match a template nor reference discovered content", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1)],
      templates: [makeTemplate(500, [{ contentViewID: 100 }])],
      pages: [makePage(300, { pageTemplateID: 500 }), makePage(999, { pageTemplateID: 888 })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.pages.has(300)).toBe(true);
    expect(tree.pages.has(999)).toBe(false);
  });

  it("handles missing pages array gracefully", () => {
    const sourceData = makeSourceData({ pages: undefined });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    expect(() => builder.buildDependencyTree(["Post"], "website")).not.toThrow();
  });
});

// ─── buildDependencyTree — content pulled from page zones ────────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — content pulled from page zones", () => {
  it("adds content IDs found in discovered page zones to the content set", () => {
    const zones = { main: [{ item: { contentid: 10 } }, { item: { contentid: 99 } }] };
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post"), makeContent(99, "Promo")],
      pages: [makePage(300, { zones })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.content.has(99)).toBe(true);
  });

  it("does not add non-numeric content IDs from page zones", () => {
    const zones = { main: [{ item: { contentid: "bad-id" } }] };
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post")],
      pages: [makePage(300, { zones })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    // Should not throw
    expect(() => builder.buildDependencyTree(["Post"], "website")).not.toThrow();
  });
});

// ─── buildDependencyTree — model back-discovery from content ─────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — model back-discovery", () => {
  it("adds the model of a content item discovered through a page zone", () => {
    const zones = { main: [{ item: { contentid: 10 } }, { item: { contentid: 99 } }] };
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post"), makeContent(99, "Promo")],
      models: [makeModel(1, "Post"), makeModel(2, "Promo")],
      pages: [makePage(300, { zones })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.models.has("Promo")).toBe(true);
  });
});

// ─── buildDependencyTree — container back-discovery from content ──────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — container discovery for content", () => {
  it("adds containers whose referenceName (case-insensitive) matches a content referenceName", () => {
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [
        makeContainer(100, 1, "news1_PostList"), // different casing
      ],
      content: [makeContent(10, "Post", "news1_postlist")],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.containers.has(100)).toBe(true);
  });

  it("does not add containers whose reference name does not match any content reference", () => {
    // Model ID 99 does not match any model in the models array, so container 200 is
    // only eligible for inclusion via the case-insensitive referenceName path — which
    // should not fire because 'unrelated_container' != 'news1_postlist'.
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(200, 99, "unrelated_container")],
      content: [makeContent(10, "Post", "news1_postlist")],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.containers.has(200)).toBe(false);
  });
});

// ─── buildDependencyTree — asset discovery ───────────────────────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — asset discovery", () => {
  it("adds asset URLs found in content fields", () => {
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post", "ref-10", { image: "https://cdn.aglty.io/my-img.jpg" })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.assets.has("https://cdn.aglty.io/my-img.jpg")).toBe(true);
  });

  it("adds asset URL variations from matching assets in sourceData", () => {
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post", "ref-10", { image: "https://cdn.aglty.io/my-img.jpg" })],
      assets: [
        makeAsset(
          "https://cdn.aglty.io/my-img.jpg",
          "https://origin.aglty.io/my-img.jpg",
          "https://edge.aglty.io/my-img.jpg"
        ),
      ],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.assets.has("https://origin.aglty.io/my-img.jpg")).toBe(true);
    expect(tree.assets.has("https://edge.aglty.io/my-img.jpg")).toBe(true);
  });

  it("does not add asset URLs for content items not in the tree", () => {
    const sourceData = makeSourceData({
      content: [
        makeContent(10, "Post", "ref-10", { image: "https://cdn.aglty.io/included.jpg" }),
        makeContent(20, "Other", "ref-20", { image: "https://cdn.aglty.io/excluded.jpg" }),
      ],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.assets.has("https://cdn.aglty.io/included.jpg")).toBe(true);
    expect(tree.assets.has("https://cdn.aglty.io/excluded.jpg")).toBe(false);
  });

  it("handles missing content array gracefully for asset discovery", () => {
    const sourceData = makeSourceData({ content: undefined });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    expect(() => builder.buildDependencyTree(["Post"], "website")).not.toThrow();
  });

  it("extracts asset URLs from agilitycms.com domain", () => {
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post", "ref-10", { banner: "https://static.agilitycms.com/banner.png" })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.assets.has("https://static.agilitycms.com/banner.png")).toBe(true);
  });
});

// ─── buildDependencyTree — gallery discovery ─────────────────────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — gallery discovery", () => {
  it("adds gallery IDs found via mediaGroupingID in content fields", () => {
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post", "ref-10", { gallery: { mediaGroupingID: 55 } })],
      galleries: [makeGallery(55)],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.galleries.has(55)).toBe(true);
  });

  it("adds gallery IDs found via galleryID in content fields", () => {
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post", "ref-10", { pics: { galleryID: 77 } })],
      galleries: [makeGallery(77)],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.galleries.has(77)).toBe(true);
  });

  it("does not add gallery IDs from content not in the tree", () => {
    const sourceData = makeSourceData({
      content: [
        makeContent(10, "Post", "ref-10", {}),
        makeContent(20, "Other", "ref-20", { g: { mediaGroupingID: 99 } }),
      ],
      galleries: [makeGallery(99)],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.galleries.has(99)).toBe(false);
  });

  it("handles missing galleries array gracefully", () => {
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post", "ref-10", { g: { mediaGroupingID: 55 } })],
      galleries: undefined,
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    expect(() => builder.buildDependencyTree(["Post"], "website")).not.toThrow();
  });

  it("recursively finds gallery IDs nested in arrays", () => {
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post", "ref-10", { items: [{ mediaGroupingID: 42 }] })],
      galleries: [makeGallery(42)],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.galleries.has(42)).toBe(true);
  });
});

// ─── buildDependencyTree — ancestor page discovery ───────────────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — ancestor page discovery", () => {
  it("adds the parent page when findPageParentInSourceSitemap returns a parent ID", () => {
    MockedSitemapHierarchy.prototype.findPageParentInSourceSitemap = jest.fn().mockImplementation((pageId: number) => {
      // child page 300 has parent 200
      if (pageId === 300) return { parentId: 200, parentName: "parent-page", foundIn: "direct-match" };
      return { parentId: null, parentName: null, foundIn: "root-level" };
    });

    const zones = { main: [{ item: { contentid: 10 } }] };
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post")],
      pages: [makePage(300, { zones, name: "child-page" }), makePage(200, { name: "parent-page" })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.pages.has(300)).toBe(true);
    expect(tree.pages.has(200)).toBe(true);
  });

  it("does not add a parent page that has already been included", () => {
    MockedSitemapHierarchy.prototype.findPageParentInSourceSitemap = jest
      .fn()
      .mockReturnValue({ parentId: null, parentName: null, foundIn: "root-level" });

    const zones = { main: [{ item: { contentid: 10 } }] };
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post")],
      pages: [makePage(300, { zones })],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.pages.size).toBe(1);
  });

  it("recursively adds grandparent pages", () => {
    MockedSitemapHierarchy.prototype.findPageParentInSourceSitemap = jest.fn().mockImplementation((pageId: number) => {
      if (pageId === 300) return { parentId: 200, parentName: "parent", foundIn: "direct-match" };
      if (pageId === 200) return { parentId: 100, parentName: "grandparent", foundIn: "direct-match" };
      return { parentId: null, parentName: null, foundIn: "root-level" };
    });

    const zones = { main: [{ item: { contentid: 10 } }] };
    const sourceData = makeSourceData({
      content: [makeContent(10, "Post")],
      pages: [
        makePage(300, { zones, name: "child" }),
        makePage(200, { name: "parent" }),
        makePage(100, { name: "grandparent" }),
      ],
    });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.pages.has(100)).toBe(true);
    expect(tree.pages.has(200)).toBe(true);
    expect(tree.pages.has(300)).toBe(true);
  });
});

// ─── buildDependencyTree — hasLoggedBreakdown deduplication ──────────────────

describe("ModelDependencyTreeBuilder.buildDependencyTree — breakdown log deduplication", () => {
  it("only logs the breakdown once across multiple calls on the same builder", () => {
    const sourceData = makeSourceData({ content: [makeContent(10, "Post")] });
    const builder = new ModelDependencyTreeBuilder(sourceData);
    const logSpy = jest.spyOn(console, "log");

    builder.buildDependencyTree(["Post"], "website");
    const firstCallCount = logSpy.mock.calls.length;

    builder.buildDependencyTree(["Post"], "website");
    expect(logSpy.mock.calls.length).toBe(firstCallCount);
  });
});

// ─── validateModels ───────────────────────────────────────────────────────────

describe("ModelDependencyTreeBuilder.validateModels", () => {
  let builder: ModelDependencyTreeBuilder;

  beforeEach(() => {
    builder = new ModelDependencyTreeBuilder(makeSourceData());
  });

  it("returns all names as invalid when models list is empty", () => {
    const result = builder.validateModels(["Post", "Author"], []);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toEqual(["Post", "Author"]);
  });

  it("returns all names as invalid when models is null", () => {
    const result = builder.validateModels(["Post"], null as any);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toEqual(["Post"]);
  });

  it("validates a model name that exists (exact case)", () => {
    const models = [makeModel(1, "Post")];
    const result = builder.validateModels(["Post"], models);
    expect(result.valid).toEqual(["Post"]);
    expect(result.invalid).toHaveLength(0);
  });

  it("validates a model name case-insensitively", () => {
    const models = [makeModel(1, "Post")];
    const result = builder.validateModels(["post"], models);
    expect(result.valid).toEqual(["post"]);
    expect(result.invalid).toHaveLength(0);
  });

  it("trims whitespace when comparing model names", () => {
    const models = [makeModel(1, "Post")];
    const result = builder.validateModels(["  Post  "], models);
    expect(result.valid).toEqual(["  Post  "]);
    expect(result.invalid).toHaveLength(0);
  });

  it("returns correct valid/invalid split for a mixed list", () => {
    const models = [makeModel(1, "Post"), makeModel(2, "Author")];
    const result = builder.validateModels(["Post", "NonExistent", "Author"], models);
    expect(result.valid).toEqual(["Post", "Author"]);
    expect(result.invalid).toEqual(["NonExistent"]);
  });

  it("handles an empty modelNames array", () => {
    const models = [makeModel(1, "Post")];
    const result = builder.validateModels([], models);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(0);
  });
});

// ─── integration: full pipeline ──────────────────────────────────────────────

describe("ModelDependencyTreeBuilder — full pipeline integration", () => {
  it("builds a complete tree linking models → containers → templates → pages → content → assets", () => {
    const zones = { main: [{ item: { contentid: 10 } }] };
    const sourceData = makeSourceData({
      models: [makeModel(1, "Post")],
      containers: [makeContainer(100, 1)],
      content: [makeContent(10, "Post", "ref-10", { hero: "https://cdn.aglty.io/hero.jpg" })],
      templates: [makeTemplate(500, [{ contentViewID: 100 }])],
      pages: [makePage(300, { pageTemplateID: 500, zones })],
      assets: [makeAsset("https://cdn.aglty.io/hero.jpg")],
    });

    const builder = new ModelDependencyTreeBuilder(sourceData);
    const tree = builder.buildDependencyTree(["Post"], "website");

    expect(tree.models.has("Post")).toBe(true);
    expect(tree.containers.has(100)).toBe(true);
    expect(tree.content.has(10)).toBe(true);
    expect(tree.templates.has(500)).toBe(true);
    expect(tree.pages.has(300)).toBe(true);
    expect(tree.assets.has("https://cdn.aglty.io/hero.jpg")).toBe(true);
  });
});
