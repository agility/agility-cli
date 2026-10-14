/**
 * Mapping integrity (PROD-2552): does every source entity have a live counterpart on the target,
 * and does every target entity trace back to a live source?
 *
 *  - unmapped          (failure)  a source entity with no mapping record
 *  - danglingMapping   (failure)  a mapping record whose target entity is not on the target
 *  - duplicateTarget   (failure)  two live source entities mapped onto one target entity
 *  - extraInTarget     (warning)  a target entity no mapping points at
 *  - sourceNotInPull   (warning)  a target entity whose mapped source is absent from the source
 *                                 pull (deleted or unpublished there since the sync)
 *
 * A source entity that cannot be migrated as-is (see isContentSourceDefect) is reported with
 * severity sourceDefect instead of failure. Entities that pass are returned as comparable pairs
 * for the per-type checks; this check only tallies checked / missing / extra / known.
 */
import { BiMap } from "./mapping-index";
import { EntityKind, FindingCollector, INSTANCE_LOCALE, Severity } from "./verify-report";
import { VerifyContext } from "./verify-context";
import { validateContentItemAgainstModel } from "../pushers/content-pusher/util/validate-required-fields";

export interface ComparablePair {
  sourceID: number;
  targetID: number;
  source: any;
  target: any;
}

export interface IntegritySet {
  entity: EntityKind;
  locale: string;
  source: Map<number, any>;
  target: Map<number, any>;
  map: BiMap<number>;
  name: (entity: any) => string | undefined;
  /** When false (scoped runs), target-side completeness is not checked. */
  checkExtra: boolean;
  /** Returns a reason when a source entity's absence on the target is explained by the source. */
  sourceDefect?: (source: any) => string | undefined;
}

export function checkIntegrity(set: IntegritySet, collector: FindingCollector): ComparablePair[] {
  const pairs: ComparablePair[] = [];
  const { entity, locale } = set;

  set.source.forEach((source, sourceID) => {
    collector.count(locale, entity, "checked");
    const targetID = set.map.target(sourceID);
    const defect = targetID !== undefined && set.target.has(targetID) ? undefined : set.sourceDefect?.(source);
    const severity: Severity = defect ? "sourceDefect" : "failure";

    if (targetID === undefined) {
      collector.count(locale, entity, defect ? "known" : "missing");
      collector.add({
        category: "unmapped",
        severity,
        entity,
        locale,
        sourceID,
        targetID: null,
        name: set.name(source),
        message: defect ? `No mapping — ${defect}` : "Source entity has no mapping to the target",
      });
      return;
    }

    if (!set.target.has(targetID)) {
      collector.count(locale, entity, defect ? "known" : "missing");
      collector.add({
        category: "danglingMapping",
        severity,
        entity,
        locale,
        sourceID,
        targetID,
        name: set.name(source),
        message: defect
          ? `Mapped target is missing — ${defect}`
          : "Mapping points at a target entity that is not on the target (deleted or unpublished)",
      });
      return;
    }

    pairs.push({ sourceID, targetID, source, target: set.target.get(targetID) });
  });

  set.map.duplicateTargets().forEach(({ target, sources }) => {
    const live = sources.filter((s) => set.source.has(s));
    if (live.length < 2) return;
    collector.add({
      category: "duplicateTarget",
      severity: "failure",
      entity,
      locale,
      sourceID: live.join(","),
      targetID: target,
      name: set.target.has(target) ? set.name(set.target.get(target)) : undefined,
      expected: "one source per target",
      actual: live,
      message: `${live.length} source entities are mapped onto the same target entity`,
    });
  });

  if (set.checkExtra) {
    set.target.forEach((target, targetID) => {
      const sources = set.map.sources(targetID);
      if (sources.length === 0) {
        collector.count(locale, entity, "extra");
        collector.add({
          category: "extraInTarget",
          severity: "warning",
          entity,
          locale,
          sourceID: null,
          targetID,
          name: set.name(target),
          message: "Target entity is not mapped from any source entity",
        });
      } else if (!sources.some((s) => set.source.has(s))) {
        collector.count(locale, entity, "extra");
        collector.add({
          category: "sourceNotInPull",
          severity: "warning",
          entity,
          locale,
          sourceID: sources.join(","),
          targetID,
          name: set.name(target),
          message: "Mapped source entity is not in the source pull (deleted or unpublished in the source)",
        });
      }
    });
  }

  return pairs;
}

/**
 * Why a source content item cannot be migrated as-is, if it can't: a required scalar field with no
 * value, which the target's Management API rejects on save.
 */
export function contentSourceDefect(item: any, sourceModelsByRef: Map<string, any>): string | undefined {
  const model = sourceModelsByRef.get(String(item?.properties?.definitionName || "").toLowerCase());
  const { missing } = validateContentItemAgainstModel(item?.fields, model);
  if (missing.length === 0) return undefined;
  return `source item is missing required field(s): ${missing.map((m) => `${m.name} (${m.type})`).join(", ")}`;
}

function idMap<T>(items: T[], key: (item: T) => any): Map<number, T> {
  const out = new Map<number, T>();
  items.forEach((item) => {
    const id = key(item);
    if (typeof id === "number" && id > 0 && !out.has(id)) out.set(id, item);
  });
  return out;
}

export interface InstanceIntegrityResult {
  models: ComparablePair[];
  containers: ComparablePair[];
  templates: ComparablePair[];
  assets: ComparablePair[];
  galleries: ComparablePair[];
}

/** Models, containers, templates, assets and galleries — instance-wide, checked once per run. */
export function checkInstanceIntegrity(ctx: VerifyContext, collector: FindingCollector): InstanceIntegrityResult {
  const s = ctx.source.entities;
  const t = ctx.target.entities;
  const checkExtra = !ctx.scoped;
  const locale = INSTANCE_LOCALE;
  return {
    models: checkIntegrity(
      {
        entity: "model",
        locale,
        source: idMap(s.models, (m: any) => m.id),
        target: idMap(t.models, (m: any) => m.id),
        map: ctx.mappings.models,
        name: (m) => m?.referenceName,
        checkExtra,
      },
      collector
    ),
    containers: checkIntegrity(
      {
        entity: "container",
        locale,
        source: idMap(s.containers, (c: any) => c.contentViewID),
        target: idMap(t.containers, (c: any) => c.contentViewID),
        map: ctx.mappings.containers,
        name: (c) => c?.referenceName,
        checkExtra,
      },
      collector
    ),
    templates: checkIntegrity(
      {
        entity: "template",
        locale,
        source: idMap(s.templates, (x: any) => x.pageTemplateID),
        target: idMap(t.templates, (x: any) => x.pageTemplateID),
        map: ctx.mappings.templates,
        name: (x) => x?.pageTemplateName,
        checkExtra,
      },
      collector
    ),
    assets: checkIntegrity(
      {
        entity: "asset",
        locale,
        source: idMap(s.assets, (a: any) => a.mediaID),
        target: idMap(t.assets, (a: any) => a.mediaID),
        map: ctx.mappings.assets,
        name: (a) => a?.originKey || a?.fileName,
        checkExtra,
      },
      collector
    ),
    galleries: checkIntegrity(
      {
        entity: "gallery",
        locale,
        source: idMap(s.galleries, (g: any) => g.mediaGroupingID),
        target: idMap(t.galleries, (g: any) => g.mediaGroupingID),
        map: ctx.mappings.galleries,
        name: (g) => g?.name,
        checkExtra,
      },
      collector
    ),
  };
}

export interface LocaleIntegrityResult {
  content: ComparablePair[];
  pages: ComparablePair[];
}

/**
 * Source items outside any live container (deleted or system container): the sync skips them, so
 * they are listed once per container as a source defect instead of one "unmapped" per item.
 */
function reportContentOutsideLiveContainers(ctx: VerifyContext, collector: FindingCollector): void {
  const byContainer = new Map<string, number>();
  ctx.source.outsideLiveContainers.forEach((item) => {
    const name = String(item?.properties?.referenceName || "").toLowerCase();
    byContainer.set(name, (byContainer.get(name) ?? 0) + 1);
  });
  Array.from(byContainer.keys())
    .sort()
    .forEach((name) => {
      const count = byContainer.get(name) as number;
      collector.count(ctx.locale, "content", "checked", count);
      collector.count(ctx.locale, "content", "known", count);
      collector.add({
        category: "contentNotInLiveContainer",
        severity: "sourceDefect",
        entity: "content",
        locale: ctx.locale,
        name,
        actual: count,
        message: `${count} source item(s) belong to container "${name}", which is deleted or a system container in the source — not migrated`,
      });
    });
}

/** Content items and pages for one locale. */
export function checkLocaleIntegrity(ctx: VerifyContext, collector: FindingCollector): LocaleIntegrityResult {
  const checkExtra = !ctx.scoped;
  reportContentOutsideLiveContainers(ctx, collector);
  return {
    content: checkIntegrity(
      {
        entity: "content",
        locale: ctx.locale,
        source: ctx.source.contentById,
        target: ctx.target.contentById,
        map: ctx.localeMappings.content,
        name: (c) => c?.properties?.referenceName,
        checkExtra,
        sourceDefect: (item) => contentSourceDefect(item, ctx.source.modelsByRef),
      },
      collector
    ),
    pages: checkIntegrity(
      {
        entity: "page",
        locale: ctx.locale,
        source: ctx.source.pagesById,
        target: ctx.target.pagesById,
        map: ctx.localeMappings.pages,
        name: (p) => p?.name,
        checkExtra,
      },
      collector
    ),
  };
}
