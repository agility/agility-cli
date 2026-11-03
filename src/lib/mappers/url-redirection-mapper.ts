import { fileOperations } from "../../core";
import { SyncFingerprint } from "../shared/sync-fingerprint";

export interface UrlRedirectionMapping extends SyncFingerprint {
  sourceGuid: string;
  targetGuid: string;
  sourceUrlRedirectionID: number;
  targetUrlRedirectionID: number;
  /** The source origin URL at the time of mapping — kept for readability/debugging of the mapping file. */
  originUrl: string;
}

/**
 * Maps source URL redirection IDs to target IDs across syncs.
 *
 * Unlike galleries/models, redirections carry no modifiedOn timestamp in the pulled
 * data. Besides the ID pairing, each record holds a hash of both sides as last synced
 * (PROD-3078, see sync-fingerprint.ts), which tells the pusher which side changed since.
 */
export class UrlRedirectionMapper {
  private fileOps: fileOperations;
  private sourceGuid: string;
  private targetGuid: string;
  private mappings: UrlRedirectionMapping[];
  private directory: string;

  constructor(sourceGuid: string, targetGuid: string) {
    this.sourceGuid = sourceGuid;
    this.targetGuid = targetGuid;
    this.directory = "urlredirections";
    this.fileOps = new fileOperations(targetGuid);
    this.mappings = this.loadMapping();
  }

  getMapping(urlRedirectionID: number, type: "source" | "target"): UrlRedirectionMapping | null {
    const mapping = this.mappings.find((m: UrlRedirectionMapping) =>
      type === "source" ? m.sourceUrlRedirectionID === urlRedirectionID : m.targetUrlRedirectionID === urlRedirectionID
    );
    if (!mapping) return null;
    return mapping;
  }

  /**
   * Add or update the record for a source redirection. `fingerprint` is the hash of both sides
   * once they agree; leave it out when they don't yet (e.g. a record adopted before its update).
   */
  addMapping(
    sourceUrlRedirectionID: number,
    targetUrlRedirectionID: number,
    originUrl: string,
    fingerprint?: SyncFingerprint
  ) {
    const existing = this.getMapping(sourceUrlRedirectionID, "source");

    if (existing) {
      existing.sourceGuid = this.sourceGuid;
      existing.targetGuid = this.targetGuid;
      existing.targetUrlRedirectionID = targetUrlRedirectionID;
      existing.originUrl = originUrl;
      if (fingerprint) Object.assign(existing, fingerprint);
    } else {
      this.mappings.push({
        sourceGuid: this.sourceGuid,
        targetGuid: this.targetGuid,
        sourceUrlRedirectionID,
        targetUrlRedirectionID,
        originUrl,
        ...(fingerprint ?? {}),
      });
    }

    this.saveMapping();
  }

  loadMapping(): UrlRedirectionMapping[] {
    return this.fileOps.getMappingFile(this.directory, this.sourceGuid, this.targetGuid);
  }

  saveMapping() {
    this.fileOps.saveMappingFile(this.mappings, this.directory, this.sourceGuid, this.targetGuid);
  }
}
