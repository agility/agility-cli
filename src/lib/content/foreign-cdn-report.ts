/**
 * PROD-2773: per-run collector for foreign CDN references (see foreign-cdn-detector.ts).
 *
 * The content pusher records each reference it finds; this collector dedupes them to one entry
 * per distinct URL, aggregating the items/fields/locales that use it, and renders that entry for
 * the console/log, the end-of-run summary, --jsonSummary and the --preflight report.
 *
 * Reporting only: nothing here affects item payloads, counts, `success` or the exit code.
 * A process-level singleton, like preflightReport, because pushers share state globally.
 */
import type { ForeignCdnFieldKind, ForeignCdnFieldReference } from "./foreign-cdn-detector";

export interface ForeignCdnOccurrence {
  contentID: number;
  referenceName: string;
  locale: string;
  field: string;
  kind: ForeignCdnFieldKind;
}

export interface ForeignCdnUrlEntry {
  url: string;
  container: string;
  occurrences: ForeignCdnOccurrence[];
}

/** Shape of a --jsonSummary `warnings` entry (JsonSummaryDetail plus additive fields). */
export interface ForeignCdnWarningDetail {
  name: string;
  error: string;
  type: "content";
  contentID?: number;
  guid?: string;
  locale?: string;
  code: "foreignCdnReference";
  url: string;
  container: string;
  references: ForeignCdnOccurrence[];
}

export const FOREIGN_CDN_WARNING_CODE = "foreignCdnReference";

class ForeignCdnReport {
  private entries = new Map<string, ForeignCdnUrlEntry>();
  private sourceContainers: string[] = [];
  private targetContainers: string[] = [];

  reset(): void {
    this.entries.clear();
    this.sourceContainers = [];
    this.targetContainers = [];
  }

  /** The containers the run treated as its own, quoted in every message. */
  setOwnContainers(sourceContainers: string[], targetContainers: string[]): void {
    this.sourceContainers = sourceContainers;
    this.targetContainers = targetContainers;
  }

  /**
   * Record one reference. Returns "new-url" the first time a URL is seen in this run,
   * "new-occurrence" for a further item/field/locale using it, and "duplicate" otherwise.
   */
  record(
    ref: Pick<ForeignCdnFieldReference, "url" | "container" | "field" | "kind">,
    item: { contentID: number; referenceName: string; locale: string }
  ): "new-url" | "new-occurrence" | "duplicate" {
    const key = ref.url.toLowerCase();
    let entry = this.entries.get(key);
    const isNewUrl = !entry;
    if (!entry) {
      entry = { url: ref.url, container: ref.container, occurrences: [] };
      this.entries.set(key, entry);
    }
    const exists = entry.occurrences.some(
      (o) => o.contentID === item.contentID && o.locale === item.locale && o.field === ref.field
    );
    if (exists) return "duplicate";
    entry.occurrences.push({ ...item, field: ref.field, kind: ref.kind });
    return isNewUrl ? "new-url" : "new-occurrence";
  }

  /** Distinct URLs in first-seen order, those used by an image/file field (higher risk) first. */
  getEntries(): ForeignCdnUrlEntry[] {
    const rank = (e: ForeignCdnUrlEntry) => (e.occurrences.some((o) => o.kind === "attachment") ? 0 : 1);
    return Array.from(this.entries.values()).sort((a, b) => rank(a) - rank(b));
  }

  /** Distinct source content items (by contentID; locales of one item count once). */
  getItemCount(): number {
    const ids = new Set<number>();
    this.entries.forEach((e) => e.occurrences.forEach((o) => ids.add(o.contentID)));
    return ids.size;
  }

  hasEntries(): boolean {
    return this.entries.size > 0;
  }

  /** "Foreign CDN references: N URLs in M items" */
  headline(): string {
    const urls = this.entries.size;
    const items = this.getItemCount();
    return `Foreign CDN references: ${urls} URL${urls === 1 ? "" : "s"} in ${items} item${items === 1 ? "" : "s"}`;
  }

  /** What is wrong with the URL and what happens to it; shared by every surface. */
  describe(container: string, kinds: ForeignCdnFieldKind[]): string {
    const own = (list: string[]) => (list.length > 0 ? list.join(", ") : "unknown");
    const consequences: string[] = [];
    if (kinds.includes("attachment")) {
      consequences.push("it is set in an image/file field, which the target may drop (the field arrives empty)");
    }
    if (kinds.includes("text")) {
      consequences.push(
        "it is embedded in a text/rich-text field, so the synced content keeps linking to that container"
      );
    }
    return (
      `references CDN container '${container}', which belongs to neither the source (${own(this.sourceContainers)}) ` +
      `nor the target (${own(this.targetContainers)}). The URL is passed through unchanged; ${consequences.join("; ")}. ` +
      `Repoint it at the source instance's own asset.`
    );
  }

  /** One log line for a single reference, used the first time its URL is seen. */
  formatOccurrence(
    ref: Pick<ForeignCdnFieldReference, "url" | "container" | "field" | "kind">,
    item: { contentID: number; referenceName: string; locale: string }
  ): string {
    const where = ref.kind === "attachment" ? "image/file field" : "text field";
    return (
      `⚠️ Foreign CDN reference: ${item.referenceName} (contentID: ${item.contentID}) [${item.locale}] ${where} '${ref.field}' ` +
      `→ ${ref.url} ${this.describe(ref.container, [ref.kind])}`
    );
  }

  private formatOccurrenceList(occurrences: ForeignCdnOccurrence[]): string {
    return occurrences
      .map(
        (o) =>
          `${o.referenceName} #${o.contentID} [${o.locale}] ${o.field}${o.kind === "attachment" ? " (image/file)" : ""}`
      )
      .join("; ");
  }

  /** Lines for the end-of-run summary: headline, then each URL with the items using it. */
  renderSummaryLines(): string[] {
    if (!this.hasEntries()) return [];
    const lines = [`${this.headline()} (non-blocking):`];
    for (const e of this.getEntries()) {
      const kinds = Array.from(new Set(e.occurrences.map((o) => o.kind)));
      const risk = kinds.includes("attachment") ? "image/file field" : "text only";
      lines.push(`  • ${e.url} — container '${e.container}', ${risk}`);
      lines.push(`      used by: ${this.formatOccurrenceList(e.occurrences)}`);
    }
    lines.push(
      `  These URLs belong to neither the source (${this.sourceContainers.join(", ") || "unknown"}) nor the target ` +
        `(${this.targetContainers.join(", ") || "unknown"}) and are passed through unchanged. Repoint them at the source instance's own assets.`
    );
    return lines;
  }

  /** One --jsonSummary warning per distinct URL, in getEntries() order. */
  toWarningDetails(sourceGuid?: string): ForeignCdnWarningDetail[] {
    return this.getEntries().map((e) => {
      const kinds = Array.from(new Set(e.occurrences.map((o) => o.kind)));
      const first = e.occurrences[0];
      return {
        name: e.url,
        error: `${this.describe(e.container, kinds)} Used by: ${this.formatOccurrenceList(e.occurrences)}.`,
        type: "content" as const,
        contentID: first?.contentID,
        guid: sourceGuid,
        locale: first?.locale,
        code: FOREIGN_CDN_WARNING_CODE,
        url: e.url,
        container: e.container,
        references: e.occurrences,
      };
    });
  }
}

/** Process-level singleton shared by the content pusher and the end-of-run summary. */
export const foreignCdnReport = new ForeignCdnReport();
