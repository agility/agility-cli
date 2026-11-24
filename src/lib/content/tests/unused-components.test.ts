import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  findUnusedComponents,
  isComponentContainer,
  loadPlacedContentIDs,
  loadPlacedContentIDsCached,
  templatePlacement,
  pageZoneContentIDs,
  placedContentIDsFromPages,
  UNUSED_COMPONENT_WARNING_CODE,
  unusedComponentsReport,
} from "../unused-components";

// PROD-3399: Components removed from or replaced on their pages but never deleted.

const componentContainer = (referenceName: string, extra: any = {}) => ({
  referenceName,
  contentDefinitionTypeID: 2,
  isShared: false,
  isDynamicPageList: false,
  ...extra,
});
const listContainer = (referenceName: string) => ({ referenceName, contentDefinitionTypeID: 1, isShared: false });

const item = (contentID: number, referenceName: string, fields: any = {}, definitionName = "PromoCard") => ({
  contentID,
  properties: { referenceName, definitionName, state: 2 },
  fields,
});

const page = (pageID: number, ...contentIDs: number[]) => ({
  pageID,
  zones: { main: contentIDs.map((id) => ({ module: "M", item: { contentid: id, fulllist: false } })) },
});

const CONTAINERS = [
  componentContainer("landing_PromoCard"),
  componentContainer("landing_PromoCardA1B2C3D4"),
  listContainer("posts"),
];

describe("isComponentContainer", () => {
  it("is true only for a Component container that isn't a dynamic page list", () => {
    expect(isComponentContainer(componentContainer("a"))).toBe(true);
    expect(isComponentContainer(componentContainer("a", { isShared: true }))).toBe(true);
    expect(isComponentContainer(componentContainer("a", { isDynamicPageList: true }))).toBe(false);
    expect(isComponentContainer(componentContainer("a", { isDeleted: true }))).toBe(false);
    expect(isComponentContainer(listContainer("posts"))).toBe(false);
    expect(isComponentContainer({ referenceName: "x", contentDefinitionType: 2 })).toBe(true);
    expect(isComponentContainer(null)).toBe(false);
  });
});

describe("pageZoneContentIDs", () => {
  it("reads every zone, any key casing, and ignores empty modules", () => {
    expect(
      pageZoneContentIDs({
        zones: {
          a: [{ item: { contentid: 1 } }, { item: { contentID: "2" } }],
          b: [{ item: { ContentID: 3 } }, { item: { contentid: 0 } }, { item: null }, {}],
          c: null,
          d: [{ item: { contentId: 4 } }],
        },
      })
    ).toEqual([1, 2, 3, 4]);
    expect(pageZoneContentIDs({})).toEqual([]);
  });
});

describe("findUnusedComponents", () => {
  const placed = (pages: any[]) => placedContentIDsFromPages(pages);

  it("returns Components no page places, and keeps placed ones and non-Components", () => {
    const placedItem = item(500, "landing_PromoCard");
    const removed = item(501, "landing_PromoCard");
    const replaced = item(502, "landing_PromoCardA1B2C3D4");
    const post = item(300, "posts", {}, "Post");
    const unused = findUnusedComponents({
      content: [placedItem, removed, replaced, post],
      containers: CONTAINERS,
      placed: placed([page(21, 500)]),
    });
    expect(unused.map((i) => i.contentID)).toEqual([501, 502]);
  });

  it("skips nothing when no page was read", () => {
    const unused = findUnusedComponents({
      content: [item(501, "landing_PromoCard")],
      containers: CONTAINERS,
      placed: placed([]),
    });
    expect(unused).toEqual([]);
  });

  it("matches the container name case-insensitively", () => {
    const unused = findUnusedComponents({
      content: [item(501, "landing_promocard")],
      containers: CONTAINERS,
      placed: placed([page(1)]),
    });
    expect(unused).toHaveLength(1);
  });

  it("keeps a Component that live content links to by ID, and what it links to in turn", () => {
    const linkedByPost = item(501, "landing_PromoCard");
    const linkedByLinked = item(502, "landing_PromoCardA1B2C3D4");
    // 501 links to 502; the post links to 501
    (linkedByPost as any).fields = { next: { contentid: 502 } };
    const post = item(300, "posts", { banner: { contentid: 501, fulllist: false } }, "Post");
    const unused = findUnusedComponents({
      content: [linkedByPost, linkedByLinked, post],
      containers: CONTAINERS,
      placed: placed([page(1)]),
    });
    expect(unused).toEqual([]);
  });

  it("keeps a Component whose container live content links to as a whole list", () => {
    const component = item(501, "landing_PromoCard");
    const post = item(300, "posts", { banners: { referencename: "landing_PromoCard", fulllist: true } }, "Post");
    const unused = findUnusedComponents({
      content: [component, post],
      containers: CONTAINERS,
      placed: placed([page(1)]),
    });
    expect(unused).toEqual([]);
  });

  it("still skips Components that only other unused Components link to", () => {
    const a = item(501, "landing_PromoCard", { next: { contentid: 502 } });
    const b = item(502, "landing_PromoCardA1B2C3D4");
    const unused = findUnusedComponents({
      content: [a, b],
      containers: CONTAINERS,
      placed: placed([page(1)]),
    });
    expect(unused.map((i) => i.contentID).sort()).toEqual([501, 502]);
  });

  it("finds a link held only in a companion field, through the model", () => {
    const component = item(501, "landing_PromoCard");
    const post = item(300, "posts", { bannerID: "501" }, "Post");
    const model = {
      referenceName: "Post",
      fields: [{ name: "Banner", type: "Content", settings: { LinkeContentDropdownValueField: "BannerID" } }],
    };
    const unused = findUnusedComponents({
      content: [component, post],
      containers: CONTAINERS,
      models: [model],
      placed: placed([page(1)]),
    });
    expect(unused).toEqual([]);
  });
});

describe("findUnusedComponents with template placement and a scope", () => {
  const placed = (pages: any[], extra: Partial<{ ids: number[]; containerIDs: number[] }> = {}) => {
    const p = placedContentIDsFromPages(pages);
    (extra.ids || []).forEach((id) => p.ids.add(id));
    return { ...p, containerIDs: new Set(extra.containerIDs || []) };
  };

  it("keeps a Component a page template places, by item or by whole container", () => {
    const containers = [
      componentContainer("landing_PromoCard", { contentViewID: 40 }),
      componentContainer("landing_PromoCardA1B2C3D4", { contentViewID: 41 }),
    ];
    const unused = findUnusedComponents({
      content: [item(501, "landing_PromoCard"), item(502, "landing_PromoCard"), item(503, "landing_PromoCardA1B2C3D4")],
      containers,
      placed: placed([page(1)], { ids: [501], containerIDs: [41] }),
    });
    expect(unused.map((i) => i.contentID)).toEqual([502]);
  });

  it("reads links from the whole locale, and only skips in-scope items", () => {
    const component = item(501, "landing_PromoCard");
    const other = item(502, "landing_PromoCard");
    const outOfScopePost = item(300, "posts", { banner: { contentid: 501 } }, "Post");
    const unused = findUnusedComponents({
      content: [component],
      allContent: [component, other, outOfScopePost],
      containers: CONTAINERS,
      placed: placed([page(1)]),
    });
    expect(unused).toEqual([]);
    const unusedOther = findUnusedComponents({
      content: [other],
      allContent: [component, other, outOfScopePost],
      containers: CONTAINERS,
      placed: placed([page(1)]),
    });
    expect(unusedOther.map((i) => i.contentID)).toEqual([502]);
  });
});

describe("templatePlacement", () => {
  it("collects fixed items, shared/default module items and bound containers, skipping deleted templates", () => {
    const result = templatePlacement([
      {
        contentSectionDefinitions: [
          {
            publishContentItemID: 7,
            itemContainerID: null,
            sharedModules: [{ item: { contentID: 8 } }],
            defaultModules: null,
          },
          { publishContentItemID: null, itemContainerID: 41, sharedModules: [], defaultModules: [{ contentId: "9" }] },
        ],
      },
      { isDeleted: true, contentSectionDefinitions: [{ publishContentItemID: 99 }] },
    ]);
    expect(Array.from(result.ids).sort()).toEqual([7, 8, 9]);
    expect(Array.from(result.containerIDs)).toEqual([41]);
  });
});

describe("loadPlacedContentIDs", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agility-unused-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const writePage = (locale: string, p: any) => {
    const dir = path.join(root, "src-guid", locale, "page");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${p.pageID}.json`), JSON.stringify(p));
  };

  const writeJson = (rel: string, data: any) => {
    const file = path.join(root, "src-guid", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };

  it("unions every pulled locale and the templates, ignores the pages passed in, and skips unreadable files", () => {
    writePage("en-us", page(1, 10));
    writePage("fr-ca", page(1, 11));
    fs.writeFileSync(path.join(root, "src-guid", "en-us", "page", "bad.json"), "{");
    writeJson("templates/14.json", { contentSectionDefinitions: [{ publishContentItemID: 13, itemContainerID: 41 }] });
    const result = loadPlacedContentIDs(root, "src-guid", [page(2, 12)]);
    expect(Array.from(result.ids).sort()).toEqual([10, 11, 13]);
    expect(result.pageCount).toBe(2);
    expect(Array.from(result.containerIDs || [])).toEqual([41]);
  });

  it("treats placement as unknown when a sitemap lists a page with no page file (incomplete pull)", () => {
    writePage("en-us", page(1, 10));
    writeJson("en-us/sitemap/website.json", { "/home": { pageID: 1 }, "/about": { pageID: 2 } });
    expect(loadPlacedContentIDs(root, "src-guid").pageCount).toBe(0);
    writePage("en-us", page(2, 11));
    expect(loadPlacedContentIDs(root, "src-guid").pageCount).toBe(2);
  });

  it("caches per instance until the report is reset", () => {
    writePage("en-us", page(1, 10));
    expect(loadPlacedContentIDsCached(root, "src-guid").ids.has(11)).toBe(false);
    writePage("en-us", page(2, 11));
    expect(loadPlacedContentIDsCached(root, "src-guid").ids.has(11)).toBe(false);
    unusedComponentsReport.reset();
    expect(loadPlacedContentIDsCached(root, "src-guid").ids.has(11)).toBe(true);
  });

  it("falls back to the pages passed in when nothing was pulled", () => {
    const result = loadPlacedContentIDs(root, "missing-guid", [page(2, 12)]);
    expect(Array.from(result.ids)).toEqual([12]);
    expect(result.pageCount).toBe(1);
  });
});

describe("unusedComponentsReport", () => {
  beforeEach(() => unusedComponentsReport.reset());

  it("records each item once per locale and renders a non-blocking summary", () => {
    unusedComponentsReport.record({
      contentID: 501,
      name: "landing_PromoCard",
      model: "PromoCard",
      locale: "en-us",
    });
    unusedComponentsReport.record({
      contentID: 501,
      name: "landing_PromoCard",
      model: "PromoCard",
      locale: "en-us",
    });
    unusedComponentsReport.record({ contentID: 310, name: "home_FeaturedPost", locale: "en-us", targetID: 555 });

    expect(unusedComponentsReport.getEntries()).toHaveLength(2);
    expect(unusedComponentsReport.onTarget()).toHaveLength(1);
    const lines = unusedComponentsReport.renderSummaryLines();
    expect(lines[0]).toBe("Unused Components skipped: 2 (not on any page), non-blocking:");
    expect(lines.join("\n")).toContain("1 of them were created on the target by an earlier sync");
    expect(lines.join("\n")).toContain("• [en-us] home_FeaturedPost #310, on the target as 555");
    expect(lines.join("\n")).toContain("• [en-us] landing_PromoCard (PromoCard) #501");
  });

  it("caps the listed items and points at the log file", () => {
    for (let i = 1; i <= 25; i++) unusedComponentsReport.record({ contentID: i, name: `c${i}`, locale: "en-us" });
    const lines = unusedComponentsReport.renderSummaryLines();
    expect(lines[lines.length - 1]).toBe("  …and 5 more (see the log file)");
  });

  it("emits one --jsonSummary warning per item with its own code", () => {
    unusedComponentsReport.record({ contentID: 310, name: "home_FeaturedPost", locale: "en-us", targetID: 555 });
    expect(unusedComponentsReport.toWarningDetails("src-guid")).toEqual([
      expect.objectContaining({
        name: "home_FeaturedPost",
        type: "content",
        guid: "src-guid",
        contentID: 310,
        sourceID: 310,
        targetID: 555,
        code: UNUSED_COMPONENT_WARNING_CODE,
      }),
    ]);
  });
});
