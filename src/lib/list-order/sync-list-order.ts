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
 * pulled order are sent, and lists that gained an item this run (it isn't in the pull yet). A mapped
 * item missing from the pull that this run didn't save is a stale mapping, not a new item: it doesn't
 * make the list differ, or every run would send that list again.
 *
 * Which side reordered (PROD-3078): after each run, the mapping type `listorder` (per locale)
 * records each list's source order and the target order the run left. A list whose target order
 * differs from the source's is then decided like any other entity (see kept-target-changes.ts):
 * reordered on the source only, it's set to the source's order; on the target only, the target's
 * order is kept with a warning; on both, it's a conflict; --overwrite sets the source's order in
 * every case. A reorder is a change in the relative order of the items both the record and the
 * list have, so an item added or deleted on either side isn't one. A list with no record yet (the
 * first run after upgrading) gets the source's order, as before, and is recorded.
 */

import ansiColors from "ansi-colors";
import { state, getApiClient, getLoggerForGuid } from "../../core/state";
import { fileOperations } from "../../core/fileOperations";
import { GuidDataLoader } from "../pushers/guid-data-loader";
import { preflightReport } from "../preflight/preflight-report";
import { keptTargetChanges } from "../pushers/kept-target-changes";
import { PENDING_DETAIL, UNRECORDED_UPDATE_DETAIL } from "../shared/sync-fingerprint";
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

/**
 * A list's order as the last run left it (mapping type `listorder`, per locale). The `source*` /
 * `target*` pairs transpose for a reverse sync like every other mapping record.
 */
export interface ListOrderRecord {
  sourceGuid?: string;
  targetGuid?: string;
  sourceReferenceName: string;
  targetReferenceName: string;
  /** Source content IDs in the source's order */
  sourceContentIDs: number[];
  /** Target content IDs in the order the run left the target list */
  targetContentIDs: number[];
  /**
   * The target's order before this run reordered it, kept until a pull shows the new order. The
   * Fetch API shows an order change a while after it's made, and a pull in that window still shows
   * the old order: that isn't a reorder. A reverse sync reads it as `sourceReplacedContentIDs`.
   */
  targetReplacedContentIDs?: number[];
  sourceReplacedContentIDs?: number[];
}

export type ListOrderAction =
  | "reorder" // set the target to the source's order
  | "in-order" // nothing to send
  | "keep" // reordered on the target only: keep it and warn
  | "conflict" // reordered on both sides
  | "pending"; // a side still shows the order the last run replaced (the Fetch API hasn't caught up): wait

/** One list's decision, with the orders to record once it's settled. */
export interface ListOrderDecision extends ListOrderPlan {
  action: ListOrderAction;
  /** The list differs and has no record yet: the source's order wins, as before */
  unrecorded: boolean;
  /** --overwrite turned a keep or a conflict into a reorder */
  overwritten?: "keep" | "conflict";
  /** Source content IDs in the source's order, to record */
  sourceOrder: number[];
  /** Target content IDs in the order this run leaves them (if a reorder is sent, after it) */
  targetOrder: number[];
  /** For a reorder: the target's order it replaces */
  replacedOrder?: number[];
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

/** Whether the items both orders have appear in a different relative order. */
export function relativeOrderChanged(recorded: number[], current: number[]): boolean {
  const inRecord = new Set(recorded);
  const inCurrent = new Set(current);
  const before = recorded.filter((id) => inCurrent.has(id));
  const now = current.filter((id) => inRecord.has(id));
  return before.some((id, i) => id !== now[i]);
}

/**
 * Decide each list's order on the target, for one locale.
 *
 * @param sourceItems   every content item in the source pull for the locale (not just a scoped run's)
 * @param targetItems   every content item in the target pull for the locale
 * @param contentMap    source content ID -> target content ID, from the locale's item mappings
 * @param containerMap  source list reference name (lower case) -> target reference name, from the container mappings
 * @param scope         when set, only these source lists (lower case) are considered, e.g. a scoped run's
 * @param savedThisRun  target content IDs this run saved; a mapped item missing from the target pull
 *   only counts as new when it's one of these
 * @param records       the locale's `listorder` records from the last run
 * @param overwrite     --overwrite: the source's order wins over a target reorder
 */
export function decideListOrders(
  locale: string,
  sourceItems: ListItem[],
  targetItems: ListItem[],
  contentMap: Map<number, number>,
  containerMap: Map<string, string>,
  scope?: Set<string>,
  savedThisRun: Set<number> = new Set(),
  records: ListOrderRecord[] = [],
  overwrite = false
): ListOrderDecision[] {
  const sourceLists = groupByList(sourceItems);
  const targetLists = groupByList(targetItems);
  const recordFor = new Map(records.filter((r) => r?.sourceReferenceName).map((r) => [lower(r.sourceReferenceName), r]));
  const decisions: ListOrderDecision[] = [];

  for (const [sourceKey, items] of Array.from(sourceLists.entries())) {
    if (scope && !scope.has(sourceKey)) continue;

    const targetReferenceName = containerMap.get(sourceKey);
    if (!targetReferenceName) continue;

    // Source order, mapped. Two source items mapped to one target keep the first position.
    const sourceSorted = sortByListOrder(items);
    const contentIDs: number[] = [];
    for (const item of sourceSorted) {
      const targetID = contentMap.get(item.contentID);
      if (targetID && !contentIDs.includes(targetID)) contentIDs.push(targetID);
    }
    if (contentIDs.length === 0) continue;

    // What the API would produce: the listed items, then the target's others in their current order.
    const current = sortByListOrder(targetLists.get(lower(targetReferenceName)) || []);
    const currentIDs = current.map((i) => i.contentID);
    const listed = new Set(contentIDs);
    const others = currentIDs.filter((id) => !listed.has(id));
    const expected = [...contentIDs.filter((id) => currentIDs.includes(id)), ...others];

    const added = contentIDs.some((id) => !currentIDs.includes(id) && savedThisRun.has(id));
    const differs = expected.some((id, i) => id !== currentIDs[i]);
    const needsOrder = added || differs || !hasDefinedOrder(current);

    const sourceOrder = sourceSorted.map((i) => i.contentID);
    // After a reorder: the listed items the target has (or gains this run), then its others.
    const reordered = [...contentIDs.filter((id) => currentIDs.includes(id) || savedThisRun.has(id)), ...others];
    const base = { locale, sourceReferenceName: items[0].properties!.referenceName!, targetReferenceName, contentIDs, sourceOrder };

    if (!needsOrder) {
      decisions.push({ ...base, action: "in-order", unrecorded: false, targetOrder: currentIDs });
      continue;
    }

    const record = recordFor.get(sourceKey);
    if (!record || !Array.isArray(record.sourceContentIDs) || !Array.isArray(record.targetContentIDs)) {
      decisions.push({ ...base, action: "reorder", unrecorded: true, targetOrder: reordered, replacedOrder: currentIDs });
      continue;
    }

    // A side still in the order the last run replaced was pulled before the reorder reached the
    // Fetch API: not a reorder. Syncing from a source in that state would put the old order back.
    const moved = (recorded: number[], replaced: number[] | undefined, current: number[]) => {
      if (!relativeOrderChanged(recorded, current)) return "same";
      if (Array.isArray(replaced) && !relativeOrderChanged(replaced, current)) return "pending";
      return "moved";
    };
    const source = moved(record.sourceContentIDs, record.sourceReplacedContentIDs, sourceOrder);
    const target = moved(record.targetContentIDs, record.targetReplacedContentIDs, currentIDs);
    const verdict: ListOrderAction =
      target === "moved"
        ? source === "moved"
          ? "conflict"
          : "keep"
        : source === "moved"
          ? "reorder"
          : source === "pending" || target === "pending"
            ? "pending"
            : "reorder";

    if (verdict === "reorder" || ((verdict === "keep" || verdict === "conflict") && overwrite)) {
      decisions.push({
        ...base,
        action: "reorder",
        unrecorded: false,
        ...(verdict !== "reorder" ? { overwritten: verdict as "keep" | "conflict" } : {}),
        targetOrder: reordered,
        replacedOrder: currentIDs,
      });
    } else {
      decisions.push({ ...base, action: verdict, unrecorded: false, targetOrder: currentIDs });
    }
  }

  return decisions.sort((a, b) => lower(a.targetReferenceName).localeCompare(lower(b.targetReferenceName)));
}

/**
 * Work out which lists need a new order on the target, for one locale, with no record of the last
 * run: every list whose target order differs from the source's. See decideListOrders.
 */
export function planListOrders(
  locale: string,
  sourceItems: ListItem[],
  targetItems: ListItem[],
  contentMap: Map<number, number>,
  containerMap: Map<string, string>,
  scope?: Set<string>,
  savedThisRun: Set<number> = new Set()
): ListOrderPlan[] {
  return decideListOrders(locale, sourceItems, targetItems, contentMap, containerMap, scope, savedThisRun)
    .filter((d) => d.action === "reorder")
    .map(({ locale, sourceReferenceName, targetReferenceName, contentIDs }) => ({
      locale,
      sourceReferenceName,
      targetReferenceName,
      contentIDs,
    }));
}

/** The record to store for a settled list; `replaced` is the target order a reorder replaced. */
function toRecord(opts: ListOrderOptions, d: ListOrderDecision, targetOrder: number[], replaced?: number[]): ListOrderRecord {
  return {
    sourceGuid: opts.sourceGuid,
    targetGuid: opts.targetGuid,
    sourceReferenceName: d.sourceReferenceName,
    targetReferenceName: d.targetReferenceName,
    sourceContentIDs: d.sourceOrder,
    targetContentIDs: targetOrder,
    ...(replaced ? { targetReplacedContentIDs: replaced } : {}),
  };
}

const sameOrder = (a: number[] | undefined, b: number[]) =>
  Array.isArray(a) && a.length === b.length && a.every((id, i) => id === b[i]);

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
 * @param savedContentIDs per locale, the target content IDs this run saved.
 */
export async function runSyncListOrder(
  opts: ListOrderOptions,
  scopedContent?: Map<string, ListItem[]>,
  savedContentIDs?: Map<string, number[]>
): Promise<PusherResult> {
  const logger = getLoggerForGuid(opts.sourceGuid);
  const result: PusherResult = { successful: 0, failed: 0, skipped: 0, status: "success", failureDetails: [], warningDetails: [] };
  const fileOps = new fileOperations(opts.targetGuid);
  const containerRecords = fileOps.getMappingFile("containers", opts.sourceGuid, opts.targetGuid, null);

  console.log(ansiColors.cyan("\n↕  List order: checking synced lists against the source's item order..."));

  const sourceLoader = new GuidDataLoader(opts.sourceGuid);
  const targetLoader = new GuidDataLoader(opts.targetGuid);
  const decisions: ListOrderDecision[] = [];
  const recordsByLocale = new Map<string, ListOrderRecord[]>();

  for (const locale of opts.locales) {
    const source = await sourceLoader.loadCompleteGuidEntities(locale);
    const target = await targetLoader.loadCompleteGuidEntities(locale);
    const itemRecords = fileOps.getMappingFile("item", opts.sourceGuid, opts.targetGuid, locale);
    const orderRecords = fileOps.getMappingFile("listorder", opts.sourceGuid, opts.targetGuid, locale);
    const records: ListOrderRecord[] = Array.isArray(orderRecords) ? orderRecords : [];
    recordsByLocale.set(locale, records);
    const targetLists = Array.from(new Set((target.content || []).map((i: any) => i?.properties?.referenceName).filter(Boolean)));
    const scoped = scopedContent?.get(locale);
    const scope = scoped ? new Set(scoped.map((i) => lower(i.properties?.referenceName)).filter(Boolean)) : undefined;

    decisions.push(
      ...decideListOrders(
        locale,
        source.content || [],
        target.content || [],
        contentMapFrom(Array.isArray(itemRecords) ? itemRecords : []),
        containerMapFrom(Array.isArray(containerRecords) ? containerRecords : [], targetLists as string[]),
        scope,
        new Set(savedContentIDs?.get(locale) || []),
        records,
        !!state.overwrite
      )
    );
  }

  // Settled lists' orders, written to the locale's `listorder` records at the end (not in preflight).
  const settled = new Map<string, ListOrderRecord[]>();
  const settle = (d: ListOrderDecision, targetOrder: number[], replaced?: number[]) => {
    const existing = recordsByLocale.get(d.locale)?.find((r) => lower(r.sourceReferenceName) === lower(d.sourceReferenceName));
    if (
      existing &&
      !replaced &&
      !existing.targetReplacedContentIDs &&
      !existing.sourceReplacedContentIDs &&
      sameOrder(existing.sourceContentIDs, d.sourceOrder) &&
      sameOrder(existing.targetContentIDs, targetOrder)
    ) {
      return;
    }
    if (!settled.has(d.locale)) settled.set(d.locale, []);
    settled.get(d.locale)!.push(toRecord(opts, d, targetOrder, replaced));
  };

  const plans = decisions.filter((d) => d.action === "reorder");
  const label = (d: ListOrderDecision) => `${d.targetReferenceName} [${d.locale}]`;

  // Lists left as they are: already in order (recorded), kept target reorders and conflicts (not recorded).
  for (const d of decisions) {
    if (d.action === "in-order") {
      settle(d, d.targetOrder);
    } else if (d.action === "keep") {
      const change = { type: "listOrder" as const, name: d.targetReferenceName, locale: d.locale };
      keptTargetChanges.record(change);
      console.warn(ansiColors.yellow(keptTargetChanges.formatLine(change)));
      logger?.warning(`${label(d)}: reordered on the target since the last sync and not on the source; kept the target's order`);
      preflightReport.record({
        phase: "List order",
        action: "skip",
        name: d.targetReferenceName,
        locale: d.locale,
        detail: "reordered on the target since the last sync and the source didn't; kept the target's order",
      });
      result.skipped++;
    } else if (d.action === "pending") {
      logger?.info(`${label(d)}: ${PENDING_DETAIL}`);
      preflightReport.record({ phase: "List order", action: "skip", name: d.targetReferenceName, locale: d.locale, detail: PENDING_DETAIL });
      result.skipped++;
    } else if (d.action === "conflict") {
      const reason = "reordered on both the source and the target since the last sync; use --overwrite to set the source's order";
      console.warn(ansiColors.yellow(`⚠️  Conflict detected List order ${label(d)} — ${reason}`));
      logger?.warning(`${label(d)}: conflict: ${reason}`);
      preflightReport.record({
        phase: "List order",
        action: "conflict",
        name: d.targetReferenceName,
        locale: d.locale,
        detail: "reordered on both sides; use --overwrite to force",
      });
      result.skipped++;
    }
  }

  if (state.preflight) {
    for (const plan of plans) {
      const why = plan.unrecorded
        ? `; ${UNRECORDED_UPDATE_DETAIL}`
        : plan.overwritten === "keep"
          ? "; target reorder overwritten"
          : plan.overwritten === "conflict"
            ? "; conflict overwritten"
            : "";
      preflightReport.record({
        phase: "List order",
        action: "update",
        name: plan.targetReferenceName,
        locale: plan.locale,
        detail: `put ${plan.contentIDs.length} item(s) in the source's order${why}`,
      });
      result.successful++;
    }
    console.log(ansiColors.gray(`List order: ${plans.length} list(s) would be reordered\n`));
    return result;
  }

  const api = getApiClient();
  for (const plan of plans) {
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
        logger?.warning(`${label(plan)}: ${detail.error}`);
      }
      // Until the Fetch API shows the new order, a pull shows the one it replaced: not a reorder.
      const changed = (response?.itemsUpdated ?? 0) > 0;
      settle(plan, plan.targetOrder.filter((id) => !skippedIDs.includes(id)), changed ? plan.replacedOrder : undefined);
      if ((response?.itemsUpdated ?? 0) > 0) {
        result.successful++;
        logger?.success(`↕  Reordered ${label(plan)}: ${response.itemsUpdated} item(s) moved (${(response.updatedContentIDs || []).join(", ")})`);
        console.log(ansiColors.green(`  ✓ reordered ${label(plan)}: ${response.itemsUpdated} item(s) moved`));
      } else {
        result.skipped++;
        logger?.info(`${label(plan)}: already in the source's order`);
      }
    } catch (error: any) {
      result.failed++;
      result.status = "error";
      const message = error?.message || String(error);
      result.failureDetails!.push({ name: plan.targetReferenceName, error: `list order failed: ${message}`, type: "content", locale: plan.locale, guid: opts.targetGuid });
      logger?.error(`Failed to set the order of ${label(plan)}: ${message}`);
      console.log(ansiColors.red(`  ✗ ${label(plan)}: list order failed — ${message}`));
    }
  }

  // Merge the settled lists into each locale's records: replace by source list, keep the rest.
  for (const [locale, updates] of Array.from(settled.entries())) {
    const updated = new Set(updates.map((r) => lower(r.sourceReferenceName)));
    const kept = (recordsByLocale.get(locale) || []).filter((r) => !updated.has(lower(r.sourceReferenceName)));
    fileOps.saveMappingFile([...kept, ...updates], "listorder", opts.sourceGuid, opts.targetGuid, locale);
  }

  const leftAlone = decisions.filter((d) => d.action === "keep" || d.action === "conflict").length;
  const pending = decisions.filter((d) => d.action === "pending").length;
  console.log(
    ansiColors.gray(`List order: `) +
      ansiColors.green(`${result.successful} reordered, `) +
      ansiColors.yellow(`${result.skipped - leftAlone - pending} already in order, `) +
      (pending > 0 ? ansiColors.gray(`${pending} waiting for the Fetch API, `) : "") +
      (leftAlone > 0 ? ansiColors.yellow(`${leftAlone} target order(s) kept or in conflict, `) : "") +
      (result.failed > 0 ? ansiColors.red : ansiColors.gray)(`${result.failed} failed`) +
      ansiColors.gray(` (${plans.length} list(s) differed from the source)\n`)
  );

  return result;
}
