/**
 * URL redirection types.
 *
 * Two shapes are in play:
 * - The SYNC shape: what the Content Sync SDK writes to
 *   agility-files/{guid}/{locale}/urlredirections/urlredirections.json during a pull.
 * - The MANAGEMENT shape: what POST /api/v1/instance/{guid}/url-redirections accepts/returns.
 *   Note the different property names (id → urlRedirectionID, statusCode → httpCode).
 */

/** A redirection as pulled by the Content Sync SDK. */
export interface UrlRedirectionSyncItem {
  id: number;
  originUrl: string;
  destinationUrl: string;
  statusCode: number;
  destinationLocale?: string | null;
  originLocales?: string[] | null;
  content?: string | null;
}

/** The file the sync SDK writes: urlredirections/urlredirections.json */
export interface UrlRedirectionSyncFile {
  items: UrlRedirectionSyncItem[];
  isUpToDate: boolean;
  lastAccessDate: string;
}

/**
 * One redirection in the Management API batch save payload.
 * urlRedirectionID 0 (or absent) = create; a positive ID = update (full replace).
 */
export interface UrlRedirectionSavePayload {
  urlRedirectionID: number;
  originUrl: string;
  destinationUrl: string;
  httpCode: number;
  destinationLocale?: string | null;
  originLocales?: string[] | null;
  content?: string | null;
}

/** Per-item outcome in the batch save response. `index` is the zero-based position in the request payload. */
export interface UrlRedirectionItemResult {
  index: number;
  urlRedirectionID?: number;
  originUrl?: string;
  /** Only set on skipped items (validation failure or origin URL collision). */
  reason?: string;
}

/** Response of POST /api/v1/instance/{guid}/url-redirections */
export interface UrlRedirectionSaveResult {
  created: UrlRedirectionItemResult[];
  updated: UrlRedirectionItemResult[];
  skipped: UrlRedirectionItemResult[];
}
