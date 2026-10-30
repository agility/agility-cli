import { Auth } from "../../core/auth";
import { state } from "../../core/state";
import {
  UrlRedirectionDeleteResult,
  UrlRedirectionSavePayload,
  UrlRedirectionSaveResult,
} from "../../types/urlRedirection";

/** The endpoint processes at most 250 redirections per request. */
export const MAX_URL_REDIRECTION_BATCH_SIZE = 250;

/**
 * Create/update a batch of URL redirections via the Management API:
 * POST /api/v1/instance/{guid}/url-redirections
 *
 * The endpoint is not in @agility/management-sdk yet, so this calls it directly using
 * the same token and base-URL resolution the SDK client is configured with.
 * Items without a urlRedirectionID are created; items with one are updated (full replace).
 * Invalid items and origin-URL collisions are reported in `skipped`, not thrown.
 */
export async function saveUrlRedirections(
  guid: string,
  redirections: UrlRedirectionSavePayload[]
): Promise<UrlRedirectionSaveResult> {
  if (redirections.length > MAX_URL_REDIRECTION_BATCH_SIZE) {
    throw new Error(
      `Cannot save more than ${MAX_URL_REDIRECTION_BATCH_SIZE} redirections at a time (got ${redirections.length}).`
    );
  }

  const auth = new Auth();
  const baseUrl = state.baseUrl || auth.determineBaseUrl(guid);
  const token = await auth.getToken();
  const url = `${baseUrl}/api/v1/instance/${guid}/url-redirections`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "User-Agent": "agility-cli-fetch/1.0",
    },
    body: JSON.stringify(redirections),
  });

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // response body is best-effort error context
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}${body ? ` — ${body}` : ""}`);
  }

  const result = (await response.json()) as UrlRedirectionSaveResult;
  return {
    created: result?.created ?? [],
    updated: result?.updated ?? [],
    skipped: result?.skipped ?? [],
  };
}

/**
 * Delete a batch of URL redirections via the Management API (--syncDeletes):
 * DELETE /api/v1/instance/{guid}/url-redirections?ids=1,2,3
 *
 * Like the save endpoint this is not in @agility/management-sdk yet. IDs that no longer match an
 * active redirection come back in `notFound` rather than failing the request.
 */
export async function deleteUrlRedirections(guid: string, ids: number[]): Promise<UrlRedirectionDeleteResult> {
  if (ids.length > MAX_URL_REDIRECTION_BATCH_SIZE) {
    throw new Error(
      `Cannot delete more than ${MAX_URL_REDIRECTION_BATCH_SIZE} redirections at a time (got ${ids.length}).`
    );
  }

  const auth = new Auth();
  const baseUrl = state.baseUrl || auth.determineBaseUrl(guid);
  const token = await auth.getToken();
  const url = `${baseUrl}/api/v1/instance/${guid}/url-redirections?ids=${ids.join(",")}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Cache-Control": "no-cache",
      "User-Agent": "agility-cli-fetch/1.0",
    },
  });

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // response body is best-effort error context
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}${body ? ` — ${body}` : ""}`);
  }

  const result = (await response.json()) as any;
  return {
    deleted: result?.deleted ?? result?.Deleted ?? [],
    notFound: result?.notFound ?? result?.NotFound ?? [],
  };
}
