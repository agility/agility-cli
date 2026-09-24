/**
 * Selective page sync scope resolution (PROD-2546)
 *
 * Turns the `--pages` selectors a user typed into the exact set of pages a sync will
 * touch: the pages they named, plus every descendant of those pages.
 *
 * Two page sets come out of this, and the difference between them matters:
 *
 *  - `pageIDs`         — pages that WILL be pushed.
 *  - `traversePageIDs` — ancestors of the selected pages. These are NOT pushed. The page
 *                        pusher still has to walk through them, because it threads the
 *                        parent page ID down the sitemap recursion, and a selected page
 *                        whose parent was skipped entirely would be created at the root
 *                        of the target sitemap instead of underneath its parent.
 *
 * Resolution is deliberately strict and loud: a selector that matches nothing is an error,
 * and a selected page whose parent has never been synced is an error. Per the design
 * constraint on the ticket, the user must be able to see exactly which pages are in scope
 * before anything is written to the target.
 */

import ansiColors from "ansi-colors";
import { SitemapNode } from "../../types/syncAnalysis";
import { ChannelSitemaps, LocalePageScope, PageScopeAncestor, PageScopeMatch } from "../../types/pageScope";

export { ChannelSitemaps, LocalePageScope, PageScopeAncestor, PageScopeMatch };

/** A sitemap node paired with the channel it came from and its ancestor chain. */
interface FlatSitemapNode {
  node: SitemapNode;
  channel: string;
  ancestors: SitemapNode[];
}

/**
 * Split the raw `--pages` value into selectors. Duplicates are dropped case-insensitively so
 * `--pages="/blog,/Blog"` does not report the same page twice.
 */
export function parsePageSelectors(raw: string | undefined | null): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const selectors: string[] = [];

  raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .forEach((selector) => {
      const key = normalizeForMatch(selector);
      if (seen.has(key)) return;
      seen.add(key);
      selectors.push(selector);
    });

  return selectors;
}

/** Lowercase + trim, for case-insensitive comparison of names and selectors. */
function normalizeForMatch(value: string | null | undefined): string {
  return (value === null || value === undefined ? "" : value).trim().toLowerCase();
}

/**
 * Normalize a sitemap path or a path-style selector so `/blog`, `blog/` and `/Blog` all
 * compare equal.
 */
function normalizePath(value: string | null | undefined): string {
  let path = normalizeForMatch(value);
  if (!path) return "";
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

/**
 * Does `selector` name this sitemap node? A selector is matched as a page ID when it is all
 * digits, and otherwise against both the page path and the page name — a page is commonly
 * referred to either way, and both are unambiguous within a channel.
 */
function selectorMatchesNode(selector: string, node: SitemapNode): boolean {
  const trimmed = selector.trim();

  if (/^\d+$/.test(trimmed)) {
    return node.pageID === parseInt(trimmed, 10);
  }

  if (normalizePath(trimmed) === normalizePath(node.path)) return true;
  return normalizeForMatch(trimmed) === normalizeForMatch(node.name);
}

/** Flatten every channel's sitemap into nodes carrying their channel and ancestor chain. */
function flattenSitemaps(sitemaps: { [channel: string]: SitemapNode[] | null }): FlatSitemapNode[] {
  const flat: FlatSitemapNode[] = [];

  Object.keys(sitemaps).forEach((channel) => {
    const nodes = sitemaps[channel];
    if (!nodes || nodes.length === 0) return;

    const walk = (list: SitemapNode[], ancestors: SitemapNode[]): void => {
      list.forEach((node) => {
        flat.push({ node, channel, ancestors });
        if (node.children && node.children.length > 0) {
          walk(node.children, ancestors.concat([node]));
        }
      });
    };

    walk(nodes, []);
  });

  return flat;
}

/** Collect the page IDs of a node and every node beneath it. */
function collectSubtreePageIDs(node: SitemapNode, into: Set<number>): void {
  into.add(node.pageID);
  (node.children || []).forEach((child) => collectSubtreePageIDs(child, into));
}

/**
 * Resolve `selectors` against one locale's sitemaps.
 *
 * Matching runs across every channel, because the page pusher walks every channel's sitemap
 * — scoping to a single channel here would leave a same-named page in another channel out
 * of the preview while the sync still considered it.
 */
export function resolvePageScopeForLocale(
  sitemaps: { [channel: string]: SitemapNode[] | null },
  selectors: string[],
  locale: string
): LocalePageScope {
  const flat = flattenSitemaps(sitemaps);

  const pageIDs = new Set<number>();
  const matches: PageScopeMatch[] = [];
  const unmatched: string[] = [];
  // Keyed by channel + pageID so a dynamic page listed once per content item (same pageID,
  // different paths) is reported as a single match rather than one per listing.
  const seenMatches = new Set<string>();
  const ancestorHits: Array<{ node: SitemapNode; channel: string }> = [];

  selectors.forEach((selector) => {
    const hits = flat.filter((entry) => selectorMatchesNode(selector, entry.node));

    if (hits.length === 0) {
      unmatched.push(selector);
      return;
    }

    hits.forEach((hit) => {
      // Ancestors are collected for every hit, even a duplicate dynamic-page listing, so the
      // parent chain is complete regardless of which listing was seen first.
      hit.ancestors.forEach((ancestor) => ancestorHits.push({ node: ancestor, channel: hit.channel }));

      const key = `${hit.channel}:${hit.node.pageID}`;
      if (seenMatches.has(key)) return;
      seenMatches.add(key);

      const subtree = new Set<number>();
      collectSubtreePageIDs(hit.node, subtree);
      subtree.forEach((id) => pageIDs.add(id));

      matches.push({
        selector,
        channel: hit.channel,
        pageID: hit.node.pageID,
        path: hit.node.path || "",
        name: hit.node.name || "",
        descendantCount: subtree.size - 1,
      });
    });
  });

  // An ancestor that is itself selected (e.g. --pages="/blog,/blog/post") is in scope and gets
  // pushed normally — only genuinely out-of-scope ancestors are traversal-only.
  const traversePageIDs = new Set<number>();
  const ancestors: PageScopeAncestor[] = [];
  const seenAncestors = new Set<string>();

  ancestorHits.forEach((entry) => {
    if (pageIDs.has(entry.node.pageID)) return;
    const key = `${entry.channel}:${entry.node.pageID}`;
    if (seenAncestors.has(key)) return;
    seenAncestors.add(key);

    traversePageIDs.add(entry.node.pageID);
    ancestors.push({
      channel: entry.channel,
      pageID: entry.node.pageID,
      path: entry.node.path || "",
      name: entry.node.name || "",
    });
  });

  return { locale, pageIDs, traversePageIDs, matches, unmatched, ancestors };
}

/** Every page path in these sitemaps, for the "did you mean" list on an unmatched selector. */
export function listAvailablePagePaths(sitemaps: { [channel: string]: SitemapNode[] | null }): string[] {
  const paths = new Set<string>();
  flattenSitemaps(sitemaps).forEach((entry) => {
    const path = entry.node.path || entry.node.name;
    if (path) paths.add(path);
  });
  return Array.from(paths).sort();
}

/**
 * Render the scope as an indented, per-channel tree so the user can see exactly which pages
 * are in scope before anything is written.
 *
 * `→` marks a page the user named, `+` a descendant that comes along with it, and `·` an
 * out-of-scope ancestor shown only for context.
 */
export function renderPageScope(
  scopes: LocalePageScope[],
  sitemapsByLocale: { [locale: string]: { [channel: string]: SitemapNode[] | null } }
): string {
  const lines: string[] = [];
  const bar = "─".repeat(60);

  lines.push(ansiColors.cyan(bar));
  lines.push(ansiColors.cyan("🎯 PAGE SCOPE — only these pages and their dependencies will be synced"));
  lines.push(ansiColors.cyan(bar));

  scopes.forEach((scope) => {
    const selectedIDs = new Set<number>();
    scope.matches.forEach((m) => selectedIDs.add(m.pageID));

    lines.push(`\n${ansiColors.bold(scope.locale)}`);

    const sitemaps = sitemapsByLocale[scope.locale] || {};
    let renderedAny = false;

    Object.keys(sitemaps).forEach((channel) => {
      const nodes = sitemaps[channel];
      if (!nodes || nodes.length === 0) return;

      const channelLines: string[] = [];
      const seenInChannel = new Set<number>();

      const renderNode = (node: SitemapNode, depth: number): void => {
        const inScope = scope.pageIDs.has(node.pageID);
        const isAncestor = scope.traversePageIDs.has(node.pageID);
        if (!inScope && !isAncestor) return;

        // +2 so the page tree nests visually under the channel heading.
        const indent = "  ".repeat(depth + 2);

        if (!inScope) {
          // "left unchanged", not "not synced": the parent may well be on the target already
          // (it has to be) — the point is that THIS run will not touch it.
          channelLines.push(`${indent}${ansiColors.gray(`· ${node.path || node.name} (parent — left unchanged)`)}`);
        } else if (!seenInChannel.has(node.pageID)) {
          // Dynamic pages appear once per content item under the same pageID; the page itself
          // is pushed once, so list it once.
          seenInChannel.add(node.pageID);
          const label = `${node.path || node.name} ${ansiColors.gray(`(pageID ${node.pageID})`)}`;
          const glyph = selectedIDs.has(node.pageID) ? ansiColors.green("→") : ansiColors.green("+");
          channelLines.push(`${indent}${glyph} ${label}`);
        }

        (node.children || []).forEach((child) => renderNode(child, depth + 1));
      };

      nodes.forEach((node) => renderNode(node, 0));

      if (channelLines.length > 0) {
        renderedAny = true;
        lines.push(`  ${ansiColors.bold(channel)}`);
        channelLines.forEach((line) => lines.push(line));
      }
    });

    if (!renderedAny) {
      lines.push(ansiColors.yellow("  (no matching pages in this locale — nothing will be synced for it)"));
    }

    if (scope.unmatched.length > 0) {
      lines.push(ansiColors.yellow(`  ⚠️  Not found in ${scope.locale}: ${scope.unmatched.join(", ")}`));
    }
  });

  lines.push(ansiColors.cyan(`\n${bar}`));

  return lines.join("\n");
}
