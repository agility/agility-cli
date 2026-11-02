/**
 * --syncDeletes: decide what happens to each target entity whose source counterpart is gone.
 *
 * A candidate is a mapping record whose source entity is no longer in the source pull. Whether it
 * is actually deleted on the target is decided here from facts the caller gathers (is the source
 * really deleted, is the target still there, did someone edit it since the last sync, does
 * anything that stays depend on it). Everything in this file is pure so the rules can be tested
 * without an instance; sync-deletes.ts does the reading and the API calls.
 */

export type DeleteKind =
  | "urlRedirection"
  | "page"
  | "content"
  | "container"
  | "template"
  | "model"
  | "asset"
  | "gallery";

/** Execution order: dependents before the things they depend on. */
export const DELETE_ORDER: DeleteKind[] = [
  "urlRedirection",
  "page",
  "content",
  "container",
  "template",
  "model",
  "asset",
  "gallery",
];

/** --elements name for each kind. A kind is only considered when its element is in the run. */
export const DELETE_KIND_ELEMENT: Record<DeleteKind, string> = {
  urlRedirection: "UrlRedirections",
  page: "Pages",
  content: "Content",
  container: "Containers",
  template: "Templates",
  model: "Models",
  asset: "Assets",
  gallery: "Galleries",
};

/** Mapping folder for each kind (content and pages are per-locale). */
export const DELETE_KIND_MAPPING_TYPE: Record<DeleteKind, string> = {
  urlRedirection: "urlredirections",
  page: "page",
  content: "item",
  container: "containers",
  template: "templates",
  model: "models",
  asset: "assets",
  gallery: "galleries",
};

/** Source/target ID fields of each kind's mapping records. */
export const DELETE_KIND_ID_FIELDS: Record<DeleteKind, { source: string; target: string }> = {
  urlRedirection: { source: "sourceUrlRedirectionID", target: "targetUrlRedirectionID" },
  page: { source: "sourcePageID", target: "targetPageID" },
  content: { source: "sourceContentID", target: "targetContentID" },
  container: { source: "sourceContentViewID", target: "targetContentViewID" },
  template: { source: "sourcePageTemplateID", target: "targetPageTemplateID" },
  model: { source: "sourceID", target: "targetID" },
  asset: { source: "sourceMediaID", target: "targetMediaID" },
  gallery: { source: "sourceMediaGroupingID", target: "targetMediaGroupingID" },
};

export type DeleteAction =
  /** Delete the target entity and drop its mapping. */
  | "delete"
  /** The target was edited since the last sync; needs --overwrite. */
  | "conflict"
  /** Something that is not being deleted still depends on the target entity. */
  | "blocked"
  /** Nothing to delete (target already gone, or still owned by a live source); drop the mapping. */
  | "unmap"
  /** The source is not confirmed deleted (e.g. only unpublished); leave everything as it is. */
  | "keep";

export interface DeleteCandidate {
  kind: DeleteKind;
  locale?: string;
  sourceID: number;
  targetID: number;
  name: string;
  /** The mapping record this candidate came from, removed again on delete/unmap. */
  record: any;
  action: DeleteAction;
  reason: string;
  /** Pages: depth in the target sitemap, so children are deleted before their parents. */
  depth?: number;
}

/** What the caller found out about one candidate. */
export interface CandidateFacts {
  /** true = confirmed deleted; a string = not confirmed, with the reason. */
  sourceDeleted: true | string;
  targetExists: boolean;
  targetChanged: boolean;
  /** A live source entity that maps onto the same target. */
  sharedWithSourceID?: number;
  /** Why the target cannot be deleted (what still depends on it). */
  blockedBy?: string;
}

export function decideAction(facts: CandidateFacts, overwrite: boolean): { action: DeleteAction; reason: string } {
  if (facts.sourceDeleted !== true) {
    return { action: "keep", reason: facts.sourceDeleted };
  }
  if (facts.sharedWithSourceID !== undefined) {
    return {
      action: "unmap",
      reason: `target is also mapped from live source ID ${facts.sharedWithSourceID}; removing the stale mapping only`,
    };
  }
  if (!facts.targetExists) {
    return { action: "unmap", reason: "already gone on the target; removing the mapping" };
  }
  if (facts.blockedBy) {
    return { action: "blocked", reason: facts.blockedBy };
  }
  if (facts.targetChanged && !overwrite) {
    return {
      action: "conflict",
      reason: "deleted in the source, but the target was changed since the last sync; use --overwrite to delete it",
    };
  }
  return {
    action: "delete",
    reason: facts.targetChanged
      ? "deleted in the source (target changes discarded by --overwrite)"
      : "deleted in the source",
  };
}

export interface MappingPair {
  sourceID: number;
  targetID: number;
  record: any;
}

/** Usable (sourceID, targetID) pairs from a kind's mapping records. */
export function mappingPairs(kind: DeleteKind, records: any[]): MappingPair[] {
  const fields = DELETE_KIND_ID_FIELDS[kind];
  const out: MappingPair[] = [];
  (records || []).forEach((record) => {
    const sourceID = toId(record?.[fields.source]);
    const targetID = toId(record?.[fields.target]);
    if (sourceID === undefined || targetID === undefined) return;
    out.push({ sourceID, targetID, record });
  });
  return out;
}

/**
 * Split a kind's mappings into the records whose source is gone (candidates) and the set of
 * target IDs still owned by a live source. A target owned by a live source is never deleted.
 */
export function findCandidates(
  pairs: MappingPair[],
  liveSourceIDs: Set<number>
): { candidates: MappingPair[]; liveTargets: Map<number, number> } {
  const candidates: MappingPair[] = [];
  const liveTargets = new Map<number, number>();
  pairs.forEach((pair) => {
    if (liveSourceIDs.has(pair.sourceID)) {
      if (!liveTargets.has(pair.targetID)) liveTargets.set(pair.targetID, pair.sourceID);
    } else {
      candidates.push(pair);
    }
  });
  return { candidates, liveTargets };
}

/**
 * Mass-delete guard. A cache that was wiped, copied from another instance or only partly pulled
 * looks exactly like a source that deleted everything. Refuse when a single kind (per locale)
 * would lose more than `maxRatio` of its mapped entities and more than `minCount` of them.
 */
export const MASS_DELETE_MIN_COUNT = 10;
export const MASS_DELETE_MAX_RATIO = 0.5;

export interface MassDeleteViolation {
  kind: DeleteKind;
  locale?: string;
  deletes: number;
  mapped: number;
}

export function findMassDeletes(
  groups: Array<{ kind: DeleteKind; locale?: string; mapped: number; candidates: DeleteCandidate[] }>,
  minCount = MASS_DELETE_MIN_COUNT,
  maxRatio = MASS_DELETE_MAX_RATIO
): MassDeleteViolation[] {
  const out: MassDeleteViolation[] = [];
  groups.forEach(({ kind, locale, mapped, candidates }) => {
    const deletes = candidates.filter((c) => c.action === "delete").length;
    if (deletes > minCount && mapped > 0 && deletes / mapped > maxRatio) {
      out.push({ kind, locale, deletes, mapped });
    }
  });
  return out;
}

// ─── reference scanning ─────────────────────────────────────────────────────

export interface FieldReferences {
  contentIDs: Set<number>;
  /** Lower-cased container reference names (linked lists). */
  containers: Set<string>;
  galleryIDs: Set<number>;
}

/**
 * Every content item, container and gallery a content item's fields point at, in any of the
 * shapes the sync reads ({contentid}, {sortids}, {referencename}, {galleryid}, and the scalar
 * "123" / "1,2,3" form a dropdown or checkbox list value field stores). Over-reporting only ever
 * blocks a delete, so the scalar form is matched loosely.
 */
export function collectFieldReferences(fields: any): FieldReferences {
  const refs: FieldReferences = { contentIDs: new Set(), containers: new Set(), galleryIDs: new Set() };
  const visit = (value: any) => {
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      if (/^\s*\d+(\s*,\s*\d+)*\s*$/.test(value)) parseIdList(value).forEach((id) => refs.contentIDs.add(id));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    Object.keys(value).forEach((key) => {
      const lowered = key.toLowerCase();
      const v = value[key];
      if (lowered === "contentid" || lowered === "sortids") {
        parseIdList(v).forEach((id) => refs.contentIDs.add(id));
      } else if (lowered === "referencename" && typeof v === "string" && v) {
        refs.containers.add(v.toLowerCase());
      } else if (lowered === "galleryid") {
        parseIdList(v).forEach((id) => refs.galleryIDs.add(id));
      } else {
        visit(v);
      }
    });
  };
  visit(fields);
  return refs;
}

export function parseIdList(value: any): number[] {
  if (typeof value === "number") return value > 0 ? [value] : [];
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function toId(value: any): number | undefined {
  const n = typeof value === "string" ? parseInt(value, 10) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Content IDs placed as modules in a page's zones. */
export function pageZoneContentIDs(page: any): number[] {
  const out: number[] = [];
  const zones = page?.zones;
  if (!zones || typeof zones !== "object") return out;
  Object.keys(zones).forEach((zone) => {
    const modules = zones[zone];
    if (!Array.isArray(modules)) return;
    modules.forEach((module) => {
      const item = module?.item;
      const id = toId(item?.contentid ?? item?.contentID ?? item?.ContentID);
      if (id) out.push(id);
    });
  });
  return out;
}

/** Lower-cased model reference names of the modules placed in a page's zones. */
export function pageZoneModuleNames(page: any): string[] {
  const out: string[] = [];
  const zones = page?.zones;
  if (!zones || typeof zones !== "object") return out;
  Object.keys(zones).forEach((zone) => {
    const modules = zones[zone];
    if (!Array.isArray(modules)) return;
    modules.forEach((module) => {
      if (typeof module?.module === "string" && module.module) out.push(module.module.toLowerCase());
    });
  });
  return out;
}

/** Lower-cased model reference names a model's fields link to (Content / linked-list fields). */
export function modelFieldModelReferences(model: any): string[] {
  const out: string[] = [];
  (model?.fields || []).forEach((field: any) => {
    const settings = field?.settings || {};
    Object.keys(settings).forEach((key) => {
      if (key.toLowerCase() !== "contentdefinition") return;
      const v = settings[key];
      if (typeof v === "string" && v) out.push(v.toLowerCase());
    });
  });
  return out;
}

/** "a, b and 3 more" for blocker messages. */
export function describeList(names: string[], max = 3): string {
  const unique = Array.from(new Set(names));
  if (unique.length <= max) return unique.join(", ");
  return `${unique.slice(0, max).join(", ")} and ${unique.length - max} more`;
}

/** Flatten a sitemap's page tree into parent links and depths. */
export function indexSitemap(channels: any[]): { parentOf: Map<number, number | null>; depthOf: Map<number, number> } {
  const parentOf = new Map<number, number | null>();
  const depthOf = new Map<number, number>();
  const walk = (nodes: any[], parent: number | null, depth: number) => {
    (nodes || []).forEach((node) => {
      const id = toId(node?.pageID);
      if (id === undefined) return;
      parentOf.set(id, parent);
      depthOf.set(id, depth);
      walk(node?.childPages || [], id, depth + 1);
    });
  };
  (channels || []).forEach((channel) => walk(channel?.pages || [], null, 0));
  return { parentOf, depthOf };
}
