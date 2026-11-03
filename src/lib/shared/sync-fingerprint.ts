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
 */

import { createHash } from "crypto";

/** Bump when a normalised shape changes: older hashes then count as missing, not as changes. */
export const FINGERPRINT_VERSION = 1;

/** Fields a mapping record carries once fingerprinted. */
export interface SyncFingerprint {
  sourceHash?: string;
  targetHash?: string;
  fingerprintVersion?: number;
}

export type SyncDecision =
  | "skip" // same on both sides now
  | "update" // source changed only
  | "update-unrecorded" // the sides differ and the mapping has no hashes yet: source wins
  | "keep" // target changed only: keep it and warn
  | "conflict"; // both changed

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
  const sourceChanged = sourceHash !== record!.sourceHash;
  const targetChanged = targetHash !== record!.targetHash;
  if (sourceChanged && targetChanged) return "conflict";
  if (targetChanged) return "keep";
  // Source changed only, or neither did while the sides still differ (only possible if the
  // normalisation and the "differs" check drift apart): the source wins, as before.
  return "update";
}

/** The fields to store on a mapping record once the two sides agree. */
export function fingerprintFields(sourceHash: string, targetHash: string): Required<SyncFingerprint> {
  return { sourceHash, targetHash, fingerprintVersion: FINGERPRINT_VERSION };
}

/** Preflight/log detail for a source-wins update on a mapping with no hashes yet. */
export const UNRECORDED_UPDATE_DETAIL =
  "no sync record yet, so the source wins this time; target-only changes are kept from the next sync on";
