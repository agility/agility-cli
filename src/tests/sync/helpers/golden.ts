import { SyncHarness, SyncRun } from "./run-sync";

/**
 * Turn a sync run into a stable, reviewable snapshot.
 *
 * Hand-written assertions do not scale to eight phases: they only ever cover what someone
 * thought to check. A golden snapshot covers *everything the CLI did* — the ordered API
 * conversation, the per-phase outcome, and the mapping tree — so any change to what the CLI
 * sends becomes a diff in the PR rather than a silent behaviour change. `jest -u` accepts it.
 *
 * ## What is normalised, and what deliberately is not
 *
 * **Normalised:** instance GUIDs, to `<source>` / `<target>`. The values are fixture-chosen and
 * carry no meaning, so leaving them raw would rewrite every snapshot the day someone renames a
 * test instance.
 *
 * **NOT normalised: timestamps and IDs.** Both are already deterministic — `FakeInstance`
 * allocates IDs from fixed per-kind ranges and derives timestamps from a per-instance counter.
 * Masking them would throw away most of the snapshot's value: a recreate-instead-of-update
 * regression shows up precisely as a changed target ID, and an ordering change shows up as
 * shifted timestamps. Those are the diffs worth seeing.
 *
 * This is why the counter behind those timestamps is per-instance rather than module-level —
 * see the note on `FakeInstance.tick`.
 */

export interface GoldenSnapshot {
  /** Per-phase outcome, in orchestrator order. Includes phases that did not run. */
  phases: Array<{
    operation: string;
    locale?: string;
    status: string;
    successful: number;
    failed: number;
    skipped: number;
  }>;
  /** The ordered API conversation — the part that catches sequencing regressions. */
  calls: Array<{ method: string; instance?: string; locale?: string; payload?: any }>;
  /** Every mapping file written, keyed by path relative to the mappings root. */
  mappings: Record<string, any>;
}

export interface GoldenOptions {
  /**
   * Drop call payloads and keep only the ordered method list.
   *
   * Useful when a scenario is about *sequence* rather than content — the payload-free form
   * stays readable and does not churn when an unrelated fixture field changes.
   */
  methodsOnly?: boolean;
}

/**
 * Build the snapshot for one run.
 *
 * Pass the run you want recorded: `harness.run()` for a fresh sync, or the result of
 * `harness.resync()` for the second pass. The mapping tree is read at call time, so it
 * reflects whatever the run just wrote.
 */
export function buildGoldenSnapshot(
  harness: SyncHarness,
  run: SyncRun,
  opts: GoldenOptions = {}
): GoldenSnapshot {
  const replaceGuids = (value: any): any =>
    substitute(value, [
      [harness.sourceGuid, "<source>"],
      [harness.targetGuid, "<target>"],
    ]);

  return {
    phases: run.phases.map((p) => ({
      operation: p.operation,
      ...(p.locale ? { locale: p.locale } : {}),
      status: p.status,
      successful: p.successful,
      failed: p.failed,
      skipped: p.skipped,
    })),
    calls: harness.fake.calls.map((c) => ({
      method: c.method,
      ...(c.guid ? { instance: replaceGuids(c.guid) } : {}),
      ...(c.locale ? { locale: c.locale } : {}),
      ...(opts.methodsOnly || c.payload === undefined ? {} : { payload: replaceGuids(c.payload) }),
    })),
    mappings: replaceGuids(harness.readAllMappings()),
  };
}

/**
 * Recursively replace substrings anywhere in a structure — including inside object *keys*,
 * because the mapping tree is keyed by `<source>-<target>/…` directory names.
 */
function substitute(value: any, pairs: Array<[string, string]>): any {
  if (typeof value === "string") {
    return pairs.reduce((acc, [from, to]) => (from ? acc.split(from).join(to) : acc), value);
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, pairs));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    Object.keys(value).forEach((k) => {
      out[substitute(k, pairs)] = substitute(value[k], pairs);
    });
    return out;
  }
  return value;
}
