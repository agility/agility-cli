/**
 * Neutral comparison form for `agility verify` (PROD-2552).
 *
 * Verify must not reuse the push transforms: a bug in ContentFieldMapper or translateZoneNames
 * would then be invisible, because the check would apply the same bug to the expectation. Instead,
 * both sides are projected into one neutral form and compared there:
 *
 *  - IDs become TARGET IDs. A source content ID is translated through the item mapping (or becomes
 *    an `unmapped:<id>` token that can never match); a target ID is used as-is.
 *  - Linked-content references, in any of their shapes ({contentid}, the scalar form, sortids, a
 *    companion value field), become an ordered list of target IDs under "@ids"; a full-list link
 *    becomes the target container reference name under "@list".
 *  - Asset attachments compare on url + label only (size/dimensions are re-derived by the target).
 *  - Asset URLs anywhere in a string are rewritten source→target (exact URL first, then container
 *    prefix), and every known alias of a target container (edge/origin/custom CDN host) collapses
 *    onto one canonical prefix, so the same file reached through two hosts compares equal.
 *  - null, "" and a missing key are equal; CRLF equals LF; keys compare case-insensitively;
 *    numbers and numeric strings compare equal, as do booleans and "true"/"false".
 */
import { getLinkedContentCompanionFields } from "../content/linked-content-companion-fields";
import { AssetPrefixPair, stripTrailingSlash } from "./mapping-index";

export type Side = "source" | "target";

// ─── asset URLs ──────────────────────────────────────────────────────────────

const URL_TAIL = `(?:/[^\\s"'<>()]*)?`;
const URL_END = `(?=$|[/\\s"'<>()])`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecode(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

/** One regex matching any of `prefixes` (longest first) followed by the rest of a URL. */
function prefixRegex(prefixes: string[]): RegExp | null {
  if (prefixes.length === 0) return null;
  const alternation = prefixes
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(`(?:${alternation})${URL_END}${URL_TAIL}`, "g");
}

function containerName(prefix: string): string {
  const trimmed = stripTrailingSlash(prefix);
  return trimmed.slice(trimmed.lastIndexOf("/") + 1).toLowerCase();
}

export interface AssetUrlTranslatorInput {
  /** Exact URL source → target (mapping records, plus each mapped asset's edge/origin URLs). */
  exact: Map<string, string>;
  /** Container prefix pairs source → target. */
  prefixPairs: AssetPrefixPair[];
  /** Every container prefix known to belong to the SOURCE instance. */
  sourcePrefixes: string[];
  /** Every container prefix known to belong to the TARGET instance (edge, origin, custom host). */
  targetPrefixes: string[];
}

export class AssetUrlTranslator {
  private readonly exact: Map<string, string>;
  private readonly prefixPairs: AssetPrefixPair[];
  private readonly sourceRegex: RegExp | null;
  private readonly detectRegex: RegExp | null;
  private readonly aliasRegex: RegExp | null;
  private readonly aliasToCanonical = new Map<string, string>();
  private readonly aliasesLongestFirst: string[];

  constructor(input: AssetUrlTranslatorInput) {
    this.exact = new Map();
    input.exact.forEach((target, source) => {
      this.exact.set(source, target);
      const decoded = safeDecode(source);
      if (!this.exact.has(decoded)) this.exact.set(decoded, target);
    });
    this.prefixPairs = input.prefixPairs
      .map((p) => ({ source: stripTrailingSlash(p.source), target: stripTrailingSlash(p.target) }))
      .sort((a, b) => b.source.length - a.source.length);

    const targetPrefixes = unique(input.targetPrefixes.map(stripTrailingSlash).filter(Boolean));
    const targetSet = new Set(targetPrefixes);
    const sourcePrefixes = unique(
      [...input.sourcePrefixes, ...this.prefixPairs.map((p) => p.source)].map(stripTrailingSlash).filter(Boolean)
    ).filter((p) => !targetSet.has(p));

    // Group target aliases by container name; the lexically smallest alias is the canonical one.
    const groups = new Map<string, string[]>();
    targetPrefixes.forEach((prefix) => {
      const name = containerName(prefix);
      if (!groups.has(name)) groups.set(name, []);
      (groups.get(name) as string[]).push(prefix);
    });
    groups.forEach((aliases) => {
      const canonical = aliases.slice().sort()[0];
      aliases.forEach((alias) => this.aliasToCanonical.set(alias, canonical));
    });
    this.aliasesLongestFirst = Array.from(this.aliasToCanonical.keys()).sort((a, b) => b.length - a.length);

    // Exact source URLs without a known container prefix (legacy mapping records) still need to
    // be found inside rich text, so they join the source alternation.
    const exactOnly = Array.from(this.exact.keys()).filter(
      (url) => !sourcePrefixes.some((p) => url.startsWith(p + "/"))
    );
    this.sourceRegex = prefixRegex([...sourcePrefixes, ...exactOnly]);
    this.detectRegex = prefixRegex(sourcePrefixes);
    this.aliasRegex = prefixRegex(this.aliasesLongestFirst);
  }

  /** Canonical form of a URL that is already a target URL. */
  canonicalTargetUrl(url: string): string {
    const decoded = safeDecode(url);
    for (const alias of this.aliasesLongestFirst) {
      if (decoded === alias || decoded.startsWith(alias + "/")) {
        return (this.aliasToCanonical.get(alias) as string) + decoded.slice(alias.length);
      }
    }
    return decoded;
  }

  /** Translate a source URL to the target URL it should have become, in canonical form. */
  translateSourceUrl(url: string): string {
    const exact = this.exact.get(url) ?? this.exact.get(safeDecode(url));
    if (exact) return this.canonicalTargetUrl(exact);
    const decoded = safeDecode(url);
    for (const pair of this.prefixPairs) {
      if (decoded === pair.source || decoded.startsWith(pair.source + "/")) {
        return this.canonicalTargetUrl(pair.target + decoded.slice(pair.source.length));
      }
    }
    return this.canonicalTargetUrl(decoded);
  }

  /** Rewrite every source asset URL inside a string, then canonicalize target aliases. */
  rewriteSourceText(text: string): string {
    const rewritten = this.sourceRegex ? text.replace(this.sourceRegex, (url) => this.translateSourceUrl(url)) : text;
    return this.canonicalTargetText(rewritten);
  }

  canonicalTargetText(text: string): string {
    return this.aliasRegex ? text.replace(this.aliasRegex, (url) => this.canonicalTargetUrl(url)) : text;
  }

  /** Source-instance asset URLs still present in a (target) string. */
  findSourceUrls(text: string): string[] {
    if (!this.detectRegex || typeof text !== "string") return [];
    return Array.from(new Set(text.match(this.detectRegex) ?? []));
  }
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

/**
 * Build the translator from the mapping index's asset records plus both sides' asset lists.
 *
 * The pulled content does not always use the host the mapping recorded (a mapping can carry a
 * custom CDN host while content uses the edge host), so each mapped asset contributes its edge and
 * origin URLs as exact pairs, and its container's edge/origin prefixes as prefix pairs.
 */
export function buildAssetUrlTranslator(input: {
  mappingUrls: Map<string, string>;
  mappingPrefixes: AssetPrefixPair[];
  assetIdMap: { target(sourceMediaID: number): number | undefined };
  sourceAssets: any[];
  targetAssets: any[];
}): AssetUrlTranslator {
  const exact = new Map<string, string>(input.mappingUrls);
  const prefixPairs: AssetPrefixPair[] = input.mappingPrefixes.slice();
  const pairKeys = new Set(prefixPairs.map((p) => `${p.source}\u0000${p.target}`));
  const addPair = (source: any, target: any) => {
    if (typeof source !== "string" || typeof target !== "string" || !source || !target) return;
    const key = `${stripTrailingSlash(source)}\u0000${stripTrailingSlash(target)}`;
    if (pairKeys.has(key)) return;
    pairKeys.add(key);
    prefixPairs.push({ source, target });
  };

  const targetById = new Map<number, any>();
  input.targetAssets.forEach((a) => targetById.set(a?.mediaID, a));

  const sourcePrefixes = new Set<string>();
  const targetPrefixes = new Set<string>();
  input.mappingPrefixes.forEach((p) => {
    sourcePrefixes.add(p.source);
    targetPrefixes.add(p.target);
  });
  input.sourceAssets.forEach((a) => {
    if (a?.containerEdgeUrl) sourcePrefixes.add(a.containerEdgeUrl);
    if (a?.containerOriginUrl) sourcePrefixes.add(a.containerOriginUrl);
  });
  input.targetAssets.forEach((a) => {
    if (a?.containerEdgeUrl) targetPrefixes.add(a.containerEdgeUrl);
    if (a?.containerOriginUrl) targetPrefixes.add(a.containerOriginUrl);
  });

  input.sourceAssets.forEach((s) => {
    const targetID = input.assetIdMap.target(s?.mediaID);
    const t = targetID !== undefined ? targetById.get(targetID) : undefined;
    if (!t) return;
    (["edgeUrl", "originUrl", "url"] as const).forEach((key) => {
      if (typeof s[key] === "string" && typeof t[key] === "string" && !exact.has(s[key])) exact.set(s[key], t[key]);
    });
    addPair(s.containerEdgeUrl, t.containerEdgeUrl);
    addPair(s.containerOriginUrl, t.containerOriginUrl);
  });

  return new AssetUrlTranslator({
    exact,
    prefixPairs,
    sourcePrefixes: Array.from(sourcePrefixes),
    targetPrefixes: Array.from(targetPrefixes),
  });
}

// ─── values ──────────────────────────────────────────────────────────────────

export interface CanonicalContext {
  side: Side;
  /** A content ID as it should appear on the target ("unmapped:<id>" when it has no mapping). */
  contentRef(id: number): string;
  /** A container reference name as it should appear on the target (lower-cased). */
  containerRef(referenceName: string): string;
  /** A gallery (media grouping) ID as it should appear on the target. */
  galleryRef(id: number): string;
  /**
   * True when a full-list reference points at a list with no items on this side. Linking an empty
   * list is the same as linking nothing: the target creates an empty nested list for a grid field
   * the source never filled in.
   */
  isEmptyList?(referenceName: string): boolean;
  assets: AssetUrlTranslator;
}

const NUMERIC = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const ID_LIST = /^\s*\d+(?:\s*,\s*\d+)*\s*,?\s*$/;

function canonicalNumber(text: string): string {
  const n = Number(text);
  return Number.isSafeInteger(n) || (Number.isFinite(n) && text.includes(".")) ? String(n) : text;
}

/** Normalize a scalar. Returns undefined for "empty" (null, undefined, ""). */
export function canonicalScalar(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? canonicalNumber(String(value)) : String(value);
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\r\n/g, "\n");
  if (text === "") return undefined;
  if (NUMERIC.test(text)) return canonicalNumber(text);
  const lowered = text.toLowerCase();
  if (lowered === "true" || lowered === "false") return lowered;
  return text;
}

function lowerKeys(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  Object.keys(obj).forEach((key) => {
    const lower = key.toLowerCase();
    // A payload with both "Title" and "title" keeps the first non-empty one.
    if (!(lower in out) || out[lower] === null || out[lower] === undefined || out[lower] === "") out[lower] = obj[key];
  });
  return out;
}

function parseIdList(text: string): number[] {
  return text
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id))
    .map((id) => parseInt(id, 10))
    .filter((id) => id > 0);
}

function isAssetObject(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.url === "string";
}

function isLinkedRef(lowered: Record<string, any>): boolean {
  return "contentid" in lowered || "sortids" in lowered || "fulllist" in lowered;
}

function canonicalLinkedRef(lowered: Record<string, any>, ctx: CanonicalContext): any {
  let ids: string[] = [];
  const sortids = lowered.sortids;
  if (typeof sortids === "string" && sortids.trim()) {
    ids = parseIdList(sortids).map((id) => ctx.contentRef(id));
  } else if (typeof sortids === "number" && sortids > 0) {
    ids = [ctx.contentRef(sortids)];
  } else {
    const contentid = typeof lowered.contentid === "string" ? parseInt(lowered.contentid, 10) : lowered.contentid;
    if (typeof contentid === "number" && contentid > 0) ids = [ctx.contentRef(contentid)];
  }

  const fullList = lowered.fulllist === true || String(lowered.fulllist).toLowerCase() === "true";
  const list =
    fullList && typeof lowered.referencename === "string" && lowered.referencename
      ? ctx.containerRef(lowered.referencename)
      : undefined;

  const out: Record<string, any> = {};
  if (ids.length > 0) out["@ids"] = ids;
  if (list && !(ids.length === 0 && ctx.isEmptyList?.(lowered.referencename))) out["@list"] = list;
  return Object.keys(out).length > 0 ? out : undefined;
}

function canonicalAsset(value: any, ctx: CanonicalContext): any {
  const url =
    ctx.side === "source" ? ctx.assets.translateSourceUrl(value.url) : ctx.assets.canonicalTargetUrl(value.url);
  const out: Record<string, any> = { "@asset": url };
  const label = canonicalScalar(value.label);
  if (label !== undefined) out.label = label;
  return out;
}

function canonicalText(text: string, ctx: CanonicalContext): string | undefined {
  const scalar = canonicalScalar(text);
  if (scalar === undefined || scalar !== text.replace(/\r\n/g, "\n")) return scalar;
  return ctx.side === "source" ? ctx.assets.rewriteSourceText(scalar) : ctx.assets.canonicalTargetText(scalar);
}

/**
 * Canonical form of one value. `fieldType` is the model's field type for a top-level field, used
 * to recognize the scalar shapes that are only references because the model says so (a Content
 * field stored as "123" or "1,2,3", a PhotoGallery stored as a gallery ID).
 */
export function canonicalValue(value: any, ctx: CanonicalContext, fieldType?: string): any {
  if (value === null || value === undefined) return undefined;
  const type = (fieldType || "").toLowerCase();

  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    if (type === "content" && ID_LIST.test(text)) {
      const ids = parseIdList(text).map((id) => ctx.contentRef(id));
      return ids.length > 0 ? { "@ids": ids } : undefined;
    }
    if (type === "photogallery" && /^\d+$/.test(text.trim()) && parseInt(text, 10) > 0) {
      return { "@gallery": ctx.galleryRef(parseInt(text, 10)) };
    }
    return typeof value === "string" ? canonicalText(value, ctx) : canonicalScalar(value);
  }

  if (typeof value === "boolean") return canonicalScalar(value);

  if (Array.isArray(value)) {
    const items = value.map((item) => {
      const canonical = canonicalValue(item, ctx);
      return canonical === undefined ? null : canonical;
    });
    return items.length > 0 && items.some((i) => i !== null) ? items : undefined;
  }

  if (typeof value === "object") {
    if (isAssetObject(value)) return canonicalAsset(value, ctx);
    const lowered = lowerKeys(value);
    if (isLinkedRef(lowered)) return canonicalLinkedRef(lowered, ctx);
    if (type === "photogallery" && typeof lowered.galleryid === "number") {
      return { "@gallery": ctx.galleryRef(lowered.galleryid) };
    }
    const out: Record<string, any> = {};
    Object.keys(lowered)
      .sort()
      .forEach((key) => {
        const canonical = canonicalValue(lowered[key], ctx);
        if (canonical !== undefined) out[key] = canonical;
      });
    return Object.keys(out).length > 0 ? out : undefined;
  }

  return undefined;
}

/**
 * Canonical form of a content item's fields object, keyed by lower-cased field name.
 *
 * `model` is the item's model on ITS OWN side: it names the Content-typed fields and their
 * companion value fields (LinkeContentDropdownValueField / SortIDFieldName).
 */
export function canonicalFields(fields: any, model: any, ctx: CanonicalContext): Record<string, any> {
  const out: Record<string, any> = {};
  if (!fields || typeof fields !== "object") return out;

  const typeByField = new Map<string, string>();
  (Array.isArray(model?.fields) ? model.fields : []).forEach((f: any) => {
    if (f?.name) typeByField.set(String(f.name).toLowerCase(), String(f.type || ""));
  });
  getLinkedContentCompanionFields(model).forEach(([main, companion]) => {
    if (companion.toLowerCase() !== main.toLowerCase()) typeByField.set(companion.toLowerCase(), "Content");
  });

  const lowered = lowerKeys(fields);
  Object.keys(lowered)
    .sort()
    .forEach((key) => {
      const canonical = canonicalValue(lowered[key], ctx, typeByField.get(key));
      if (canonical !== undefined) out[key] = canonical;
    });
  return out;
}

// ─── comparison ──────────────────────────────────────────────────────────────

/** JSON with sorted keys, so two equal canonical values stringify identically. */
export function stableStringify(value: any): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(",")}}`;
}

export function canonicalEquals(a: any, b: any): boolean {
  return stableStringify(a) === stableStringify(b);
}

export interface FieldDifference {
  field: string;
  expected: any;
  actual: any;
}

/** Top-level keys whose canonical values differ, in key order. */
export function diffCanonical(expected: Record<string, any>, actual: Record<string, any>): FieldDifference[] {
  const keys = Array.from(new Set([...Object.keys(expected), ...Object.keys(actual)])).sort();
  const out: FieldDifference[] = [];
  keys.forEach((key) => {
    if (!canonicalEquals(expected[key], actual[key])) {
      out.push({ field: key, ...describeDifference(expected[key], actual[key]) });
    }
  });
  return out;
}

const SNIPPET_CONTEXT = 80;

/**
 * Report-friendly expected/actual: long strings are cut to a window around the first difference,
 * so a one-character change in a 20KB rich-text field is readable.
 */
export function describeDifference(expected: any, actual: any): { expected: any; actual: any } {
  if (typeof expected === "string" && typeof actual === "string" && (expected.length > 200 || actual.length > 200)) {
    let i = 0;
    while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
    const start = Math.max(0, i - SNIPPET_CONTEXT);
    const cut = (s: string) =>
      `${start > 0 ? "…" : ""}${s.slice(start, i + SNIPPET_CONTEXT)}${i + SNIPPET_CONTEXT < s.length ? "…" : ""}`;
    return { expected: cut(expected), actual: cut(actual) };
  }
  return { expected, actual };
}
