import ansiColors from "ansi-colors";

import { listAvailablePagePaths, parsePageSelectors, renderPageScope, resolvePageScopeForLocale } from "../page-scope";
import { ChannelSitemaps } from "types/pageScope";
import { SitemapNode } from "types/syncAnalysis";

// Colors make the rendered-tree assertions unreadable; the content is what matters.
beforeAll(() => {
  ansiColors.enabled = false;
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function node(
  pageID: number,
  path: string,
  children: SitemapNode[] = [],
  extra: Partial<SitemapNode> = {}
): SitemapNode {
  const name = path.split("/").filter(Boolean).pop() || "root";
  return {
    title: name,
    name,
    pageID,
    menuText: name,
    visible: { menu: true, sitemap: true },
    path,
    redirect: null,
    isFolder: false,
    children,
    ...extra,
  };
}

/**
 *   /home                            (2)
 *   /products                        (3)
 *     /products/my-lottery           (10)
 *       /products/my-lottery/rules   (11)
 *       /products/my-lottery/winners (12)
 *     /products/other                (20)
 *   /about                           (4)
 */
function makeSitemaps(): ChannelSitemaps {
  return {
    website: [
      node(2, "/home"),
      node(3, "/products", [
        node(10, "/products/my-lottery", [
          node(11, "/products/my-lottery/rules"),
          node(12, "/products/my-lottery/winners"),
        ]),
        node(20, "/products/other"),
      ]),
      node(4, "/about"),
    ],
  };
}

function ids(set: Set<number>): number[] {
  return Array.from(set).sort((a, b) => a - b);
}

// ─── parsePageSelectors ───────────────────────────────────────────────────────

describe("parsePageSelectors", () => {
  it("returns an empty list for empty, null and undefined input", () => {
    expect(parsePageSelectors("")).toEqual([]);
    expect(parsePageSelectors(null)).toEqual([]);
    expect(parsePageSelectors(undefined)).toEqual([]);
  });

  it("splits on commas and trims each selector", () => {
    expect(parsePageSelectors(" /blog , /about ")).toEqual(["/blog", "/about"]);
  });

  it("drops empty segments from a trailing or doubled comma", () => {
    expect(parsePageSelectors("/blog,,/about,")).toEqual(["/blog", "/about"]);
  });

  it("drops case-insensitive duplicates, keeping the first spelling", () => {
    expect(parsePageSelectors("/Blog,/blog,/BLOG")).toEqual(["/Blog"]);
  });
});

// ─── selector matching ────────────────────────────────────────────────────────

describe("resolvePageScopeForLocale — selector matching", () => {
  it("matches a page by its path", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/products/my-lottery"], "en-us");
    expect(scope.matches).toHaveLength(1);
    expect(scope.matches[0].pageID).toBe(10);
  });

  it("matches a page by its name", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["my-lottery"], "en-us");
    expect(scope.matches.map((m) => m.pageID)).toEqual([10]);
  });

  it("matches a page by its numeric page ID", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["10"], "en-us");
    expect(scope.matches.map((m) => m.pageID)).toEqual([10]);
  });

  it("ignores case, a missing leading slash and a trailing slash", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["Products/My-Lottery/"], "en-us");
    expect(scope.matches.map((m) => m.pageID)).toEqual([10]);
  });

  it("records a selector that matches nothing instead of silently dropping it", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/nope"], "en-us");
    expect(scope.unmatched).toEqual(["/nope"]);
    expect(ids(scope.pageIDs)).toEqual([]);
  });

  it("keeps the matched selector on the match so the caller can report per-selector results", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["my-lottery"], "en-us");
    expect(scope.matches[0].selector).toBe("my-lottery");
  });

  it("carries the channel each match came from", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/products/my-lottery"], "en-us");
    expect(scope.matches[0].channel).toBe("website");
  });

  it("matches across every channel, not just the first", () => {
    const sitemaps: ChannelSitemaps = {
      website: [node(1, "/shared")],
      app: [node(50, "/shared")],
    };
    const scope = resolvePageScopeForLocale(sitemaps, ["/shared"], "en-us");
    expect(ids(scope.pageIDs)).toEqual([1, 50]);
  });
});

// ─── descendants ──────────────────────────────────────────────────────────────

describe("resolvePageScopeForLocale — descendants", () => {
  it("brings every descendant of a selected page into scope", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/products/my-lottery"], "en-us");
    expect(ids(scope.pageIDs)).toEqual([10, 11, 12]);
  });

  it("reports how many descendants came along with the selected page", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/products/my-lottery"], "en-us");
    expect(scope.matches[0].descendantCount).toBe(2);
  });

  it("leaves sibling branches out of scope", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/products/my-lottery"], "en-us");
    expect(scope.pageIDs.has(20)).toBe(false);
    expect(scope.pageIDs.has(4)).toBe(false);
  });

  it("collects descendants at any depth", () => {
    const sitemaps: ChannelSitemaps = {
      website: [node(1, "/a", [node(2, "/a/b", [node(3, "/a/b/c", [node(4, "/a/b/c/d")])])])],
    };
    const scope = resolvePageScopeForLocale(sitemaps, ["/a"], "en-us");
    expect(ids(scope.pageIDs)).toEqual([1, 2, 3, 4]);
  });

  it("unions the scope of multiple selectors", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/products/my-lottery", "/about"], "en-us");
    expect(ids(scope.pageIDs)).toEqual([4, 10, 11, 12]);
  });
});

// ─── ancestors ────────────────────────────────────────────────────────────────

describe("resolvePageScopeForLocale — ancestors", () => {
  it("marks out-of-scope ancestors as traverse-only rather than in scope", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/products/my-lottery"], "en-us");
    expect(ids(scope.traversePageIDs)).toEqual([3]);
    expect(scope.pageIDs.has(3)).toBe(false);
  });

  it("reports each out-of-scope ancestor with its path and page ID", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/products/my-lottery/rules"], "en-us");
    expect(scope.ancestors.map((a) => a.pageID).sort((a, b) => a - b)).toEqual([3, 10]);
    expect(scope.ancestors.find((a) => a.pageID === 10)?.path).toBe("/products/my-lottery");
  });

  it("does not treat an ancestor that is itself selected as traverse-only", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/products", "/products/my-lottery"], "en-us");
    expect(ids(scope.traversePageIDs)).toEqual([]);
    expect(scope.ancestors).toHaveLength(0);
    expect(scope.pageIDs.has(3)).toBe(true);
  });

  it("reports no ancestors for a root-level page", () => {
    const scope = resolvePageScopeForLocale(makeSitemaps(), ["/about"], "en-us");
    expect(scope.ancestors).toHaveLength(0);
    expect(ids(scope.traversePageIDs)).toEqual([]);
  });
});

// ─── dynamic pages ────────────────────────────────────────────────────────────

describe("resolvePageScopeForLocale — dynamic pages", () => {
  // A dynamic page listing repeats the SAME pageID once per content item.
  const dynamicSitemaps = (): ChannelSitemaps => ({
    website: [
      node(3, "/blog", [
        node(6, "/blog/post-one", [], { contentID: 101 }),
        node(6, "/blog/post-two", [], { contentID: 102 }),
        node(6, "/blog/post-three", [], { contentID: 103 }),
      ]),
    ],
  });

  it("counts a repeated dynamic pageID once in the page scope", () => {
    const scope = resolvePageScopeForLocale(dynamicSitemaps(), ["/blog"], "en-us");
    expect(ids(scope.pageIDs)).toEqual([3, 6]);
    expect(scope.matches[0].descendantCount).toBe(1);
  });

  it("reports a directly selected dynamic page as a single match", () => {
    const scope = resolvePageScopeForLocale(dynamicSitemaps(), ["6"], "en-us");
    expect(scope.matches).toHaveLength(1);
    expect(scope.matches[0].pageID).toBe(6);
  });

  it("still records the parent chain when the first listing of a dynamic page was deduplicated", () => {
    const scope = resolvePageScopeForLocale(dynamicSitemaps(), ["6"], "en-us");
    expect(ids(scope.traversePageIDs)).toEqual([3]);
  });
});

// ─── listAvailablePagePaths ───────────────────────────────────────────────────

describe("listAvailablePagePaths", () => {
  it("returns every page path, sorted", () => {
    expect(listAvailablePagePaths(makeSitemaps())).toEqual([
      "/about",
      "/home",
      "/products",
      "/products/my-lottery",
      "/products/my-lottery/rules",
      "/products/my-lottery/winners",
      "/products/other",
    ]);
  });

  it("falls back to the page name when a node has no path", () => {
    const sitemaps: ChannelSitemaps = { website: [node(1, "", [], { name: "nameless", path: "" })] };
    expect(listAvailablePagePaths(sitemaps)).toEqual(["nameless"]);
  });

  it("ignores a null or empty channel sitemap", () => {
    expect(listAvailablePagePaths({ website: null, app: [] })).toEqual([]);
  });
});

// ─── renderPageScope ──────────────────────────────────────────────────────────

describe("renderPageScope", () => {
  const render = (selectors: string[], sitemaps = makeSitemaps()) => {
    const scope = resolvePageScopeForLocale(sitemaps, selectors, "en-us");
    return renderPageScope([scope], { "en-us": sitemaps });
  };

  it("marks a selected page with an arrow and its descendants with a plus", () => {
    const out = render(["/products/my-lottery"]);
    expect(out).toContain("→ /products/my-lottery (pageID 10)");
    expect(out).toContain("+ /products/my-lottery/rules (pageID 11)");
  });

  it("shows an out-of-scope ancestor as context, flagged as not synced", () => {
    const out = render(["/products/my-lottery"]);
    expect(out).toContain("· /products (parent — left unchanged)");
  });

  it("omits pages that are neither in scope nor an ancestor of one", () => {
    const out = render(["/products/my-lottery"]);
    expect(out).not.toContain("/products/other");
    expect(out).not.toContain("/about");
  });

  it("names the locale and channel the pages belong to", () => {
    const out = render(["/products/my-lottery"]);
    expect(out).toContain("en-us");
    expect(out).toContain("website");
  });

  it("calls out selectors that matched nothing in this locale", () => {
    const out = render(["/products/my-lottery", "/gone"]);
    expect(out).toContain("Not found in en-us: /gone");
  });

  it("says plainly when a locale has no matching pages at all", () => {
    const out = render(["/gone"]);
    expect(out).toContain("no matching pages in this locale");
  });

  it("lists a repeated dynamic page once", () => {
    const sitemaps: ChannelSitemaps = {
      website: [node(3, "/blog", [node(6, "/blog/a", [], { contentID: 1 }), node(6, "/blog/b", [], { contentID: 2 })])],
    };
    const out = render(["/blog"], sitemaps);
    expect(out.match(/pageID 6/g) || []).toHaveLength(1);
  });
});
