/**
 * Sitemap checks for one locale, per channel (PROD-2552).
 *
 * The source nested sitemap is translated to target page IDs through the page mapping and compared
 * with the target's nested sitemap for the same channel:
 *  - pageMissingFromSitemap  a mapped page that exists on the target but is not in its sitemap
 *  - parentMismatch          the page sits under a different parent (root = 0)
 *  - siblingOrderMismatch    one finding per parent whose children are in a different order,
 *                            with both sequences (target page IDs)
 * Dynamic-page item entries (nodes carrying a contentID) are generated from content, not pages,
 * and are skipped. Pages that are not mapped at all are reported by mapping integrity, not here.
 */
import { FindingCollector } from "./verify-report";
import { ChannelSitemaps, VerifyContext } from "./verify-context";
import { SitemapNode } from "../../types/syncAnalysis";

interface Placement {
  parent: number;
  path: string;
  name: string;
}

interface FlatSitemap {
  placement: Map<number, Placement>;
  children: Map<number, number[]>;
}

function isPageNode(node: SitemapNode): boolean {
  return typeof node?.pageID === "number" && node.pageID > 0 && !node.contentID;
}

/** Flatten a nested sitemap into parent links and ordered child lists, keyed by page ID. */
export function flattenSitemap(nodes: SitemapNode[] | null | undefined): FlatSitemap {
  const flat: FlatSitemap = { placement: new Map(), children: new Map() };
  const visit = (list: SitemapNode[] | undefined, parent: number) => {
    (list || []).forEach((node) => {
      if (!isPageNode(node)) return;
      if (!flat.placement.has(node.pageID)) {
        flat.placement.set(node.pageID, { parent, path: node.path, name: node.name });
        if (!flat.children.has(parent)) flat.children.set(parent, []);
        (flat.children.get(parent) as number[]).push(node.pageID);
      }
      visit(node.children, node.pageID);
    });
  };
  visit(nodes || [], 0);
  return flat;
}

function channelKey(sitemaps: ChannelSitemaps): Map<string, string> {
  const out = new Map<string, string>();
  Object.keys(sitemaps || {}).forEach((name) => out.set(name.toLowerCase(), name));
  return out;
}

export function checkSitemap(ctx: VerifyContext, collector: FindingCollector): void {
  const { locale } = ctx;
  const sourceChannels = channelKey(ctx.source.entities.sitemaps);
  const targetChannels = channelKey(ctx.target.entities.sitemaps);
  const pageMap = ctx.localeMappings.pages;
  // A scoped run compares only the pages the scope loaded on the source side.
  const inScope = (sourcePageID: number) => !ctx.scoped || ctx.source.pagesById.has(sourcePageID);

  Array.from(sourceChannels.keys())
    .sort()
    .forEach((channel) => {
      if (ctx.channels && !ctx.channels.includes(channel)) return;
      const source = flattenSitemap(ctx.source.entities.sitemaps[sourceChannels.get(channel) as string]);
      const targetName = targetChannels.get(channel);
      const target = flattenSitemap(targetName ? ctx.target.entities.sitemaps[targetName] : null);
      const where = (path: string) => `${channel}:${path}`;

      const toTarget = (sourcePageID: number): number | undefined =>
        sourcePageID === 0 ? 0 : pageMap.target(sourcePageID);

      source.placement.forEach((placement, sourcePageID) => {
        if (!inScope(sourcePageID)) return;
        const targetPageID = pageMap.target(sourcePageID);
        // Unmapped or dangling: mapping integrity already reports the page itself.
        if (targetPageID === undefined || !ctx.target.pagesById.has(targetPageID)) return;
        collector.count(locale, "sitemap", "checked");

        const actual = target.placement.get(targetPageID);
        if (!actual) {
          collector.count(locale, "sitemap", "missing");
          collector.add({
            category: "pageMissingFromSitemap",
            severity: "failure",
            entity: "sitemap",
            locale,
            sourceID: sourcePageID,
            targetID: targetPageID,
            name: placement.name,
            path: where(placement.path),
            message: `Page is on the target but not in its "${channel}" sitemap`,
          });
          return;
        }

        const expectedParent = toTarget(placement.parent);
        if (expectedParent !== actual.parent) {
          collector.count(locale, "sitemap", "mismatched");
          collector.add({
            category: "parentMismatch",
            severity: "failure",
            entity: "sitemap",
            locale,
            sourceID: sourcePageID,
            targetID: targetPageID,
            name: placement.name,
            path: where(placement.path),
            expected: expectedParent === undefined ? `unmapped:${placement.parent}` : expectedParent,
            actual: actual.parent,
            message: "Page is under a different parent on the target (0 = root)",
          });
          return;
        }
        collector.count(locale, "sitemap", "matched");
      });

      source.children.forEach((sourceChildren, sourceParent) => {
        if (sourceParent !== 0 && !inScope(sourceParent)) return;
        const targetParent = toTarget(sourceParent);
        if (targetParent === undefined) return;
        const actualChildren = target.children.get(targetParent) ?? [];
        const actualSet = new Set(actualChildren);
        const expected = sourceChildren
          .filter(inScope)
          .map((id) => pageMap.target(id))
          .filter((id): id is number => id !== undefined && actualSet.has(id));
        if (expected.length < 2) return;
        const expectedSet = new Set(expected);
        const actual = actualChildren.filter((id) => expectedSet.has(id));
        if (expected.every((id, i) => id === actual[i])) return;
        const parentPlacement = source.placement.get(sourceParent);
        collector.add({
          category: "siblingOrderMismatch",
          severity: "failure",
          entity: "sitemap",
          locale,
          sourceID: sourceParent,
          targetID: targetParent,
          name: parentPlacement?.name ?? "(root)",
          path: where(parentPlacement?.path ?? "/"),
          expected,
          actual,
          message: "Child pages are in a different order on the target (target page IDs shown)",
        });
      });
    });
}
