import {
  AssetUrlTranslator,
  buildAssetUrlTranslator,
  canonicalFields,
  canonicalScalar,
  canonicalValue,
  CanonicalContext,
  diffCanonical,
  describeDifference,
} from "../canonicalize";

const SRC_EDGE = "https://cdn-usa2.aglty.io/src-container";
const SRC_CUSTOM = "https://cdn.custom.com/src-container";
const TGT_EDGE = "https://cdn-usa2.aglty.io/tgt-container";
const TGT_CUSTOM = "https://cdn.custom.com/tgt-container";
const TGT_ORIGIN = "https://origin.example.net/tgt-container";

function translator(): AssetUrlTranslator {
  return buildAssetUrlTranslator({
    mappingUrls: new Map([[`${SRC_CUSTOM}/img/exact.png`, `${TGT_CUSTOM}/img/renamed.png`]]),
    mappingPrefixes: [{ source: SRC_CUSTOM, target: TGT_CUSTOM }],
    assetIdMap: { target: (id: number) => (id === 1 ? 101 : undefined) },
    sourceAssets: [{ mediaID: 1, containerEdgeUrl: SRC_EDGE, edgeUrl: `${SRC_EDGE}/a.png` }],
    targetAssets: [
      { mediaID: 101, containerEdgeUrl: TGT_EDGE, containerOriginUrl: TGT_ORIGIN, edgeUrl: `${TGT_EDGE}/a.png` },
    ],
  });
}

function contexts(): { source: CanonicalContext; target: CanonicalContext } {
  const assets = translator();
  const contentMap = new Map([
    [1, 501],
    [2, 502],
    [3, 503],
  ]);
  return {
    source: {
      side: "source",
      contentRef: (id) => (contentMap.has(id) ? String(contentMap.get(id)) : `unmapped:${id}`),
      containerRef: (name) => (name.toLowerCase() === "posts" ? "poststarget" : `unmapped:${name.toLowerCase()}`),
      galleryRef: (id) => String(id + 1000),
      assets,
    },
    target: {
      side: "target",
      contentRef: (id) => String(id),
      containerRef: (name) => name.toLowerCase(),
      galleryRef: (id) => String(id),
      assets,
    },
  };
}

function same(sourceValue: any, targetValue: any, fieldType?: string): boolean {
  const { source, target } = contexts();
  return (
    JSON.stringify(canonicalValue(sourceValue, source, fieldType)) ===
    JSON.stringify(canonicalValue(targetValue, target, fieldType))
  );
}

describe("canonicalScalar", () => {
  it("treats null, undefined and empty string as empty", () => {
    expect(canonicalScalar(null)).toBeUndefined();
    expect(canonicalScalar(undefined)).toBeUndefined();
    expect(canonicalScalar("")).toBeUndefined();
  });

  it("normalizes CRLF to LF", () => {
    expect(canonicalScalar("a\r\nb")).toBe("a\nb");
  });

  it("equates numbers and numeric strings", () => {
    expect(canonicalScalar("13")).toBe(canonicalScalar(13));
    expect(canonicalScalar("37.80")).toBe(canonicalScalar(37.8));
    expect(canonicalScalar("-2")).toBe("-2");
  });

  it("keeps leading-zero strings (zip codes, codes) as text", () => {
    expect(canonicalScalar("007")).toBe("007");
  });

  it("equates booleans and their string forms", () => {
    expect(canonicalScalar(true)).toBe(canonicalScalar("True"));
    expect(canonicalScalar(false)).toBe("false");
  });
});

describe("canonicalValue", () => {
  it("compares object keys case-insensitively and drops empty values", () => {
    expect(same({ Href: "/x", Target: "", Text: "Go" }, { href: "/x", text: "Go", target: null })).toBe(true);
  });

  it("treats a missing value and an empty one as equal", () => {
    expect(same("", undefined)).toBe(true);
    expect(same(null, "")).toBe(true);
  });

  describe("linked content", () => {
    it("translates a {contentid} selection to the mapped target ID", () => {
      expect(same({ contentid: 1, fulllist: false }, { contentid: 501, fulllist: false })).toBe(true);
      expect(same({ contentid: 1, fulllist: false }, { contentid: 502, fulllist: false })).toBe(false);
    });

    it("equates the object form with the scalar form on a Content field", () => {
      expect(same({ contentid: 1, fulllist: false }, "501", "Content")).toBe(true);
      expect(same("1", { contentid: 501 }, "Content")).toBe(true);
    });

    it("keeps sortids order significant", () => {
      const source = { referencename: "posts", fulllist: true, sortids: "1,2,3" };
      expect(same(source, { referencename: "PostsTarget", fulllist: true, sortids: "501,502,503" })).toBe(true);
      expect(same(source, { referencename: "PostsTarget", fulllist: true, sortids: "502,501,503" })).toBe(false);
    });

    it("maps a full-list reference name through the container mapping", () => {
      expect(same({ referencename: "Posts", fulllist: true }, { referencename: "poststarget", fulllist: true })).toBe(
        true
      );
      expect(same({ referencename: "Other", fulllist: true }, { referencename: "other", fulllist: true })).toBe(false);
    });

    it("marks an unmapped source ID so it can never match", () => {
      const { source } = contexts();
      expect(canonicalValue({ contentid: 99 }, source)).toEqual({ "@ids": ["unmapped:99"] });
    });

    it("reads an empty selection as empty", () => {
      expect(same({ fulllist: false }, undefined)).toBe(true);
    });
  });

  describe("asset attachments", () => {
    it("compares url and label only", () => {
      expect(
        same(
          { url: `${SRC_EDGE}/a.png`, label: "A", filesize: 10, height: 5, width: 5 },
          { url: `${TGT_EDGE}/a.png`, label: "A", filesize: 11, pixelHeight: "5" }
        )
      ).toBe(true);
      expect(same({ url: `${SRC_EDGE}/a.png`, label: "A" }, { url: `${TGT_EDGE}/a.png`, label: "B" })).toBe(false);
    });

    it("uses the exact mapping first, then the container prefix", () => {
      expect(same({ url: `${SRC_CUSTOM}/img/exact.png` }, { url: `${TGT_CUSTOM}/img/renamed.png` })).toBe(true);
      expect(same({ url: `${SRC_CUSTOM}/img/other.png` }, { url: `${TGT_CUSTOM}/img/other.png` })).toBe(true);
    });

    it("treats every alias of the target container as the same host", () => {
      expect(same({ url: `${SRC_EDGE}/b.png` }, { url: `${TGT_ORIGIN}/b.png` })).toBe(true);
    });
  });

  describe("rich text", () => {
    it("rewrites mapped source asset URLs inside text", () => {
      expect(
        same(
          `<img src="${SRC_EDGE}/x/y.png"> and <a href="${SRC_CUSTOM}/img/exact.png">`,
          `<img src="${TGT_EDGE}/x/y.png"> and <a href="${TGT_CUSTOM}/img/renamed.png">`
        )
      ).toBe(true);
    });

    it("prefers the longest matching URL", () => {
      const t = translator();
      expect(t.rewriteSourceText(`${SRC_CUSTOM}/img/exact.png`)).toBe(
        t.canonicalTargetText(`${TGT_CUSTOM}/img/renamed.png`)
      );
    });

    it("does not match a container whose name merely starts with a known one", () => {
      const t = translator();
      expect(t.rewriteSourceText(`${SRC_EDGE}-old/a.png`)).toBe(`${SRC_EDGE}-old/a.png`);
    });

    it("finds source-instance asset URLs left in target text", () => {
      const t = translator();
      expect(t.findSourceUrls(`<img src="${SRC_EDGE}/left.png"><img src="${TGT_EDGE}/ok.png">`)).toEqual([
        `${SRC_EDGE}/left.png`,
      ]);
    });

    it("equates CRLF and LF in text", () => {
      expect(same("<p>a</p>\r\n<p>b</p>", "<p>a</p>\n<p>b</p>")).toBe(true);
    });
  });

  it("maps a PhotoGallery ID through the gallery mapping", () => {
    expect(same(3, "1003", "PhotoGallery")).toBe(true);
  });
});

describe("canonicalFields", () => {
  it("matches field keys case-insensitively", () => {
    const { source, target } = contexts();
    expect(canonicalFields({ Title: "a" }, null, source)).toEqual(canonicalFields({ title: "a" }, null, target));
  });

  it("treats a model's companion value field as a content ID list", () => {
    const { source, target } = contexts();
    const model = {
      fields: [{ name: "Game", type: "Content", settings: { LinkeContentDropdownValueField: "Game_ValueField" } }],
    };
    const s = canonicalFields({ game: { contentid: 1 }, game_valuefield: "1,2" }, model, source);
    const t = canonicalFields({ game: { contentid: 501 }, Game_ValueField: "501,502" }, model, target);
    expect(s).toEqual(t);
    expect(s.game_valuefield).toEqual({ "@ids": ["501", "502"] });
  });
});

describe("diffCanonical / describeDifference", () => {
  it("lists only the differing keys", () => {
    expect(diffCanonical({ a: "1", b: "x" }, { a: "1", b: "y", c: "z" })).toEqual([
      { field: "b", expected: "x", actual: "y" },
      { field: "c", expected: undefined, actual: "z" },
    ]);
  });

  it("cuts long strings to a window around the first difference", () => {
    const prefix = "a".repeat(500);
    const { expected, actual } = describeDifference(`${prefix}XYZ`, `${prefix}XQZ`);
    expect(expected.length).toBeLessThan(200);
    expect(expected).toContain("XYZ");
    expect(actual).toContain("XQZ");
  });
});
