/**
 * PROD-3399: Components that aren't on any page ("unused Components").
 *
 * When an editor removes a Component from a page, or replaces it with a new one, the Component's
 * item is not deleted. It stays in the instance, the Management API still returns it, and so the
 * CLI's source pull has it. In the Manager a Component is opened through its page, so once it is off
 * every page nobody can open it. The sync used to push these like any other item: the ones that
 * break a rule on the target (a required field added to the model later, a link to content that
 * isn't synced) were reported as sync failures, and the rest were created on the target silently.
 *
 * The sync now skips them and reports them once, as "unused, skipped", instead of as errors.
 *
 * An item counts as an unused Component when all of these hold:
 *  - its container is a live Component container (contentDefinitionTypeID 2, not deleted) that is
 *    not a dynamic page list;
 *  - no page zone the CLI pulled places it, in any pulled locale, and no page template places it
 *    (a fixed item, shared/default modules, or a whole container);
 *  - no other item that is used links to it, by ID or by its container's reference name. Links are
 *    read from the locale's whole source content, even when a scope narrows what is pushed.
 *
 * Nothing is skipped when placement can't be trusted: no page was pulled, or a page some sitemap
 * lists has no page file (an incomplete pull).
 */
import * as fs from "fs";
import * as path from "path";
import { collectContentIDReferences } from "../pushers/content-pusher/util/collect-content-id-references";
import { collectListReferenceNames } from "../pushers/content-pusher/util/collect-list-reference-names";

export const COMPONENT_CONTAINER_TYPE_ID = 2;

export const UNUSED_COMPONENT_WARNING_CODE = "unusedComponentSkipped";

/** Why the item was skipped; shared by every surface. */
export const UNUSED_COMPONENT_REASON = "unused Component: not on any page, so it was skipped";

function lower(value: any): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

/** A Component container (page module list), not a dynamic page list. */
export function isComponentContainer(container: any): boolean {
  if (!container || container.isDynamicPageList === true || container.isDeleted === true) return false;
  const typeID = container.contentDefinitionTypeID ?? container.contentDefinitionType;
  return typeID === COMPONENT_CONTAINER_TYPE_ID;
}

/** Content IDs that a page's zones place, across every zone. */
export function pageZoneContentIDs(page: any): number[] {
  const ids: number[] = [];
  const zones = page?.zones;
  if (!zones || typeof zones !== "object") return ids;
  for (const zone of Object.keys(zones)) {
    const modules = (zones as any)[zone];
    if (!Array.isArray(modules)) continue;
    for (const module of modules) {
      const item = (module as any)?.item;
      if (!item || typeof item !== "object") continue;
      const raw = item.contentid ?? item.contentID ?? item.ContentID ?? item.contentId;
      const id = typeof raw === "string" ? parseInt(raw, 10) : raw;
      if (typeof id === "number" && id > 0) ids.push(id);
    }
  }
  return ids;
}

export interface PlacedContentIDs {
  ids: Set<number>;
  /** Pages read. Zero means placement is unknown, and nothing may be treated as unused. */
  pageCount: number;
  /** Containers (contentViewID) a page template places as a whole: every item in them is used. */
  containerIDs?: Set<number>;
}

const CONTENT_ID_KEY = /^content_?id$/i;

function positiveInt(raw: any): number | undefined {
  const id = typeof raw === "string" ? parseInt(raw, 10) : raw;
  return typeof id === "number" && Number.isFinite(id) && id > 0 ? id : undefined;
}

/** Every content ID under a value, by any contentID-like key. */
function collectContentIDKeys(value: any, out: Set<number>, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 6) return;
  if (Array.isArray(value)) {
    value.forEach((v) => collectContentIDKeys(v, out, depth + 1));
    return;
  }
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (CONTENT_ID_KEY.test(key)) {
      const id = positiveInt(v);
      if (id) out.add(id);
    } else if (v && typeof v === "object") {
      collectContentIDKeys(v, out, depth + 1);
    }
  }
}

/**
 * What page templates place: a section's fixed item (publishContentItemID), the items in its shared
 * and default modules, and a section bound to a whole container (itemContainerID).
 */
export function templatePlacement(templates: any[]): { ids: Set<number>; containerIDs: Set<number> } {
  const ids = new Set<number>();
  const containerIDs = new Set<number>();
  for (const template of templates || []) {
    if (!template || template.isDeleted === true) continue;
    for (const section of template.contentSectionDefinitions || []) {
      const fixed = positiveInt(section?.publishContentItemID);
      if (fixed) ids.add(fixed);
      const container = positiveInt(section?.itemContainerID);
      if (container) containerIDs.add(container);
      collectContentIDKeys(section?.sharedModules, ids);
      collectContentIDKeys(section?.defaultModules, ids);
    }
  }
  return { ids, containerIDs };
}

/** Placement from a list of pages. */
export function placedContentIDsFromPages(pages: any[]): PlacedContentIDs {
  const ids = new Set<number>();
  let pageCount = 0;
  for (const page of pages || []) {
    if (!page) continue;
    pageCount++;
    pageZoneContentIDs(page).forEach((id) => ids.add(id));
  }
  return { ids, pageCount };
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined; // unreadable: left out (the loaders already warn about it)
  }
}

function jsonFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

/**
 * Placement from every pulled locale of one instance (`<rootPath>/<guid>/<locale>/page/*.json`) and
 * its page templates (`<rootPath>/<guid>/templates/*.json`). A Component placed only in another
 * locale's page still counts as used. Reading from disk, not the loaded pages, keeps a --pages scope
 * from making the Components of out-of-scope pages look unused. `extraPages` are used only when no
 * page file was found on disk.
 *
 * If a page some locale's sitemap lists has no page file, the pull didn't finish (a channel's run
 * failed, for instance), so placement is unknown and `pageCount` is 0: nothing may be skipped.
 */
export function loadPlacedContentIDs(rootPath: string, guid: string, extraPages: any[] = []): PlacedContentIDs {
  const base = path.join(rootPath, guid);
  const templates = templatePlacement(
    jsonFiles(path.join(base, "templates"))
      .map((f) => readJson(path.join(base, "templates", f)))
      .filter(Boolean)
  );
  const result: PlacedContentIDs = { ids: new Set(templates.ids), pageCount: 0, containerIDs: templates.containerIDs };
  let locales: string[] = [];
  try {
    locales = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    locales = [];
  }
  for (const locale of locales) {
    const pageDir = path.join(base, locale, "page");
    const files = jsonFiles(pageDir);
    const pageIDs = new Set<number>();
    for (const file of files) {
      const page = readJson(path.join(pageDir, file));
      if (!page) continue;
      result.pageCount++;
      const id = positiveInt(page.pageID);
      if (id) pageIDs.add(id);
      pageZoneContentIDs(page).forEach((cid) => result.ids.add(cid));
    }
    const sitemapDir = path.join(base, locale, "sitemap");
    for (const file of jsonFiles(sitemapDir)) {
      const sitemap = readJson(path.join(sitemapDir, file));
      if (!sitemap || typeof sitemap !== "object") continue;
      for (const key of Object.keys(sitemap)) {
        const id = positiveInt(sitemap[key]?.pageID);
        if (id && !pageIDs.has(id)) return { ids: new Set(), pageCount: 0, containerIDs: new Set() };
      }
    }
  }
  if (result.pageCount === 0) {
    const extra = placedContentIDsFromPages(extraPages);
    extra.ids.forEach((id) => result.ids.add(id));
    result.pageCount = extra.pageCount;
  }
  return result;
}

const placementCache = new Map<string, PlacedContentIDs>();

/** loadPlacedContentIDs, read once per run per instance (the sync calls it once per locale). */
export function loadPlacedContentIDsCached(rootPath: string, guid: string, extraPages: any[] = []): PlacedContentIDs {
  const key = `${rootPath}\u0000${guid}`;
  let placed = placementCache.get(key);
  if (!placed) {
    placed = loadPlacedContentIDs(rootPath, guid, extraPages);
    placementCache.set(key, placed);
  }
  return placed;
}

/**
 * The unused Components among `content` (one locale's source items, possibly narrowed by a scope).
 * `allContent` is the locale's whole source content, which links are read from; it defaults to
 * `content`. `containers` and `models` are the source instance's; models are only used to find links
 * held in companion fields.
 */
export function findUnusedComponents(input: {
  content: any[];
  containers: any[];
  placed: PlacedContentIDs;
  models?: any[];
  allContent?: any[];
}): any[] {
  const { content, containers, placed } = input;
  if (!placed || placed.pageCount === 0) return [];
  const all = input.allContent && input.allContent.length > 0 ? input.allContent : content;

  const componentContainers = new Set<string>();
  for (const container of containers || []) {
    if (!isComponentContainer(container)) continue;
    // a page template binds this whole container to a section: all of its items are used
    if (placed.containerIDs?.has(container.contentViewID)) continue;
    componentContainers.add(lower(container.referenceName));
  }
  if (componentContainers.size === 0) return [];

  const candidates = new Map<number, any>();
  for (const item of all || []) {
    const id = item?.contentID;
    if (typeof id !== "number" || placed.ids.has(id)) continue;
    if (componentContainers.has(lower(item?.properties?.referenceName))) candidates.set(id, item);
  }
  if (candidates.size === 0) return [];

  // Who links to whom. A candidate another live item links to is used; so is one a used candidate
  // links to, so this runs until nothing changes.
  const modelsByRef = new Map<string, any>();
  for (const model of input.models || []) {
    const ref = lower(model?.referenceName);
    if (ref && !modelsByRef.has(ref)) modelsByRef.set(ref, model);
  }
  const candidatesByContainer = new Map<string, number[]>();
  candidates.forEach((item, id) => {
    const ref = lower(item?.properties?.referenceName);
    candidatesByContainer.set(ref, [...(candidatesByContainer.get(ref) || []), id]);
  });
  const linksOf = (item: any): number[] => {
    const model = modelsByRef.get(lower(item?.properties?.definitionName));
    const ids = collectContentIDReferences(item?.fields || {}, model).filter((id) => candidates.has(id));
    for (const listName of collectListReferenceNames(item?.fields || {})) {
      ids.push(...(candidatesByContainer.get(lower(listName)) || []));
    }
    return ids;
  };

  const used = new Set<number>();
  const pending: number[] = [];
  const markUsed = (id: number) => {
    if (candidates.has(id) && !used.has(id)) {
      used.add(id);
      pending.push(id);
    }
  };
  for (const item of all || []) {
    if (candidates.has(item?.contentID)) continue;
    linksOf(item).forEach(markUsed);
  }
  while (pending.length > 0) {
    const id = pending.pop() as number;
    linksOf(candidates.get(id)).forEach(markUsed);
  }

  const inScope = all === content ? undefined : new Set((content || []).map((item) => item?.contentID));
  return Array.from(candidates.values()).filter(
    (item) => !used.has(item.contentID) && (!inScope || inScope.has(item.contentID))
  );
}

// ─── run report ──────────────────────────────────────────────────────────────

export interface UnusedComponentEntry {
  contentID: number;
  name: string;
  model?: string;
  locale: string;
  /** A target item an earlier sync created for it, still on the target. */
  targetID?: number;
}

export interface UnusedComponentWarningDetail {
  name: string;
  error: string;
  type: "content";
  guid?: string;
  locale?: string;
  contentID?: number;
  model?: string;
  code: typeof UNUSED_COMPONENT_WARNING_CODE;
  sourceID?: number;
  targetID?: number;
}

/** How many entries the end-of-run summary lists before pointing at the log file. */
const SUMMARY_LIST_LIMIT = 20;

/**
 * Per-run collector. Reporting only: skipped items count as skips and never affect `success` or the
 * exit code. A process-level singleton, like keptTargetChanges.
 */
class UnusedComponentsReport {
  private entries: UnusedComponentEntry[] = [];

  /** Clears the entries and the cached placement, at the start of a run. */
  reset(): void {
    this.entries = [];
    placementCache.clear();
  }

  record(entry: UnusedComponentEntry): void {
    if (this.entries.some((e) => e.contentID === entry.contentID && e.locale === entry.locale)) return;
    this.entries.push(entry);
  }

  getEntries(): UnusedComponentEntry[] {
    return [...this.entries];
  }

  hasEntries(): boolean {
    return this.entries.length > 0;
  }

  /** Entries an earlier sync already created on the target. */
  onTarget(): UnusedComponentEntry[] {
    return this.entries.filter((e) => typeof e.targetID === "number");
  }

  /** "Unused Components skipped: 12 (not on any page)" */
  headline(): string {
    return `Unused Components skipped: ${this.entries.length} (not on any page)`;
  }

  /** One console/log line for an item, when it is skipped. */
  formatLine(entry: UnusedComponentEntry): string {
    const model = entry.model ? ` (${entry.model})` : "";
    const onTarget = entry.targetID ? `; an earlier sync created it on the target as ${entry.targetID}` : "";
    return `${entry.name}${model} #${entry.contentID}: ${UNUSED_COMPONENT_REASON}${onTarget}`;
  }

  /** Lines for the end-of-run summary: headline, an explanation, then the first items. */
  renderSummaryLines(): string[] {
    if (!this.hasEntries()) return [];
    const lines = [`${this.headline()}, non-blocking:`];
    lines.push(
      "  These Components were removed from or replaced on their pages but never deleted, so the Manager can't open them.",
      "  They aren't errors. To clear them for good, delete them in the source instance."
    );
    const onTarget = this.onTarget().length;
    if (onTarget > 0) {
      lines.push(
        `  ${onTarget} of them were created on the target by an earlier sync and are still there; this sync left them alone.`
      );
    }
    const byLocale = [...this.entries].sort((a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name));
    byLocale.slice(0, SUMMARY_LIST_LIMIT).forEach((e) => {
      const model = e.model ? ` (${e.model})` : "";
      const onTargetNote = e.targetID ? `, on the target as ${e.targetID}` : "";
      lines.push(`  • [${e.locale}] ${e.name}${model} #${e.contentID}${onTargetNote}`);
    });
    if (byLocale.length > SUMMARY_LIST_LIMIT) {
      lines.push(`  …and ${byLocale.length - SUMMARY_LIST_LIMIT} more (see the log file)`);
    }
    return lines;
  }

  /** One --jsonSummary warning per skipped item. `guid` is the source. */
  toWarningDetails(sourceGuid?: string): UnusedComponentWarningDetail[] {
    return this.entries.map((e) => ({
      name: e.name,
      error: UNUSED_COMPONENT_REASON,
      type: "content",
      guid: sourceGuid,
      locale: e.locale,
      contentID: e.contentID,
      model: e.model,
      code: UNUSED_COMPONENT_WARNING_CODE,
      sourceID: e.contentID,
      targetID: e.targetID,
    }));
  }
}

export const unusedComponentsReport = new UnusedComponentsReport();
