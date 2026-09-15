/**
 * Machine-readable run summary (`--jsonSummary=<path>`).
 *
 * A sync reports itself to a human today: coloured console sections plus a per-operation
 * log file. Neither is assertable. CI can see that the process exited, and not much else —
 * `.github/workflows/agility-sync.yml` runs a real sync with no assertions for exactly this
 * reason. This module serializes what the run already knows into one JSON file so a test,
 * a workflow step or a person can assert on it.
 *
 * Scope is deliberately narrow: **per-phase success/failure/skip counts, the failure and
 * warning details behind them, the exit signal, and the preflight plan when preflight ran.**
 * It does NOT split `successful` into created-vs-updated — the preflight pass already records
 * that distinction, and a recreate-instead-of-update regression shows up in the mapping tree.
 *
 * Two properties this file is deliberately built around:
 *
 * 1. **It reports the CLI's own bookkeeping as-is, rather than a corrected version of it.**
 *    The run's `success` verdict and its per-item counts are computed independently and can
 *    disagree; both are recorded so a consumer can compare them instead of trusting whichever
 *    one this file chose. Serializing what the CLI currently reports is what makes present
 *    behaviour assertable, so any later change to it surfaces as a diff.
 * 2. **Volatile fields are quarantined under `run`.** Everything that changes between two
 *    otherwise-identical runs (timestamps, duration, log paths, CLI version) lives there, so a
 *    golden-file comparison can drop one key instead of walking the tree.
 */
import * as fs from "fs";
import * as path from "path";

/** Bump when a field is removed or its meaning changes. Additions do not require a bump. */
export const JSON_SUMMARY_SCHEMA_VERSION = 1;

/** Per-item failure/warning detail, mirroring `FailureDetail` in types/sourceData. */
export interface JsonSummaryDetail {
  name: string;
  error: string;
  type?: "content" | "page";
  pageID?: number;
  contentID?: number;
  guid?: string;
  locale?: string;
}

/**
 * One pusher invocation. Locale-scoped phases (Content, Pages) appear once per locale, so
 * `operation` is not unique — the (operation, locale) pair is.
 */
export interface JsonSummaryPhase {
  /** Internal operation name, e.g. "pushModels". Stable across releases. */
  operation: string;
  /** Human description as printed to the console, e.g. "Push content models and field definitions". */
  description: string;
  /** Locale for locale-scoped phases; omitted for guid-level phases. */
  locale?: string;
  successful: number;
  failed: number;
  skipped: number;
  /**
   * "success" / "error" come from the pusher itself. "notRun" means the phase was filtered out
   * before the pusher was called — no source data, or excluded by --elements. A phase that
   * never ran is distinct from one that ran and did nothing, and conflating them hides a
   * misconfigured --elements.
   */
  status: "success" | "error" | "notRun";
}

export interface JsonSummaryPreflightPhase {
  phase: string;
  create: number;
  update: number;
  skip: number;
  conflict: number;
}

export interface JsonSummaryPreflight {
  totals: { create: number; update: number; skip: number; conflict: number };
  hasConflicts: boolean;
  phases: JsonSummaryPreflightPhase[];
  /** Every recorded action, in the order the pushers recorded them. */
  entries: Array<{
    phase: string;
    action: "create" | "update" | "skip" | "conflict";
    name: string;
    locale?: string;
    detail?: string;
  }>;
}

export interface JsonSummary {
  schemaVersion: number;
  command: "sync" | "push";
  /**
   * The run's own verdict, as the CLI computed it. This is NOT derived from
   * `totals.failed === 0`; the two are independent and both are recorded so they can be
   * compared.
   */
  success: boolean;
  exitCode: number;
  source: string;
  target: string;
  options: {
    preflight: boolean;
    overwrite: boolean;
    autoPublish: string;
    elements: string[];
    locales: string[];
    channel: string;
  };
  phases: JsonSummaryPhase[];
  totals: { successful: number; failed: number; skipped: number };
  /** Item-level failures — the detail behind `totals.failed`. */
  failures: JsonSummaryDetail[];
  /** Non-blocking notices (PROD-2316). Never affect `success` or the exit code. */
  warnings: JsonSummaryDetail[];
  /** Operation-level failures — a whole pusher threw, as opposed to an item failing. */
  operationErrors: Array<{ type: string; error: string; locale?: string }>;
  autoPublish: {
    /** Blocking publish failures. */
    errors: Array<{ type: string; error: string; locale?: string }>;
    /** Post-publish bookkeeping notices (PROD-2311) — non-blocking by design. */
    warnings: Array<{ type: string; error: string; locale?: string }>;
  };
  /** Present only when --preflight ran. A plan, not an observation — see the module docblock. */
  preflight: JsonSummaryPreflight | null;
  /** Everything that differs between two otherwise-identical runs. Drop this for golden files. */
  run: {
    cliVersion: string;
    startedAt: string;
    finishedAt: string;
    elapsedMs: number;
    logFiles: string[];
  };
}

/**
 * Resolve the CLI's own version.
 *
 * Worth recording: the log file does not carry it today, so when a CI run misbehaves there is
 * no way to tell from the artifacts which version produced it — which matters most exactly
 * when a workflow pins an old published package rather than building from the checkout.
 */
export function resolveCliVersion(): string {
  // dist/core/ at runtime, src/core/ under ts-jest — walk up until package.json turns up.
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "package.json");
    try {
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (pkg?.name === "@agility/cli" && pkg?.version) return String(pkg.version);
      }
    } catch {
      // Unreadable or malformed package.json — keep walking rather than fail the run.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "unknown";
}

/**
 * Summary for a run that aborted before the push pipeline started — failed authentication,
 * or a failed precondition such as a locale missing on the target.
 *
 * Same schema, zero phases, and the reason recorded as an operation-level error. A harness
 * then never has to special-case a missing file: if the flag was passed, a summary exists,
 * and `phases: []` with a populated `operationErrors` says the run never got going.
 */
export function buildAbortSummary(input: {
  command: "sync" | "push";
  reason: string;
  source: string;
  target: string;
  options: JsonSummary["options"];
  startedAt: Date;
  cliVersion?: string;
}): JsonSummary {
  const now = new Date();
  return buildJsonSummary({
    command: input.command,
    success: false,
    exitCode: 1,
    source: input.source,
    target: input.target,
    options: input.options,
    phases: [],
    failures: [],
    warnings: [],
    operationErrors: [{ type: "abort", error: input.reason }],
    autoPublishErrors: [],
    preflight: null,
    startedAt: input.startedAt,
    finishedAt: now,
    elapsedMs: now.getTime() - input.startedAt.getTime(),
    logFiles: [],
    cliVersion: input.cliVersion,
  });
}

/**
 * Write an abort summary from the current run state, when --jsonSummary is set.
 *
 * Takes the state slice rather than importing `state`, so this module stays free of the
 * global and remains testable without a CLI run. No-ops when the flag is absent; never
 * throws, for the same reason writeJsonSummary does not.
 */
export function emitAbortSummary(
  runState: {
    jsonSummary?: string;
    isSync?: boolean;
    sourceGuid?: string;
    targetGuid?: string;
    preflight?: boolean;
    overwrite?: boolean;
    autoPublish?: string;
    elements?: string;
    locale?: string[];
    channel?: string;
  },
  reason: string,
  startedAt: Date = new Date()
): { written: boolean; error?: string } {
  if (!runState.jsonSummary) return { written: false };
  try {
    const summary = buildAbortSummary({
      command: runState.isSync ? "sync" : "push",
      reason,
      source: runState.sourceGuid || "",
      target: runState.targetGuid || "",
      options: {
        preflight: runState.preflight === true,
        overwrite: runState.overwrite === true,
        autoPublish: runState.autoPublish || "",
        elements: (runState.elements || "").split(",").filter(Boolean),
        locales: Array.isArray(runState.locale) ? runState.locale : [],
        channel: runState.channel || "",
      },
      startedAt,
    });
    return writeJsonSummary(runState.jsonSummary, summary);
  } catch (error: any) {
    return { written: false, error: error?.message || String(error) };
  }
}

export interface BuildJsonSummaryInput {
  command: "sync" | "push";
  success: boolean;
  exitCode: number;
  source: string;
  target: string;
  options: JsonSummary["options"];
  phases: JsonSummaryPhase[];
  failures: JsonSummaryDetail[];
  warnings: JsonSummaryDetail[];
  operationErrors: Array<{ type: string; error: string; locale?: string }>;
  autoPublishErrors: Array<{ type: string; error: string; locale?: string }>;
  preflight: JsonSummaryPreflight | null;
  startedAt: Date;
  finishedAt: Date;
  elapsedMs: number;
  logFiles: string[];
  cliVersion?: string;
}

/**
 * Assemble the summary. Pure — takes everything it needs, touches no globals and no disk, so
 * the shape can be tested without running a sync.
 */
export function buildJsonSummary(input: BuildJsonSummaryInput): JsonSummary {
  const totals = input.phases.reduce(
    (acc, p) => ({
      successful: acc.successful + p.successful,
      failed: acc.failed + p.failed,
      skipped: acc.skipped + p.skipped,
    }),
    { successful: 0, failed: 0, skipped: 0 }
  );

  // Same split the console summary uses (PROD-2311): "publish"/"fatal" block the run,
  // "mapping"/"refresh" are post-publish bookkeeping and deliberately do not.
  const autoPublishErrors = input.autoPublishErrors.filter((e) => e.type === "publish" || e.type === "fatal");
  const autoPublishWarnings = input.autoPublishErrors.filter((e) => e.type === "mapping" || e.type === "refresh");

  return {
    schemaVersion: JSON_SUMMARY_SCHEMA_VERSION,
    command: input.command,
    success: input.success,
    exitCode: input.exitCode,
    source: input.source,
    target: input.target,
    options: input.options,
    phases: input.phases,
    totals,
    failures: input.failures,
    warnings: input.warnings,
    operationErrors: input.operationErrors,
    autoPublish: { errors: autoPublishErrors, warnings: autoPublishWarnings },
    preflight: input.preflight,
    run: {
      cliVersion: input.cliVersion ?? resolveCliVersion(),
      startedAt: input.startedAt.toISOString(),
      finishedAt: input.finishedAt.toISOString(),
      elapsedMs: input.elapsedMs,
      logFiles: input.logFiles,
    },
  };
}

/**
 * Write the summary to disk, creating parent directories as needed.
 *
 * Never throws. A reporting artifact must not be able to fail a sync that otherwise
 * succeeded — an unwritable path is worth a warning, not a non-zero exit. Returns whether
 * the write landed so the caller can say so.
 */
export function writeJsonSummary(filePath: string, summary: JsonSummary): { written: boolean; error?: string } {
  try {
    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, JSON.stringify(summary, null, 2) + "\n", "utf8");
    return { written: true };
  } catch (error: any) {
    return { written: false, error: error?.message || String(error) };
  }
}
