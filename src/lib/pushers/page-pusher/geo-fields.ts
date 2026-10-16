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

  return {
    message,
    strip,
    structuredDataOnly: paths.every((p) => p.startsWith("geo.structureddata")),
  };
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

/** The warning text recorded for a page whose GEO data was not copied. */
export function geoNotCopiedMessage(validation: GeoValidationError): string {
  const what = validation.structuredDataOnly ? "invalid structured data" : "invalid GEO fields";
  return `GEO not copied: ${what} (${validation.strip.join(", ")} left out; the target keeps its existing values). ${validation.message}`;
}
