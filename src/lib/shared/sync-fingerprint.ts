/**
 * Sync fingerprints (PROD-3078): telling which side changed for entities with no version or
 * modified date (page templates, URL redirections).
 *
 * After each sync that leaves both sides in agreement, the mapping record stores a hash of each
 * side's normalised shape (`sourceHash` / `targetHash`, so reverse sync transposes them with the
 * IDs). On the next sync, a side whose current hash differs from its stored one changed since.
 * The normalised shape leaves out per-instance IDs and is the same shape the pushers' "differs"
 * checks compare, so "changed" and "differs" can't disagree.
 *
 * The decision follows the rule the other types use (see kept-target-changes.ts):
 *   - the two sides are the same now: skip, and record the hashes (seeds old mappings too)
 *   - no hashes recorded (mapping from an older CLI): the source wins, as before, then record
 *   - only the source changed: update
 *   - only the target changed: keep the target and warn; the record isn't refreshed
 *   - both changed: conflict; the record isn't refreshed
 *   - --overwrite: the source wins in the last two cases
 *   - a side still shows what the last sync replaced (types pulled from the Fetch API, which shows
 *     a save a while later): skip until it catches up, so a stale pull is neither an edit nor
 *     synced back
 */

import { createHash } from "crypto";

/** Bump when a normalised shape changes: older hashes then count as missing, not as changes. */
export const FINGERPRINT_VERSION = 1;

/** Fields a mapping record carries once fingerprinted. */
export interface SyncFingerprint {
  sourceHash?: string;
  targetHash?: string;
  fingerprintVersion?: number;
  /**
   * The target's hash before the sync replaced it, kept until a pull shows the replacement. Types
   * pulled from the Fetch API (redirections) show a save a while later, and a pull in that window
   * still shows what was replaced: that isn't an edit. A reverse sync reads it as
   * `sourceReplacedHash`, the side it now syncs from.
   */
  targetReplacedHash?: string;
  sourceReplacedHash?: string;
}

export type SyncDecision =
  | "skip" // same on both sides now
  | "update" // source changed only
  | "update-unrecorded" // the sides differ and the mapping has no hashes yet: source wins
  | "keep" // target changed only: keep it and warn
  | "conflict" // both changed
  | "pending"; // a side still shows what the last sync replaced (the Fetch API hasn't caught up): wait

/** JSON with object keys sorted, so equal values always serialise the same way. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashShape(shape: unknown): string {
  return createHash("sha1").update(stableStringify(shape)).digest("hex");
}

/** Whether the record carries hashes from the current fingerprint version. */
export function hasFingerprint(record: SyncFingerprint | null | undefined): boolean {
  return (
    !!record?.sourceHash && !!record?.targetHash && record.fingerprintVersion === FINGERPRINT_VERSION
  );
}

/**
 * Decide what to do with a mapped pair whose target still exists.
 *
 * @param inSync      whether the two sides are the same now (the pusher's own "differs" check)
 * @param sourceHash  hash of the current source's normalised shape
 * @param targetHash  hash of the current target's normalised shape
 * @param record      the mapping record, with any hashes from the last sync
 *
 * --overwrite is applied by the caller: it turns "keep" and "conflict" into an update.
 */
export function decideSync(
  inSync: boolean,
  sourceHash: string,
  targetHash: string,
  record: SyncFingerprint | null | undefined
): SyncDecision {
  if (inSync) return "skip";
  if (!hasFingerprint(record)) return "update-unrecorded";
  const r = record!;
  // A side that still shows what the last sync replaced was pulled before the save reached the
  // Fetch API: not an edit. Syncing from a source in that state would put the old version back.
  const sourcePending = sourceHash !== r.sourceHash && !!r.sourceReplacedHash && sourceHash === r.sourceReplacedHash;
  const targetPending = targetHash !== r.targetHash && !!r.targetReplacedHash && targetHash === r.targetReplacedHash;
  const sourceChanged = sourceHash !== r.sourceHash && !sourcePending;
  const targetChanged = targetHash !== r.targetHash && !targetPending;
  if (sourceChanged && targetChanged) return "conflict";
  if (targetChanged) return "keep";
  if (sourceChanged) return "update";
  if (sourcePending || targetPending) return "pending";
  // Neither changed while the sides still differ (only possible if the normalisation and the
  // "differs" check drift apart): the source wins, as before.
  return "update";
}

/**
 * The fields to store on a mapping record once the two sides agree. `targetReplacedHash` is the
 * target's hash before this sync replaced it, for types pulled from the Fetch API; leaving it out
 * clears any earlier one (it is written as undefined, which the mapping file drops).
 */
export function fingerprintFields(sourceHash: string, targetHash: string, targetReplacedHash?: string): SyncFingerprint {
  return {
    sourceHash,
    targetHash,
    fingerprintVersion: FINGERPRINT_VERSION,
    targetReplacedHash,
    sourceReplacedHash: undefined,
  };
}

/** Preflight/log detail for an entity skipped until the Fetch API shows the last sync's change. */
export const PENDING_DETAIL = "the last sync's change isn't in the Fetch API yet; skipped until it is";

/** Preflight/log detail for a source-wins update on a mapping with no hashes yet. */
export const UNRECORDED_UPDATE_DETAIL =
  "no sync record yet, so the source wins this time; target-only changes are kept from the next sync on";
