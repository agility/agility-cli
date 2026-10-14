/**
 * Bidirectional, Map-backed indices over every mapping file of a source→target pair (PROD-2552).
 *
 * The mappers in lib/mappers look records up with Array.find, which is fine for the one lookup a
 * pusher makes per item but quadratic for a verify pass that touches every item in both
 * directions. These indices are built once per run and answer every lookup in O(1).
 *
 * Read-only: records come in through a reader function and nothing here can write a mapping file.
 */
import * as fs from "fs";
import * as path from "path";
import { fileOperations } from "../../core/fileOperations";

/** Mapping folder names as the mappers write them. Content and pages are per-locale. */
export type MappingType =
  | "models"
  | "containers"
  | "templates"
  | "sections"
  | "galleries"
  | "assets"
  | "urlredirections"
  | "item"
  | "page";

export type MappingReader = (type: MappingType, locale?: string) => any[];

/**
 * A one-to-one-ish relation between source keys and target keys. Duplicate sources keep their
 * FIRST target (the same record the mappers' Array.find would return); duplicate targets — two
 * sources mapped onto one target — are kept and reported.
 */
export class BiMap<K extends string | number> {
  private readonly s2t = new Map<K, K>();
  private readonly t2s = new Map<K, K[]>();

  add(source: K | null | undefined, target: K | null | undefined): void {
    if (!isUsableKey(source) || !isUsableKey(target)) return;
    if (this.s2t.has(source as K)) return;
    this.s2t.set(source as K, target as K);
    const sources = this.t2s.get(target as K);
    if (sources) sources.push(source as K);
    else this.t2s.set(target as K, [source as K]);
  }

  target(source: K | null | undefined): K | undefined {
    return isUsableKey(source) ? this.s2t.get(source as K) : undefined;
  }

  sources(target: K | null | undefined): K[] {
    return isUsableKey(target) ? (this.t2s.get(target as K) ?? []) : [];
  }

  hasSource(source: K): boolean {
    return this.s2t.has(source);
  }

  hasTarget(target: K): boolean {
    return this.t2s.has(target);
  }

  /** Targets that more than one source maps onto. */
  duplicateTargets(): Array<{ target: K; sources: K[] }> {
    const out: Array<{ target: K; sources: K[] }> = [];
    this.t2s.forEach((sources, target) => {
      if (sources.length > 1) out.push({ target, sources: sources.slice() });
    });
    return out;
  }

  entries(): Array<[K, K]> {
    return Array.from(this.s2t.entries());
  }

  get size(): number {
    return this.s2t.size;
  }
}

function isUsableKey(key: any): boolean {
  if (key === null || key === undefined || key === "") return false;
  if (typeof key === "number") return Number.isFinite(key) && key > 0;
  return true;
}

function lower(value: any): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.toLowerCase() : undefined;
}

/** A source container-URL prefix and the target prefix it maps onto. */
export interface AssetPrefixPair {
  source: string;
  target: string;
}

export interface LocaleMappingIndex {
  content: BiMap<number>;
  pages: BiMap<number>;
}

export interface MappingIndex {
  models: BiMap<number>;
  /** Lower-cased reference names. */
  modelNames: BiMap<string>;
  containers: BiMap<number>;
  /** Lower-cased reference names. */
  containerNames: BiMap<string>;
  templates: BiMap<number>;
  /** Lower-cased template names. */
  templateNames: BiMap<string>;
  /** pageItemTemplateID (zone definition) source → target. */
  sections: BiMap<number>;
  galleries: BiMap<number>;
  assets: BiMap<number>;
  /** Exact asset URL source → target. */
  assetUrls: Map<string, string>;
  /** Container URL prefixes (edge and origin) source → target, from the mapping records. */
  assetPrefixes: AssetPrefixPair[];
  byLocale: Map<string, LocaleMappingIndex>;
}

export function buildMappingIndex(read: MappingReader, locales: string[]): MappingIndex {
  const index: MappingIndex = {
    models: new BiMap(),
    modelNames: new BiMap(),
    containers: new BiMap(),
    containerNames: new BiMap(),
    templates: new BiMap(),
    templateNames: new BiMap(),
    sections: new BiMap(),
    galleries: new BiMap(),
    assets: new BiMap(),
    assetUrls: new Map(),
    assetPrefixes: [],
    byLocale: new Map(),
  };

  (read("models") || []).forEach((m: any) => {
    index.models.add(m.sourceID, m.targetID);
    index.modelNames.add(lower(m.sourceReferenceName), lower(m.targetReferenceName));
  });

  (read("containers") || []).forEach((c: any) => {
    index.containers.add(c.sourceContentViewID, c.targetContentViewID);
    index.containerNames.add(lower(c.sourceReferenceName), lower(c.targetReferenceName));
  });

  (read("templates") || []).forEach((t: any) => {
    index.templates.add(t.sourcePageTemplateID, t.targetPageTemplateID);
    index.templateNames.add(lower(t.sourcePageTemplateName), lower(t.targetPageTemplateName));
  });

  (read("sections") || []).forEach((s: any) =>
    index.sections.add(s.sourcePageItemTemplateID, s.targetPageItemTemplateID)
  );

  (read("galleries") || []).forEach((g: any) => index.galleries.add(g.sourceMediaGroupingID, g.targetMediaGroupingID));

  const prefixKeys = new Set<string>();
  const addPrefix = (source: any, target: any) => {
    if (typeof source !== "string" || typeof target !== "string" || !source || !target) return;
    const pair = { source: stripTrailingSlash(source), target: stripTrailingSlash(target) };
    const key = `${pair.source}\u0000${pair.target}`;
    if (prefixKeys.has(key)) return;
    prefixKeys.add(key);
    index.assetPrefixes.push(pair);
  };
  (read("assets") || []).forEach((a: any) => {
    index.assets.add(a.sourceMediaID, a.targetMediaID);
    if (typeof a.sourceUrl === "string" && typeof a.targetUrl === "string" && a.sourceUrl && a.targetUrl) {
      if (!index.assetUrls.has(a.sourceUrl)) index.assetUrls.set(a.sourceUrl, a.targetUrl);
    }
    addPrefix(a.sourceContainerEdgeUrl, a.targetContainerEdgeUrl);
    addPrefix(a.sourceContainerOriginUrl, a.targetContainerOriginUrl);
  });

  locales.forEach((locale) => {
    const localeIndex: LocaleMappingIndex = { content: new BiMap(), pages: new BiMap() };
    (read("item", locale) || []).forEach((r: any) => localeIndex.content.add(r.sourceContentID, r.targetContentID));
    (read("page", locale) || []).forEach((r: any) => localeIndex.pages.add(r.sourcePageID, r.targetPageID));
    index.byLocale.set(locale, localeIndex);
  });

  return index;
}

export function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** The on-disk directory holding one pair's mappings. */
export function mappingPairDirectory(rootPath: string, sourceGuid: string, targetGuid: string): string {
  return path.join(rootPath, "mappings", `${sourceGuid}-${targetGuid}`);
}

/**
 * Read mappings through fileOperations.getMappingFile, but only when the mappings.json exists:
 * getMappingFile seeds an empty file when the folder exists without one, and verify must never
 * write to a mapping directory.
 */
export function createFileMappingReader(rootPath: string, sourceGuid: string, targetGuid: string): MappingReader {
  const fileOps = new fileOperations(sourceGuid);
  const pairDir = mappingPairDirectory(rootPath, sourceGuid, targetGuid);
  return (type: MappingType, locale?: string) => {
    const file = path.join(pairDir, locale ?? "", type, "mappings.json");
    if (!fs.existsSync(file)) return [];
    const records = fileOps.getMappingFile(type, sourceGuid, targetGuid, locale ?? null);
    if (!Array.isArray(records)) {
      throw new Error(`Mapping file ${file} does not contain an array`);
    }
    return records;
  };
}
