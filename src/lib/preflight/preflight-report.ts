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

export type PreflightAction = "create" | "update" | "skip" | "conflict";

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
  skip: number;
  conflict: number;
  entries: PreflightEntry[];
}

const ACTION_ORDER: PreflightAction[] = ["create", "update", "skip", "conflict"];

const ACTION_COLOR: Record<PreflightAction, (s: string) => string> = {
  create: ansiColors.green,
  update: ansiColors.cyan,
  skip: ansiColors.gray,
  conflict: ansiColors.red,
};

const ACTION_GLYPH: Record<PreflightAction, string> = {
  create: "+",
  update: "~",
  skip: "·",
  conflict: "✗",
};

class PreflightReport {
  private entries: PreflightEntry[] = [];

  /** Whether preflight mode is active for the current run. */
  isEnabled(): boolean {
    return state.preflight === true;
  }

  /** Clear all recorded actions (called per-command via resetState). */
  reset(): void {
    this.entries = [];
  }

  /**
   * Record a planned action. Safe to call unconditionally — it is a no-op when
   * preflight mode is off, so pushers can record without branching first.
   */
  record(entry: PreflightEntry): void {
    if (!this.isEnabled()) return;
    this.entries.push(entry);
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
        summary = { phase: entry.phase, create: 0, update: 0, skip: 0, conflict: 0, entries: [] };
        byPhase.set(entry.phase, summary);
      }
      summary[entry.action]++;
      summary.entries.push(entry);
    }
    return Array.from(byPhase.values());
  }

  /** Aggregate totals across all phases. */
  getTotals(): Record<PreflightAction, number> {
    const totals: Record<PreflightAction, number> = { create: 0, update: 0, skip: 0, conflict: 0 };
    for (const entry of this.entries) {
      totals[entry.action]++;
    }
    return totals;
  }

  /** Human-readable, colorized per-phase summary. */
  renderTable(): string {
    const lines: string[] = [];
    const bar = "═".repeat(60);

    lines.push(ansiColors.cyan(bar));
    lines.push(ansiColors.cyan("🔎 PREFLIGHT — no changes were written to the target or mappings"));
    lines.push(ansiColors.cyan(bar));

    const phases = this.getPhaseSummaries();
    if (phases.length === 0) {
      lines.push(ansiColors.gray("\nNothing to do — no creates, updates, skips, or conflicts detected.\n"));
      return lines.join("\n");
    }

    for (const phase of phases) {
      const header =
        `\n${ansiColors.bold(phase.phase)}: ` +
        ACTION_COLOR.create(`${phase.create} create, `) +
        ACTION_COLOR.update(`${phase.update} update, `) +
        ACTION_COLOR.skip(`${phase.skip} skip, `) +
        ACTION_COLOR.conflict(`${phase.conflict} conflict`);
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
        ACTION_COLOR.skip(`${totals.skip} skip, `) +
        ACTION_COLOR.conflict(`${totals.conflict} conflict`)
    );
    if (this.hasConflicts()) {
      lines.push(ansiColors.red("\n⚠️  Conflicts detected — a real sync would require --overwrite (exit code 1)."));
    }
    lines.push(ansiColors.cyan(bar));

    return lines.join("\n");
  }

  /** Print the report to stdout. */
  print(): void {
    console.log(this.renderTable());
  }
}

/** Process-level singleton shared by all pushers. */
export const preflightReport = new PreflightReport();
