/**
 * Everything one locale's verify checks need, loaded once (PROD-2552).
 *
 * Reads only: the pulled caches through GuidDataLoader / SitemapHierarchy, and the mapping index
 * built by mapping-index.ts. Building the context is split from loading it so tests can hand in
 * entities directly.
 *
 * Unpublished items: a full pull omits state-7 (unpublished) items, on both sides. Anything with
 * state 7 that is still on disk (an older incremental pull) is dropped here, on BOTH sides, so the
 * two sides are always compared on the same terms — what a fresh pull of each instance returns.
 */
import * as fs from "fs";
import * as path from "path";
import { GuidDataLoader, GuidEntities, ModelFilterOptions } from "../pushers/guid-data-loader";
import { SitemapHierarchy } from "../pushers/page-pusher/sitemap-hierarchy";
import { SitemapNode } from "../../types/syncAnalysis";
import { LocaleMappingIndex, MappingIndex } from "./mapping-index";
import { AssetUrlTranslator, buildAssetUrlTranslator, CanonicalContext } from "./canonicalize";

export const UNPUBLISHED_STATE = 7;

/**
 * Containers every instance has and the sync never migrates (container-pusher skips them by name),
 * so they are left out on both sides.
 */
export const SYSTEM_CONTAINER_NAMES = new Set([
  "agilitycssfiles",
  "agilityjavascriptfiles",
  "agilityglobalcodetemplates",
  "agilitymodulecodetemplates",
  "agilitypagecodetemplates",
]);

export type ChannelSitemaps = { [channel: string]: SitemapNode[] | null };

export interface SideEntities {
  models: any[];
  containers: any[];
  templates: any[];
  assets: any[];
  galleries: any[];
  content: any[];
  pages: any[];
  sitemaps: ChannelSitemaps;
}

export interface SideIndex {
  entities: SideEntities;
  modelsById: Map<number, any>;
  /** Lower-cased reference name → model. */
  modelsByRef: Map<string, any>;
  containersById: Map<number, any>;
  /** Lower-cased reference name → container. */
  containersByRef: Map<string, any>;
  templatesById: Map<number, any>;
  /** Lower-cased template name → template. */
  templatesByName: Map<string, any>;
  contentById: Map<number, any>;
  pagesById: Map<number, any>;
  /** Content IDs placed as a module on some page zone (their container is auto-generated). */
  pageBoundContentIDs: Set<number>;
  /** Lower-cased container reference name → number of (live) items in it, for this locale. */
  contentCountByContainer: Map<string, number>;
  /**
   * Content items whose container is not a live container on this side (deleted, or a system
   * container). The pull still returns them, but they are not reachable content and the sync skips
   * them (no container mapping), so they are left out of every comparison.
   */
  outsideLiveContainers: any[];
}

export interface VerifyContext {
  sourceGuid: string;
  targetGuid: string;
  locale: string;
  mappings: MappingIndex;
  localeMappings: LocaleMappingIndex;
  source: SideIndex;
  target: SideIndex;
  assets: AssetUrlTranslator;
  /**
   * A --models / --pages / --containers scope narrowed the SOURCE side. Checks that compare
   * whole sets (extra target entities, per-container counts) are skipped: the target side is not
   * narrowed, so they would report everything outside the scope.
   */
  scoped: boolean;
  /** Restrict sitemap checks to these channels (lower-case); undefined = every channel. */
  channels?: string[];
}

export function isPulled(entity: any): boolean {
  return entity?.properties?.state !== UNPUBLISHED_STATE;
}

function lower(value: any): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

/** Module entries on a page, across every zone. */
export function zoneModules(page: any): Array<{ zone: string; module: any }> {
  const out: Array<{ zone: string; module: any }> = [];
  const zones = page?.zones;
  if (!zones || typeof zones !== "object") return out;
  Object.keys(zones).forEach((zone) => {
    const modules = zones[zone];
    if (Array.isArray(modules)) modules.forEach((module) => out.push({ zone, module }));
  });
  return out;
}

/** The content ID a zone module points at, whatever the key's casing. */
export function moduleContentID(module: any): number | undefined {
  const item = module?.item;
  if (!item || typeof item !== "object") return undefined;
  const raw = item.contentid ?? item.contentID ?? item.ContentID;
  const id = typeof raw === "string" ? parseInt(raw, 10) : raw;
  return typeof id === "number" && id > 0 ? id : undefined;
}

export function buildSideIndex(entities: SideEntities, outsideLiveContainers: any[] = []): SideIndex {
  const index: SideIndex = {
    entities,
    modelsById: new Map(),
    modelsByRef: new Map(),
    containersById: new Map(),
    containersByRef: new Map(),
    templatesById: new Map(),
    templatesByName: new Map(),
    contentById: new Map(),
    pagesById: new Map(),
    pageBoundContentIDs: new Set(),
    contentCountByContainer: new Map(),
    outsideLiveContainers,
  };
  entities.models.forEach((m) => {
    if (typeof m?.id === "number") index.modelsById.set(m.id, m);
    if (m?.referenceName && !index.modelsByRef.has(lower(m.referenceName)))
      index.modelsByRef.set(lower(m.referenceName), m);
  });
  entities.containers.forEach((c) => {
    if (typeof c?.contentViewID === "number") index.containersById.set(c.contentViewID, c);
    if (c?.referenceName && !index.containersByRef.has(lower(c.referenceName)))
      index.containersByRef.set(lower(c.referenceName), c);
  });
  entities.templates.forEach((t) => {
    if (typeof t?.pageTemplateID === "number") index.templatesById.set(t.pageTemplateID, t);
    if (t?.pageTemplateName && !index.templatesByName.has(lower(t.pageTemplateName)))
      index.templatesByName.set(lower(t.pageTemplateName), t);
  });
  entities.content.forEach((c) => {
    if (typeof c?.contentID === "number") index.contentById.set(c.contentID, c);
    const container = lower(c?.properties?.referenceName);
    if (container)
      index.contentCountByContainer.set(container, (index.contentCountByContainer.get(container) ?? 0) + 1);
  });
  entities.pages.forEach((p) => {
    if (typeof p?.pageID === "number") index.pagesById.set(p.pageID, p);
    zoneModules(p).forEach(({ module }) => {
      const id = moduleContentID(module);
      if (id) index.pageBoundContentIDs.add(id);
    });
  });
  return index;
}

export function createVerifyContext(input: {
  sourceGuid: string;
  targetGuid: string;
  locale: string;
  mappings: MappingIndex;
  source: SideEntities;
  target: SideEntities;
  scoped?: boolean;
  channels?: string[];
}): VerifyContext {
  const clean = (side: SideEntities): SideIndex => {
    const containers = side.containers.filter(
      (c) => c?.isDeleted !== true && !SYSTEM_CONTAINER_NAMES.has(lower(c?.referenceName))
    );
    const liveContainers = new Set(containers.map((c) => lower(c?.referenceName)));
    const pulled = side.content.filter(isPulled);
    // Without a container list (nothing pulled, or a hand-built fixture) every item counts as live.
    const isLive = (item: any) => containers.length === 0 || liveContainers.has(lower(item?.properties?.referenceName));
    return buildSideIndex(
      {
        ...side,
        content: pulled.filter(isLive),
        pages: side.pages.filter(isPulled),
        containers,
        templates: side.templates.filter((t) => t?.isDeleted !== true),
        assets: side.assets.filter((a) => a?.isDeleted !== true && a?.isFolder !== true),
      },
      pulled.filter((item) => !isLive(item))
    );
  };
  const source = clean(input.source);
  const target = clean(input.target);
  const localeMappings = input.mappings.byLocale.get(input.locale);
  if (!localeMappings) {
    throw new Error(`No mapping index for locale ${input.locale}`);
  }

  return {
    sourceGuid: input.sourceGuid,
    targetGuid: input.targetGuid,
    locale: input.locale,
    mappings: input.mappings,
    localeMappings,
    source,
    target,
    assets: buildAssetUrlTranslator({
      mappingUrls: input.mappings.assetUrls,
      mappingPrefixes: input.mappings.assetPrefixes,
      assetIdMap: input.mappings.assets,
      sourceAssets: source.entities.assets,
      targetAssets: target.entities.assets,
    }),
    scoped: input.scoped === true,
    channels: input.channels?.map((c) => c.toLowerCase()),
  };
}

/** Canonicalization context for SOURCE values: every ID is translated to its target. */
export function sourceCanonicalContext(ctx: VerifyContext): CanonicalContext {
  return {
    side: "source",
    contentRef: (id) => {
      const target = ctx.localeMappings.content.target(id);
      return target !== undefined ? String(target) : `unmapped:${id}`;
    },
    containerRef: (name) => {
      const key = lower(name);
      const mapped = ctx.mappings.containerNames.target(key);
      if (mapped) return mapped;
      // Auto-named nested lists keep their reference name on the target, so an identical name is
      // accepted. A name that is not a live container in the source either (a dangling reference
      // the sync copies verbatim) is compared literally. Only a live, unmapped source container
      // that the target lacks can never match.
      if (ctx.target.containersByRef.has(key) || !ctx.source.containersByRef.has(key)) return key;
      return `unmapped:${key}`;
    },
    galleryRef: (id) => {
      const target = ctx.mappings.galleries.target(id);
      return target !== undefined ? String(target) : `unmapped:${id}`;
    },
    isEmptyList: (name) => !ctx.source.contentCountByContainer.get(lower(name)),
    assets: ctx.assets,
  };
}

/** Canonicalization context for TARGET values: IDs are already target IDs. */
export function targetCanonicalContext(ctx: VerifyContext): CanonicalContext {
  return {
    side: "target",
    contentRef: (id) => String(id),
    containerRef: (name) => lower(name),
    galleryRef: (id) => String(id),
    isEmptyList: (name) => !ctx.target.contentCountByContainer.get(lower(name)),
    assets: ctx.assets,
  };
}

// ─── loading ─────────────────────────────────────────────────────────────────

function toSideEntities(entities: GuidEntities, sitemaps: ChannelSitemaps): SideEntities {
  return {
    models: entities.models || [],
    containers: entities.containers || [],
    templates: entities.templates || [],
    assets: entities.assets || [],
    galleries: entities.galleries || [],
    content: entities.content || [],
    pages: entities.pages || [],
    sitemaps,
  };
}

/**
 * Load one side of one locale from the pulled cache. With `filter`, the existing scope filters
 * (--models / --pages / --containers) narrow what is loaded, exactly as a scoped sync would.
 */
export async function loadSideEntities(
  guid: string,
  locale: string,
  filter?: ModelFilterOptions
): Promise<SideEntities> {
  const loader = new GuidDataLoader(guid);
  const entities = filter
    ? await loader.loadGuidEntities(locale, filter)
    : await loader.loadCompleteGuidEntities(locale);
  // Sitemaps are always loaded whole: a scoped run narrows the sitemap check to the scoped pages
  // itself (see check-sitemap.ts), and siblings outside the scope are still needed for ordering.
  const sitemaps = new SitemapHierarchy().loadAllSitemaps(guid, locale);
  return toSideEntities(entities, sitemaps);
}

/**
 * The loaders skip a JSON file they cannot parse with only a console warning, which would make a
 * corrupt cache read as "entity missing". Verify refuses to compare on top of that: every file a
 * check reads is parsed here first, and any failure is a "could not verify" (exit 2).
 */
export function findUnreadableCacheFiles(rootPath: string, guid: string, locales: string[]): string[] {
  const problems: string[] = [];
  const base = path.join(rootPath, guid);
  if (!fs.existsSync(base)) return [`${base} does not exist (the pull wrote nothing)`];

  const folders = ["models", "containers", "templates", "galleries", path.join("assets", "json")];
  locales.forEach((locale) =>
    folders.push(path.join(locale, "item"), path.join(locale, "page"), path.join(locale, "nestedsitemap"))
  );

  if (!fs.existsSync(path.join(base, "models"))) problems.push(`${path.join(base, "models")} is missing`);

  folders.forEach((folder) => {
    const dir = path.join(base, folder);
    if (!fs.existsSync(dir)) return;
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch (error: any) {
      problems.push(`${dir}: ${error.message}`);
      return;
    }
    files.forEach((file) => {
      const full = path.join(dir, file);
      try {
        JSON.parse(fs.readFileSync(full, "utf8"));
      } catch (error: any) {
        problems.push(`${full}: ${error.message}`);
      }
    });
  });
  return problems;
}
