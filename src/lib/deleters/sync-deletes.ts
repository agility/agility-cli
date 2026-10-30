/**
 * --syncDeletes: after every pusher has run, delete from the target what was deleted in the
 * source since the last sync.
 *
 * Only entities reached through a mapping record are ever considered — something created on the
 * target is never touched. For each mapping whose source entity is gone from the source pull:
 *
 *  1. confirm the source really is deleted. Content and pages are checked against the source
 *     Management API, because a full pull also leaves out unpublished items; the other kinds are
 *     pulled as complete lists every run, so absence (or isDeleted) is authoritative — except an
 *     entirely empty list, which is treated as a bad pull rather than "everything deleted";
 *  2. read the target's current state (content and pages from the API, since this run's pushes
 *     happened after the pull) and whether it was edited since the last sync — a conflict unless
 *     --overwrite;
 *  3. block the delete when anything that stays on the target still depends on it (a page's
 *     children, content placed on a page or linked from other content, a container's items, ...);
 *  4. refuse the whole delete phase when one kind would lose more than half its mapped entities
 *     (a wiped or stale cache looks exactly like that), unless --allowMassDeletes.
 *
 * Deletes run dependents-first (DELETE_ORDER). Each delete — and each mapping whose target is
 * already gone — removes its mapping record. Under --preflight the plan is reported and nothing
 * is written.
 */
import ansiColors from "ansi-colors";
import { parse } from "date-fns";
import { state, getApiClient, getLoggerForGuid } from "../../core/state";
import { fileOperations } from "../../core/fileOperations";
import { GuidDataLoader, GuidEntities } from "../pushers/guid-data-loader";
import { preflightReport } from "../preflight/preflight-report";
import { deleteUrlRedirections, MAX_URL_REDIRECTION_BATCH_SIZE } from "../pushers/url-redirection-api";
import { FailureDetail, FailureDetailType, PusherResult } from "../../types/sourceData";
import {
  CandidateFacts,
  DeleteCandidate,
  DeleteKind,
  DELETE_KIND_ELEMENT,
  DELETE_KIND_ID_FIELDS,
  DELETE_KIND_MAPPING_TYPE,
  DELETE_ORDER,
  collectFieldReferences,
  decideAction,
  describeList,
  findCandidates,
  findMassDeletes,
  indexSitemap,
  mappingPairs,
  MappingPair,
  MASS_DELETE_MAX_RATIO,
  MASS_DELETE_MIN_COUNT,
  modelFieldModelReferences,
  pageZoneContentIDs,
  pageZoneModuleNames,
  toId,
} from "./delete-plan";

const DELETED_STATE = 3;
const UNPUBLISHED_STATE = 7;
const API_CONCURRENCY = 6;
const SYSTEM_CONTAINER_NAMES = new Set([
  "agilitycssfiles",
  "agilityjavascriptfiles",
  "agilityglobalcodetemplates",
  "agilitymodulecodetemplates",
  "agilitypagecodetemplates",
]);

const PHASE_LABEL: Record<DeleteKind, string> = {
  urlRedirection: "Delete URL Redirections",
  page: "Delete Pages",
  content: "Delete Content",
  container: "Delete Containers",
  template: "Delete Templates",
  model: "Delete Models",
  asset: "Delete Assets",
  gallery: "Delete Galleries",
};

const FAILURE_TYPE: Record<DeleteKind, FailureDetailType> = {
  urlRedirection: "urlRedirection",
  page: "page",
  content: "content",
  container: "container",
  template: "template",
  model: "model",
  asset: "asset",
  gallery: "gallery",
};

export interface SyncDeletesOptions {
  sourceGuid: string;
  targetGuid: string;
  locales: string[];
  elements: string[];
}

export interface SyncDeletesResult extends PusherResult {
  candidates: DeleteCandidate[];
  massDeleteRefused: boolean;
}

interface LocaleSide {
  content: any[];
  pages: any[];
}

interface Side {
  guid: string;
  entities: GuidEntities;
  byLocale: Map<string, LocaleSide>;
  urlRedirectionsPulled: boolean;
}

/** Everything one planning pass reads, shared by the per-kind planners. */
interface PlanContext {
  opts: SyncDeletesOptions;
  source: Side;
  target: Side;
  overwrite: boolean;
  /** Mapping records per kind (and per locale for content/pages). */
  mappings: Map<string, any[]>;
  /** Target IDs mapped from a live source, per kind/locale — push keeps these in line with the source. */
  liveTargets: Map<string, Map<number, number>>;
  /** Target IDs this run will delete, per kind/locale (filled in as kinds are planned). */
  deleting: Map<string, Set<number>>;
  /** Live (post-push) target sitemap per locale; null when it could not be read. */
  targetSitemaps: Map<string, { parentOf: Map<number, number | null>; depthOf: Map<number, number> } | null>;
}

function groupKey(kind: DeleteKind, locale?: string): string {
  return locale ? `${kind}:${locale}` : kind;
}

function lower(value: any): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function errorStatus(error: any): number | undefined {
  return error?.innerError?.response?.status ?? error?.response?.status ?? error?.status;
}

function errorMessage(error: any): string {
  const data = error?.innerError?.response?.data;
  if (typeof data === "string" && data) return data;
  if (data?.message) return data.message;
  return error?.message || String(error);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── loading ─────────────────────────────────────────────────────────────────

async function loadSide(guid: string, locales: string[]): Promise<Side> {
  const loader = new GuidDataLoader(guid);
  const entities = await loader.loadCompleteGuidEntities(locales[0]);
  const byLocale = new Map<string, LocaleSide>();
  for (const locale of locales) {
    const localeEntities = locale === locales[0] ? entities : await loader.loadCompleteGuidEntities(locale);
    byLocale.set(locale, { content: localeEntities.content || [], pages: localeEntities.pages || [] });
  }
  const redirectionsFile = new fileOperations(guid, locales[0]).readJsonFile("urlredirections/urlredirections.json");
  return { guid, entities, byLocale, urlRedirectionsPulled: !!redirectionsFile };
}

function readMappings(kind: DeleteKind, opts: SyncDeletesOptions, locale?: string): any[] {
  const fileOps = new fileOperations(opts.targetGuid);
  const records = fileOps.getMappingFile(DELETE_KIND_MAPPING_TYPE[kind], opts.sourceGuid, opts.targetGuid, locale ?? null);
  return Array.isArray(records) ? records : [];
}

// ─── API reads ───────────────────────────────────────────────────────────────

/** Is a content item / page really deleted in the source, or only missing from the pull? */
async function confirmSourceDeleted(kind: "content" | "page", sourceID: number, locale: string): Promise<true | string> {
  const api = getApiClient();
  try {
    const entity =
      kind === "content"
        ? await api.contentMethods.getContentItem(sourceID, state.sourceGuid, locale)
        : await api.pageMethods.getPage(sourceID, state.sourceGuid, locale);
    const itemState = entity?.properties?.state;
    if (!entity || itemState === DELETED_STATE) return true;
    if (itemState === UNPUBLISHED_STATE) return "unpublished in the source, not deleted";
    return `still exists in the source (state ${itemState}) but is missing from the pull; re-run with --fullPull`;
  } catch (error: any) {
    if (errorStatus(error) === 404) return true;
    return `could not confirm the source delete: ${errorMessage(error)}`;
  }
}

/** The target content item / page as it is now (after this run's pushes). */
async function readTargetNow(
  kind: "content" | "page",
  targetID: number,
  locale: string
): Promise<{ exists: boolean; entity?: any; error?: string }> {
  const api = getApiClient();
  try {
    const entity =
      kind === "content"
        ? await api.contentMethods.getContentItem(targetID, state.targetGuid, locale)
        : await api.pageMethods.getPage(targetID, state.targetGuid, locale);
    if (!entity || entity?.properties?.state === DELETED_STATE) return { exists: false };
    return { exists: true, entity };
  } catch (error: any) {
    if (errorStatus(error) === 404) return { exists: false };
    return { exists: true, error: errorMessage(error) };
  }
}

// ─── planning ────────────────────────────────────────────────────────────────

function newCandidate(kind: DeleteKind, pair: MappingPair, name: string, locale?: string): DeleteCandidate {
  return { kind, locale, sourceID: pair.sourceID, targetID: pair.targetID, name, record: pair.record, action: "keep", reason: "" };
}

function apply(candidate: DeleteCandidate, facts: CandidateFacts, overwrite: boolean): DeleteCandidate {
  const { action, reason } = decideAction(facts, overwrite);
  candidate.action = action;
  candidate.reason = reason;
  return candidate;
}

/** Is this target entity going away in this run, or kept in line with a live source by the push? */
function isDeleting(ctx: PlanContext, kind: DeleteKind, targetID: number, locale?: string): boolean {
  return ctx.deleting.get(groupKey(kind, locale))?.has(targetID) === true;
}

function isLiveMapped(ctx: PlanContext, kind: DeleteKind, targetID: number, locale?: string): boolean {
  return ctx.liveTargets.get(groupKey(kind, locale))?.has(targetID) === true;
}

/** A target entity that stays after this run and is not maintained from a live source. */
function stays(ctx: PlanContext, kind: DeleteKind, targetID: number, locale?: string): boolean {
  return !isDeleting(ctx, kind, targetID, locale) && !isLiveMapped(ctx, kind, targetID, locale);
}

function recordDeleting(ctx: PlanContext, kind: DeleteKind, candidates: DeleteCandidate[], locale?: string) {
  const key = groupKey(kind, locale);
  const set = ctx.deleting.get(key) ?? new Set<number>();
  candidates.filter((c) => c.action === "delete").forEach((c) => set.add(c.targetID));
  ctx.deleting.set(key, set);
}

/**
 * Re-check blockers until nothing changes: blocking one delete can keep alive something another
 * candidate depends on (a page whose child is in conflict, content linked from a kept item).
 */
function settleBlocking(
  ctx: PlanContext,
  kind: DeleteKind,
  candidates: DeleteCandidate[],
  blockerOf: (candidate: DeleteCandidate) => string | undefined,
  locale?: string
): void {
  let changed = true;
  while (changed) {
    changed = false;
    ctx.deleting.set(groupKey(kind, locale), new Set(candidates.filter((c) => c.action === "delete").map((c) => c.targetID)));
    for (const candidate of candidates) {
      if (candidate.action !== "delete" && candidate.action !== "conflict") continue;
      const blocker = blockerOf(candidate);
      if (blocker) {
        candidate.action = "blocked";
        candidate.reason = blocker;
        changed = true;
      }
    }
  }
  recordDeleting(ctx, kind, candidates, locale);
}

function prepareKind(
  ctx: PlanContext,
  kind: DeleteKind,
  liveSourceIDs: Set<number>,
  locale?: string
): { pairs: MappingPair[]; candidates: MappingPair[] } {
  const records = readMappings(kind, ctx.opts, locale);
  ctx.mappings.set(groupKey(kind, locale), records);
  const pairs = mappingPairs(kind, records);
  const { candidates, liveTargets } = findCandidates(pairs, liveSourceIDs);
  ctx.liveTargets.set(groupKey(kind, locale), liveTargets);
  return { pairs, candidates };
}

function sharedWith(ctx: PlanContext, kind: DeleteKind, targetID: number, locale?: string): number | undefined {
  return ctx.liveTargets.get(groupKey(kind, locale))?.get(targetID);
}

async function planUrlRedirections(ctx: PlanContext): Promise<DeleteCandidate[]> {
  const live = new Set<number>((ctx.source.entities.urlRedirections || []).map((r: any) => r?.id).filter(Boolean));
  const { candidates } = prepareKind(ctx, "urlRedirection", live);
  const targetIds = new Set<number>((ctx.target.entities.urlRedirections || []).map((r: any) => r?.id));
  const emptySource = !ctx.source.urlRedirectionsPulled || live.size === 0;
  return candidates.map((pair) => {
    const candidate = newCandidate("urlRedirection", pair, pair.record?.originUrl || `redirection ${pair.targetID}`);
    return apply(
      candidate,
      {
        sourceDeleted: emptySource ? "the source URL redirection list is empty or was not pulled; not treating that as deletes" : true,
        // An unpulled target list can't prove absence; the delete endpoint reports notFound instead.
        targetExists: !ctx.target.urlRedirectionsPulled || targetIds.has(pair.targetID),
        targetChanged: false,
        sharedWithSourceID: sharedWith(ctx, "urlRedirection", pair.targetID),
      },
      ctx.overwrite
    );
  });
}

async function planPages(ctx: PlanContext, locale: string): Promise<DeleteCandidate[]> {
  const sourcePages = ctx.source.byLocale.get(locale)?.pages || [];
  const live = new Set<number>(sourcePages.map((p: any) => toId(p?.pageID)).filter(Boolean) as number[]);
  const { candidates } = prepareKind(ctx, "page", live, locale);
  if (candidates.length === 0) return [];
  const targetPagesById = new Map<number, any>();
  (ctx.target.byLocale.get(locale)?.pages || []).forEach((p: any) => targetPagesById.set(p?.pageID, p));

  const planned = await mapPool(candidates, API_CONCURRENCY, async (pair) => {
    const cached = targetPagesById.get(pair.targetID);
    const shared = sharedWith(ctx, "page", pair.targetID, locale);
    const sourceDeleted =
      live.size === 0
        ? "the source page list for this locale is empty; not treating that as deletes"
        : shared !== undefined
          ? true
          : await confirmSourceDeleted("page", pair.sourceID, locale);
    const target = sourceDeleted === true && shared === undefined ? await readTargetNow("page", pair.targetID, locale) : { exists: true };
    const entity = (target as any).entity ?? cached;
    const name = entity?.name || entity?.title || `page ${pair.targetID}`;
    const candidate = newCandidate("page", pair, name, locale);
    const targetVersion = entity?.properties?.versionID ?? 0;
    return apply(
      candidate,
      {
        sourceDeleted,
        targetExists: target.exists,
        targetChanged: targetVersion > (pair.record?.targetVersionID ?? 0),
        sharedWithSourceID: shared,
        blockedBy: (target as any).error ? `could not read the target page: ${(target as any).error}` : undefined,
      },
      ctx.overwrite
    );
  });

  const sitemap = ctx.targetSitemaps.get(locale);
  const childrenOf = new Map<number, number[]>();
  sitemap?.parentOf.forEach((parent, id) => {
    if (parent === null) return;
    const list = childrenOf.get(parent) ?? [];
    list.push(id);
    childrenOf.set(parent, list);
  });

  settleBlocking(
    ctx,
    "page",
    planned,
    (candidate) => {
      if (!sitemap) return "could not read the target sitemap to check for child pages";
      // The live sitemap reflects this run's page moves, so every child that is not itself being
      // deleted keeps the parent — mapped or not.
      const remaining = (childrenOf.get(candidate.targetID) || []).filter((id) => !isDeleting(ctx, "page", id, locale));
      if (remaining.length === 0) return undefined;
      const names = remaining.map((id) => targetPagesById.get(id)?.name || `page ${id}`);
      return `still has child pages on the target: ${describeList(names)}`;
    },
    locale
  );
  planned.forEach((c) => (c.depth = sitemap?.depthOf.get(c.targetID) ?? 0));
  return planned;
}

async function planContent(ctx: PlanContext, locale: string): Promise<DeleteCandidate[]> {
  const sourceContent = ctx.source.byLocale.get(locale)?.content || [];
  const live = new Set<number>(sourceContent.map((c: any) => toId(c?.contentID)).filter(Boolean) as number[]);
  const { candidates } = prepareKind(ctx, "content", live, locale);
  if (candidates.length === 0) return [];

  const targetContent = ctx.target.byLocale.get(locale)?.content || [];
  const targetPages = ctx.target.byLocale.get(locale)?.pages || [];
  const contentById = new Map<number, any>();
  targetContent.forEach((c: any) => contentById.set(c?.contentID, c));

  // Who points at each content item on the target: other items' fields, and page zones.
  const referencedBy = new Map<number, Array<{ kind: "content" | "page"; id: number; name: string }>>();
  const addRef = (contentID: number, ref: { kind: "content" | "page"; id: number; name: string }) => {
    const list = referencedBy.get(contentID) ?? [];
    list.push(ref);
    referencedBy.set(contentID, list);
  };
  targetContent.forEach((item: any) => {
    const name = `${item?.properties?.referenceName || "item"} #${item?.contentID}`;
    collectFieldReferences(item?.fields).contentIDs.forEach((id) => {
      if (id !== item?.contentID) addRef(id, { kind: "content", id: item.contentID, name });
    });
  });
  targetPages.forEach((page: any) => {
    pageZoneContentIDs(page).forEach((id) => addRef(id, { kind: "page", id: page.pageID, name: page?.name || `page ${page.pageID}` }));
  });

  const planned = await mapPool(candidates, API_CONCURRENCY, async (pair) => {
    const cached = contentById.get(pair.targetID);
    const shared = sharedWith(ctx, "content", pair.targetID, locale);
    const sourceDeleted =
      live.size === 0
        ? "the source content list for this locale is empty; not treating that as deletes"
        : shared !== undefined
          ? true
          : await confirmSourceDeleted("content", pair.sourceID, locale);
    const target =
      sourceDeleted === true && shared === undefined ? await readTargetNow("content", pair.targetID, locale) : { exists: true };
    const entity = (target as any).entity ?? cached;
    const name = `${entity?.properties?.referenceName || "content"} #${pair.targetID}`;
    const candidate = newCandidate("content", pair, name, locale);
    const targetVersion = entity?.properties?.versionID ?? 0;
    return apply(
      candidate,
      {
        sourceDeleted,
        targetExists: target.exists,
        targetChanged: targetVersion > (pair.record?.targetVersionID ?? 0),
        sharedWithSourceID: shared,
        blockedBy: (target as any).error ? `could not read the target item: ${(target as any).error}` : undefined,
      },
      ctx.overwrite
    );
  });

  settleBlocking(
    ctx,
    "content",
    planned,
    (candidate) => {
      const holders = (referencedBy.get(candidate.targetID) || []).filter((ref) => stays(ctx, ref.kind, ref.id, locale));
      if (holders.length === 0) return undefined;
      return `still used on the target by ${describeList(holders.map((h) => `${h.kind} ${h.name}`))}`;
    },
    locale
  );
  return planned;
}

/** Container (and other guid-level) liveness: in the pulled list and not flagged deleted. */
function liveIds(list: any[], idOf: (e: any) => any): Set<number> {
  const out = new Set<number>();
  (list || []).forEach((e) => {
    if (e?.isDeleted === true) return;
    const id = toId(idOf(e));
    if (id) out.add(id);
  });
  return out;
}

function emptyListReason(label: string): string {
  return `the source ${label} list is empty; not treating that as deletes`;
}

function changedSince(current: any, recorded: any, format?: string): boolean {
  if (!current || !recorded) return false;
  const a = format ? parse(current, format, new Date()) : new Date(current);
  const b = format ? parse(recorded, format, new Date()) : new Date(recorded);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
  return a > b;
}

function planContainers(ctx: PlanContext): DeleteCandidate[] {
  const sourceList = ctx.source.entities.containers || [];
  const live = liveIds(sourceList, (c) => c?.contentViewID);
  const { candidates } = prepareKind(ctx, "container", live);
  const targetById = new Map<number, any>();
  (ctx.target.entities.containers || []).forEach((c: any) => {
    if (c?.isDeleted !== true) targetById.set(c?.contentViewID, c);
  });

  const planned = candidates.map((pair) => {
    const target = targetById.get(pair.targetID);
    const refName = lower(target?.referenceName || pair.record?.targetReferenceName);
    const candidate = newCandidate("container", pair, target?.referenceName || pair.record?.targetReferenceName || `container ${pair.targetID}`);

    let blockedBy: string | undefined;
    if (SYSTEM_CONTAINER_NAMES.has(refName)) blockedBy = "system container";
    if (!blockedBy && target) {
      const holders: string[] = [];
      ctx.opts.locales.forEach((locale) => {
        const side = ctx.target.byLocale.get(locale);
        (side?.content || []).forEach((item: any) => {
          if (!stays(ctx, "content", item.contentID, locale)) return;
          const itemName = `content #${item.contentID} [${locale}]`;
          if (lower(item?.properties?.referenceName) === refName) holders.push(itemName);
          else if (collectFieldReferences(item?.fields).containers.has(refName)) holders.push(`${itemName} (linked list)`);
        });
        (side?.pages || []).forEach((page: any) => {
          if (lower(page?.dynamic?.referenceName) === refName && stays(ctx, "page", page.pageID, locale)) {
            holders.push(`dynamic page ${page?.name || page.pageID} [${locale}]`);
          }
        });
      });
      if (holders.length > 0) blockedBy = `still used on the target by ${describeList(holders)}`;
    }

    return apply(
      candidate,
      {
        sourceDeleted: live.size === 0 ? emptyListReason("container") : true,
        targetExists: !!target,
        targetChanged: changedSince(target?.lastModifiedDate, pair.record?.targetLastModifiedDate, "MM/dd/yyyy hh:mma"),
        sharedWithSourceID: sharedWith(ctx, "container", pair.targetID),
        blockedBy,
      },
      ctx.overwrite
    );
  });
  recordDeleting(ctx, "container", planned);
  return planned;
}

function planTemplates(ctx: PlanContext): DeleteCandidate[] {
  const live = liveIds(ctx.source.entities.templates || [], (t) => t?.pageTemplateID);
  const { candidates } = prepareKind(ctx, "template", live);
  const targetById = new Map<number, any>();
  (ctx.target.entities.templates || []).forEach((t: any) => {
    if (t?.isDeleted !== true) targetById.set(t?.pageTemplateID, t);
  });

  const planned = candidates.map((pair) => {
    const target = targetById.get(pair.targetID);
    const templateName = target?.pageTemplateName || pair.record?.targetPageTemplateName;
    const candidate = newCandidate("template", pair, templateName || `template ${pair.targetID}`);
    const holders: string[] = [];
    ctx.opts.locales.forEach((locale) => {
      (ctx.target.byLocale.get(locale)?.pages || []).forEach((page: any) => {
        if (lower(page?.templateName) === lower(templateName) && stays(ctx, "page", page.pageID, locale)) {
          holders.push(`page ${page?.name || page.pageID} [${locale}]`);
        }
      });
    });
    return apply(
      candidate,
      {
        sourceDeleted: live.size === 0 ? emptyListReason("page template") : true,
        targetExists: !!target,
        targetChanged: false,
        sharedWithSourceID: sharedWith(ctx, "template", pair.targetID),
        blockedBy: holders.length > 0 ? `still used on the target by ${describeList(holders)}` : undefined,
      },
      ctx.overwrite
    );
  });
  recordDeleting(ctx, "template", planned);
  return planned;
}

function planModels(ctx: PlanContext): DeleteCandidate[] {
  const live = liveIds(ctx.source.entities.models || [], (m) => m?.id);
  const { candidates } = prepareKind(ctx, "model", live);
  const targetModels = ctx.target.entities.models || [];
  const targetById = new Map<number, any>();
  targetModels.forEach((m: any) => targetById.set(m?.id, m));

  const planned = candidates.map((pair) => {
    const target = targetById.get(pair.targetID);
    const refName = target?.referenceName || pair.record?.targetReferenceName;
    const candidate = newCandidate("model", pair, refName || `model ${pair.targetID}`);
    return apply(
      candidate,
      {
        sourceDeleted: live.size === 0 ? emptyListReason("model") : true,
        targetExists: !!target,
        targetChanged: changedSince(target?.lastModifiedDate, pair.record?.targetLastModifiedDate),
        sharedWithSourceID: sharedWith(ctx, "model", pair.targetID),
      },
      ctx.overwrite
    );
  });

  settleBlocking(ctx, "model", planned, (candidate) => {
    const target = targetById.get(candidate.targetID);
    const refName = lower(target?.referenceName || candidate.record?.targetReferenceName);
    const holders: string[] = [];
    (ctx.target.entities.containers || []).forEach((c: any) => {
      if (c?.isDeleted === true || c?.contentDefinitionID !== candidate.targetID) return;
      if (stays(ctx, "container", c.contentViewID)) holders.push(`container ${c.referenceName}`);
    });
    ctx.opts.locales.forEach((locale) => {
      const side = ctx.target.byLocale.get(locale);
      (side?.content || []).forEach((item: any) => {
        if (lower(item?.properties?.definitionName) === refName && stays(ctx, "content", item.contentID, locale)) {
          holders.push(`content #${item.contentID} [${locale}]`);
        }
      });
      (side?.pages || []).forEach((page: any) => {
        if (pageZoneModuleNames(page).includes(refName) && stays(ctx, "page", page.pageID, locale)) {
          holders.push(`page ${page?.name || page.pageID} [${locale}]`);
        }
      });
    });
    targetModels.forEach((m: any) => {
      if (m?.id === candidate.targetID || !stays(ctx, "model", m?.id)) return;
      if (modelFieldModelReferences(m).includes(refName)) holders.push(`model ${m.referenceName}`);
    });
    return holders.length > 0 ? `still used on the target by ${describeList(holders)}` : undefined;
  });
  return planned;
}

function planAssets(ctx: PlanContext): DeleteCandidate[] {
  const isFile = (a: any) => a?.isFolder !== true;
  const live = liveIds((ctx.source.entities.assets || []).filter(isFile), (a) => a?.mediaID);
  const { candidates } = prepareKind(ctx, "asset", live);
  const targetById = new Map<number, any>();
  (ctx.target.entities.assets || []).forEach((a: any) => {
    if (a?.isDeleted !== true && isFile(a)) targetById.set(a?.mediaID, a);
  });

  // Content that stays, as one searchable string per item, built once.
  const remainingContent: Array<{ name: string; text: string }> = [];
  ctx.opts.locales.forEach((locale) => {
    (ctx.target.byLocale.get(locale)?.content || []).forEach((item: any) => {
      if (!stays(ctx, "content", item.contentID, locale)) return;
      remainingContent.push({ name: `content #${item.contentID} [${locale}]`, text: JSON.stringify(item?.fields ?? {}) });
    });
  });

  const planned = candidates.map((pair) => {
    const target = targetById.get(pair.targetID);
    const candidate = newCandidate("asset", pair, target?.fileName || pair.record?.targetUrl || `asset ${pair.targetID}`);
    let blockedBy: string | undefined;
    if (target) {
      const urls = [target.url, target.originUrl, target.edgeUrl, pair.record?.targetUrl].filter(
        (u): u is string => typeof u === "string" && u.length > 0
      );
      const holders = remainingContent.filter((c) => urls.some((u) => c.text.includes(u))).map((c) => c.name);
      if (holders.length > 0) blockedBy = `still used on the target by ${describeList(holders)}`;
    }
    return apply(
      candidate,
      {
        sourceDeleted: live.size === 0 ? emptyListReason("asset") : true,
        targetExists: !!target,
        targetChanged: changedSince(target?.dateModified, pair.record?.targetDateModified),
        sharedWithSourceID: sharedWith(ctx, "asset", pair.targetID),
        blockedBy,
      },
      ctx.overwrite
    );
  });
  recordDeleting(ctx, "asset", planned);
  return planned;
}

function planGalleries(ctx: PlanContext): DeleteCandidate[] {
  const live = liveIds(ctx.source.entities.galleries || [], (g) => g?.mediaGroupingID);
  const { candidates } = prepareKind(ctx, "gallery", live);
  const targetById = new Map<number, any>();
  (ctx.target.entities.galleries || []).forEach((g: any) => {
    if (g?.isDeleted !== true) targetById.set(g?.mediaGroupingID, g);
  });

  const planned = candidates.map((pair) => {
    const target = targetById.get(pair.targetID);
    const candidate = newCandidate("gallery", pair, target?.name || `gallery ${pair.targetID}`);
    const holders: string[] = [];
    if (target) {
      (ctx.target.entities.assets || []).forEach((a: any) => {
        if (a?.isDeleted === true || a?.mediaGroupingID !== pair.targetID) return;
        if (stays(ctx, "asset", a.mediaID)) holders.push(`asset ${a.fileName || a.mediaID}`);
      });
      ctx.opts.locales.forEach((locale) => {
        (ctx.target.byLocale.get(locale)?.content || []).forEach((item: any) => {
          if (!stays(ctx, "content", item.contentID, locale)) return;
          if (collectFieldReferences(item?.fields).galleryIDs.has(pair.targetID)) {
            holders.push(`content #${item.contentID} [${locale}]`);
          }
        });
      });
    }
    return apply(
      candidate,
      {
        sourceDeleted: live.size === 0 ? emptyListReason("gallery") : true,
        targetExists: !!target,
        targetChanged: changedSince(target?.modifiedOn, pair.record?.targetModifiedOn, "MM/dd/yyyy hh:mma"),
        sharedWithSourceID: sharedWith(ctx, "gallery", pair.targetID),
        blockedBy: holders.length > 0 ? `still used on the target by ${describeList(holders)}` : undefined,
      },
      ctx.overwrite
    );
  });
  recordDeleting(ctx, "gallery", planned);
  return planned;
}

async function loadTargetSitemaps(ctx: PlanContext): Promise<void> {
  const api = getApiClient();
  for (const locale of ctx.opts.locales) {
    try {
      const channels = await api.pageMethods.getSitemap(ctx.opts.targetGuid, locale);
      ctx.targetSitemaps.set(locale, indexSitemap(channels as any[]));
    } catch {
      ctx.targetSitemaps.set(locale, null);
    }
  }
}

/** Build the full delete plan. Exported for tests; reads the pulled caches and the mapping files. */
export async function planSyncDeletes(opts: SyncDeletesOptions): Promise<{ groups: Array<{ kind: DeleteKind; locale?: string; mapped: number; candidates: DeleteCandidate[] }> }> {
  const ctx: PlanContext = {
    opts,
    source: await loadSide(opts.sourceGuid, opts.locales),
    target: await loadSide(opts.targetGuid, opts.locales),
    overwrite: state.overwrite === true,
    mappings: new Map(),
    liveTargets: new Map(),
    deleting: new Map(),
    targetSitemaps: new Map(),
  };
  const wants = (kind: DeleteKind) => opts.elements.includes(DELETE_KIND_ELEMENT[kind]);
  const groups: Array<{ kind: DeleteKind; locale?: string; mapped: number; candidates: DeleteCandidate[] }> = [];
  const add = (kind: DeleteKind, candidates: DeleteCandidate[], locale?: string) => {
    groups.push({ kind, locale, mapped: (ctx.mappings.get(groupKey(kind, locale)) || []).length, candidates });
  };

  if (wants("page")) await loadTargetSitemaps(ctx);

  // Planned in execution order: each kind's blockers look at what the kinds before it delete.
  if (wants("urlRedirection")) add("urlRedirection", await planUrlRedirections(ctx));
  for (const locale of opts.locales) {
    if (wants("page")) add("page", await planPages(ctx, locale), locale);
  }
  for (const locale of opts.locales) {
    if (wants("content")) add("content", await planContent(ctx, locale), locale);
  }
  if (wants("container")) add("container", planContainers(ctx));
  if (wants("template")) add("template", planTemplates(ctx));
  if (wants("model")) add("model", planModels(ctx));
  if (wants("asset")) add("asset", planAssets(ctx));
  if (wants("gallery")) add("gallery", planGalleries(ctx));

  return { groups };
}

// ─── execution ───────────────────────────────────────────────────────────────

async function waitForBatch(batchID: number, guid: string): Promise<void> {
  const api = getApiClient();
  for (let attempt = 0; attempt < 150; attempt++) {
    const batch: any = await api.batchMethods.getBatch(batchID, guid, true);
    const batchState = batch?.batchState ?? batch?.BatchState;
    if (batchState === 3) {
      const errorData = batch?.errorData ?? batch?.ErrorData;
      const itemError = (batch?.items ?? batch?.Items ?? []).find((i: any) => i?.errorMessage)?.errorMessage;
      if (errorData || itemError) throw new Error(`batch ${batchID} failed: ${itemError || errorData}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`batch ${batchID} did not finish in time; check the Batches page in the Content Manager`);
}

async function deleteOne(candidate: DeleteCandidate, opts: SyncDeletesOptions): Promise<void> {
  const api = getApiClient();
  const guid = state.targetGuid;
  switch (candidate.kind) {
    case "page":
    case "content": {
      // Deleting a page can take its zone content with it, and a delete in one locale can reach
      // another: re-read right before deleting so an already-gone target counts as done.
      const now = await readTargetNow(candidate.kind, candidate.targetID, candidate.locale!);
      if (!now.exists) return;
      break;
    }
  }
  switch (candidate.kind) {
    case "page": {
      const [batchID] = await api.pageMethods.deletePage(candidate.targetID, guid, candidate.locale!, "Deleted by agility-cli --syncDeletes", true);
      await waitForBatch(batchID, guid);
      return;
    }
    case "content": {
      const [batchID] = await api.contentMethods.deleteContent(candidate.targetID, guid, candidate.locale!, "Deleted by agility-cli --syncDeletes", true);
      await waitForBatch(batchID, guid);
      return;
    }
    case "container":
      await api.containerMethods.deleteContainer(candidate.targetID, guid);
      return;
    case "template":
      await api.pageMethods.deletePageTemplate(guid, opts.locales[0], candidate.targetID);
      return;
    case "model":
      await api.modelMethods.deleteModel(candidate.targetID, guid);
      return;
    case "asset":
      await api.assetMethods.deleteFile(candidate.targetID, guid);
      return;
    case "gallery":
      await api.assetMethods.deleteGallery(guid, candidate.targetID);
      return;
    default:
      throw new Error(`unsupported delete kind ${candidate.kind}`);
  }
}

/** Execute one group's deletes; returns the candidates whose delete failed. */
async function executeGroup(candidates: DeleteCandidate[], opts: SyncDeletesOptions): Promise<Map<DeleteCandidate, string>> {
  const failures = new Map<DeleteCandidate, string>();
  const toDelete = candidates.filter((c) => c.action === "delete");
  if (toDelete.length === 0) return failures;
  const kind = toDelete[0].kind;

  if (kind === "urlRedirection") {
    for (let i = 0; i < toDelete.length; i += MAX_URL_REDIRECTION_BATCH_SIZE) {
      const chunk = toDelete.slice(i, i + MAX_URL_REDIRECTION_BATCH_SIZE);
      try {
        // notFound means it is already gone, which is the outcome we wanted.
        await deleteUrlRedirections(state.targetGuid, chunk.map((c) => c.targetID));
      } catch (error: any) {
        chunk.forEach((c) => failures.set(c, errorMessage(error)));
      }
    }
    return failures;
  }

  if (kind === "page") {
    // Children before parents: a parent is only deletable once its children are gone.
    const ordered = [...toDelete].sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
    for (const candidate of ordered) {
      try {
        await deleteOne(candidate, opts);
      } catch (error: any) {
        failures.set(candidate, errorMessage(error));
      }
    }
    return failures;
  }

  const limit = kind === "content" ? API_CONCURRENCY : 1;
  await mapPool(toDelete, limit, async (candidate) => {
    try {
      await deleteOne(candidate, opts);
    } catch (error: any) {
      failures.set(candidate, errorMessage(error));
    }
  });
  return failures;
}

/** Drop the mapping records of deleted / unmapped candidates from one kind's mapping file. */
function removeMappings(kind: DeleteKind, removed: DeleteCandidate[], opts: SyncDeletesOptions, locale?: string): void {
  if (removed.length === 0 || state.preflight) return;
  const fields = DELETE_KIND_ID_FIELDS[kind];
  const drop = new Set(removed.map((c) => `${c.sourceID}:${c.targetID}`));
  const records = readMappings(kind, opts, locale);
  const kept = records.filter((r) => !drop.has(`${toId(r?.[fields.source])}:${toId(r?.[fields.target])}`));
  if (kept.length === records.length) return;
  new fileOperations(opts.targetGuid).saveMappingFile(kept, DELETE_KIND_MAPPING_TYPE[kind], opts.sourceGuid, opts.targetGuid, locale ?? null);
}

function preflightPhase(kind: DeleteKind): string {
  return PHASE_LABEL[kind];
}

function recordPreflight(candidate: DeleteCandidate): void {
  const base = { phase: preflightPhase(candidate.kind), name: candidate.name, locale: candidate.locale, detail: candidate.reason };
  switch (candidate.action) {
    case "delete":
      preflightReport.record({ ...base, action: "delete" });
      break;
    case "conflict":
      preflightReport.record({ ...base, action: "conflict" });
      break;
    default:
      preflightReport.record({ ...base, action: "skip" });
  }
}

/**
 * Run the delete phase. Called by the push orchestrator after every pusher, only with --syncDeletes.
 */
export async function runSyncDeletes(opts: SyncDeletesOptions): Promise<SyncDeletesResult> {
  const logger = getLoggerForGuid(opts.sourceGuid);
  const result: SyncDeletesResult = {
    successful: 0,
    failed: 0,
    skipped: 0,
    status: "success",
    failureDetails: [],
    warningDetails: [],
    candidates: [],
    massDeleteRefused: false,
  };

  console.log(ansiColors.cyan("\n🗑  Sync deletes: checking for entities deleted in the source since the last sync..."));

  const { groups } = await planSyncDeletes(opts);
  result.candidates = groups.reduce<DeleteCandidate[]>((all, g) => all.concat(g.candidates), []);

  const violations = findMassDeletes(groups);
  if (violations.length > 0 && !state.allowMassDeletes) {
    result.massDeleteRefused = true;
    const lines = violations.map(
      (v) => `${PHASE_LABEL[v.kind]}${v.locale ? ` [${v.locale}]` : ""}: ${v.deletes} of ${v.mapped} mapped entities`
    );
    const message =
      `Refusing to sync deletes: more than ${Math.round(MASS_DELETE_MAX_RATIO * 100)}% (and more than ${MASS_DELETE_MIN_COUNT}) ` +
      `of the mapped entities would be deleted — ${lines.join("; ")}. This usually means a stale or partial local cache ` +
      `(re-run with --fullPull). If the deletes are intended, re-run with --allowMassDeletes.`;
    console.log(ansiColors.red(`\n❌ ${message}`));
    logger?.error(message);
    result.failed = 1;
    result.status = "error";
    result.failureDetails!.push({ name: "sync deletes", error: message });
    if (state.preflight) result.candidates.forEach(recordPreflight);
    return result;
  }

  for (const kind of DELETE_ORDER) {
    for (const group of groups.filter((g) => g.kind === kind)) {
      const { candidates, locale } = group;
      if (candidates.length === 0) continue;

      if (state.preflight) {
        candidates.forEach(recordPreflight);
        candidates.forEach((c) => (c.action === "delete" ? result.successful++ : result.skipped++));
        continue;
      }

      const failures = await executeGroup(candidates, opts);
      const removed: DeleteCandidate[] = [];

      for (const candidate of candidates) {
        const where = candidate.locale ? ` [${candidate.locale}]` : "";
        const label = `${PHASE_LABEL[kind].replace("Delete ", "").replace(/s$/, "")} ${candidate.name}${where}`;
        const failure = failures.get(candidate);
        if (candidate.action === "delete" && !failure) {
          result.successful++;
          removed.push(candidate);
          logger?.success(`🗑  Deleted ${label} (target ID ${candidate.targetID}) — ${candidate.reason}`);
          console.log(ansiColors.green(`  ✓ deleted ${label}`));
        } else if (candidate.action === "delete") {
          result.failed++;
          result.status = "error";
          result.failureDetails!.push({ name: candidate.name, error: `delete failed: ${failure}`, type: FAILURE_TYPE[kind], locale: candidate.locale, guid: opts.targetGuid });
          logger?.error(`Failed to delete ${label} (target ID ${candidate.targetID}): ${failure}`);
          console.log(ansiColors.red(`  ✗ ${label}: delete failed — ${failure}`));
        } else if (candidate.action === "unmap") {
          result.skipped++;
          removed.push(candidate);
          logger?.info(`${label}: ${candidate.reason}`);
        } else if (candidate.action === "conflict" || candidate.action === "blocked") {
          result.skipped++;
          const detail: FailureDetail = { name: candidate.name, error: `not deleted — ${candidate.reason}`, type: FAILURE_TYPE[kind], locale: candidate.locale };
          result.warningDetails!.push(detail);
          logger?.warning(`${label}: not deleted — ${candidate.reason}`);
          console.log(ansiColors.yellow(`  ⚠ ${label}: not deleted — ${candidate.reason}`));
        } else {
          result.skipped++;
          logger?.info(`${label}: ${candidate.reason}`);
        }
      }

      removeMappings(kind, removed, opts, locale);
    }
  }

  const planned = result.candidates.length;
  console.log(
    ansiColors.gray(`\nSync deletes: `) +
      ansiColors.green(`${result.successful} deleted, `) +
      ansiColors.yellow(`${result.skipped} skipped, `) +
      (result.failed > 0 ? ansiColors.red : ansiColors.gray)(`${result.failed} failed`) +
      ansiColors.gray(` (${planned} mapping(s) whose source is gone)\n`)
  );

  return result;
}
