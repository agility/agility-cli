import { fileOperations } from "../../core";
import * as mgmtApi from "@agility/management-sdk";

interface SectionMapping {
  sourceGuid: string;
  targetGuid: string;
  sourcePageItemTemplateID: number;
  targetPageItemTemplateID: number;
  sourceReferenceName?: string;
  targetReferenceName?: string;
}

// PROD-2350: content section definitions (page zones) were being matched between source and
// target templates by reference name (or worse, by array position) every time a page or template
// was pushed. That breaks whenever a section is renamed or reordered on either side. This mapper
// persists the source/target pageItemTemplateID pairing once (established in template-pusher.ts
// from the confirmed API response), so later lookups are a stable ID join instead of a repeated
// guess against possibly-stale names.
export class SectionMapper {
  private fileOps: fileOperations;
  private sourceGuid: string;
  private targetGuid: string;
  private mappings: SectionMapping[];
  private directory: string;

  constructor(sourceGuid: string, targetGuid: string) {
    this.sourceGuid = sourceGuid;
    this.targetGuid = targetGuid;
    this.directory = "sections";
    // this will provide access to the /agility-files/{GUID} folder
    this.fileOps = new fileOperations(targetGuid);
    this.mappings = this.loadMapping();
  }

  getSectionMapping(
    section: mgmtApi.ContentSectionDefinition,
    type: "source" | "target"
  ): SectionMapping | null {
    if (!section) return null;
    const mapping = this.mappings.find((m: SectionMapping) =>
      type === "source"
        ? m.sourcePageItemTemplateID === section.pageItemTemplateID
        : m.targetPageItemTemplateID === section.pageItemTemplateID
    );
    if (!mapping) return null;
    return mapping;
  }

  getSectionMappingByID(pageItemTemplateID: number, type: "source" | "target"): SectionMapping | null {
    const mapping = this.mappings.find((m: SectionMapping) =>
      type === "source"
        ? m.sourcePageItemTemplateID === pageItemTemplateID
        : m.targetPageItemTemplateID === pageItemTemplateID
    );
    if (!mapping) return null;
    return mapping;
  }

  addMapping(
    sourceSection: mgmtApi.ContentSectionDefinition,
    targetSection: mgmtApi.ContentSectionDefinition
  ) {
    const targetMapping = this.getSectionMapping(targetSection, "target");
    const sourceMapping = this.getSectionMapping(sourceSection, "source");

    if (targetMapping && sourceMapping && targetMapping !== sourceMapping) {
      throw new Error(
        `Invalid Mappings detected! Source pageItemTemplateID: ${sourceSection.pageItemTemplateID}, Target pageItemTemplateID: ${targetSection.pageItemTemplateID}`
      );
    }

    if (targetMapping) {
      this.updateMapping(sourceSection, targetSection, targetMapping);
    } else {
      const newMapping: SectionMapping = {
        sourceGuid: this.sourceGuid,
        targetGuid: this.targetGuid,
        sourcePageItemTemplateID: sourceSection.pageItemTemplateID,
        targetPageItemTemplateID: targetSection.pageItemTemplateID,
        sourceReferenceName: sourceSection.pageItemTemplateReferenceName,
        targetReferenceName: targetSection.pageItemTemplateReferenceName,
      };

      this.mappings.push(newMapping);
    }

    this.saveMapping();
  }

  updateMapping(
    sourceSection: mgmtApi.ContentSectionDefinition,
    targetSection: mgmtApi.ContentSectionDefinition,
    mapping: SectionMapping
  ) {
    if (targetSection.pageItemTemplateID !== mapping.targetPageItemTemplateID) {
      throw new Error(
        `Invalid items trying to be mapped! Source pageItemTemplateID: ${sourceSection.pageItemTemplateID}, Target pageItemTemplateID: ${targetSection.pageItemTemplateID}`
      );
    }
    mapping.sourceGuid = this.sourceGuid;
    mapping.targetGuid = this.targetGuid;
    mapping.sourcePageItemTemplateID = sourceSection.pageItemTemplateID;
    mapping.targetPageItemTemplateID = targetSection.pageItemTemplateID;
    mapping.sourceReferenceName = sourceSection.pageItemTemplateReferenceName;
    mapping.targetReferenceName = targetSection.pageItemTemplateReferenceName;
    this.saveMapping();
  }

  loadMapping() {
    const mapping = this.fileOps.getMappingFile(this.directory, this.sourceGuid, this.targetGuid);
    return mapping;
  }

  saveMapping() {
    this.fileOps.saveMappingFile(this.mappings, this.directory, this.sourceGuid, this.targetGuid);
  }
}
