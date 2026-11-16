/**
 * Page order (PROD-3164): put each synced page on the target under the source's parent, in the
 * source's place among its siblings.
 *
 * The page save can't do this for a page that already exists: an update keeps the page's stored
 * position and ignores placeBeforePageItemID (only a new page is placed). So a page moved on the
 * source after it was first synced stays where it was on the target. This phase runs after pages
 * and moves only the pages that are out of place, through the Management API's page move endpoint.
 *
 * The target's order is read live from the Management API sitemap, not from the pull: it reads the
 * database, so it already shows the pages this run created and the moves it made.
 *
 * Per parent, the pages already in the source's relative order stay put (the longest such run) and
 * the rest move, each placed before its next sibling in the source's order, working from the end so
 * that sibling is already in place. A page under a different parent on the target moves too.
 *
 * Fixed pages are never moved, and the others are ordered around them:
 *  - pages the page phase held this run (the target page changed since the last sync: a kept target
 *    change or a conflict). A move on the target makes a new version, so this is how a target-only
 *    move is kept. --overwrite moves them like any other page.
 *  - pages outside a --pages scope.
 *
 * A move makes a new version of the page and puts it in staging in every locale (a page's place is
 * shared by all locales). After each move the mapping's target version is moved forward in every
 * locale of the run, so the next run doesn't read the move as a target change, and the page is
 * queued for republishing in each locale where it was published on the target and the source.
 */

import ansiColors from "ansi-colors";
import { state, getApiClient, getLoggerForGuid, registerOtherLocaleStaging } from "../../core/state";
import { flattenSitemap } from "../verify/check-sitemap";
import { SitemapHierarchy } from "../pushers/page-pusher/sitemap-hierarchy";
import { PageMapper } from "../mappers/page-mapper";
import { preflightReport } from "../preflight/preflight-report";
import { isHeldPage } from "./held-pages";
import { PusherResult } from "../../types/sourceData";
import { SitemapNode } from "../../types/syncAnalysis";

const ROOT = 0;
const PUBLISHED_STATE = 2;

export interface PageOrderOptions {
  sourceGuid: string;
  targetGuid: string;
  locales: string[];
}

/** One page to move on the target. Parent and place-before are target page IDs; -1 is the root / last. */
export interface PageMove {
  pageID: number;
  parentPageID: number;
  placeBeforePageID: number;
  /** Under the wrong parent, or only out of order among its siblings. */
  reason: "parent" | "order";
}

export interface PageOrderPlan {
  moves: PageMove[];
  /** Target parents (0 = root) whose order can't fully match, because fixed pages are out of order. */
  unresolvedParents: number[];
}

/** A nested sitemap as plain nodes: the pull's (children) or the Management API's (childPages). */
export interface TreeNode {
  pageID: number;
  contentID?: number;
  children?: TreeNode[];
}

/** The Management API sitemap's pages, in the shape flattenSitemap reads. */
export function fromManagementSitemap(pages: any[] | null | undefined): TreeNode[] {
  return (pages || [])
    .filter((p) => p && typeof p.pageID === "number")
    .map((p) => ({ pageID: p.pageID, children: fromManagementSitemap(p.childPages) }));
}

/**
 * Indices (into `positions`) of the heaviest subsequence whose positions increase. Fixed entries
 * weigh more than all the others together, so the subsequence keeps every fixed page it can.
 */
function heaviestIncreasing(positions: number[], fixed: boolean[]): number[] {
  const n = positions.length;
  const heavy = n + 1;
  const best = new Array<number>(n).fill(0);
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    best[i] = fixed[i] ? heavy : 1;
    for (let j = 0; j < i; j++) {
      if (positions[j] < positions[i] && best[j] + (fixed[i] ? heavy : 1) > best[i]) {
        best[i] = best[j] + (fixed[i] ? heavy : 1);
        prev[i] = j;
      }
    }
  }
  let end = -1;
  for (let i = 0; i < n; i++) if (end < 0 || best[i] > best[end]) end = i;
  const chain: number[] = [];
  for (let i = end; i >= 0; i = prev[i]) chain.unshift(i);
  return chain;
}

/**
 * Work out the moves that put the target's pages, for one channel, in the source's places.
 *
 * @param sourceNodes  the source's nested sitemap for the channel (dynamic-page items are skipped)
 * @param targetNodes  the target's nested sitemap for the same channel, as it stands now
 * @param toTarget     source page ID -> target page ID; unmapped pages are left out
 * @param fixed        target page IDs that must not move
 */
export function planPageMoves(
  sourceNodes: TreeNode[],
  targetNodes: TreeNode[],
  toTarget: (sourcePageID: number) => number | undefined,
  fixed: Set<number> = new Set()
): PageOrderPlan {
  const source = flattenSitemap(sourceNodes as unknown as SitemapNode[]);
  const target = flattenSitemap(targetNodes as unknown as SitemapNode[]);
  const moves: PageMove[] = [];
  const unresolvedParents: number[] = [];

  // Parents first, top down, so a page's parent is in place before its children are ordered.
  const parentsInOrder: number[] = [];
  const visit = (parent: number) => {
    parentsInOrder.push(parent);
    for (const child of source.children.get(parent) || []) visit(child);
  };
  visit(ROOT);

  for (const sourceParent of parentsInOrder) {
    const sourceChildren = source.children.get(sourceParent);
    if (!sourceChildren || sourceChildren.length === 0) continue;
    const targetParent = sourceParent === ROOT ? ROOT : toTarget(sourceParent);
    if (targetParent === undefined || (targetParent !== ROOT && !target.placement.has(targetParent))) continue;

    // The source's children on the target, in the source's order. A page not on the target at all
    // (not created, or created in another channel) is left to the page phase.
    const expected: number[] = [];
    for (const id of sourceChildren) {
      const targetID = toTarget(id);
      if (targetID !== undefined && target.placement.has(targetID) && !expected.includes(targetID))
        expected.push(targetID);
    }
    if (expected.length === 0) continue;

    const actual = target.children.get(targetParent) || [];
    const position = new Map(actual.map((id, i) => [id, i]));
    const underParent = expected.filter((id) => position.has(id));

    // Keep the heaviest run already in order; every other page under this parent moves.
    const keep = new Set(
      heaviestIncreasing(
        underParent.map((id) => position.get(id) as number),
        underParent.map((id) => fixed.has(id))
      ).map((i) => underParent[i])
    );
    if (underParent.some((id) => fixed.has(id) && !keep.has(id))) unresolvedParents.push(targetParent);

    const willMove = expected.filter((id) => !keep.has(id) && !fixed.has(id));
    if (willMove.length === 0) continue;

    // From the end, so each page's next sibling is already in its final place. The anchor is the
    // next expected page that will be under this parent: one that stays, or one already moved here.
    const placed = new Set(Array.from(keep).concat(underParent.filter((id) => fixed.has(id))));
    for (let i = expected.length - 1; i >= 0; i--) {
      const id = expected[i];
      if (!willMove.includes(id)) continue;
      let anchor = -1;
      for (let j = i + 1; j < expected.length; j++) {
        if (placed.has(expected[j])) {
          anchor = expected[j];
          break;
        }
      }
      moves.push({
        pageID: id,
        parentPageID: targetParent === ROOT ? -1 : targetParent,
        placeBeforePageID: anchor,
        reason: position.has(id) ? "order" : "parent",
      });
      placed.add(id);
    }
  }

  return { moves, unresolvedParents };
}

/** source page ID -> target page ID, for one locale. */
function pageMapFor(sourceGuid: string, targetGuid: string, locale: string): (id: number) => number | undefined {
  const mapper = new PageMapper(sourceGuid, targetGuid, locale);
  return (id: number) => {
    const targetID = mapper.getPageMappingByPageID(id, "source")?.targetPageID;
    return targetID && targetID > 0 ? targetID : undefined;
  };
}

/**
 * After a move: move each locale's recorded target version forward to the version the move made,
 * and queue the page for republishing where it was published on the target and the source.
 */
async function afterMove(
  opts: PageOrderOptions,
  targetPageID: number,
  movedLocale: string,
  apiClient: any
): Promise<void> {
  for (const locale of opts.locales) {
    try {
      const mapper = new PageMapper(opts.sourceGuid, opts.targetGuid, locale);
      const record = mapper.getPageMappingByPageID(targetPageID, "target");
      if (!record) continue;
      const current = await apiClient.pageMethods.getPage(targetPageID, opts.targetGuid, locale);
      const version = current?.properties?.versionID;
      if (version && version > (record.targetVersionID ?? 0)) mapper.updateTargetVersionID(targetPageID, version);

      const pulledTarget = mapper.getMappedEntity(record, "target");
      const sourcePage = mapper.getMappedEntity(record, "source");
      if (pulledTarget?.properties?.state === PUBLISHED_STATE && sourcePage?.properties?.state === PUBLISHED_STATE) {
        registerOtherLocaleStaging(locale, {
          targetPageID,
          pageName: current?.name || pulledTarget.name || `Page ${targetPageID}`,
          savedLocale: movedLocale,
          cause: "page move",
        });
      }
    } catch {
      // Non-fatal: the next run reads the move as a target change on this page, and says so.
    }
  }
}

/** Run the page order phase. Called by the push orchestrator after pages. */
export async function runSyncPageOrder(opts: PageOrderOptions): Promise<PusherResult> {
  const logger = getLoggerForGuid(opts.sourceGuid);
  const result: PusherResult = {
    successful: 0,
    failed: 0,
    skipped: 0,
    status: "success",
    failureDetails: [],
    warningDetails: [],
  };
  const apiClient = getApiClient();
  const hierarchy = new SitemapHierarchy();
  let planned = 0;
  // Preflight moves nothing, so a later locale reads the same target and would list the same moves.
  const previewed = new Set<string>();

  console.log(ansiColors.cyan("\n↕  Page order: checking synced pages against the source's sitemap..."));

  // A page's place is shared by all locales; each locale is checked against the target as the last
  // one left it, so a page that moved for an earlier locale isn't moved again.
  for (const locale of opts.locales) {
    const toTarget = pageMapFor(opts.sourceGuid, opts.targetGuid, locale);
    const sourceSitemaps = hierarchy.loadAllSitemaps(opts.sourceGuid, locale);
    const scope = state.pageScope?.byLocale.get(locale);
    let targetSitemaps: any[];
    try {
      targetSitemaps = (await apiClient.pageMethods.getSitemap(opts.targetGuid, locale)) || [];
    } catch (error: any) {
      result.failed++;
      result.status = "error";
      const message = error?.message || String(error);
      result.failureDetails!.push({
        name: `Sitemap [${locale}]`,
        error: `page order: couldn't read the target sitemap: ${message}`,
        type: "page",
        locale,
        guid: opts.targetGuid,
      });
      console.log(ansiColors.red(`  ✗ page order [${locale}]: couldn't read the target sitemap — ${message}`));
      continue;
    }

    for (const [channel, sourceNodes] of Object.entries(sourceSitemaps)) {
      if (!sourceNodes || sourceNodes.length === 0) continue;
      const targetChannel = targetSitemaps.find((s: any) => (s?.name || "").toLowerCase() === channel.toLowerCase());
      if (!targetChannel) continue;

      // Pages the page phase held (unless --overwrite) and pages outside a --pages scope stay put.
      const fixed = new Set<number>();
      const flatSource = flattenSitemap(sourceNodes as SitemapNode[]);
      flatSource.placement.forEach((_placement, sourcePageID) => {
        const targetID = toTarget(sourcePageID);
        if (targetID === undefined) return;
        const held = isHeldPage(sourcePageID) && !state.overwrite;
        const outOfScope = !!scope && !scope.pageIDs.has(sourcePageID);
        if (held || outOfScope) fixed.add(targetID);
      });

      const plan = planPageMoves(
        sourceNodes as unknown as TreeNode[],
        fromManagementSitemap(targetChannel.pages),
        toTarget,
        fixed
      );

      for (const parent of plan.unresolvedParents) {
        const where = parent === ROOT ? `the root of ${channel}` : `page ${parent}`;
        const message = `pages under ${where} can't all be put in the source's order: a page changed on the target since the last sync (or outside --pages) is out of order. Use --overwrite to move it too`;
        result.warningDetails!.push({
          name: `Page order [${locale}]`,
          error: message,
          type: "page",
          locale,
          guid: opts.targetGuid,
        });
        logger?.warning(`page order [${locale}]: ${message}`);
      }

      for (const move of plan.moves) {
        const key = `${move.pageID}:${move.parentPageID}:${move.placeBeforePageID}`;
        if (state.preflight && previewed.has(key)) continue;
        previewed.add(key);
        planned++;
        const label = `target page ${move.pageID} [${locale}]`;
        const where =
          (move.parentPageID > 0 ? `under page ${move.parentPageID}` : "at the root") +
          (move.placeBeforePageID > 0 ? `, before page ${move.placeBeforePageID}` : ", last");

        if (state.preflight) {
          preflightReport.record({
            phase: "Page order",
            action: "update",
            name: `Page ${move.pageID}`,
            locale,
            detail: `${move.reason === "parent" ? "move to the source's parent" : "move to the source's place"}: ${where}`,
          });
          result.successful++;
          continue;
        }

        try {
          const response: any = await apiClient.pageMethods.movePage(
            move.pageID,
            opts.targetGuid,
            locale,
            move.parentPageID,
            move.placeBeforePageID
          );
          if (response?.moved) {
            result.successful++;
            await afterMove(opts, move.pageID, locale, apiClient);
            logger?.success(`↕  Moved ${label} ${where}`);
            console.log(ansiColors.green(`  ✓ moved ${label} ${where}`));
          } else {
            result.skipped++;
            logger?.info(`${label}: already in the source's place`);
          }
        } catch (error: any) {
          result.failed++;
          result.status = "error";
          const message = error?.message || String(error);
          result.failureDetails!.push({
            name: `Page ${move.pageID}`,
            error: `page order failed: ${message}`,
            type: "page",
            locale,
            guid: opts.targetGuid,
          });
          logger?.error(`Failed to move ${label} ${where}: ${message}`);
          console.log(ansiColors.red(`  ✗ ${label}: page move failed — ${message}`));
        }
      }
    }
  }

  const verb = state.preflight ? "would be moved" : "moved";
  console.log(
    ansiColors.gray("Page order: ") +
      (result.successful > 0 ? ansiColors.green : ansiColors.gray)(`${result.successful} page(s) ${verb}, `) +
      (result.failed > 0 ? ansiColors.red : ansiColors.gray)(`${result.failed} failed`) +
      ansiColors.gray(` (${planned} out of place)\n`)
  );

  return result;
}
