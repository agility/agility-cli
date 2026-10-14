import {
  buildCdnOwnership,
  collectForeignCdnReferences,
  extractAgilityCdnUrls,
  ForeignCdnDetector,
  isGenericAgilityCdnHost,
  parseContainerUrl,
} from "lib/content/foreign-cdn-detector";

// A clone pair: source container on the aglty.io edge and a custom domain, target likewise.
const SOURCE = "clone-qa-20261002";
const TARGET = "clone-cat-20261002";
const mapping = {
  sourceUrl: `https://cdn.example.com/${SOURCE}/a/b.png`,
  targetUrl: `https://cdn.example.com/${TARGET}/a/b.png`,
  sourceContainerEdgeUrl: `https://cdn.example.com/${SOURCE}`,
  targetContainerEdgeUrl: `https://cdn.example.com/${TARGET}`,
  sourceContainerOriginUrl: `https://agility-cdn-usa2.azurewebsites.net/${SOURCE}`,
  targetContainerOriginUrl: `https://agility-cdn-usa2.azurewebsites.net/${TARGET}`,
};

function detector(): ForeignCdnDetector {
  return new ForeignCdnDetector(buildCdnOwnership({ assetMappings: [mapping] }));
}

describe("isGenericAgilityCdnHost", () => {
  it("matches the Agility CDN edge, origin and legacy hosts", () => {
    expect(isGenericAgilityCdnHost("cdn.aglty.io")).toBe(true);
    expect(isGenericAgilityCdnHost("cdn-usa2.aglty.io")).toBe(true);
    expect(isGenericAgilityCdnHost("agility-cdn-usa2.azurewebsites.net")).toBe(true);
    expect(isGenericAgilityCdnHost("cdn.agilitycms.com")).toBe(true);
  });

  it("does not match non-CDN Agility hosts or unrelated hosts", () => {
    expect(isGenericAgilityCdnHost("api.aglty.io")).toBe(false);
    expect(isGenericAgilityCdnHost("manager.agilitycms.com")).toBe(false);
    expect(isGenericAgilityCdnHost("myapp.azurewebsites.net")).toBe(false);
    expect(isGenericAgilityCdnHost("www.example.org")).toBe(false);
  });
});

describe("parseContainerUrl", () => {
  it("returns the host and lower-cased first path segment", () => {
    expect(parseContainerUrl("https://cdn-usa2.aglty.io/Upstream-QA/x.png")).toEqual({
      host: "cdn-usa2.aglty.io",
      container: "upstream-qa",
    });
  });

  it("returns null for missing or unparseable input", () => {
    expect(parseContainerUrl(undefined)).toBeNull();
    expect(parseContainerUrl("not a url")).toBeNull();
    expect(parseContainerUrl("https://cdn.aglty.io/")).toBeNull();
  });
});

describe("buildCdnOwnership", () => {
  it("learns each side's containers and custom edge hosts from asset mappings", () => {
    const own = buildCdnOwnership({ assetMappings: [mapping] });
    expect(own.sourceContainers).toEqual([SOURCE]);
    expect(own.targetContainers).toEqual([TARGET]);
    expect(own.customHosts).toEqual(["cdn.example.com"]);
  });

  it("learns containers from pulled assets when there are no mappings", () => {
    const own = buildCdnOwnership({
      sourceAssets: [
        { containerEdgeUrl: "https://cdn-usa2.aglty.io/src-c", edgeUrl: "https://cdn-usa2.aglty.io/src-c/x.png" },
      ],
      targetAssets: [{ originUrl: "https://agility-cdn-usa2.azurewebsites.net/tgt-c/y.png" }],
    });
    expect(own.sourceContainers).toEqual(["src-c"]);
    expect(own.targetContainers).toEqual(["tgt-c"]);
    expect(own.customHosts).toEqual([]);
  });

  it("falls back to per-asset URLs for legacy mapping records", () => {
    const own = buildCdnOwnership({
      assetMappings: [
        { sourceUrl: "https://cdn.aglty.io/old-src/a.png", targetUrl: "https://cdn.aglty.io/old-tgt/a.png" },
      ],
    });
    expect(own.sourceContainers).toEqual(["old-src"]);
    expect(own.targetContainers).toEqual(["old-tgt"]);
  });
});

describe("extractAgilityCdnUrls", () => {
  it("finds an aglty.io URL and its container", () => {
    expect(extractAgilityCdnUrls("https://cdn-usa2.aglty.io/upstream-qa/hero-background-image.png")).toEqual([
      {
        url: "https://cdn-usa2.aglty.io/upstream-qa/hero-background-image.png",
        host: "cdn-usa2.aglty.io",
        container: "upstream-qa",
      },
    ]);
  });

  it("finds an azurewebsites origin URL", () => {
    const [m] = extractAgilityCdnUrls('<img src="https://agility-cdn-usa2.azurewebsites.net/other/img/a.jpg">');
    expect(m.container).toBe("other");
  });

  it("ignores custom-domain URLs unless the host is known, and then requires a file name", () => {
    const html =
      '<a href="https://cdn.example.com/foo/x.svg">x</a> <a href="https://cdn.example.com/apps/list">';
    expect(extractAgilityCdnUrls(html)).toEqual([]);
    expect(extractAgilityCdnUrls(html, ["cdn.example.com"]).map((m) => m.url)).toEqual([
      "https://cdn.example.com/foo/x.svg",
    ]);
  });

  it("unescapes JSON-escaped slashes", () => {
    const json = '{"img":"https:\\/\\/cdn.aglty.io\\/other\\/a.png"}';
    expect(extractAgilityCdnUrls(json).map((m) => m.url)).toEqual(["https://cdn.aglty.io/other/a.png"]);
  });

  it("strips query strings (including &amp; variants) and fragments", () => {
    const html =
      '<img src="https://cdn.aglty.io/other/a.png?w=100&amp;h=50"><img src="https://cdn.aglty.io/other/b.png#top">';
    expect(extractAgilityCdnUrls(html).map((m) => m.url)).toEqual([
      "https://cdn.aglty.io/other/a.png",
      "https://cdn.aglty.io/other/b.png",
    ]);
  });

  it("finds percent-encoded URLs nested in a query string", () => {
    const text = "https://images.example.com/resize?src=https%3A%2F%2Fcdn.aglty.io%2Fother%2Fa.png&w=10";
    expect(extractAgilityCdnUrls(text).map((m) => m.container)).toEqual(["other"]);
  });

  it("finds protocol-relative URLs and drops trailing punctuation", () => {
    expect(extractAgilityCdnUrls("see //cdn.aglty.io/other/a.png.").map((m) => m.url)).toEqual([
      "//cdn.aglty.io/other/a.png",
    ]);
  });

  it("ignores bare container URLs and non-CDN Agility hosts", () => {
    expect(extractAgilityCdnUrls("https://cdn.aglty.io/other")).toEqual([]);
    expect(extractAgilityCdnUrls("https://api.aglty.io/abc-u/fetch/en-us/item/1")).toEqual([]);
    expect(extractAgilityCdnUrls("https://manager.agilitycms.com/instance/abc/x")).toEqual([]);
  });

  it("returns every occurrence, duplicates included", () => {
    expect(extractAgilityCdnUrls("https://cdn.aglty.io/o/a.png https://cdn.aglty.io/o/a.png")).toHaveLength(2);
  });
});

describe("ForeignCdnDetector", () => {
  it("does not flag the source's or target's own containers on any host", () => {
    const d = detector();
    const text = [
      `https://cdn-usa2.aglty.io/${SOURCE}/x.png`,
      `https://cdn.example.com/${SOURCE}/x.png`,
      `https://agility-cdn-usa2.azurewebsites.net/${SOURCE}/x.png`,
      `https://cdn-usa2.aglty.io/${TARGET}/x.png`,
      `https://cdn.example.com/${TARGET.toUpperCase()}/x.png`,
    ].join(" ");
    expect(d.findForeignUrls(text)).toEqual([]);
  });

  it("flags a third instance's container on aglty.io and on the shared custom domain", () => {
    const d = detector();
    const text =
      "https://cdn-usa2.aglty.io/upstream-qa/a.png https://cdn.example.com/site-qa/upload/b.svg";
    expect(d.findForeignUrls(text).map((m) => m.container)).toEqual(["upstream-qa", "site-qa"]);
  });

  it("reports nothing when either side's container is unknown", () => {
    const sourceOnly = new ForeignCdnDetector({ sourceContainers: [SOURCE], targetContainers: [], customHosts: [] });
    const targetOnly = new ForeignCdnDetector({ sourceContainers: [], targetContainers: [TARGET], customHosts: [] });
    expect(sourceOnly.isEnabled()).toBe(false);
    expect(targetOnly.isEnabled()).toBe(false);
    expect(sourceOnly.findForeignUrls("https://cdn.aglty.io/other/a.png")).toEqual([]);
    expect(targetOnly.findForeignUrls("https://cdn.aglty.io/other/a.png")).toEqual([]);
  });
});

describe("collectForeignCdnReferences", () => {
  const foreign = "https://cdn-usa2.aglty.io/upstream-qa/hero-background-image.png";

  it("classifies ImageAttachment, AttachmentList, plain URL and rich text fields", () => {
    const fields = {
      mobileBackgroundImage: { label: "Hero Image", url: foreign, target: null },
      gallery: [{ url: `https://cdn.aglty.io/upstream-qa/g1.png` }, { url: `https://cdn.aglty.io/${SOURCE}/g2.png` }],
      imagesrc: "https://cdn.aglty.io/othersite/footer/find-a-store.png",
      body: `<p><img src="${foreign}"><img src="https://cdn-usa2.aglty.io/${SOURCE}/own.png"></p>`,
      title: "No URLs here",
    };
    const refs = collectForeignCdnReferences(fields, detector());
    expect(refs.map(({ field, kind, container }) => ({ field, kind, container }))).toEqual([
      { field: "mobileBackgroundImage", kind: "attachment", container: "upstream-qa" },
      { field: "gallery[0]", kind: "attachment", container: "upstream-qa" },
      { field: "imagesrc", kind: "text", container: "othersite" },
      { field: "body", kind: "text", container: "upstream-qa" },
    ]);
  });

  it("reports a URL repeated within one field once", () => {
    const refs = collectForeignCdnReferences({ body: `<img src="${foreign}"><img src="${foreign}">` }, detector());
    expect(refs).toHaveLength(1);
  });

  it("never mutates the fields it scans", () => {
    const fields = { a: { url: foreign }, b: [{ url: foreign }], c: `<img src="${foreign}">` };
    const before = JSON.stringify(fields);
    collectForeignCdnReferences(Object.freeze(fields), detector());
    expect(JSON.stringify(fields)).toBe(before);
  });

  it("returns nothing when the detector is disabled", () => {
    const off = new ForeignCdnDetector({ sourceContainers: [], targetContainers: [], customHosts: [] });
    expect(collectForeignCdnReferences({ a: { url: foreign } }, off)).toEqual([]);
  });
});
