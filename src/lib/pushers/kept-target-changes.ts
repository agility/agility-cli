/**
 * Per-run collector for target-only changes: entities edited on the target since the last sync
 * while the source didn't change. The sync keeps the target's version and warns, instead of
 * reporting a conflict, because a newer target version alone doesn't mean an editor changed it:
 * mappings written by older CLI versions often record a target version older than the target's
 * real one, with identical content on both sides. --overwrite replaces them with the source.
 *
 * Reporting only: nothing here affects counts, `success` or the exit code. A change on both sides
 * is still a conflict, decided by each pusher. A process-level singleton, like preflightReport.
 */

export type KeptTargetChangeType = "content" | "asset" | "gallery" | "container" | "model" | "page";

export interface KeptTargetChange {
  type: KeptTargetChangeType;
  name: string;
  locale?: string;
  sourceID?: number;
  targetID?: number;
  /** CMS link to the target entity, when there is one (content and pages) */
  targetUrl?: string;
}

/** Shape of a --jsonSummary `warnings` entry (JsonSummaryDetail plus additive fields). */
export interface KeptTargetChangeWarningDetail {
  name: string;
  error: string;
  type: KeptTargetChangeType;
  guid?: string;
  locale?: string;
  contentID?: number;
  pageID?: number;
  code: "targetChangeKept";
  sourceID?: number;
  targetID?: number;
  targetUrl?: string;
}

export const KEPT_TARGET_CHANGE_WARNING_CODE = "targetChangeKept";

/** Why the entity was left alone and how to replace it; shared by every surface. */
export const KEPT_TARGET_CHANGE_MESSAGE =
  "changed on the target since the last sync, and the source didn't change, so the target's version was kept. " +
  "Use --overwrite to replace it with the source";

const TYPE_LABELS: Record<KeptTargetChangeType, string> = {
  content: "content item",
  asset: "asset",
  gallery: "gallery",
  container: "container",
  model: "model",
  page: "page",
};

const TYPE_PLURALS: Record<KeptTargetChangeType, string> = {
  content: "content items",
  asset: "assets",
  gallery: "galleries",
  container: "containers",
  model: "models",
  page: "pages",
};

class KeptTargetChanges {
  private entries: KeptTargetChange[] = [];

  reset(): void {
    this.entries = [];
  }

  /** Record one kept change. A repeat of the same entity (same type, locale and ID or name) is ignored. */
  record(change: KeptTargetChange): void {
    const key = (c: KeptTargetChange) => `${c.type}|${c.locale ?? ""}|${c.sourceID ?? c.name}`;
    if (this.entries.some((e) => key(e) === key(change))) return;
    this.entries.push(change);
  }

  getEntries(): KeptTargetChange[] {
    return [...this.entries];
  }

  hasEntries(): boolean {
    return this.entries.length > 0;
  }

  /** "Target changes kept: 3 content items, 1 page" */
  headline(): string {
    const counts = new Map<KeptTargetChangeType, number>();
    for (const e of this.entries) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    const parts = Array.from(counts.entries()).map(
      ([type, n]) => `${n} ${n === 1 ? TYPE_LABELS[type] : TYPE_PLURALS[type]}`
    );
    return `Target changes kept: ${parts.join(", ")}`;
  }

  /** One console/log line for an entity, when it is skipped. */
  formatLine(change: KeptTargetChange): string {
    const where = change.locale ? ` [${change.locale}]` : "";
    const id = change.targetID ? ` (target ID ${change.targetID})` : "";
    return `⚠️  Kept target change: ${TYPE_LABELS[change.type]} ${change.name}${where}${id} ${KEPT_TARGET_CHANGE_MESSAGE}.`;
  }

  /** Lines for the end-of-run summary: headline, then each entity. */
  renderSummaryLines(): string[] {
    if (!this.hasEntries()) return [];
    const lines = [`${this.headline()} (non-blocking):`];
    for (const e of this.entries) {
      const where = e.locale ? `[${e.locale}] ` : "";
      lines.push(`  • ${where}${TYPE_LABELS[e.type]} ${e.name}${e.targetUrl ? ` ${e.targetUrl}` : ""}`);
    }
    lines.push(
      "  Each changed on the target since the last sync while the source didn't, so the target's version was kept. " +
        "Use --overwrite to replace them with the source. If the source changes later, the sync reports a conflict."
    );
    return lines;
  }

  /** One --jsonSummary warning per kept entity. */
  toWarningDetails(targetGuid?: string): KeptTargetChangeWarningDetail[] {
    return this.entries.map((e) => ({
      name: e.name,
      error: `${TYPE_LABELS[e.type]} ${e.name} ${KEPT_TARGET_CHANGE_MESSAGE}.`,
      type: e.type,
      guid: targetGuid,
      locale: e.locale,
      ...(e.type === "content" && e.targetID ? { contentID: e.targetID } : {}),
      ...(e.type === "page" && e.targetID ? { pageID: e.targetID } : {}),
      code: KEPT_TARGET_CHANGE_WARNING_CODE,
      sourceID: e.sourceID,
      targetID: e.targetID,
      targetUrl: e.targetUrl,
    }));
  }
}

/** Process-level singleton shared by the pushers and the end-of-run summary. */
export const keptTargetChanges = new KeptTargetChanges();
