import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { AssetMapper } from "lib/mappers/asset-mapper";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-asset-mapper-"));
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

function makeMapper(): AssetMapper {
  // Use unique GUIDs per test to prevent mapping file contamination across tests
  testCounter++;
  return new AssetMapper(`src-${testCounter}`, `tgt-${testCounter}`);
}

function makeAsset(overrides: Record<string, any> = {}): any {
  return {
    mediaID: 1,
    dateModified: "2024-01-01T00:00:00Z",
    edgeUrl: "https://cdn.aglty.io/src/photo.jpg",
    containerEdgeUrl: "https://cdn.aglty.io/src",
    containerOriginUrl: "https://origin.aglty.io/src",
    ...overrides,
  };
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe("AssetMapper constructor", () => {
  it("constructs without throwing when no mapping file exists", () => {
    expect(() => makeMapper()).not.toThrow();
  });
});

// ─── getAssetMapping ──────────────────────────────────────────────────────────

describe("AssetMapper.getAssetMapping", () => {
  it("returns null when no mapping exists for source", () => {
    const mapper = makeMapper();
    expect(mapper.getAssetMapping(makeAsset({ mediaID: 99 }), "source")).toBeNull();
  });

  it("returns null when no mapping exists for target", () => {
    const mapper = makeMapper();
    expect(mapper.getAssetMapping(makeAsset({ mediaID: 99 }), "target")).toBeNull();
  });

  it("returns the mapping after addMapping", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 10 });
    const tgt = makeAsset({ mediaID: 20, edgeUrl: "https://cdn.aglty.io/tgt/photo.jpg" });
    mapper.addMapping(src, tgt);
    const found = mapper.getAssetMapping(tgt, "target");
    expect(found).not.toBeNull();
    expect(found!.targetMediaID).toBe(20);
  });

  it("finds the mapping by source mediaID", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 10 });
    const tgt = makeAsset({ mediaID: 20 });
    mapper.addMapping(src, tgt);
    const found = mapper.getAssetMapping(src, "source");
    expect(found).not.toBeNull();
    expect(found!.sourceMediaID).toBe(10);
  });
});

// ─── getAssetMappingByMediaID ─────────────────────────────────────────────────

describe("AssetMapper.getAssetMappingByMediaID", () => {
  it("returns null for unknown ID", () => {
    const mapper = makeMapper();
    expect(mapper.getAssetMappingByMediaID(999, "source")).toBeNull();
  });

  it("returns mapping by source mediaID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeAsset({ mediaID: 5 }), makeAsset({ mediaID: 6 }));
    expect(mapper.getAssetMappingByMediaID(5, "source")).not.toBeNull();
  });

  it("returns mapping by target mediaID", () => {
    const mapper = makeMapper();
    mapper.addMapping(makeAsset({ mediaID: 5 }), makeAsset({ mediaID: 6 }));
    expect(mapper.getAssetMappingByMediaID(6, "target")).not.toBeNull();
  });
});

// ─── getAssetMappingByMediaUrl ────────────────────────────────────────────────

describe("AssetMapper.getAssetMappingByMediaUrl", () => {
  it("returns null when no mappings exist", () => {
    const mapper = makeMapper();
    expect(mapper.getAssetMappingByMediaUrl("https://cdn.aglty.io/none.jpg", "source")).toBeNull();
  });

  it("returns a mapping by exact source URL", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 1, edgeUrl: "https://cdn.aglty.io/src/photo.jpg" });
    const tgt = makeAsset({ mediaID: 2, edgeUrl: "https://cdn.aglty.io/tgt/photo.jpg" });
    mapper.addMapping(src, tgt);
    const found = mapper.getAssetMappingByMediaUrl("https://cdn.aglty.io/src/photo.jpg", "source");
    expect(found).not.toBeNull();
    expect(found!.sourceMediaID).toBe(1);
  });

  it("returns a mapping by exact target URL", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 1, edgeUrl: "https://cdn.aglty.io/src/photo.jpg" });
    const tgt = makeAsset({ mediaID: 2, edgeUrl: "https://cdn.aglty.io/tgt/photo.jpg" });
    mapper.addMapping(src, tgt);
    const found = mapper.getAssetMappingByMediaUrl("https://cdn.aglty.io/tgt/photo.jpg", "target");
    expect(found).not.toBeNull();
    expect(found!.targetMediaID).toBe(2);
  });

  it("falls back to container prefix match when exact URL is not found", () => {
    const mapper = makeMapper();
    const src = makeAsset({
      mediaID: 1,
      edgeUrl: "https://cdn.aglty.io/src/img.jpg",
      containerEdgeUrl: "https://cdn.aglty.io/src",
    });
    const tgt = makeAsset({
      mediaID: 2,
      edgeUrl: "https://cdn.aglty.io/tgt/img.jpg",
      containerEdgeUrl: "https://cdn.aglty.io/tgt",
    });
    mapper.addMapping(src, tgt);
    const found = mapper.getAssetMappingByMediaUrl("https://cdn.aglty.io/src/subfolder/other.jpg", "source");
    expect(found).not.toBeNull();
  });
});

// ─── remapUrlByContainer ──────────────────────────────────────────────────────

describe("AssetMapper.remapUrlByContainer", () => {
  it("returns null when no mappings exist", () => {
    const mapper = makeMapper();
    expect(mapper.remapUrlByContainer("https://cdn.aglty.io/src/file.jpg", "source")).toBeNull();
  });

  it("remaps a URL by swapping the edge container prefix", () => {
    const mapper = makeMapper();
    const src = makeAsset({
      mediaID: 1,
      edgeUrl: "https://cdn.aglty.io/src/img.jpg",
      containerEdgeUrl: "https://cdn.aglty.io/src",
      containerOriginUrl: "https://origin.aglty.io/src",
    });
    const tgt = makeAsset({
      mediaID: 2,
      edgeUrl: "https://cdn.aglty.io/tgt/img.jpg",
      containerEdgeUrl: "https://cdn.aglty.io/tgt",
      containerOriginUrl: "https://origin.aglty.io/tgt",
    });
    mapper.addMapping(src, tgt);
    const result = mapper.remapUrlByContainer("https://cdn.aglty.io/src/sub/file.jpg", "source");
    expect(result).toBe("https://cdn.aglty.io/tgt/sub/file.jpg");
  });

  it("remaps a URL by swapping the origin container prefix when edge does not match", () => {
    const mapper = makeMapper();
    const src = makeAsset({
      mediaID: 1,
      edgeUrl: "https://cdn.aglty.io/src/img.jpg",
      containerEdgeUrl: null,
      containerOriginUrl: "https://origin.aglty.io/src",
    });
    const tgt = makeAsset({
      mediaID: 2,
      edgeUrl: "https://cdn.aglty.io/tgt/img.jpg",
      containerEdgeUrl: null,
      containerOriginUrl: "https://origin.aglty.io/tgt",
    });
    mapper.addMapping(src, tgt);
    const result = mapper.remapUrlByContainer("https://origin.aglty.io/src/photo.jpg", "source");
    expect(result).toBe("https://origin.aglty.io/tgt/photo.jpg");
  });

  it("returns null when URL does not match any container prefix", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 1, containerEdgeUrl: "https://cdn.aglty.io/src" });
    const tgt = makeAsset({ mediaID: 2, containerEdgeUrl: "https://cdn.aglty.io/tgt" });
    mapper.addMapping(src, tgt);
    const result = mapper.remapUrlByContainer("https://completely-different.io/file.jpg", "source");
    expect(result).toBeNull();
  });

  it("handles a customer using a custom CDN domain (cdn.ilotteryservices.com) end-to-end", () => {
    // custom configured domain cdn host
    const mapper = makeMapper();
    const src = makeAsset({
      mediaID: 1,
      edgeUrl: "https://cdn.ilotteryservices.com/8f5ad099/mobile/configuration/wizard.json",
      containerEdgeUrl: "https://cdn.ilotteryservices.com/8f5ad099",
      containerOriginUrl: "https://origin.ilotteryservices.com/8f5ad099",
    });
    const tgt = makeAsset({
      mediaID: 2,
      edgeUrl: "https://cdn.ilotteryservices.com/0e9b1234/mobile/configuration/wizard.json",
      containerEdgeUrl: "https://cdn.ilotteryservices.com/0e9b1234",
      containerOriginUrl: "https://origin.ilotteryservices.com/0e9b1234",
    });
    mapper.addMapping(src, tgt);

    // Edge URL swap
    expect(
      mapper.remapUrlByContainer("https://cdn.ilotteryservices.com/8f5ad099/draw-games/picks.json", "source")
    ).toBe("https://cdn.ilotteryservices.com/0e9b1234/draw-games/picks.json");

    // Origin URL swap
    expect(mapper.remapUrlByContainer("https://origin.ilotteryservices.com/8f5ad099/folder/asset.png", "source")).toBe(
      "https://origin.ilotteryservices.com/0e9b1234/folder/asset.png"
    );

    // Detection: source-side URL is recognized
    expect(mapper.isKnownAssetUrl("https://cdn.ilotteryservices.com/8f5ad099/anything/at/all.json")).toBe(true);
    expect(mapper.isKnownAssetUrl("https://cdn.ilotteryservices.com/0e9b1234/anything/at/all.json")).toBe(true);

    expect(mapper.isKnownAssetUrl("https://cdn.competitor.com/8f5ad099/file.jpg")).toBe(false);
    expect(mapper.isKnownAssetUrl("https://cdn.ilotteryservices.com/zzzzzzzz/file.jpg")).toBe(false);
  });
});

// ─── isKnownAssetUrl ──────────────────────────────────────────────────────────

describe("AssetMapper.isKnownAssetUrl", () => {
  it("returns false for empty or non-string input", () => {
    const mapper = makeMapper();
    expect(mapper.isKnownAssetUrl("")).toBe(false);
    expect(mapper.isKnownAssetUrl(null as any)).toBe(false);
    expect(mapper.isKnownAssetUrl(undefined as any)).toBe(false);
    expect(mapper.isKnownAssetUrl(123 as any)).toBe(false);
  });

  it("returns false when no mappings exist", () => {
    const mapper = makeMapper();
    expect(mapper.isKnownAssetUrl("https://cdn.aglty.io/anywhere/file.jpg")).toBe(false);
  });

  it("returns true when URL starts with a source container edge URL", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 1, containerEdgeUrl: "https://cdn-usa2.aglty.io/brightstar-qa" });
    const tgt = makeAsset({ mediaID: 2, containerEdgeUrl: "https://cdn-usa2.aglty.io/brightstar-prod" });
    mapper.addMapping(src, tgt);
    expect(mapper.isKnownAssetUrl("https://cdn-usa2.aglty.io/brightstar-qa/mobile/file.json")).toBe(true);
  });

  it("returns true when URL starts with a source container origin URL", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 1, containerOriginUrl: "https://mediadev.agilitycms.com/aaaaaaaa" });
    const tgt = makeAsset({ mediaID: 2, containerOriginUrl: "https://mediadev.agilitycms.com/bbbbbbbb" });
    mapper.addMapping(src, tgt);
    expect(mapper.isKnownAssetUrl("https://mediadev.agilitycms.com/aaaaaaaa/folder/asset.png")).toBe(true);
  });

  it("returns true when URL starts with a target container URL", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 1, containerEdgeUrl: "https://cdn.aglty.io/src" });
    const tgt = makeAsset({ mediaID: 2, containerEdgeUrl: "https://cdn.aglty.io/tgt" });
    mapper.addMapping(src, tgt);
    expect(mapper.isKnownAssetUrl("https://cdn.aglty.io/tgt/some/path.jpg")).toBe(true);
  });

  it("recognizes URLs on a custom CDN host (PROD-1505 scenario)", () => {
    // Customer using a custom CDN domain — the container URL the CMS returns
    // points to their host, not aglty.io. isKnownAssetUrl should still match.
    const mapper = makeMapper();
    const src = makeAsset({
      mediaID: 1,
      containerEdgeUrl: "https://cdn.ilotteryservices.com/8f5ad099",
      containerOriginUrl: "https://origin.ilotteryservices.com/8f5ad099",
    });
    const tgt = makeAsset({
      mediaID: 2,
      containerEdgeUrl: "https://cdn.ilotteryservices.com/0e9b1234",
      containerOriginUrl: "https://origin.ilotteryservices.com/0e9b1234",
    });
    mapper.addMapping(src, tgt);
    expect(mapper.isKnownAssetUrl("https://cdn.ilotteryservices.com/8f5ad099/mobile/config.json")).toBe(true);
    expect(mapper.isKnownAssetUrl("https://origin.ilotteryservices.com/8f5ad099/folder/file.png")).toBe(true);
  });

  it("returns false for a URL that does not match any container URL", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 1, containerEdgeUrl: "https://cdn.aglty.io/src" });
    const tgt = makeAsset({ mediaID: 2, containerEdgeUrl: "https://cdn.aglty.io/tgt" });
    mapper.addMapping(src, tgt);
    expect(mapper.isKnownAssetUrl("https://unrelated.example.com/file.jpg")).toBe(false);
  });

  it("returns false when a mapping has no container URLs and no asset URLs", () => {
    const mapper = makeMapper();
    const src = makeAsset({
      mediaID: 1,
      edgeUrl: undefined as any,
      containerEdgeUrl: undefined as any,
      containerOriginUrl: undefined as any,
    });
    const tgt = makeAsset({
      mediaID: 2,
      edgeUrl: undefined as any,
      containerEdgeUrl: undefined as any,
      containerOriginUrl: undefined as any,
    });
    mapper.addMapping(src, tgt);
    expect(mapper.isKnownAssetUrl("https://cdn.aglty.io/anything.jpg")).toBe(false);
  });

  // Legacy fallback: mapping files written before container URLs were tracked
  // only stored the full per-asset sourceUrl/targetUrl. Detection must still
  // work off the URL origin so custom-CDN assets are recognized without a re-map.
  describe("legacy mapping files (no container URLs)", () => {
    it("recognizes a custom-CDN URL via the source asset URL origin", () => {
      const mapper = makeMapper();
      // Simulate a legacy entry: container URLs absent, only edge/origin asset URLs.
      const src = makeAsset({
        mediaID: 1,
        edgeUrl: "https://cdn.ilotteryservices.com/brightstar-tns-cat/acl/en-us1.json",
        containerEdgeUrl: undefined as any,
        containerOriginUrl: undefined as any,
      });
      const tgt = makeAsset({
        mediaID: 2,
        edgeUrl: "https://cdn-usa2.aglty.io/de5185c3/acl/en-us1.json",
        containerEdgeUrl: undefined as any,
        containerOriginUrl: undefined as any,
      });
      mapper.addMapping(src, tgt);

      // A different file on the same custom CDN host is recognized.
      expect(
        mapper.isKnownAssetUrl(
          "https://cdn.ilotteryservices.com/brightstar-tns-cat/mobile/configuration/draw-games/quickPickConfig.json"
        )
      ).toBe(true);
    });

    it("recognizes a URL via the target asset URL origin", () => {
      const mapper = makeMapper();
      const src = makeAsset({
        mediaID: 1,
        edgeUrl: "https://cdn.ilotteryservices.com/brightstar-tns-cat/acl/en-us1.json",
        containerEdgeUrl: undefined as any,
        containerOriginUrl: undefined as any,
      });
      const tgt = makeAsset({
        mediaID: 2,
        edgeUrl: "https://cdn-usa2.aglty.io/de5185c3/acl/en-us1.json",
        containerEdgeUrl: undefined as any,
        containerOriginUrl: undefined as any,
      });
      mapper.addMapping(src, tgt);

      expect(mapper.isKnownAssetUrl("https://cdn-usa2.aglty.io/de5185c3/mobile/other.json")).toBe(true);
    });

    it("does not match a URL on an unrelated host", () => {
      const mapper = makeMapper();
      const src = makeAsset({
        mediaID: 1,
        edgeUrl: "https://cdn.ilotteryservices.com/brightstar-tns-cat/acl/en-us1.json",
        containerEdgeUrl: undefined as any,
        containerOriginUrl: undefined as any,
      });
      const tgt = makeAsset({
        mediaID: 2,
        edgeUrl: "https://cdn-usa2.aglty.io/de5185c3/acl/en-us1.json",
        containerEdgeUrl: undefined as any,
        containerOriginUrl: undefined as any,
      });
      mapper.addMapping(src, tgt);

      expect(mapper.isKnownAssetUrl("https://cdn.competitor.com/brightstar-tns-cat/file.json")).toBe(false);
    });
  });
});

// ─── addMapping / updateMapping ───────────────────────────────────────────────

describe("AssetMapper.addMapping", () => {
  it("adds a new mapping when target does not exist", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 10 });
    const tgt = makeAsset({ mediaID: 20 });
    mapper.addMapping(src, tgt);
    expect(mapper.getAssetMappingByMediaID(20, "target")).not.toBeNull();
  });

  it("updates the mapping when target mediaID already exists", () => {
    const mapper = makeMapper();
    const src1 = makeAsset({ mediaID: 10, dateModified: "2024-01-01T00:00:00Z" });
    const tgt = makeAsset({ mediaID: 20 });
    mapper.addMapping(src1, tgt);

    const src2 = makeAsset({ mediaID: 11, dateModified: "2024-02-01T00:00:00Z" });
    mapper.addMapping(src2, tgt);

    const found = mapper.getAssetMappingByMediaID(20, "target");
    expect(found!.sourceMediaID).toBe(11);
  });
});

// ─── hasSourceChanged ─────────────────────────────────────────────────────────

describe("AssetMapper.hasSourceChanged", () => {
  it("returns false when sourceAsset is null", () => {
    const mapper = makeMapper();
    expect(mapper.hasSourceChanged(null)).toBe(false);
  });

  it("returns false when no mapping exists for the source asset", () => {
    const mapper = makeMapper();
    expect(mapper.hasSourceChanged(makeAsset({ mediaID: 999 }))).toBe(false);
  });

  it("returns false when source date has not changed", () => {
    const mapper = makeMapper();
    const date = "2024-01-01T00:00:00Z";
    const src = makeAsset({ mediaID: 1, dateModified: date });
    mapper.addMapping(src, makeAsset({ mediaID: 2 }));
    expect(mapper.hasSourceChanged(makeAsset({ mediaID: 1, dateModified: date }))).toBe(false);
  });

  it("returns true when source date is newer than mapped date", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 1, dateModified: "2024-01-01T00:00:00Z" });
    mapper.addMapping(src, makeAsset({ mediaID: 2 }));
    expect(mapper.hasSourceChanged(makeAsset({ mediaID: 1, dateModified: "2025-01-01T00:00:00Z" }))).toBe(true);
  });
});

// ─── hasTargetChanged ─────────────────────────────────────────────────────────

describe("AssetMapper.hasTargetChanged", () => {
  it("returns false when targetAsset is undefined", () => {
    const mapper = makeMapper();
    expect(mapper.hasTargetChanged(undefined)).toBe(false);
  });

  it("returns false when no mapping exists for the target asset", () => {
    const mapper = makeMapper();
    expect(mapper.hasTargetChanged(makeAsset({ mediaID: 999 }))).toBe(false);
  });

  it("returns false when target date has not changed", () => {
    const mapper = makeMapper();
    const date = "2024-01-01T00:00:00Z";
    const src = makeAsset({ mediaID: 1, dateModified: date });
    const tgt = makeAsset({ mediaID: 2, dateModified: date });
    mapper.addMapping(src, tgt);
    expect(mapper.hasTargetChanged(makeAsset({ mediaID: 2, dateModified: date }))).toBe(false);
  });

  it("returns true when target date is newer than mapped date", () => {
    const mapper = makeMapper();
    const src = makeAsset({ mediaID: 1 });
    const tgt = makeAsset({ mediaID: 2, dateModified: "2024-01-01T00:00:00Z" });
    mapper.addMapping(src, tgt);
    expect(mapper.hasTargetChanged(makeAsset({ mediaID: 2, dateModified: "2025-06-01T00:00:00Z" }))).toBe(true);
  });
});
