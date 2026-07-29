import { fileOperations } from "../../../core";
import { UrlRedirectionSyncItem, UrlRedirectionSyncFile } from "../../../types/urlRedirection";

/**
 * Get URL redirections from the filesystem without side effects.
 * The Content Sync SDK stores them per-locale at urlredirections/urlredirections.json,
 * so the fileOps instance must be locale-level. The set is instance-wide (the same for
 * every locale), so reading one locale's file is sufficient.
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getUrlRedirectionsFromFileSystem(fileOps: fileOperations): UrlRedirectionSyncItem[] {
  const data: UrlRedirectionSyncFile | null = fileOps.readJsonFile("urlredirections/urlredirections.json");
  if (!data || !Array.isArray(data.items)) {
    return [];
  }
  return data.items;
}
