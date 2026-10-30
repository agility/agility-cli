/**
 * List order (PROD-2992): put each synced content list on the target in the source's item order.
 *
 * The content save can't carry order across: an update keeps the target's own itemOrder, a new item
 * is appended when its source position is already taken, and a reorder alone in the source makes no
 * new version, so change detection never sees it. This phase runs after content (and --syncDeletes)
 * and sets the order of each list that differs through the Management API's list item-order
 * endpoint, which renumbers the staging and the live list in place, with no new versions.
 *
 * Planning is pure (planListOrders) and works from the local pulls plus the mapping files, so
 * preflight can report what would change. Only lists whose expected order differs from the target's
 * pulled order are sent; a list that gained an item this run always differs, since the new item is
 * not in the pull.
 */

import ansiColors from "ansi-colors";
import { state, getApiClient, getLoggerForGuid } from "../../core/state";
import { fileOperations } from "../../core/fileOperations";
import { GuidDataLoader } from "../pushers/guid-data-loader";
import { preflightReport } from "../preflight/preflight-report";
import { FailureDetail, PusherResult } from "../../types/sourceData";

export interface ListOrderOptions {
  sourceGuid: string;
  targetGuid: string;
  locales: string[];
}

/** The minimum of a pulled content item this phase reads. */
export interface ListItem {
  contentID: number;
  properties?: { referenceName?: string; itemOrder?: number | null; state?: number };
}

/** One list whose target order has to change. */
export interface ListOrderPlan {
  locale: string;
  sourceReferenceName: string;
  targetReferenceName: string;
  /** Target content IDs in the source's order. Target-only items are not listed; the API keeps them after these. */
  contentIDs: number[];
}

const DELETED_STATE = 3;

const lower = (value: string | undefined | null) => (value || "").toLowerCase();

/** List order as the server reads it: by itemOrder (missing last), then content ID. */
function sortByListOrder<T extends ListItem>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (a.properties?.itemOrder ?? Number.MAX_SAFE_INTEGER) - (b.properties?.itemOrder ?? Number.MAX_SAFE_INTEGER) ||
      a.contentID - b.contentID
  );
}

/** Whether every value is set and strictly increasing: otherwise the order isn't defined and the server renumbers. */
function hasDefinedOrder(sorted: ListItem[]): boolean {
  return sorted.every(
    (item, i) =>
      item.properties?.itemOrder != null &&
      (i === 0 || (item.properties.itemOrder as number) > (sorted[i - 1].properties?.itemOrder as number))
  );
}

function groupByList(items: ListItem[]): Map<string, ListItem[]> {
  const lists = new Map<string, ListItem[]>();
  for (const item of items) {
    if (!item?.contentID || item.properties?.state === DELETED_STATE) continue;
    const key = lower(item.properties?.referenceName);
    if (!key) continue;
    if (!lists.has(key)) lists.set(key, []);
    lists.get(key)!.push(item);
  }
  return lists;
}

/**
 * Work out which lists need a new order on the target, for one locale.
 *
 * @param sourceItems   every content item in the source pull for the locale (not just a scoped run's)
 * @param targetItems   every content item in the target pull for the locale
 * @param contentMap    source content ID -> target content ID, from the locale's item mappings
 * @param containerMap  source list reference name (lower case) -> target reference name, from the container mappings
 * @param scope         when set, only these source lists (lower case) are considered, e.g. a scoped run's
 */
export function planListOrders(
  locale: string,
  sourceItems: ListItem[],
  targetItems: ListItem[],
  contentMap: Map<number, number>,
  containerMap: Map<string, string>,
  scope?: Set<string>
): ListOrderPlan[] {
  const sourceLists = groupByList(sourceItems);
  const targetLists = groupByList(targetItems);
  const plans: ListOrderPlan[] = [];

  for (const [sourceKey, items] of Array.from(sourceLists.entries())) {
    if (scope && !scope.has(sourceKey)) continue;

    const targetReferenceName = containerMap.get(sourceKey);
    if (!targetReferenceName) continue;

    // Source order, mapped. Two source items mapped to one target keep the first position.
    const contentIDs: number[] = [];
    for (const item of sortByListOrder(items)) {
      const targetID = contentMap.get(item.contentID);
      if (targetID && !contentIDs.includes(targetID)) contentIDs.push(targetID);
    }
    if (contentIDs.length === 0) continue;

    // What the API would produce: the listed items, then the target's others in their current order.
    const current = sortByListOrder(targetLists.get(lower(targetReferenceName)) || []);
    const currentIDs = current.map((i) => i.contentID);
    const listed = new Set(contentIDs);
    const expected = [...contentIDs.filter((id) => currentIDs.includes(id)), ...currentIDs.filter((id) => !listed.has(id))];

    const missing = contentIDs.some((id) => !currentIDs.includes(id)); // e.g. created this run
    const differs = expected.some((id, i) => id !== currentIDs[i]);
    if (!missing && !differs && hasDefinedOrder(current)) continue;

    plans.push({ locale, sourceReferenceName: items[0].properties!.referenceName!, targetReferenceName, contentIDs });
  }

  return plans.sort((a, b) => lower(a.targetReferenceName).localeCompare(lower(b.targetReferenceName)));
}

/** source content ID -> target content ID. The last record for a source wins, as in the content mapper. */
export function contentMapFrom(records: any[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of records || []) {
    const source = Number(r?.sourceContentID);
    const target = Number(r?.targetContentID);
    if (source > 0 && target > 0) map.set(source, target);
  }
  return map;
}

/** source list reference name (lower case) -> target reference name. */
export function containerMapFrom(records: any[], targetLists: string[] = []): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of records || []) {
    if (r?.sourceReferenceName && r?.targetReferenceName) map.set(lower(r.sourceReferenceName), r.targetReferenceName);
  }
  // A list with the same reference name on both sides but no mapping record (e.g. synced before
  // container mappings were kept) still counts as the same list.
  for (const name of targetLists) {
    if (!map.has(lower(name))) map.set(lower(name), name);
  }
  return map;
}

/**
 * Run the list order phase. Called by the push orchestrator after content (and --syncDeletes).
 *
 * @param scopedContent per locale, the source content a scoped run (--pages/--containers/--models)
 *   pushed; only their lists are ordered. Omit for a full run.
 */
export async function runSyncListOrder(
  opts: ListOrderOptions,
  scopedContent?: Map<string, ListItem[]>
): Promise<PusherResult> {
  const logger = getLoggerForGuid(opts.sourceGuid);
  const result: PusherResult = { successful: 0, failed: 0, skipped: 0, status: "success", failureDetails: [], warningDetails: [] };
  const fileOps = new fileOperations(opts.targetGuid);
  const containerRecords = fileOps.getMappingFile("containers", opts.sourceGuid, opts.targetGuid, null);

  console.log(ansiColors.cyan("\n↕  List order: checking synced lists against the source's item order..."));

  const sourceLoader = new GuidDataLoader(opts.sourceGuid);
  const targetLoader = new GuidDataLoader(opts.targetGuid);
  const plans: ListOrderPlan[] = [];

  for (const locale of opts.locales) {
    const source = await sourceLoader.loadCompleteGuidEntities(locale);
    const target = await targetLoader.loadCompleteGuidEntities(locale);
    const itemRecords = fileOps.getMappingFile("item", opts.sourceGuid, opts.targetGuid, locale);
    const targetLists = Array.from(new Set((target.content || []).map((i: any) => i?.properties?.referenceName).filter(Boolean)));
    const scoped = scopedContent?.get(locale);
    const scope = scoped ? new Set(scoped.map((i) => lower(i.properties?.referenceName)).filter(Boolean)) : undefined;

    plans.push(
      ...planListOrders(
        locale,
        source.content || [],
        target.content || [],
        contentMapFrom(Array.isArray(itemRecords) ? itemRecords : []),
        containerMapFrom(Array.isArray(containerRecords) ? containerRecords : [], targetLists as string[]),
        scope
      )
    );
  }

  if (state.preflight) {
    for (const plan of plans) {
      preflightReport.record({
        phase: "List order",
        action: "update",
        name: plan.targetReferenceName,
        locale: plan.locale,
        detail: `put ${plan.contentIDs.length} item(s) in the source's order`,
      });
      result.successful++;
    }
    console.log(ansiColors.gray(`List order: ${plans.length} list(s) would be reordered\n`));
    return result;
  }

  const api = getApiClient();
  for (const plan of plans) {
    const label = `${plan.targetReferenceName} [${plan.locale}]`;
    try {
      const response: any = await api.contentMethods.setContentListItemOrder(
        plan.targetReferenceName,
        opts.targetGuid,
        plan.locale,
        plan.contentIDs,
        true
      );
      const skippedIDs: number[] = response?.skippedContentIDs || [];
      if (skippedIDs.length > 0) {
        const detail: FailureDetail = {
          name: plan.targetReferenceName,
          error: `list order: ${skippedIDs.length} mapped item(s) aren't in the target list and were left out (target IDs ${skippedIDs.join(", ")})`,
          type: "content",
          locale: plan.locale,
          guid: opts.targetGuid,
        };
        result.warningDetails!.push(detail);
        logger?.warning(`${label}: ${detail.error}`);
      }
      if ((response?.itemsUpdated ?? 0) > 0) {
        result.successful++;
        logger?.success(`↕  Reordered ${label}: ${response.itemsUpdated} item(s) moved (${(response.updatedContentIDs || []).join(", ")})`);
        console.log(ansiColors.green(`  ✓ reordered ${label}: ${response.itemsUpdated} item(s) moved`));
      } else {
        result.skipped++;
        logger?.info(`${label}: already in the source's order`);
      }
    } catch (error: any) {
      result.failed++;
      result.status = "error";
      const message = error?.message || String(error);
      result.failureDetails!.push({ name: plan.targetReferenceName, error: `list order failed: ${message}`, type: "content", locale: plan.locale, guid: opts.targetGuid });
      logger?.error(`Failed to set the order of ${label}: ${message}`);
      console.log(ansiColors.red(`  ✗ ${label}: list order failed — ${message}`));
    }
  }

  console.log(
    ansiColors.gray(`List order: `) +
      ansiColors.green(`${result.successful} reordered, `) +
      ansiColors.yellow(`${result.skipped} already in order, `) +
      (result.failed > 0 ? ansiColors.red : ansiColors.gray)(`${result.failed} failed`) +
      ansiColors.gray(` (${plans.length} list(s) differed from the source)\n`)
  );

  return result;
}
