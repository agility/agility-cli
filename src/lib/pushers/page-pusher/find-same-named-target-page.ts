/**
 * PROD-3113 / PROD-3026: find the target page at a new source page's path.
 *
 * The server refuses a page whose name is already used at the same level ("There is already a page
 * at this level with the same name"). When a source page has no mapping row, the sync used to try
 * to create it anyway and fail. Instead the page pusher looks for that page here, in the target's
 * management API sitemap, and reports it as a conflict, or with --overwrite maps it and updates it.
 * Parents are resolved through their mapping rows first, so a name match at the mapped parent's
 * level is a match by path.
 */

/** The parts of a management API sitemap node (SitemapItem) this lookup reads. */
export interface TargetSitemapNode {
  pageID: number | null;
  parentPageID?: number | null;
  pageName: string | null;
  pageType?: string | null;
  childPages?: (TargetSitemapNode | null)[] | null;
}

export interface TargetPageCandidate {
  pageID: number;
  pageName: string;
  /** The management sitemap's type: "Template" (static), "Container" (folder) or "Custom" (link). */
  pageType: string | null;
  /** Full path on the target, from the page names, e.g. "/company/about-us". */
  path: string;
}

// Page file pageType → management sitemap pageType, both lowercased. Dynamic pages and anything
// else not listed here are never treated as a type mismatch.
const SITEMAP_PAGE_TYPES: Record<string, string> = {
  static: "template",
  folder: "container",
  link: "custom",
};

const KNOWN_SITEMAP_TYPES = new Set(Object.values(SITEMAP_PAGE_TYPES));

/**
 * The target page named `pageName` (case-insensitive, as the server compares it) directly under
 * `targetParentPageID`, or at the root when that is 0 or less. `channelPages` is one channel's
 * `pages` from `pageMethods.getSitemap`. Null when there is no such page.
 */
export function findSameNamedTargetPage(
  channelPages: (TargetSitemapNode | null)[] | null | undefined,
  targetParentPageID: number,
  pageName: string | null | undefined
): TargetPageCandidate | null {
  if (!channelPages || !pageName) return null;
  const wanted = pageName.toLowerCase();
  const wantRoot = !(targetParentPageID > 0);

  const visit = (
    nodes: (TargetSitemapNode | null)[] | null | undefined,
    treeParentID: number,
    parentPath: string
  ): TargetPageCandidate | null => {
    for (const node of nodes || []) {
      if (!node || !node.pageID || node.pageID <= 0) continue;
      // Root nodes carry parentPageID -1; fall back to the tree position when it's missing.
      const nodeParentID = node.parentPageID ?? treeParentID;
      const path = `${parentPath}/${node.pageName ?? ""}`;
      const atLevel = wantRoot ? !(nodeParentID > 0) : nodeParentID === targetParentPageID;
      if (atLevel && node.pageName?.toLowerCase() === wanted) {
        return { pageID: node.pageID, pageName: node.pageName, pageType: node.pageType ?? null, path };
      }
      const found = visit(node.childPages, node.pageID, path);
      if (found) return found;
    }
    return null;
  };

  return visit(channelPages, -1, "");
}

/**
 * True when the source page and the same-named target page are known to be different kinds
 * (e.g. a folder on one side and a static page on the other), so adopting it would be a guess.
 */
export function pageTypesDiffer(sourcePageType: string | null | undefined, targetSitemapType: string | null): boolean {
  const expected = SITEMAP_PAGE_TYPES[(sourcePageType || "").toLowerCase()];
  const actual = (targetSitemapType || "").toLowerCase();
  return !!expected && KNOWN_SITEMAP_TYPES.has(actual) && expected !== actual;
}

/** Human label for a management sitemap page type, for messages. */
export function sitemapTypeLabel(targetSitemapType: string | null): string {
  const actual = (targetSitemapType || "").toLowerCase();
  const entry = Object.entries(SITEMAP_PAGE_TYPES).find(([, v]) => v === actual);
  return entry ? entry[0] : targetSitemapType || "page";
}
