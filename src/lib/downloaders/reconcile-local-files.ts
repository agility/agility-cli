import * as fs from "fs";
import * as path from "path";

/**
 * PROD-2614: helpers that keep the local agility-files cache truthful about deletions.
 *
 * The pushers treat the cache as the current state of BOTH instances: change detection, conflict
 * detection and the guardrails all read from disk. A file left behind for an entity that was deleted
 * upstream ("ghost") is therefore pushed as if it still existed, or makes the pusher believe the
 * target still has something it no longer does. Models and containers already reconcile against the
 * API list on every pull (download-models.ts / download-containers.ts); these helpers bring the other
 * entity types in line.
 *
 * Callers must only reconcile when they hold the COMPLETE list from the API. A partial page or a
 * failed list call followed by a delete pass would wipe valid local files.
 */

export type ReconcileLog = (message: string) => void;

/**
 * Delete every `{id}.json` in `folderPath` whose id is not in `liveIds`. Non-JSON entries (binary
 * sub-folders, page dumps) are left alone. Returns the removed ids.
 */
export function removeLocalJsonNotIn(
  folderPath: string,
  liveIds: Array<string | number>,
  label: string,
  log?: ReconcileLog
): string[] {
  const keep = new Set<string>(liveIds.map((id) => String(id)));

  const removed: string[] = [];
  if (!fs.existsSync(folderPath)) return removed;
  for (const file of fs.readdirSync(folderPath) || []) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -".json".length);
    if (keep.has(id)) continue;
    fs.unlinkSync(path.join(folderPath, file));
    removed.push(id);
    log?.(`Removed deleted ${label} file: ${file}`);
  }
  return removed;
}

/**
 * Delete every `*.json` in `folderPath` last written before `cutoffMs`. Used after a FULL content
 * sync: the sync SDK rewrites every current item/page, so a file it did not touch belongs to an item
 * deleted (or unpublished) upstream while no sync token was in place to deliver the delete event.
 */
export function removeLocalJsonOlderThan(
  folderPath: string,
  cutoffMs: number,
  label: string,
  log?: ReconcileLog
): string[] {
  const removed: string[] = [];
  if (!fs.existsSync(folderPath)) return removed;
  for (const file of fs.readdirSync(folderPath) || []) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(folderPath, file);
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs >= cutoffMs) continue;
    fs.unlinkSync(filePath);
    removed.push(file.slice(0, -".json".length));
    log?.(`Removed deleted ${label} file: ${file}`);
  }
  return removed;
}

/** Delete every `*.json` in `folderPath` (used to rebuild merged list files on a full content sync). */
export function clearLocalJson(folderPath: string): number {
  if (!fs.existsSync(folderPath)) return 0;
  let count = 0;
  for (const file of fs.readdirSync(folderPath) || []) {
    if (!file.endsWith(".json")) continue;
    fs.unlinkSync(path.join(folderPath, file));
    count++;
  }
  return count;
}
