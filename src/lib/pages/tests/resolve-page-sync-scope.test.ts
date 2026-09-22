import ansiColors from "ansi-colors";

import { printPageSyncScope, resolvePageSyncScope } from "../resolve-page-sync-scope";
import { ChannelSitemaps } from "types/pageScope";
import { SitemapNode } from "types/syncAnalysis";

beforeAll(() => {
  ansiColors.enabled = false;
});

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function node(pageID: number, path: string, children: SitemapNode[] = []): SitemapNode {
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
  };
}

function sitemaps(): ChannelSitemaps {
  return {
    website: [
      node(2, "/home"),
      node(3, "/products", [node(10, "/products/my-lottery", [node(11, "/products/my-lottery/rules")])]),
    ],
  };
}

function resolve(overrides: Partial<Parameters<typeof resolvePageSyncScope>[0]> = {}) {
  return resolvePageSyncScope({
    sourceGuid: "src",
    targetGuid: "tgt",
    locales: ["en-us"],
    selectors: ["/products/my-lottery"],
    loadSitemaps: () => sitemaps(),
    // Default: the parent chain is already on the target.
    isAncestorMapped: () => true,
    ...overrides,
  });
}

// ─── happy path ───────────────────────────────────────────────────────────────

describe("resolvePageSyncScope", () => {
  it("resolves a scope per locale", () => {
    const scope = resolve({ locales: ["en-us", "fr-ca"] });
    expect(Array.from(scope.byLocale.keys())).toEqual(["en-us", "fr-ca"]);
  });

  it("unions in-scope page IDs across locales", () => {
    const scope = resolve({
      locales: ["en-us", "fr-ca"],
      loadSitemaps: (_guid, locale) =>
        locale === "en-us" ? { website: [node(10, "/my-lottery")] } : { website: [node(77, "/my-lottery")] },
      selectors: ["/my-lottery"],
    });
    expect(Array.from(scope.allPageIDs).sort((a, b) => a - b)).toEqual([10, 77]);
  });

  it("keeps the selectors the user typed", () => {
    expect(resolve().selectors).toEqual(["/products/my-lottery"]);
  });

  it("keeps the sitemaps it resolved against, for rendering", () => {
    const scope = resolve();
    expect(scope.sitemapsByLocale["en-us"].website).toHaveLength(2);
  });

  it("reads sitemaps from the SOURCE instance", () => {
    const loadSitemaps = jest.fn().mockReturnValue(sitemaps());
    resolve({ loadSitemaps });
    expect(loadSitemaps).toHaveBeenCalledWith("src", "en-us");
  });
});

// ─── unmatched selectors ──────────────────────────────────────────────────────

describe("resolvePageSyncScope — unmatched selectors", () => {
  it("throws when a selector matches nothing in any locale", () => {
    expect(() => resolve({ selectors: ["/typo"] })).toThrow(/No page matched: \/typo/);
  });

  it('marks the failure as a "validation failed" halt so the push aborts', () => {
    expect(() => resolve({ selectors: ["/typo"] })).toThrow(/validation failed/);
  });

  it("lists the available page paths to help correct the typo", () => {
    const logSpy = jest.spyOn(console, "log");
    expect(() => resolve({ selectors: ["/typo"] })).toThrow();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("/products/my-lottery"));
  });

  it("accepts a selector that matches in only one of several locales", () => {
    const scope = resolve({
      locales: ["en-us", "fr-ca"],
      loadSitemaps: (_guid, locale) => (locale === "en-us" ? sitemaps() : { website: [node(2, "/home")] }),
    });
    expect(scope.byLocale.get("fr-ca")?.unmatched).toEqual(["/products/my-lottery"]);
    expect(Array.from(scope.byLocale.get("fr-ca")!.pageIDs)).toEqual([]);
  });


  it("hints at shell path rewriting when a selector arrives as a Windows path", () => {
    // Git Bash rewrites --pages=/my-lottery into C:/Program Files/Git/my-lottery.
    const logSpy = jest.spyOn(console, "log");
    expect(() => resolve({ selectors: ["C:/Program Files/Git/my-lottery"] })).toThrow();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("MSYS_NO_PATHCONV"));
  });

  it("does not show the shell hint for an ordinary typo", () => {
    const logSpy = jest.spyOn(console, "log");
    expect(() => resolve({ selectors: ["/typo"] })).toThrow();
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("MSYS_NO_PATHCONV"));
  });

  it("throws when --pages was given with no usable selectors", () => {
    expect(() => resolve({ selectors: [] })).toThrow(/no page selectors/);
  });
});

// ─── unsynced parents ─────────────────────────────────────────────────────────

describe("resolvePageSyncScope — parent pages not yet on the target", () => {
  it("throws when an out-of-scope parent has no target mapping", () => {
    expect(() => resolve({ isAncestorMapped: () => false })).toThrow(/parent page\(s\)/);
  });

  it('marks the failure as a "validation failed" halt so the push aborts', () => {
    expect(() => resolve({ isAncestorMapped: () => false })).toThrow(/validation failed/);
  });

  it("names the unsynced parent and its locale", () => {
    const logSpy = jest.spyOn(console, "log");
    expect(() => resolve({ isAncestorMapped: () => false })).toThrow();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[en-us] /products (pageID 3)"));
  });

  it("tells the user how to fix it", () => {
    const logSpy = jest.spyOn(console, "log");
    expect(() => resolve({ isAncestorMapped: () => false })).toThrow();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Add them to --pages"));
  });

  it("passes when the parent chain is already mapped", () => {
    expect(() => resolve({ isAncestorMapped: () => true })).not.toThrow();
  });

  it("does not require a mapping for a root-level selection", () => {
    const isAncestorMapped = jest.fn().mockReturnValue(false);
    expect(() => resolve({ selectors: ["/home"], isAncestorMapped })).not.toThrow();
    expect(isAncestorMapped).not.toHaveBeenCalled();
  });

  it("does not require a mapping for a parent that is itself selected", () => {
    const isAncestorMapped = jest.fn().mockReturnValue(false);
    expect(() => resolve({ selectors: ["/products", "/products/my-lottery"], isAncestorMapped })).not.toThrow();
    expect(isAncestorMapped).not.toHaveBeenCalled();
  });

  it("checks the parent chain in every locale", () => {
    const isAncestorMapped = jest.fn().mockReturnValue(true);
    resolve({ locales: ["en-us", "fr-ca"], isAncestorMapped });
    expect(isAncestorMapped.mock.calls.map((c) => c[1])).toEqual(["en-us", "fr-ca"]);
  });
});

// ─── printPageSyncScope ───────────────────────────────────────────────────────

describe("printPageSyncScope", () => {
  it("prints the page tree that is about to be synced", () => {
    const logSpy = jest.spyOn(console, "log");
    printPageSyncScope(resolve());
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("PAGE SCOPE");
    expect(printed).toContain("/products/my-lottery (pageID 10)");
    expect(printed).toContain("/products/my-lottery/rules (pageID 11)");
  });
});
