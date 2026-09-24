/**
 * Types for selective page sync (PROD-2546).
 *
 * These live in `types/` rather than next to the resolver so `core/state` can hold a resolved
 * scope without importing `lib/pages`, which would close an import cycle back through
 * SitemapHierarchy into `core/state`.
 */

import { SitemapNode } from "./syncAnalysis";

/** A page that a `--pages` selector resolved to. */
export interface PageScopeMatch {
  /** The selector the user typed, verbatim. */
  selector: string;
  channel: string;
  pageID: number;
  path: string;
  name: string;
  /** How many descendants came along with this page. */
  descendantCount: number;
}

/** An ancestor of a selected page: walked through for parenting, never pushed. */
export interface PageScopeAncestor {
  channel: string;
  pageID: number;
  path: string;
  name: string;
}

/** The resolved page scope for a single locale. */
export interface LocalePageScope {
  locale: string;
  /** Pages that will be pushed: the selected pages plus all of their descendants. */
  pageIDs: Set<number>;
  /** Ancestors of the selected pages — traversed for correct parenting, never pushed. */
  traversePageIDs: Set<number>;
  /** One entry per page a selector resolved to. */
  matches: PageScopeMatch[];
  /** Selectors that matched no page in this locale. */
  unmatched: string[];
  /** Out-of-scope ancestors of the selected pages. */
  ancestors: PageScopeAncestor[];
}

/** Sitemaps keyed by channel, as loaded from a locale's `nestedsitemap` folder. */
export interface ChannelSitemaps {
  [channel: string]: SitemapNode[] | null;
}

/** The resolved `--pages` scope for a whole sync run. */
export interface PageSyncScope {
  /** The selectors the user typed, in order. */
  selectors: string[];
  /** Resolved scope per locale. */
  byLocale: Map<string, LocalePageScope>;
  /** Every in-scope page ID across all locales, for filtering instance-wide entities. */
  allPageIDs: Set<number>;
  /** The sitemaps each locale's scope was resolved against, kept for rendering. */
  sitemapsByLocale: { [locale: string]: ChannelSitemaps };
}
