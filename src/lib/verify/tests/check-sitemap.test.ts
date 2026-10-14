import { checkSitemap, flattenSitemap } from "../check-sitemap";
import { FindingCollector } from "../verify-report";
import { context, LOCALE, page, pageMappings } from "./fixtures";

function node(pageID: number, path: string, children?: any[], extra: Record<string, any> = {}): any {
  return {
    title: path,
    name: path.split("/").pop(),
    pageID,
    menuText: path,
    visible: { menu: true, sitemap: true },
    path,
    redirect: null,
    isFolder: false,
    ...(children ? { children } : {}),
    ...extra,
  };
}

// Source: /home, /about (→ /about/team, /about/jobs), /contact. Target IDs are source + 100.
const SOURCE_TREE = [
  node(1, "/home"),
  node(2, "/about", [node(3, "/about/team"), node(4, "/about/jobs")]),
  node(5, "/contact"),
];
const MAP = pageMappings([
  [1, 101],
  [2, 102],
  [3, 103],
  [4, 104],
  [5, 105],
]);

function run(
  targetTree: any[] | null,
  opts: { channels?: Record<string, any[]>; targetChannels?: Record<string, any[]>; only?: string[] } = {}
) {
  const ids = [1, 2, 3, 4, 5];
  const ctx = context({
    source: { pages: ids.map((id) => page(id, {})), sitemaps: opts.channels ?? { website: SOURCE_TREE } },
    target: {
      pages: ids.map((id) => page(id + 100, {})),
      sitemaps: opts.targetChannels ?? { website: targetTree as any[] },
    },
    mappings: { locales: { [LOCALE]: { page: MAP } } },
    channels: opts.only,
  });
  const collector = new FindingCollector();
  checkSitemap(ctx, collector);
  return collector;
}

const translate = (nodes: any[]): any[] =>
  nodes.map((n) => node(n.pageID + 100, n.path, n.children ? translate(n.children) : undefined));

describe("flattenSitemap", () => {
  it("records parents and child order, skipping dynamic-item nodes", () => {
    const flat = flattenSitemap([node(1, "/a", [node(2, "/a/b"), node(1, "/a/item", undefined, { contentID: 9 })])]);
    expect(flat.placement.get(2)?.parent).toBe(1);
    expect(flat.children.get(0)).toEqual([1]);
    expect(flat.children.get(1)).toEqual([2]);
  });
});

describe("checkSitemap", () => {
  it("reports nothing for an identical structure", () => {
    const collector = run(translate(SOURCE_TREE));
    expect(collector.findings).toEqual([]);
    expect(collector.talliesFor(LOCALE).sitemap).toMatchObject({ checked: 5, matched: 5 });
  });

  it("reports one siblingOrderMismatch per parent with both sequences", () => {
    const target = [
      node(101, "/home"),
      node(102, "/about", [node(104, "/about/jobs"), node(103, "/about/team")]),
      node(105, "/contact"),
    ];
    const findings = run(target).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: "siblingOrderMismatch",
      sourceID: 2,
      targetID: 102,
      expected: [103, 104],
      actual: [104, 103],
    });
  });

  it("reports a reordered root level", () => {
    const target = [
      node(105, "/contact"),
      node(101, "/home"),
      node(102, "/about", [node(103, "/a/t"), node(104, "/a/j")]),
    ];
    const findings = run(target).findings;
    expect(findings.map((f) => f.category)).toEqual(["siblingOrderMismatch"]);
    expect(findings[0]).toMatchObject({ name: "(root)", expected: [101, 102, 105], actual: [105, 101, 102] });
  });

  it("reports a reparented page", () => {
    const target = [
      node(101, "/home", [node(103, "/home/team")]),
      node(102, "/about", [node(104, "/about/jobs")]),
      node(105, "/contact"),
    ];
    const findings = run(target).findings;
    expect(findings.map((f) => f.category)).toEqual(["parentMismatch"]);
    expect(findings[0]).toMatchObject({ sourceID: 3, targetID: 103, expected: 102, actual: 101 });
  });

  it("reports a mapped page missing from the target sitemap", () => {
    const target = [node(101, "/home"), node(102, "/about", [node(103, "/about/team")]), node(105, "/contact")];
    const findings = run(target).findings;
    expect(findings.map((f) => f.category)).toEqual(["pageMissingFromSitemap"]);
    expect(findings[0]).toMatchObject({ sourceID: 4, targetID: 104 });
  });

  describe("multiple channels", () => {
    const channels = { website: SOURCE_TREE, mobile: [node(5, "/contact"), node(1, "/home")] };

    it("compares each channel against the same channel on the target", () => {
      const findings = run(null, {
        channels,
        targetChannels: { website: translate(SOURCE_TREE), mobile: [node(101, "/home"), node(105, "/contact")] },
      }).findings;
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ category: "siblingOrderMismatch", path: "mobile:/" });
    });

    it("reports pages of a channel the target lacks", () => {
      const findings = run(null, { channels, targetChannels: { website: translate(SOURCE_TREE) } }).findings;
      expect(findings.map((f) => f.category)).toEqual(["pageMissingFromSitemap", "pageMissingFromSitemap"]);
    });

    it("checks only the requested channel when one is given", () => {
      const findings = run(null, {
        channels,
        targetChannels: { website: translate(SOURCE_TREE) },
        only: ["Website"],
      }).findings;
      expect(findings).toEqual([]);
    });
  });
});
