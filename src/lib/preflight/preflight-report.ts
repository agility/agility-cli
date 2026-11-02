/**
 * Preflight report collector (PROD-2203)
 *
 * Central, in-memory collector for the actions a sync/push WOULD take when run
 * in `--preflight` mode. Each pusher records the outcome of its change-detection
 * (create / update / skip / conflict) here instead of writing to the target
 * instance or mapping files. At the end of the run the report is rendered as a
 * human-readable table.
 *
 * This is a process-level singleton because the push pipeline threads `state`
 * globally rather than passing context objects down to each pusher.
 */
import ansiColors from "ansi-colors";
import { state } from "../../core/state";

/**
 * "invalid" (PROD-2542): the item would be created/updated, but fails client-side validation against
 * the target model (e.g. a missing required field), so a real run skips it and reports a failure.
 * It is a warning in the plan: not a write, and — unlike "conflict" — it doesn't set the exit code.
 */
export type PreflightAction = "create" | "update" | "delete" | "skip" | "conflict" | "invalid";

export interface PreflightEntry {
  /** Phase / element type, e.g. "Models", "Containers", "Content". */
  phase: string;
  /** What the real sync would do for this item. */
  action: PreflightAction;
  /** Human-friendly identifier for the item (reference name, title, path, etc.). */
  name: string;
  /** Locale, for locale-scoped phases (content, pages). */
  locale?: string;
  /** Optional extra context, e.g. the reason for a skip or the nature of a conflict. */
  detail?: string;
}

export interface PreflightPhaseSummary {
  phase: string;
  create: number;
  update: number;
  delete: number;
  skip: number;
  conflict: number;
  invalid: number;
  entries: PreflightEntry[];
}

const ACTION_ORDER: PreflightAction[] = ["create", "update", "delete", "skip", "conflict", "invalid"];

const ACTION_COLOR: Record<PreflightAction, (s: string) => string> = {
  create: ansiColors.green,
  update: ansiColors.cyan,
  delete: ansiColors.magenta,
  skip: ansiColors.gray,
  conflict: ansiColors.red,
  invalid: ansiColors.yellow,
};

const ACTION_GLYPH: Record<PreflightAction, string> = {
  create: "+",
  update: "~",
  delete: "-",
  skip: "·",
  conflict: "✗",
  invalid: "!",
};

class PreflightReport {
  private entries: PreflightEntry[] = [];
  // PROD-2773: non-blocking notices shown under their own heading. Kept apart from `entries`
  // so they never change a phase count, the totals, or the conflict exit code.
  private warnings: string[] = [];

  /** Whether preflight mode is active for the current run. */
  isEnabled(): boolean {
    return state.preflight === true;
  }

  /** Clear all recorded actions (called per-command via resetState). */
  reset(): void {
    this.entries = [];
    this.warnings = [];
  }

  /**
   * Record a planned action. Safe to call unconditionally — it is a no-op when
   * preflight mode is off, so pushers can record without branching first.
   */
  record(entry: PreflightEntry): void {
    if (!this.isEnabled()) return;
    this.entries.push(entry);
  }

  /** PROD-2773: record a non-blocking warning line. No-op when preflight mode is off. */
  recordWarning(message: string): void {
    if (!this.isEnabled()) return;
    this.warnings.push(message);
  }

  getWarnings(): string[] {
    return this.warnings;
  }

  /** True if any item would conflict (used to set a non-zero exit code). */
  hasConflicts(): boolean {
    return this.entries.some((e) => e.action === "conflict");
  }

  getEntries(): PreflightEntry[] {
    return this.entries;
  }

  /** Per-phase counts, preserving first-seen phase order. */
  getPhaseSummaries(): PreflightPhaseSummary[] {
    const byPhase = new Map<string, PreflightPhaseSummary>();
    for (const entry of this.entries) {
      let summary = byPhase.get(entry.phase);
      if (!summary) {
        summary = { phase: entry.phase, create: 0, update: 0, delete: 0, skip: 0, conflict: 0, invalid: 0, entries: [] };
        byPhase.set(entry.phase, summary);
      }
      summary[entry.action]++;
      summary.entries.push(entry);
    }
    return Array.from(byPhase.values());
  }

  /** Aggregate totals across all phases. */
  getTotals(): Record<PreflightAction, number> {
    const totals: Record<PreflightAction, number> = { create: 0, update: 0, delete: 0, skip: 0, conflict: 0, invalid: 0 };
    for (const entry of this.entries) {
      totals[entry.action]++;
    }
    return totals;
  }

  /**
   * Machine-readable form of the same report, for --jsonSummary.
   *
   * Emitted even when no actions were recorded, so a consumer can tell "preflight ran and
   * planned nothing" from "preflight did not run" (the latter is a null preflight key).
   *
   * This is a *plan*, not an observation. It is what change-detection predicts a real sync
   * would do, and the mapping to real outcomes is not 1:1 — a cross-kind model collision
   * (PROD-2315) is previewed as `conflict` precisely because a real run fails it. Assert
   * against this only for scenarios that actually ran with --preflight.
   */
  toJSON(): {
    totals: Record<PreflightAction, number>;
    hasConflicts: boolean;
    phases: Array<{
      phase: string;
      create: number;
      update: number;
      delete: number;
      skip: number;
      conflict: number;
      invalid: number;
    }>;
    entries: PreflightEntry[];
  } {
    return {
      totals: this.getTotals(),
      hasConflicts: this.hasConflicts(),
      phases: this.getPhaseSummaries().map(({ phase, create, update, delete: deletes, skip, conflict, invalid }) => ({
        phase,
        create,
        update,
        delete: deletes,
        skip,
        conflict,
        invalid,
      })),
      entries: this.getEntries(),
    };
  }

  /** Human-readable, colorized per-phase summary. */
  renderTable(): string {
    const lines: string[] = [];
    const bar = "═".repeat(60);

    lines.push(ansiColors.cyan(bar));
    lines.push(ansiColors.cyan("🔎 PREFLIGHT — no changes were written to the target or mappings"));
    // PROD-2546: say so when the run was narrowed to a page subtree, or the report reads as
    // "the whole instance is up to date" when it only ever looked at part of it.
    if (state.pages && state.pages.trim().length > 0) {
      lines.push(ansiColors.gray(`Scoped to --pages: ${state.pages.trim()}`));
    }
    // PROD-2547: same for a container-scoped run.
    if (state.containers && state.containers.trim().length > 0) {
      lines.push(ansiColors.gray(`Scoped to --containers: ${state.containers.trim()}`));
    }
    lines.push(ansiColors.cyan(bar));

    const phases = this.getPhaseSummaries();
    if (phases.length === 0) {
      lines.push(ansiColors.gray("\nNothing to do — no creates, updates, deletes, skips, or conflicts detected.\n"));
      lines.push(...this.renderWarnings());
      return lines.join("\n");
    }

    for (const phase of phases) {
      const header =
        `\n${ansiColors.bold(phase.phase)}: ` +
        ACTION_COLOR.create(`${phase.create} create, `) +
        ACTION_COLOR.update(`${phase.update} update, `) +
        (phase.delete > 0 ? ACTION_COLOR.delete(`${phase.delete} delete, `) : "") +
        ACTION_COLOR.skip(`${phase.skip} skip, `) +
        ACTION_COLOR.conflict(`${phase.conflict} conflict`) +
        (phase.invalid > 0 ? ACTION_COLOR.invalid(`, ${phase.invalid} invalid`) : "");
      lines.push(header);

      // List entries grouped by action so creates/updates/conflicts are easy to scan.
      for (const action of ACTION_ORDER) {
        const items = phase.entries.filter((e) => e.action === action);
        for (const item of items) {
          const color = ACTION_COLOR[action];
          const localePart = item.locale ? ansiColors.gray(`[${item.locale}] `) : "";
          const detailPart = item.detail ? ansiColors.gray(` — ${item.detail}`) : "";
          lines.push(`  ${color(ACTION_GLYPH[action])} ${localePart}${item.name}${detailPart}`);
        }
      }
    }

    const totals = this.getTotals();
    lines.push(ansiColors.cyan("\n" + bar));
    lines.push(
      ansiColors.bold("TOTAL: ") +
        ACTION_COLOR.create(`${totals.create} create, `) +
        ACTION_COLOR.update(`${totals.update} update, `) +
        (totals.delete > 0 ? ACTION_COLOR.delete(`${totals.delete} delete, `) : "") +
        ACTION_COLOR.skip(`${totals.skip} skip, `) +
        ACTION_COLOR.conflict(`${totals.conflict} conflict`) +
        (totals.invalid > 0 ? ACTION_COLOR.invalid(`, ${totals.invalid} invalid`) : "")
    );
    if (totals.invalid > 0) {
      lines.push(
        ansiColors.yellow(
          `\n⚠️  ${totals.invalid} item(s) fail validation against the target model — a real sync would skip them and report them as failures.`
        )
      );
    }
    if (this.hasConflicts()) {
      lines.push(ansiColors.red("\n⚠️  Conflicts detected — a real sync would require --overwrite (exit code 1)."));
    }
    lines.push(...this.renderWarnings());
    lines.push(ansiColors.cyan(bar));

    return lines.join("\n");
  }

  /** PROD-2773: the warnings section — not counted in the totals and never affects the exit code. */
  private renderWarnings(): string[] {
    if (this.warnings.length === 0) return [];
    return [
      ansiColors.yellow(`\nWarnings (${this.warnings.length}, non-blocking — not counted above):`),
      ...this.warnings.map((w) => ansiColors.yellow(`  ⚠ ${w}`)),
    ];
  }

  /** Print the report to stdout. */
  print(): void {
    console.log(this.renderTable());
  }
}

/** Process-level singleton shared by all pushers. */
export const preflightReport = new PreflightReport();
