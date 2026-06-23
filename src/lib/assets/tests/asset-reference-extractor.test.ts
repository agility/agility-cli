import { resetState } from "core/state";
import { AssetReferenceExtractor } from "lib/assets/asset-reference-extractor";
import { AssetReference, SourceEntities, SyncAnalysisContext } from "types/syncAnalysis";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const makeContext = (overrides: Partial<SyncAnalysisContext> = {}): SyncAnalysisContext => ({
  sourceGuid: "test-guid-u",
  locale: "en-us",
  isPreview: false,
  rootPath: "agility-files",
  debug: false,
  elements: [],
  ...overrides,
});

// ─── extractAssetReferences / extractReferences ───────────────────────────────

describe("AssetReferenceExtractor.extractAssetReferences", () => {
  let extractor: AssetReferenceExtractor;

  beforeEach(() => {
    extractor = new AssetReferenceExtractor();
  });

  describe("null / non-object inputs", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a number", 42],
      ["a string", "just a string"],
      ["a boolean", true],
    ])("returns [] for %s", (_label, input) => {
      expect(extractor.extractAssetReferences(input)).toEqual([]);
    });
  });

  describe("top-level string fields", () => {
    it("finds an aglty.io URL in a top-level string field", () => {
      const refs = extractor.extractAssetReferences({
        image: "https://cdn.aglty.io/guid/assets/photo.jpg",
      });
      expect(refs).toHaveLength(1);
      expect(refs[0]).toEqual<AssetReference>({
        url: "https://cdn.aglty.io/guid/assets/photo.jpg",
        fieldPath: "image",
      });
    });

    it("finds an agilitycms.com URL in a top-level string field", () => {
      const refs = extractor.extractAssetReferences({
        logo: "https://cdn.agilitycms.com/guid/assets/logo.png",
      });
      expect(refs).toHaveLength(1);
      expect(refs[0].url).toBe("https://cdn.agilitycms.com/guid/assets/logo.png");
      expect(refs[0].fieldPath).toBe("logo");
    });

    it("ignores top-level string fields that are not asset URLs", () => {
      const refs = extractor.extractAssetReferences({
        title: "Hello world",
        href: "https://example.com/page",
      });
      expect(refs).toHaveLength(0);
    });

    it("collects multiple asset URLs from separate fields", () => {
      const refs = extractor.extractAssetReferences({
        hero: "https://cdn.aglty.io/guid/assets/hero.jpg",
        thumb: "https://cdn-eu.aglty.io/guid/assets/thumb.jpg",
      });
      expect(refs).toHaveLength(2);
      const paths = refs.map((r) => r.fieldPath);
      expect(paths).toContain("hero");
      expect(paths).toContain("thumb");
    });
  });

  describe("nested objects with url / originUrl / edgeUrl properties", () => {
    it("picks up the url property of an object field", () => {
      const refs = extractor.extractAssetReferences({
        attachment: { url: "https://cdn.aglty.io/guid/assets/doc.pdf", size: 1024 },
      });
      const assetRef = refs.find((r) => r.url === "https://cdn.aglty.io/guid/assets/doc.pdf");
      expect(assetRef).toBeDefined();
      expect(assetRef!.fieldPath).toBe("attachment.url");
    });

    it("picks up the originUrl property of an object field", () => {
      const refs = extractor.extractAssetReferences({
        file: { originUrl: "https://origin.aglty.io/guid/assets/file.zip" },
      });
      const assetRef = refs.find((r) => r.url === "https://origin.aglty.io/guid/assets/file.zip");
      expect(assetRef).toBeDefined();
      expect(assetRef!.fieldPath).toBe("file.originUrl");
    });

    it("picks up the edgeUrl property of an object field", () => {
      const refs = extractor.extractAssetReferences({
        media: { edgeUrl: "https://cdn-usa2.aglty.io/guid/assets/vid.mp4" },
      });
      const assetRef = refs.find((r) => r.url === "https://cdn-usa2.aglty.io/guid/assets/vid.mp4");
      expect(assetRef).toBeDefined();
      expect(assetRef!.fieldPath).toBe("media.edgeUrl");
    });

    it("does not duplicate when scanning url-named properties that are already non-asset strings", () => {
      const refs = extractor.extractAssetReferences({
        link: { url: "https://example.com/not-an-asset" },
      });
      expect(refs).toHaveLength(0);
    });
  });

  describe("array fields", () => {
    it("finds asset URLs inside an array of strings", () => {
      const refs = extractor.extractAssetReferences({
        gallery: ["https://cdn.aglty.io/guid/assets/img1.jpg", "https://cdn.aglty.io/guid/assets/img2.jpg"],
      });
      expect(refs).toHaveLength(2);
      expect(refs[0].fieldPath).toBe("gallery[0]");
      expect(refs[1].fieldPath).toBe("gallery[1]");
    });

    it("finds asset URLs inside an array of objects (url property)", () => {
      const refs = extractor.extractAssetReferences({
        items: [
          { url: "https://cdn.aglty.io/guid/assets/a.jpg", label: "A" },
          { url: "https://cdn.aglty.io/guid/assets/b.jpg", label: "B" },
        ],
      });
      const urls = refs.map((r) => r.url);
      expect(urls).toContain("https://cdn.aglty.io/guid/assets/a.jpg");
      expect(urls).toContain("https://cdn.aglty.io/guid/assets/b.jpg");
    });

    it("skips non-asset array items", () => {
      const refs = extractor.extractAssetReferences({
        tags: ["news", "tech", "design"],
      });
      expect(refs).toHaveLength(0);
    });
  });

  describe("deeply nested structures", () => {
    it("recurses into nested objects to find asset URLs", () => {
      const refs = extractor.extractAssetReferences({
        section: {
          hero: {
            background: "https://cdn.aglty.io/guid/assets/bg.jpg",
          },
        },
      });
      expect(refs).toHaveLength(1);
      expect(refs[0].url).toBe("https://cdn.aglty.io/guid/assets/bg.jpg");
    });
  });
});

// ─── extractReferences (public alias) ────────────────────────────────────────

describe("AssetReferenceExtractor.extractReferences", () => {
  it("delegates to extractAssetReferences and returns the same result", () => {
    const extractor = new AssetReferenceExtractor();
    const fields = { image: "https://cdn.aglty.io/guid/assets/pic.jpg" };
    expect(extractor.extractReferences(fields)).toEqual(extractor.extractAssetReferences(fields));
  });
});

// ─── initialize ───────────────────────────────────────────────────────────────

describe("AssetReferenceExtractor.initialize", () => {
  it("stores context without throwing", () => {
    const extractor = new AssetReferenceExtractor();
    expect(() => extractor.initialize(makeContext())).not.toThrow();
  });

  it("continues to extract references correctly after initialization", () => {
    const extractor = new AssetReferenceExtractor();
    extractor.initialize(makeContext());
    const refs = extractor.extractAssetReferences({
      img: "https://cdn.aglty.io/guid/assets/x.png",
    });
    expect(refs).toHaveLength(1);
  });
});

// ─── showContentAssetDependencies ─────────────────────────────────────────────

describe("AssetReferenceExtractor.showContentAssetDependencies", () => {
  let extractor: AssetReferenceExtractor;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    extractor = new AssetReferenceExtractor();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  it("logs nothing when content has no fields", () => {
    extractor.showContentAssetDependencies({}, {}, "  ");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logs a line with the asset fileName when the asset is found in sourceEntities", () => {
    const content = {
      fields: { hero: "https://cdn.aglty.io/guid/assets/banner.jpg" },
    };
    const sourceEntities: SourceEntities = {
      assets: [
        {
          url: "https://cdn.aglty.io/guid/assets/banner.jpg",
          fileName: "banner.jpg",
          mediaGroupingID: null,
        },
      ],
    };
    extractor.showContentAssetDependencies(content, sourceEntities, "  ");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("banner.jpg");
  });

  it("logs a MISSING line when the asset is not found in sourceEntities", () => {
    const content = {
      fields: { hero: "https://cdn.aglty.io/guid/assets/missing.jpg" },
    };
    extractor.showContentAssetDependencies(content, { assets: [] }, "  ");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("MISSING IN SOURCE DATA");
  });

  it("logs a gallery line when the asset belongs to a gallery present in sourceEntities", () => {
    const content = {
      fields: { hero: "https://cdn.aglty.io/guid/assets/photo.jpg" },
    };
    const sourceEntities: SourceEntities = {
      assets: [
        {
          url: "https://cdn.aglty.io/guid/assets/photo.jpg",
          fileName: "photo.jpg",
          mediaGroupingID: 99,
        },
      ],
      galleries: [{ mediaGroupingID: 99, name: "My Gallery" }],
    };
    extractor.showContentAssetDependencies(content, sourceEntities, "  ");
    expect(logSpy).toHaveBeenCalledTimes(2);
    const galleryLine = logSpy.mock.calls[1][0] as string;
    expect(galleryLine).toContain("My Gallery");
  });

  it("does not log a gallery line when the gallery is absent from sourceEntities", () => {
    const content = {
      fields: { hero: "https://cdn.aglty.io/guid/assets/photo.jpg" },
    };
    const sourceEntities: SourceEntities = {
      assets: [
        {
          url: "https://cdn.aglty.io/guid/assets/photo.jpg",
          fileName: "photo.jpg",
          mediaGroupingID: 99,
        },
      ],
      galleries: [],
    };
    extractor.showContentAssetDependencies(content, sourceEntities, "  ");
    // Only the asset line; no gallery line
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("matches assets by originUrl", () => {
    const content = {
      fields: { hero: "https://cdn.aglty.io/guid/assets/photo.jpg" },
    };
    const sourceEntities: SourceEntities = {
      assets: [
        {
          originUrl: "https://cdn.aglty.io/guid/assets/photo.jpg",
          edgeUrl: "https://edge.aglty.io/guid/assets/photo.jpg",
          fileName: "photo.jpg",
        },
      ],
    };
    extractor.showContentAssetDependencies(content, sourceEntities, "");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("photo.jpg");
    expect(logSpy.mock.calls[0][0]).not.toContain("MISSING");
  });
});

// ─── findMissingAssetsForContent ──────────────────────────────────────────────

describe("AssetReferenceExtractor.findMissingAssetsForContent", () => {
  let extractor: AssetReferenceExtractor;

  beforeEach(() => {
    extractor = new AssetReferenceExtractor();
  });

  it("returns [] when content has no fields", () => {
    expect(extractor.findMissingAssetsForContent({}, {})).toEqual([]);
  });

  it("returns [] when all referenced assets are present in sourceEntities", () => {
    const content = {
      fields: { hero: "https://cdn.aglty.io/guid/assets/img.jpg" },
    };
    const sourceEntities: SourceEntities = {
      assets: [{ url: "https://cdn.aglty.io/guid/assets/img.jpg", fileName: "img.jpg" }],
    };
    expect(extractor.findMissingAssetsForContent(content, sourceEntities)).toEqual([]);
  });

  it("reports a missing asset URL when the asset is not in sourceEntities", () => {
    const content = {
      fields: { hero: "https://cdn.aglty.io/guid/assets/gone.jpg" },
    };
    const missing = extractor.findMissingAssetsForContent(content, { assets: [] });
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("Asset:");
    expect(missing[0]).toContain("gone.jpg");
  });

  it("reports a missing gallery when the gallery is absent from sourceEntities", () => {
    const content = {
      fields: { hero: "https://cdn.aglty.io/guid/assets/photo.jpg" },
    };
    const sourceEntities: SourceEntities = {
      assets: [
        {
          url: "https://cdn.aglty.io/guid/assets/photo.jpg",
          fileName: "photo.jpg",
          mediaGroupingID: 42,
        },
      ],
      galleries: [],
    };
    const missing = extractor.findMissingAssetsForContent(content, sourceEntities);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("Gallery:42");
  });

  it("reports nothing for gallery when the gallery is present", () => {
    const content = {
      fields: { hero: "https://cdn.aglty.io/guid/assets/photo.jpg" },
    };
    const sourceEntities: SourceEntities = {
      assets: [
        {
          url: "https://cdn.aglty.io/guid/assets/photo.jpg",
          fileName: "photo.jpg",
          mediaGroupingID: 42,
        },
      ],
      galleries: [{ mediaGroupingID: 42, name: "Good Gallery" }],
    };
    expect(extractor.findMissingAssetsForContent(content, sourceEntities)).toEqual([]);
  });

  it("reports multiple missing assets", () => {
    const content = {
      fields: {
        hero: "https://cdn.aglty.io/guid/assets/a.jpg",
        thumb: "https://cdn.aglty.io/guid/assets/b.jpg",
      },
    };
    const missing = extractor.findMissingAssetsForContent(content, { assets: [] });
    expect(missing).toHaveLength(2);
  });

  it("matches assets by originUrl and edgeUrl as well", () => {
    const content = {
      fields: { hero: "https://cdn.aglty.io/guid/assets/photo.jpg" },
    };
    const sourceEntities: SourceEntities = {
      assets: [
        {
          originUrl: "https://cdn.aglty.io/guid/assets/photo.jpg",
          edgeUrl: "https://edge.aglty.io/guid/assets/photo.jpg",
          fileName: "photo.jpg",
        },
      ],
    };
    expect(extractor.findMissingAssetsForContent(content, sourceEntities)).toEqual([]);
  });
});
