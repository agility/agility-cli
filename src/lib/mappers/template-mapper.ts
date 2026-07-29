import { fileOperations } from "../../core";
import * as mgmtApi from "@agility/management-sdk";
import { SectionMapper } from "./section-mapper";
interface TemplateMapping {
  sourceGuid: string;
  targetGuid: string;
  sourcePageTemplateID: number;
  targetPageTemplateID: number;
  sourcePageTemplateName: string;
  targetPageTemplateName: string;
}

export class TemplateMapper {
  private fileOps: fileOperations;
  private sourceGuid: string;
  private targetGuid: string;
  private mappings: TemplateMapping[];
  private directory: string;

  constructor(sourceGuid: string, targetGuid: string) {
    this.sourceGuid = sourceGuid;
    this.targetGuid = targetGuid;
    this.directory = "templates";
    // this will provide access to the /agility-files/{GUID} folder
    this.fileOps = new fileOperations(targetGuid);
    this.mappings = this.loadMapping();
  }

  getTemplateMapping(template: mgmtApi.PageModel, type: "source" | "target"): TemplateMapping | null {
    if (!template) return null;
    const mapping = this.mappings.find((m: TemplateMapping) =>
      type === "source"
        ? m.sourcePageTemplateID === template.pageTemplateID
        : m.targetPageTemplateID === template.pageTemplateID
    );
    if (!mapping) return null;
    return mapping;
  }

  getTemplateMappingByPageTemplateID(pageTemplateID: number, type: "source" | "target"): TemplateMapping | null {
    const mapping = this.mappings.find((m: TemplateMapping) =>
      type === "source" ? m.sourcePageTemplateID === pageTemplateID : m.targetPageTemplateID === pageTemplateID
    );
    if (!mapping) return null;
    return mapping;
  }

  getTemplateMappingByPageTemplateName(pageTemplateName: string, type: "source" | "target"): TemplateMapping | null {
    const mapping = this.mappings.find((m: TemplateMapping) =>
      type === "source" ? m.sourcePageTemplateName === pageTemplateName : m.targetPageTemplateName === pageTemplateName
    );
    if (!mapping) return null;
    return mapping;
  }

  getMappedEntity(mapping: TemplateMapping, type: "source" | "target"): mgmtApi.PageModel | null {
    if (!mapping) return null;
    const guid = type === "source" ? mapping.sourceGuid : mapping.targetGuid;
    const pageTemplateID = type === "source" ? mapping.sourcePageTemplateID : mapping.targetPageTemplateID;
    const fileOps = new fileOperations(guid);

    const templateData = fileOps.readJsonFile(`templates/${pageTemplateID}.json`);
    if (!templateData) return null;
    return templateData as mgmtApi.PageModel;
  }

  addMapping(sourceTemplate: mgmtApi.PageModel, targetTemplate: mgmtApi.PageModel) {
    const targetMapping = this.getTemplateMapping(targetTemplate, "target");
    const sourceMapping = this.getTemplateMapping(sourceTemplate, "source");

    if (targetMapping && sourceMapping && targetMapping !== sourceMapping) {
      throw new Error(
        `Invalid Mappings detected! Source pageTemplateID: ${sourceTemplate.pageTemplateID}, Target pageTemplateID: ${targetTemplate.pageTemplateID}`
      );
    }

    if (targetMapping) {
      this.updateMapping(sourceTemplate, targetTemplate, targetMapping);
    } else {
      const newMapping: TemplateMapping = {
        sourceGuid: this.sourceGuid,
        targetGuid: this.targetGuid,
        sourcePageTemplateID: sourceTemplate.pageTemplateID,
        targetPageTemplateID: targetTemplate.pageTemplateID,
        sourcePageTemplateName: sourceTemplate.pageTemplateName,
        targetPageTemplateName: targetTemplate.pageTemplateName,
      };

      this.mappings.push(newMapping);
    }

    this.saveMapping();
  }

  updateMapping(sourceTemplate: mgmtApi.PageModel, targetTemplate: mgmtApi.PageModel, mapping: TemplateMapping) {
    if (targetTemplate.pageTemplateID !== mapping.targetPageTemplateID) {
      throw new Error(
        `Invalid items trying to be mapped! Source pageTemplateID: ${sourceTemplate.pageTemplateID}, Target pageTemplateID: ${targetTemplate.pageTemplateID}`
      );
    }
    mapping.sourceGuid = this.sourceGuid;
    mapping.targetGuid = this.targetGuid;
    mapping.sourcePageTemplateID = sourceTemplate.pageTemplateID;
    mapping.targetPageTemplateID = targetTemplate.pageTemplateID;
    mapping.sourcePageTemplateName = sourceTemplate.pageTemplateName;
    mapping.targetPageTemplateName = targetTemplate.pageTemplateName;
    this.saveMapping();
  }

  loadMapping() {
    const mapping = this.fileOps.getMappingFile(this.directory, this.sourceGuid, this.targetGuid);
    return mapping;
  }

  saveMapping() {
    this.fileOps.saveMappingFile(this.mappings, this.directory, this.sourceGuid, this.targetGuid);
  }

  // Templates have no lastModifiedDate, so change detection compares the source and target
  // structure directly. Per-instance IDs (pageItemTemplateID, pageTemplateID, contentViewID,
  // contentDefinitionID, itemContainerID) are excluded — they always differ between instances.
  //
  // PROD-2350: pair each source section with its target counterpart by the persisted
  // pageItemTemplateID mapping when one is available — that's the actual identity, not a
  // name-based guess — and only fall back to a reference-name match when no mapping exists yet
  // (bootstrap, or sectionMapper not supplied). Matching purely by reference name can silently
  // miss a real change (e.g. two sections trade reference names and item orders at once) since
  // it re-derives the pairing from a value that isn't guaranteed to still identify the section.
  hasTemplateChanged(
    sourceTemplate: mgmtApi.PageModel | null,
    targetTemplate: mgmtApi.PageModel | null,
    sectionMapper?: SectionMapper | null
  ): boolean {
    if (!sourceTemplate || !targetTemplate) return false;

    if ((sourceTemplate.pageTemplateName ?? null) !== (targetTemplate.pageTemplateName ?? null)) return true;

    const sourceSections = sourceTemplate.contentSectionDefinitions || [];
    const targetSections = targetTemplate.contentSectionDefinitions || [];

    if (sourceSections.length !== targetSections.length) return true;

    for (const sourceSection of sourceSections) {
      if (!sourceSection) return true;

      let targetSection: mgmtApi.ContentSectionDefinition | null = null;

      if (sectionMapper && sourceSection.pageItemTemplateID != null) {
        const sectionMapping = sectionMapper.getSectionMappingByID(sourceSection.pageItemTemplateID, "source");
        if (sectionMapping) {
          targetSection =
            targetSections.find((t) => t?.pageItemTemplateID === sectionMapping.targetPageItemTemplateID) ?? null;
        }
      }

      if (!targetSection) {
        targetSection =
          targetSections.find(
            (t) => t?.pageItemTemplateReferenceName === sourceSection.pageItemTemplateReferenceName
          ) ?? null;
      }

      if (!targetSection) return true;

      const sectionChanged =
        (sourceSection.pageItemTemplateName ?? null) !== (targetSection.pageItemTemplateName ?? null) ||
        (sourceSection.pageItemTemplateReferenceName ?? null) !== (targetSection.pageItemTemplateReferenceName ?? null) ||
        (sourceSection.pageItemTemplateType ?? null) !== (targetSection.pageItemTemplateType ?? null) ||
        (sourceSection.itemOrder ?? null) !== (targetSection.itemOrder ?? null);

      if (sectionChanged) return true;
    }

    return false;
  }
}
