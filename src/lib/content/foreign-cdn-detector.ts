/**
 * PROD-2773: detect asset URLs that point at an Agility CDN container belonging to NEITHER the
 * source NOR the target instance of a sync.
 *
 * Content synced before the PROD-915 fix kept the URLs of the instance it was copied FROM, so a
 * source can carry URLs into a third instance's container (e.g. `cdn-usa2.aglty.io/upstream-qa/…`
 * in an instance whose own container is `site-qa`). The asset mapping only knows the
 * source's own container, so those URLs pass through unchanged and silently: an image/file field
 * holding one may be dropped by the target, and a link in rich text keeps pointing at the other
 * instance. This module only DETECTS them — it never changes a value.
 *
 * Container ownership rule:
 * - A URL is an Agility CDN URL when its host is a generic Agility CDN host (`cdn*.aglty.io`,
 *   `agility-cdn*.azurewebsites.net`, `cdn*.agilitycms.com`) or a custom edge host seen in the
 *   source/target container URLs (asset mappings, pulled assets). Non-CDN Agility hosts such as
 *   `api.aglty.io` or `manager.agilitycms.com` are deliberately not matched.
 * - Its container is the first path segment (case-insensitive), whatever the host — the same
 *   container is served from the aglty.io edge, the azurewebsites origin and any custom domain.
 * - It is foreign when that container is in neither the source's nor the target's known set.
 * - When either side's container is unknown (no asset mappings and no pulled assets for it), any
 *   unclaimed container could plausibly be that side's, so nothing is reported at all.
 */
import * as mgmtApi from "@agility/management-sdk";

/** Generic Agility CDN hosts; anything else must be learned from the instances' own URLs. */
const GENERIC_CDN_HOST_PATTERNS: RegExp[] = [
  /^cdn[a-z0-9-]*\.aglty\.io$/,
  /^agility-?cdn[a-z0-9-]*\.azurewebsites\.net$/,
  /^cdn[a-z0-9-]*\.agilitycms\.com$/,
];

// host, then the path up to the first character that cannot be part of a URL in text/HTML/JSON
const URL_PATTERN = /(https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?\/([^\s"'<>()\\[\]{}|^`]*)/gi;

export interface CdnUrlMatch {
  /** The asset URL as found (unescaped, query string and fragment removed). */
  url: string;
  host: string;
  /** Lower-cased first path segment. */
  container: string;
}

export interface CdnOwnership {
  sourceContainers: string[];
  targetContainers: string[];
  /** Custom (non-generic) edge hosts used by the source or target, lower-cased. */
  customHosts: string[];
}

export function isGenericAgilityCdnHost(host: string): boolean {
  const h = host.toLowerCase();
  return GENERIC_CDN_HOST_PATTERNS.some((p) => p.test(h));
}

/**
 * Undo the encodings a URL picks up when stored in a field: JSON-escaped slashes (`https:\/\/`),
 * HTML-escaped ampersands (`&amp;`) and percent-encoded nested URLs (`?src=https%3A%2F%2F…`).
 * Only used for detection; field values are never rewritten.
 */
function normalizeText(text: string): string {
  return text.replace(/\\+\//g, "/").replace(/&amp;/gi, "&").replace(/%3A/gi, ":").replace(/%2F/gi, "/");
}

/**
 * Every Agility CDN asset URL in a string (a plain URL, rich text, HTML or a JSON blob).
 * A bare container URL (no file path) is not an asset reference and is ignored; on a custom host
 * the last segment must also look like a file, since that host may serve ordinary pages too.
 */
export function extractAgilityCdnUrls(text: string, customHosts: Iterable<string> = []): CdnUrlMatch[] {
  if (!text || typeof text !== "string" || !text.includes("/")) return [];
  const custom = new Set(Array.from(customHosts, (h) => h.toLowerCase()));
  const matches: CdnUrlMatch[] = [];

  const normalized = normalizeText(text);
  const pattern = new RegExp(URL_PATTERN.source, URL_PATTERN.flags);
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(normalized)) !== null) {
    const scheme = m[1] || "";
    const host = m[2].toLowerCase();
    const pathStart = m.index + m[0].length - m[3].length;
    const path = m[3].split(/[?#]/)[0].replace(/[.,;:!*]+$/, "");
    // resume scanning inside this URL's query string, where another URL may be nested
    // (e.g. an image proxy's ?src=https://cdn.aglty.io/...)
    pattern.lastIndex = pathStart + path.length;

    const isGeneric = isGenericAgilityCdnHost(host);
    if (!isGeneric && !custom.has(host)) continue;

    const segments = path.split("/").filter((s) => s.length > 0);
    if (segments.length < 2) continue;
    if (!isGeneric && !/\.[a-z0-9]{1,8}$/i.test(segments[segments.length - 1])) continue;

    matches.push({ url: `${scheme}//${m[2]}/${path}`, host, container: segments[0].toLowerCase() });
  }
  return matches;
}

/** Host and container of a container/asset URL such as `https://cdn-usa2.aglty.io/my-container`. */
export function parseContainerUrl(url: string | null | undefined): { host: string; container: string } | null {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    const container = parsed.pathname.split("/").filter((s) => s.length > 0)[0];
    if (!container) return null;
    return { host: parsed.hostname.toLowerCase(), container: decodeURIComponent(container).toLowerCase() };
  } catch {
    return null;
  }
}

interface ContainerUrlRecord {
  sourceContainerEdgeUrl?: string;
  targetContainerEdgeUrl?: string;
  sourceContainerOriginUrl?: string;
  targetContainerOriginUrl?: string;
  sourceUrl?: string;
  targetUrl?: string;
}

/**
 * Collect each side's containers (and custom edge hosts) from the asset mapping records and the
 * pulled asset lists. Either input may be empty; a side with nothing to learn from stays unknown.
 */
export function buildCdnOwnership(input: {
  assetMappings?: ContainerUrlRecord[];
  sourceAssets?: Array<Partial<mgmtApi.Media>>;
  targetAssets?: Array<Partial<mgmtApi.Media>>;
}): CdnOwnership {
  const source = new Set<string>();
  const target = new Set<string>();
  const hosts = new Set<string>();

  const add = (side: Set<string>, url: string | undefined) => {
    const parsed = parseContainerUrl(url);
    if (!parsed) return;
    side.add(parsed.container);
    if (!isGenericAgilityCdnHost(parsed.host)) hosts.add(parsed.host);
  };

  for (const m of input.assetMappings ?? []) {
    if (!m) continue;
    const hasContainerUrls = m.sourceContainerEdgeUrl || m.sourceContainerOriginUrl;
    add(source, m.sourceContainerEdgeUrl);
    add(source, m.sourceContainerOriginUrl);
    add(target, m.targetContainerEdgeUrl);
    add(target, m.targetContainerOriginUrl);
    // legacy records (before container URLs were tracked) only have the per-asset URLs
    if (!hasContainerUrls) add(source, m.sourceUrl);
    if (!m.targetContainerEdgeUrl && !m.targetContainerOriginUrl) add(target, m.targetUrl);
  }

  for (const [assets, side] of [
    [input.sourceAssets, source],
    [input.targetAssets, target],
  ] as const) {
    for (const a of assets ?? []) {
      if (!a) continue;
      add(side, a.containerEdgeUrl);
      add(side, a.containerOriginUrl);
      add(side, a.edgeUrl);
      add(side, a.originUrl);
    }
  }

  return {
    sourceContainers: Array.from(source),
    targetContainers: Array.from(target),
    customHosts: Array.from(hosts),
  };
}

export class ForeignCdnDetector {
  private source: Set<string>;
  private target: Set<string>;
  private customHosts: Set<string>;

  constructor(ownership: CdnOwnership) {
    this.source = new Set(ownership.sourceContainers.map((c) => c.toLowerCase()));
    this.target = new Set(ownership.targetContainers.map((c) => c.toLowerCase()));
    this.customHosts = new Set(ownership.customHosts.map((h) => h.toLowerCase()));
  }

  /** False when either side's container is unknown — see the ownership rule above. */
  isEnabled(): boolean {
    return this.source.size > 0 && this.target.size > 0;
  }

  get sourceContainers(): string[] {
    return Array.from(this.source);
  }

  get targetContainers(): string[] {
    return Array.from(this.target);
  }

  isForeignContainer(container: string): boolean {
    const c = container.toLowerCase();
    return this.isEnabled() && !this.source.has(c) && !this.target.has(c);
  }

  findForeignUrls(text: string): CdnUrlMatch[] {
    if (!this.isEnabled()) return [];
    return extractAgilityCdnUrls(text, this.customHosts).filter(
      (m) => !this.source.has(m.container) && !this.target.has(m.container)
    );
  }
}

/** "attachment": the URL of an image/file/attachment-list field. "text": inside a string field. */
export type ForeignCdnFieldKind = "attachment" | "text";

export interface ForeignCdnFieldReference extends CdnUrlMatch {
  /** Field path, named the way ContentFieldMapper names nested values (`field[0]`, `field.sub`). */
  field: string;
  kind: ForeignCdnFieldKind;
}

/**
 * Walk a content item's fields and return every foreign CDN reference, one per (field, URL).
 * Mirrors ContentFieldMapper's shapes: an object with a string `url` is an attachment (ImageAttachment,
 * FileAttachment, an AttachmentList entry); any other string is scanned as text.
 */
export function collectForeignCdnReferences(fields: any, detector: ForeignCdnDetector): ForeignCdnFieldReference[] {
  if (!detector.isEnabled() || !fields || typeof fields !== "object") return [];
  const refs: ForeignCdnFieldReference[] = [];
  const seen = new Set<string>();

  const push = (field: string, kind: ForeignCdnFieldKind, matches: CdnUrlMatch[]) => {
    for (const m of matches) {
      const key = `${field}\u0000${m.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ ...m, field, kind });
    }
  };

  const walk = (path: string, value: any) => {
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      push(path, "text", detector.findForeignUrls(value));
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${path}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        if (key === "url" && typeof v === "string") {
          push(path, "attachment", detector.findForeignUrls(v));
        } else {
          walk(`${path}.${key}`, v);
        }
      }
    }
  };

  for (const [name, value] of Object.entries(fields)) walk(name, value);
  return refs;
}
