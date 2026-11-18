/**
 * Source readiness (PROD-3212): stop a sync whose source pull came back empty.
 *
 * The CLI reads the source's content and pages through the Fetch API (preview). When that isn't
 * ready (a new or just-cloned instance whose preview push hasn't finished, or a preview that has
 * stopped updating) the pull returns no sitemap and no content items. Every push phase then has
 * nothing to do, and the sync used to report success with exit 0, silently syncing nothing. With
 * --syncDeletes it would read as everything deleted.
 *
 * Checked per requested locale, before anything is written to the target, against the unscoped
 * pull and the pair's mappings:
 *  - nothing pulled, but the mappings have entries of that kind: a failure (the run stops);
 *  - nothing pulled and nothing mapped: a warning (possibly a locale that really is empty);
 *  - far fewer pulled than mapped: a warning (a partial pull, or a large deletion on the source).
 */

import ansiColors from "ansi-colors";
import { FailureDetail } from "../../types/sourceData";

export type ReadinessKind = "content" | "pages";

export interface LocaleCounts {
  locale: string;
  pulled: Record<ReadinessKind, number>;
  mapped: Record<ReadinessKind, number>;
}

export interface ReadinessIssue {
  locale: string;
  kind: ReadinessKind;
  severity: "error" | "warning";
  message: string;
}

/** A drop is only reported once the mappings have this many entries of a kind. */
export const DROP_MIN_MAPPED = 20;
/** ...and the pull has less than this share of them. */
export const DROP_RATIO = 0.5;

const LABEL: Record<ReadinessKind, string> = { content: "content items", pages: "pages" };

export function checkSourceReadiness(counts: LocaleCounts[], kinds: ReadinessKind[]): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  for (const { locale, pulled, mapped } of counts) {
    for (const kind of kinds) {
      const got = pulled[kind];
      const had = mapped[kind];
      const label = LABEL[kind];
      if (got === 0 && had > 0) {
        issues.push({
          locale,
          kind,
          severity: "error",
          message: `the source returned no ${label} for ${locale}, but the mappings have ${had}`,
        });
      } else if (got === 0) {
        issues.push({
          locale,
          kind,
          severity: "warning",
          message: `the source returned no ${label} for ${locale} (none mapped either, so nothing to sync)`,
        });
      } else if (had >= DROP_MIN_MAPPED && got < had * DROP_RATIO) {
        issues.push({
          locale,
          kind,
          severity: "warning",
          message: `the source returned ${got} ${label} for ${locale}, under half of the ${had} mapped: a partial pull, or a large deletion on the source`,
        });
      }
    }
  }
  return issues;
}

/** The error a run stops with, or null when nothing failed. */
export function readinessError(sourceGuid: string, issues: ReadinessIssue[]): Error | null {
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length === 0) return null;
  return new Error(
    `Source validation failed. ${errors.map((e) => e.message).join("; ")}. ` +
      `Nothing was written to the target. The source's Fetch API (preview) for ${sourceGuid} may not be ` +
      `ready: a new or cloned instance still publishing, or a preview that stopped updating. Wait for it ` +
      `and run again (pull with --reset to refetch). To sync without a locale, leave it out of --locales; ` +
      `without a kind, leave it out of --elements.`
  );
}

export function readinessWarnings(sourceGuid: string, issues: ReadinessIssue[]): FailureDetail[] {
  return issues
    .filter((i) => i.severity === "warning")
    .map((i) => ({
      name: `Source ${LABEL[i.kind]} [${i.locale}]`,
      error: i.message,
      type: i.kind === "pages" ? "page" : "content",
      locale: i.locale,
      guid: sourceGuid,
    })) as FailureDetail[];
}

export function printReadinessIssues(issues: ReadinessIssue[]): void {
  for (const issue of issues) {
    const color = issue.severity === "error" ? ansiColors.red : ansiColors.yellow;
    console.log(color(`${issue.severity === "error" ? "✗" : "⚠️"} Source check: ${issue.message}`));
  }
}
