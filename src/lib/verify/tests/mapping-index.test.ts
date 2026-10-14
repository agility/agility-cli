import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BiMap, buildMappingIndex, createFileMappingReader } from "../mapping-index";
import { resetState, setState } from "../../../core/state";

describe("BiMap", () => {
  it("looks up both directions", () => {
    const map = new BiMap<number>();
    map.add(1, 101);
    map.add(2, 102);
    expect(map.target(1)).toBe(101);
    expect(map.sources(102)).toEqual([2]);
    expect(map.target(3)).toBeUndefined();
    expect(map.sources(999)).toEqual([]);
  });

  it("keeps the first target for a duplicated source, like the mappers' Array.find", () => {
    const map = new BiMap<number>();
    map.add(1, 101);
    map.add(1, 201);
    expect(map.target(1)).toBe(101);
    expect(map.hasTarget(201)).toBe(false);
  });

  it("reports targets that more than one source maps onto", () => {
    const map = new BiMap<number>();
    map.add(1, 101);
    map.add(2, 101);
    map.add(3, 103);
    expect(map.duplicateTargets()).toEqual([{ target: 101, sources: [1, 2] }]);
  });

  it("ignores unusable keys (missing, zero, negative)", () => {
    const map = new BiMap<number>();
    map.add(undefined, 1);
    map.add(1, null);
    map.add(2, -1);
    map.add(0, 5);
    expect(map.size).toBe(0);
  });
});

describe("buildMappingIndex", () => {
  const records: Record<string, any[]> = {
    models: [{ sourceID: 1, targetID: 11, sourceReferenceName: "Post", targetReferenceName: "Post" }],
    containers: [
      { sourceContentViewID: 5, targetContentViewID: 55, sourceReferenceName: "Posts", targetReferenceName: "PostsT" },
    ],
    templates: [
      {
        sourcePageTemplateID: 2,
        targetPageTemplateID: 22,
        sourcePageTemplateName: "Std",
        targetPageTemplateName: "Std",
      },
    ],
    sections: [{ sourcePageItemTemplateID: 7, targetPageItemTemplateID: 77 }],
    galleries: [{ sourceMediaGroupingID: 3, targetMediaGroupingID: 33 }],
    assets: [
      {
        sourceMediaID: 4,
        targetMediaID: 44,
        sourceUrl: "https://cdn/src/a.png",
        targetUrl: "https://cdn/tgt/a.png",
        sourceContainerEdgeUrl: "https://cdn/src",
        targetContainerEdgeUrl: "https://cdn/tgt",
        sourceContainerOriginUrl: "https://origin/src/",
        targetContainerOriginUrl: "https://origin/tgt/",
      },
      {
        sourceMediaID: 6,
        targetMediaID: 66,
        sourceContainerEdgeUrl: "https://cdn/src",
        targetContainerEdgeUrl: "https://cdn/tgt",
      },
    ],
  };
  const locales: Record<string, Record<string, any[]>> = {
    "en-us": {
      item: [{ sourceContentID: 100, targetContentID: 900 }],
      page: [{ sourcePageID: 8, targetPageID: 88 }],
    },
    "fr-ca": { item: [{ sourceContentID: 100, targetContentID: 901 }] },
  };

  const index = buildMappingIndex(
    (type, locale) => (locale ? (locales[locale]?.[type] ?? []) : (records[type] ?? [])),
    ["en-us", "fr-ca"]
  );

  it("indexes every guid-level mapping type", () => {
    expect(index.models.target(1)).toBe(11);
    expect(index.modelNames.target("post")).toBe("post");
    expect(index.containers.target(5)).toBe(55);
    expect(index.containerNames.target("posts")).toBe("postst");
    expect(index.templates.target(2)).toBe(22);
    expect(index.templateNames.target("std")).toBe("std");
    expect(index.sections.target(7)).toBe(77);
    expect(index.galleries.target(3)).toBe(33);
    expect(index.assets.target(4)).toBe(44);
  });

  it("collects exact asset URLs and de-duplicated container prefixes without trailing slashes", () => {
    expect(index.assetUrls.get("https://cdn/src/a.png")).toBe("https://cdn/tgt/a.png");
    expect(index.assetPrefixes).toEqual([
      { source: "https://cdn/src", target: "https://cdn/tgt" },
      { source: "https://origin/src", target: "https://origin/tgt" },
    ]);
  });

  it("keeps content and page mappings per locale", () => {
    expect(index.byLocale.get("en-us")?.content.target(100)).toBe(900);
    expect(index.byLocale.get("fr-ca")?.content.target(100)).toBe(901);
    expect(index.byLocale.get("en-us")?.pages.sources(88)).toEqual([8]);
    expect(index.byLocale.get("fr-ca")?.pages.size).toBe(0);
  });
});

describe("createFileMappingReader", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-mappings-"));
    resetState();
    setState({ rootPath: root });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("reads existing mapping files and never seeds a missing one", () => {
    const pair = path.join(root, "mappings", "a-b");
    fs.mkdirSync(path.join(pair, "models"), { recursive: true });
    fs.writeFileSync(path.join(pair, "models", "mappings.json"), JSON.stringify([{ sourceID: 1, targetID: 2 }]));
    // A type folder without its mappings.json: fileOperations.getMappingFile would write "[]" here.
    fs.mkdirSync(path.join(pair, "containers"), { recursive: true });

    const read = createFileMappingReader(root, "a", "b");

    expect(read("models")).toEqual([{ sourceID: 1, targetID: 2 }]);
    expect(read("containers")).toEqual([]);
    expect(fs.existsSync(path.join(pair, "containers", "mappings.json"))).toBe(false);
    expect(read("item", "en-us")).toEqual([]);
  });

  it("throws on a malformed mapping file", () => {
    const dir = path.join(root, "mappings", "a-b", "models");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mappings.json"), "{ not json");
    expect(() => createFileMappingReader(root, "a", "b")("models")).toThrow();
  });
});
