import { fileOperations } from "../../core";

export interface UrlRedirectionMapping {
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
 * data, so this mapper only tracks the ID pairing. Change detection is done by the
 * pusher via a direct field comparison of the pulled source and target items.
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

  addMapping(sourceUrlRedirectionID: number, targetUrlRedirectionID: number, originUrl: string) {
    const existing = this.getMapping(sourceUrlRedirectionID, "source");

    if (existing) {
      existing.sourceGuid = this.sourceGuid;
      existing.targetGuid = this.targetGuid;
      existing.targetUrlRedirectionID = targetUrlRedirectionID;
      existing.originUrl = originUrl;
    } else {
      this.mappings.push({
        sourceGuid: this.sourceGuid,
        targetGuid: this.targetGuid,
        sourceUrlRedirectionID,
        targetUrlRedirectionID,
        originUrl,
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
