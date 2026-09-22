/**
 * Resolve the `--pages` scope for a whole sync run (PROD-2546).
 *
 * Runs once, after the source/target pull and before any pusher writes anything, so the
 * scope can be printed and validated up front. Two things make a scope invalid, and both
 * are hard stops rather than warnings — silently doing the wrong thing to a customer
 * instance is the failure mode this feature has to avoid:
 *
 *  1. A selector that matches no page in any locale. Almost always a typo, and letting it
 *     through would sync a narrower set than the user asked for without saying so.
 *  2. A selected page whose parent has never been synced to the target. The page pusher
 *     resolves a parent through the page mappings; with no mapping it falls back to "no
 *     parent", which would create the page at the ROOT of the target sitemap instead of
 *     underneath its parent.
 */

import ansiColors from "ansi-colors";
import { SitemapHierarchy } from "../pushers/page-pusher/sitemap-hierarchy";
import { PageMapper } from "../mappers/page-mapper";
import { ChannelSitemaps, LocalePageScope, PageSyncScope } from "../../types/pageScope";
import { listAvailablePagePaths, renderPageScope, resolvePageScopeForLocale } from "./page-scope";

export { PageSyncScope };

/** How many example paths to show when a selector matches nothing. */
const MAX_SUGGESTED_PATHS = 25;

export interface ResolvePageSyncScopeOptions {
  sourceGuid: string;
  targetGuid: string;
  locales: string[];
  selectors: string[];
  /** Injected in tests; defaults to reading the pulled sitemaps off disk. */
  loadSitemaps?: (guid: string, locale: string) => ChannelSitemaps;
  /** Injected in tests; defaults to reading the real page mappings. */
  isAncestorMapped?: (sourcePageID: number, locale: string) => boolean;
}

export function resolvePageSyncScope({
  sourceGuid,
  targetGuid,
  locales,
  selectors,
  loadSitemaps,
  isAncestorMapped,
}: ResolvePageSyncScopeOptions): PageSyncScope {
  if (selectors.length === 0) {
    throw new Error("Page validation failed. --pages was provided but contained no page selectors.");
  }

  const readSitemaps =
    loadSitemaps ?? ((guid: string, locale: string) => new SitemapHierarchy().loadAllSitemaps(guid, locale));

  const byLocale = new Map<string, LocalePageScope>();
  const sitemapsByLocale: { [locale: string]: ChannelSitemaps } = {};
  const allPageIDs = new Set<number>();

  locales.forEach((locale) => {
    const sitemaps = readSitemaps(sourceGuid, locale);
    sitemapsByLocale[locale] = sitemaps;

    const scope = resolvePageScopeForLocale(sitemaps, selectors, locale);
    byLocale.set(locale, scope);
    scope.pageIDs.forEach((id) => allPageIDs.add(id));
  });

  assertEverySelectorMatched(selectors, byLocale, sitemapsByLocale);
  assertAncestorsAlreadySynced(byLocale, sourceGuid, targetGuid, isAncestorMapped);

  return { selectors, byLocale, allPageIDs, sitemapsByLocale };
}

/**
 * A selector only has to match in ONE locale — a page that exists in en-us but not fr-ca is
 * normal, and the per-locale preview already calls that out. A selector matching nowhere is
 * a typo.
 */
function assertEverySelectorMatched(
  selectors: string[],
  byLocale: Map<string, LocalePageScope>,
  sitemapsByLocale: { [locale: string]: ChannelSitemaps }
): void {
  const matchedSomewhere = new Set<string>();
  byLocale.forEach((scope) => {
    scope.matches.forEach((match) => matchedSomewhere.add(match.selector));
  });

  const missing = selectors.filter((selector) => !matchedSomewhere.has(selector));
  if (missing.length === 0) return;

  const available = new Set<string>();
  Object.keys(sitemapsByLocale).forEach((locale) => {
    listAvailablePagePaths(sitemapsByLocale[locale]).forEach((path) => available.add(path));
  });

  const suggestions = Array.from(available).sort();
  const shown = suggestions.slice(0, MAX_SUGGESTED_PATHS);

  console.log(ansiColors.red(`❌ No page matched: ${missing.join(", ")}`));
  if (shown.length > 0) {
    console.log(ansiColors.gray(`Available pages (${suggestions.length}): ${shown.join(", ")}`));
    if (suggestions.length > shown.length) {
      console.log(ansiColors.gray(`  …and ${suggestions.length - shown.length} more`));
    }
  } else {
    console.log(ansiColors.gray("No sitemap data was found — pull the source instance before scoping a sync."));
  }

  throw new Error(
    `Page validation failed. No page matched: ${missing.join(", ")}. ` +
      `Pass a page path (e.g. "/my-lottery"), a page name, or a page ID.`
  );
}

/**
 * Every out-of-scope ancestor of a selected page must already be mapped to the target, or
 * the selected page would land at the root of the target sitemap.
 */
function assertAncestorsAlreadySynced(
  byLocale: Map<string, LocalePageScope>,
  sourceGuid: string,
  targetGuid: string,
  isAncestorMapped?: (sourcePageID: number, locale: string) => boolean
): void {
  const problems: string[] = [];

  byLocale.forEach((scope, locale) => {
    if (scope.ancestors.length === 0) return;

    const isMapped =
      isAncestorMapped ??
      (() => {
        const mapper = new PageMapper(sourceGuid, targetGuid, locale);
        return (sourcePageID: number) => (mapper.getPageMappingByPageID(sourcePageID, "source")?.targetPageID || 0) > 0;
      })();

    scope.ancestors.forEach((ancestor) => {
      if (isMapped(ancestor.pageID, locale)) return;
      problems.push(`  • [${locale}] ${ancestor.path || ancestor.name} (pageID ${ancestor.pageID})`);
    });
  });

  if (problems.length === 0) return;

  console.log(ansiColors.red("❌ Parent pages of the selected pages have never been synced to the target:"));
  problems.forEach((problem) => console.log(ansiColors.red(problem)));
  console.log(
    ansiColors.yellow(
      "💡 Add them to --pages to sync them too, or run a sync that covers them first. " +
        "Without a parent on the target, the selected pages would be created at the top level of the sitemap."
    )
  );

  throw new Error(
    `Page validation failed. ${problems.length} parent page(s) of the selected pages are not present in the ` +
      `target mappings. Include them in --pages or sync them first.`
  );
}

/** Print the resolved scope. Called before any pusher writes to the target. */
export function printPageSyncScope(scope: PageSyncScope): void {
  const scopes: LocalePageScope[] = [];
  scope.byLocale.forEach((localeScope) => scopes.push(localeScope));
  console.log(renderPageScope(scopes, scope.sitemapsByLocale));
}
