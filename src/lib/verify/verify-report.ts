/**
 * Findings, tallies and the report for `agility verify` (PROD-2552).
 *
 * The report is the product of the command: CI reads the exit code, a person reads the console
 * table, and a harness asserts on the JSON. All three are derived from the same findings list, so
 * they cannot disagree.
 *
 * Exit codes:
 *   0 — every check passed (warnings and source defects do not fail a run)
 *   1 — at least one failure-severity finding
 *   2 — the run could not verify at all (auth, status guard, pull, missing mappings, unreadable cache)
 */
import * as path from "path";
import ansiColors from "ansi-colors";
import { writeJsonSummary, resolveCliVersion } from "../../core/json-summary";

/** Bump when a field is removed or its meaning changes. Additions do not require a bump. */
export const VERIFY_REPORT_SCHEMA_VERSION = 1;

export const EXIT_PASS = 0;
export const EXIT_DIFFERENCES = 1;
export const EXIT_CANNOT_VERIFY = 2;

/**
 * - failure: the target differs from the source in a way the migration should have prevented.
 * - warning: worth knowing, does not fail the run (extra target items, publish-state drift).
 * - sourceDefect: a difference explained by the source item itself (e.g. a missing required
 *   field the target would reject). Listed, does not fail the run.
 */
export type Severity = "failure" | "warning" | "sourceDefect";

export type EntityKind =
  | "model"
  | "container"
  | "template"
  | "asset"
  | "gallery"
  | "content"
  | "page"
  | "zone"
  | "sitemap";

export interface Finding {
  category: string;
  severity: Severity;
  entity: EntityKind;
  /** Locale for locale-scoped entities; "*" for instance-wide ones (models, containers, ...). */
  locale: string;
  sourceID?: number | string | null;
  targetID?: number | string | null;
  name?: string;
  /** A field name, zone name, or sitemap path — what inside the entity differs. */
  path?: string;
  expected?: any;
  actual?: any;
  /** Human sentence for the console. */
  message?: string;
}

export interface Tally {
  checked: number;
  matched: number;
  mismatched: number;
  missing: number;
  extra: number;
  known: number;
}

/** Instance-wide entities (models, containers, templates, assets, galleries) are tallied here. */
export const INSTANCE_LOCALE = "*";

export function emptyTally(): Tally {
  return { checked: 0, matched: 0, mismatched: 0, missing: 0, extra: 0, known: 0 };
}

/**
 * Collects findings and per-(locale, entity) tallies as the checks run. Each check decides what an
 * entity's outcome is; the collector only counts.
 */
export class FindingCollector {
  readonly findings: Finding[] = [];
  private readonly tallies = new Map<string, Map<EntityKind, Tally>>();

  add(finding: Finding): void {
    this.findings.push(finding);
  }

  tally(locale: string, entity: EntityKind): Tally {
    let byEntity = this.tallies.get(locale);
    if (!byEntity) {
      byEntity = new Map();
      this.tallies.set(locale, byEntity);
    }
    let tally = byEntity.get(entity);
    if (!tally) {
      tally = emptyTally();
      byEntity.set(entity, tally);
    }
    return tally;
  }

  count(locale: string, entity: EntityKind, outcome: keyof Tally, by: number = 1): void {
    this.tally(locale, entity)[outcome] += by;
  }

  /** Locales in a stable order: instance-wide first, then alphabetical. */
  locales(): string[] {
    return Array.from(this.tallies.keys()).sort((a, b) =>
      a === INSTANCE_LOCALE ? -1 : b === INSTANCE_LOCALE ? 1 : a.localeCompare(b)
    );
  }

  talliesFor(locale: string): Record<string, Tally> {
    const out: Record<string, Tally> = {};
    const byEntity = this.tallies.get(locale);
    if (!byEntity) return out;
    Array.from(byEntity.keys())
      .sort()
      .forEach((entity) => (out[entity] = { ...(byEntity.get(entity) as Tally) }));
    return out;
  }
}

export function computeExitCode(findings: Finding[]): number {
  return findings.some((f) => f.severity === "failure") ? EXIT_DIFFERENCES : EXIT_PASS;
}

export interface SeverityCounts {
  failures: number;
  warnings: number;
  sourceDefects: number;
}

function countSeverities(findings: Finding[]): SeverityCounts {
  return {
    failures: findings.filter((f) => f.severity === "failure").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    sourceDefects: findings.filter((f) => f.severity === "sourceDefect").length,
  };
}

export interface StatusSnapshot {
  guid: string;
  mode: string;
  checkedAt: string;
  inProgress: boolean;
  lastContentVersionID: number | null;
  maxChangeDate: string | null;
}

export interface VerifyRunInfo {
  cliVersion: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  pull: { attempts: number; elapsedMs: number[] };
  status: { before: StatusSnapshot[]; after: StatusSnapshot[] };
  compareElapsedMs: number;
}

export interface VerifyOptionsSummary {
  locales: string[];
  channel: string;
  models: string;
  pages: string;
  containers: string;
}

export interface VerifyReport {
  schemaVersion: number;
  command: "verify";
  verdict: "pass" | "fail" | "error";
  exitCode: number;
  /** Set when exitCode is 2: why the run could not verify. */
  error?: string;
  source: string;
  target: string;
  options: VerifyOptionsSummary;
  totals: SeverityCounts & {
    byCategory: Record<string, number>;
    entities: Record<string, Tally>;
  };
  byLocale: Record<string, SeverityCounts & { entities: Record<string, Tally> }>;
  findings: Finding[];
  /** Everything that differs between two otherwise-identical runs. Drop this for golden files. */
  run: VerifyRunInfo;
}

/** Stable ordering, so two runs over the same data produce byte-identical findings. */
export function sortFindings(findings: Finding[]): Finding[] {
  const key = (v: any) => (v === undefined || v === null ? "" : String(v));
  const severityRank: Record<Severity, number> = { failure: 0, sourceDefect: 1, warning: 2 };
  return findings.slice().sort((a, b) => {
    return (
      key(a.locale).localeCompare(key(b.locale)) ||
      severityRank[a.severity] - severityRank[b.severity] ||
      a.category.localeCompare(b.category) ||
      a.entity.localeCompare(b.entity) ||
      key(a.sourceID).localeCompare(key(b.sourceID), undefined, { numeric: true }) ||
      key(a.targetID).localeCompare(key(b.targetID), undefined, { numeric: true }) ||
      key(a.path).localeCompare(key(b.path))
    );
  });
}

export function emptyRunInfo(startedAt: Date = new Date()): VerifyRunInfo {
  return {
    cliVersion: resolveCliVersion(),
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    elapsedMs: 0,
    pull: { attempts: 0, elapsedMs: [] },
    status: { before: [], after: [] },
    compareElapsedMs: 0,
  };
}

export function buildVerifyReport(input: {
  source: string;
  target: string;
  options: VerifyOptionsSummary;
  collector: FindingCollector;
  run: VerifyRunInfo;
}): VerifyReport {
  const findings = sortFindings(input.collector.findings);
  const exitCode = computeExitCode(findings);

  const byCategory: Record<string, number> = {};
  findings.forEach((f) => (byCategory[f.category] = (byCategory[f.category] || 0) + 1));
  const sortedByCategory: Record<string, number> = {};
  Object.keys(byCategory)
    .sort()
    .forEach((k) => (sortedByCategory[k] = byCategory[k]));

  const byLocale: VerifyReport["byLocale"] = {};
  const entityTotals: Record<string, Tally> = {};
  input.collector.locales().forEach((locale) => {
    const entities = input.collector.talliesFor(locale);
    byLocale[locale] = { ...countSeverities(findings.filter((f) => f.locale === locale)), entities };
    Object.keys(entities).forEach((entity) => {
      const total = entityTotals[entity] ?? emptyTally();
      (Object.keys(total) as Array<keyof Tally>).forEach((k) => (total[k] += entities[entity][k]));
      entityTotals[entity] = total;
    });
  });
  const sortedEntityTotals: Record<string, Tally> = {};
  Object.keys(entityTotals)
    .sort()
    .forEach((k) => (sortedEntityTotals[k] = entityTotals[k]));

  return {
    schemaVersion: VERIFY_REPORT_SCHEMA_VERSION,
    command: "verify",
    verdict: exitCode === EXIT_PASS ? "pass" : "fail",
    exitCode,
    source: input.source,
    target: input.target,
    options: input.options,
    totals: { ...countSeverities(findings), byCategory: sortedByCategory, entities: sortedEntityTotals },
    byLocale,
    findings,
    run: input.run,
  };
}

/** Report for a run that could not verify (exit 2). Same schema, no findings. */
export function buildErrorReport(input: {
  source: string;
  target: string;
  options: VerifyOptionsSummary;
  error: string;
  run: VerifyRunInfo;
}): VerifyReport {
  return {
    schemaVersion: VERIFY_REPORT_SCHEMA_VERSION,
    command: "verify",
    verdict: "error",
    exitCode: EXIT_CANNOT_VERIFY,
    error: input.error,
    source: input.source,
    target: input.target,
    options: input.options,
    totals: { failures: 0, warnings: 0, sourceDefects: 0, byCategory: {}, entities: {} },
    byLocale: {},
    findings: [],
    run: input.run,
  };
}

export function defaultReportPath(rootPath: string, sourceGuid: string, targetGuid: string, at: Date): string {
  const timestamp = at.toISOString().replace(/[:.]/g, "-");
  return path.join(rootPath, "logs", `verify-${sourceGuid}-${targetGuid}-${timestamp}.json`);
}

/** Never throws — an unwritable report path is a warning, not a different verdict. */
export function writeVerifyReport(filePath: string, report: VerifyReport): { written: boolean; error?: string } {
  return writeJsonSummary(filePath, report);
}

// ─── console output ──────────────────────────────────────────────────────────

/** How many findings to print per category before summarizing the rest. */
export const MAX_DETAILS_PER_CATEGORY = 20;

const TABLE_COLUMNS: Array<keyof Tally> = ["checked", "matched", "mismatched", "missing", "extra", "known"];

function formatValue(value: any, max: number = 160): string {
  if (value === undefined) return "(none)";
  let text: string;
  if (Array.isArray(value)) {
    text = `[${value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")}]`;
  } else if (typeof value === "string") {
    text = JSON.stringify(value);
  } else {
    text = JSON.stringify(value);
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function renderTallyTable(entities: Record<string, Tally>): string[] {
  const header = ["entity", ...TABLE_COLUMNS];
  const rows = Object.keys(entities).map((entity) => [
    entity,
    ...TABLE_COLUMNS.map((c) => String(entities[entity][c])),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)];
}

export interface PrintOptions {
  /** Builds a CMS link for a finding, or returns undefined when there is none. */
  linkFor?: (finding: Finding) => string | undefined;
  log?: (line: string) => void;
}

export function printVerifyReport(report: VerifyReport, options: PrintOptions = {}): void {
  const log = options.log ?? ((line: string) => console.log(line));

  log(ansiColors.cyan(`\n🔎 Verify: ${report.source} → ${report.target}`));

  if (report.exitCode === EXIT_CANNOT_VERIFY) {
    log(ansiColors.red(`\n✗ Could not verify: ${report.error}`));
    log(ansiColors.red(`VERDICT: ERROR (exit ${report.exitCode})`));
    return;
  }

  Object.keys(report.byLocale).forEach((locale) => {
    const section = report.byLocale[locale];
    const title = locale === INSTANCE_LOCALE ? "Instance-wide" : `Locale ${locale}`;
    log(
      ansiColors.bold(
        `\n${title}: ${section.failures} failure(s), ${section.warnings} warning(s), ${section.sourceDefects} source defect(s)`
      )
    );
    renderTallyTable(section.entities).forEach((row) => log(`  ${row}`));
  });

  const byCategory = new Map<string, Finding[]>();
  report.findings.forEach((f) => {
    const key = `${f.severity}:${f.category}`;
    if (!byCategory.has(key)) byCategory.set(key, []);
    (byCategory.get(key) as Finding[]).push(f);
  });

  byCategory.forEach((findings, key) => {
    const [severity, category] = key.split(":");
    const color =
      severity === "failure" ? ansiColors.red : severity === "warning" ? ansiColors.yellow : ansiColors.magenta;
    log(color(`\n${severity.toUpperCase()} ${category} (${findings.length})`));
    findings.slice(0, MAX_DETAILS_PER_CATEGORY).forEach((f) => {
      const where = f.locale === INSTANCE_LOCALE ? "" : `[${f.locale}] `;
      const ids = `source ${f.sourceID ?? "-"} → target ${f.targetID ?? "-"}`;
      const label = [f.name, f.path].filter(Boolean).join(" / ");
      log(`  • ${where}${f.entity} ${label ? `"${label}" ` : ""}(${ids})`);
      if (f.message) log(ansiColors.gray(`      ${f.message}`));
      if (f.expected !== undefined || f.actual !== undefined) {
        log(ansiColors.gray(`      expected: ${formatValue(f.expected)}`));
        log(ansiColors.gray(`      actual:   ${formatValue(f.actual)}`));
      }
      const link = options.linkFor?.(f);
      if (link) log(ansiColors.gray(`      ${link}`));
    });
    if (findings.length > MAX_DETAILS_PER_CATEGORY) {
      log(ansiColors.gray(`  …and ${findings.length - MAX_DETAILS_PER_CATEGORY} more (see the JSON report)`));
    }
  });

  const t = report.totals;
  const verdictLine = `VERDICT: ${report.verdict.toUpperCase()} — ${t.failures} failure(s), ${t.warnings} warning(s), ${t.sourceDefects} source defect(s) (exit ${report.exitCode})`;
  log("");
  log(report.exitCode === EXIT_PASS ? ansiColors.green(`✓ ${verdictLine}`) : ansiColors.red(`✗ ${verdictLine}`));
}
