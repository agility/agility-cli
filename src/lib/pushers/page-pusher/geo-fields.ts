/**
 * PROD-2729: page GEO/AEO fields during a sync.
 *
 * A page can carry a top-level `geo` block (schemaType, summary, structuredData, ai) and four
 * newer `seo` keys (title, canonicalUrl, robots, ogImage). The CLI needs no feature work for them:
 * they arrive on the pulled page and are spread into the savePage payload untouched. Two rules
 * matter on the write side, both from the Management API's three-state contract:
 *
 *  - an omitted property keeps what the target has stored, and
 *  - an explicit `null` clears it.
 *
 * So the CLI must never default these properties to `null`, and when it has to leave GEO data out
 * it deletes the keys rather than nulling them.
 *
 * The Management API rejects invalid GEO input (e.g. malformed `geo.structuredData`) with a 400
 * whose message names each offending field path ("geo.structuredData: is not valid JSON (...)").
 * Data saved through a path that doesn't validate can therefore fail when synced to another
 * instance. One bad JSON-LD block must never fail a sync, so the page is saved again without the
 * offending GEO properties (the target keeps its own values) and the skip is reported as a warning.
 */

/** The `seo` keys added for GEO/AEO. The five older keys are not GEO fields. */
export const GEO_SEO_KEYS = ["title", "canonicalUrl", "robots", "ogImage"] as const;

/** Stable warning code for the run summary / --jsonSummary. */
export const GEO_NOT_COPIED_CODE = "geoNotCopied";

export interface GeoValidationError {
  /** The validation message from the Management API. */
  message: string;
  /**
   * What to leave out of the retry: "geo" for anything under `geo.*`, or "seo.<key>" for one of
   * GEO_SEO_KEYS. Deduplicated, in first-seen order.
   */
  strip: string[];
  /** True when every offending path is `geo.structuredData`. */
  structuredDataOnly: boolean;
}

const GEO_PATH =
  /(?:^|[\s"'$.[])((?:geo(?:\.[A-Za-z]+)*)|(?:seo\.(?:title|canonicalUrl|robots|ogImage)(?:\.[A-Za-z]+)*))\s*:/gi;

function canonicalSeoKey(key: string): string | undefined {
  return GEO_SEO_KEYS.find((k) => k.toLowerCase() === key.toLowerCase());
}

/** Map one field path ("geo.ai.crawl", "$.seo.Title") to what the retry leaves out. */
function stripTargetForPath(rawPath: string): { strip: string; path: string } | undefined {
  const path = rawPath.replace(/^\$\./, "");
  const parts = path.split(".");
  if (parts[0].toLowerCase() === "geo") return { strip: "geo", path: path.toLowerCase() };
  if (parts[0].toLowerCase() === "seo" && parts[1]) {
    const key = canonicalSeoKey(parts[1]);
    if (key) return { strip: `seo.${key}`, path: path.toLowerCase() };
  }
  return undefined;
}

/** The HTTP response behind an error thrown by @agility/management-sdk (it wraps the AxiosError). */
function responseOf(error: any): any {
  return error?.innerError?.response ?? error?.response ?? error?.innerError?.innerError?.response;
}

/**
 * If `error` is a Management API 400 rejecting GEO fields, describe it; otherwise undefined.
 *
 * Handles both 400 shapes the Management API produces:
 *  - its own validation: `{ statusCode: 400, exceptionMessage: "geo.structuredData: ... geo.schemaType: ..." }`
 *  - ASP.NET model binding: `{ status: 400, title: "...", errors: { "$.geo.schemaType": ["..."] } }`
 */
export function getGeoValidationError(error: any): GeoValidationError | undefined {
  const response = responseOf(error);
  if (!response || response.status !== 400) return undefined;

  const data = response.data;
  const pieces: string[] = [];
  if (typeof data === "string") pieces.push(data);
  if (data && typeof data === "object") {
    if (typeof data.exceptionMessage === "string") pieces.push(data.exceptionMessage);
    if (typeof data.message === "string") pieces.push(data.message);
    if (data.errors && typeof data.errors === "object") {
      for (const [key, value] of Object.entries(data.errors)) {
        const messages = Array.isArray(value) ? value.join(" ") : String(value);
        pieces.push(`${key}: ${messages}`);
      }
    }
  }
  const message = pieces.join(" ").trim();
  if (!message) return undefined;

  const parsed = parseGeoPaths(message);
  if (!parsed) return undefined;
  return { message, ...parsed };
}

/**
 * Content items (the MVP's item half): `POST {locale}/item/multi` validates every item's GEO data
 * before queueing the batch and rejects the whole request with one 400 whose message prefixes each
 * path with the item's index ("items[3].geo.structuredData: ..."; ASP.NET model binding says
 * "$[3].geo.schemaType"); a single-item save has no prefix.
 * Returns the validation errors per payload index, or undefined when the error isn't a GEO 400.
 *
 * When the message names no index for a multi-item request, every item is attributed the whole
 * error: the caller then leaves the named properties out of every item that carries them, which
 * only ever keeps the target's values.
 */
export function getItemGeoValidationErrors(error: any, itemCount: number): Map<number, GeoValidationError> | undefined {
  const overall = getGeoValidationError(error);
  if (!overall) return undefined;

  const byIndex = new Map<number, GeoValidationError>();
  const segments = overall.message.split(/(?=(?:items|\$)\[\d+\]\.)/);
  for (const segment of segments) {
    const indexMatch = /^(?:items|\$)\[(\d+)\]\./.exec(segment);
    if (!indexMatch) continue;
    const index = parseInt(indexMatch[1], 10);
    if (index < 0 || index >= itemCount) continue;
    const parsed = parseGeoPaths(segment.slice(indexMatch[0].length));
    if (!parsed) continue;
    const existing = byIndex.get(index);
    if (existing) {
      existing.message = `${existing.message} ${segment.trim()}`;
      parsed.strip.forEach((s) => existing.strip.includes(s) || existing.strip.push(s));
      existing.structuredDataOnly = existing.structuredDataOnly && parsed.structuredDataOnly;
    } else {
      byIndex.set(index, {
        message: segment.trim(),
        strip: parsed.strip,
        structuredDataOnly: parsed.structuredDataOnly,
      });
    }
  }
  if (byIndex.size > 0) return byIndex;

  for (let i = 0; i < itemCount; i++) byIndex.set(i, { ...overall, strip: [...overall.strip] });
  return byIndex;
}

function parseGeoPaths(message: string): Omit<GeoValidationError, "message"> | undefined {
  const strip: string[] = [];
  const paths: string[] = [];
  const pattern = new RegExp(GEO_PATH.source, GEO_PATH.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    const target = stripTargetForPath(match[1]);
    if (!target) continue;
    paths.push(target.path);
    if (!strip.includes(target.strip)) strip.push(target.strip);
  }
  if (strip.length === 0) return undefined;
  return { strip, structuredDataOnly: paths.every((p) => p.startsWith("geo.structureddata")) };
}

/**
 * A copy of `payload` without the GEO properties named in `strip`. The keys are deleted, never
 * set to null: omitted means "keep what the target has", null would clear it.
 */
export function withoutGeoFields<T extends Record<string, any>>(payload: T, strip: string[]): T {
  const copy: any = { ...payload };
  for (const entry of strip) {
    if (entry === "geo") {
      delete copy.geo;
    } else if (entry.startsWith("seo.") && copy.seo && typeof copy.seo === "object") {
      copy.seo = { ...copy.seo };
      delete copy.seo[entry.slice(4)];
    }
  }
  return copy;
}

/** The warning text recorded for a page or content item whose GEO data was not copied. */
export function geoNotCopiedMessage(validation: GeoValidationError): string {
  const what = validation.structuredDataOnly ? "invalid structured data" : "invalid GEO fields";
  return `GEO not copied: ${what} (${validation.strip.join(", ")} left out; the target keeps its existing values). ${validation.message}`;
}
