import { failedAssets } from "../failed-assets";

const asset = {
  mediaID: 7,
  fileName: "banner-01.png",
  edgeUrl: "https://cdn.example.com/src/promotions/banner-01.png",
  originUrl: "https://origin.example.com/src/promotions/banner-01.png",
};

describe("failedAssets (PROD-3449)", () => {
  beforeEach(() => failedAssets.reset());

  it("finds nothing when no asset failed", () => {
    expect(failedAssets.findReferences({ img: { url: asset.edgeUrl } })).toEqual([]);
  });

  it("finds an attachment, a URL field and rich text using the asset, by edge or origin URL", () => {
    failedAssets.record(asset, "503");
    const refs = failedAssets.findReferences({
      bannerImage: { url: asset.edgeUrl, label: "x" },
      gallery: [{ url: "https://cdn.example.com/src/ok.png" }, { url: asset.originUrl }],
      link: asset.edgeUrl.toUpperCase(),
      body: `<p><img src="${asset.edgeUrl}?w=200"></p>`,
      title: "banner-01.png",
    });
    expect(refs.map((r) => r.path)).toEqual(["bannerImage.url", "gallery[1].url", "link", "body"]);
    expect(refs[0].asset).toEqual({ mediaID: 7, fileName: "banner-01.png", error: "503" });
  });

  it("forgets failures on reset", () => {
    failedAssets.record(asset, "503");
    failedAssets.reset();
    expect(failedAssets.find(asset.edgeUrl)).toBeUndefined();
    expect(failedAssets.size).toBe(0);
  });
});
