import * as mgmtApi from "@agility/management-sdk";
import { SectionMapper } from "../../mappers/section-mapper";

interface TranslateZoneNamesOptions {
  sourceTemplate?: mgmtApi.PageModel | null;
  sectionMapper?: SectionMapper | null;
}

export function translateZoneNames(
  sourceZones: any,
  targetTemplate: mgmtApi.PageModel | null,
  options: TranslateZoneNamesOptions = {}
): any {
  if (!sourceZones || !targetTemplate?.contentSectionDefinitions) {
    return sourceZones || {}; // No template or sections, return as-is
  }

  const { sourceTemplate, sectionMapper } = options;

  const targetSections = (targetTemplate.contentSectionDefinitions || [])
    .slice()
    .sort((a, b) => (a.itemOrder || 0) - (b.itemOrder || 0)); // Sort by item order
  const targetNames = targetSections.map((def) => def.pageItemTemplateReferenceName);

  const translatedZones: any = {};
  const matchedTargetNames = new Set<string>();
  const remainingSourceEntries: [string, any][] = [];

  // Pass 1: resolve each source zone against a target section, preferring the persisted
  // source->target pageItemTemplateID mapping (PROD-2350) since it's stable even when a
  // section has been renamed or reordered on either side. Falls back to a direct name match
  // when no ID mapping is available yet (first push after upgrading, or a genuinely new zone).
  for (const [sourceZoneName, zoneContent] of Object.entries(sourceZones)) {
    let targetZoneName: string | null = null;

    if (sourceTemplate && sectionMapper) {
      const sourceSection = sourceTemplate.contentSectionDefinitions?.find(
        (s) => s?.pageItemTemplateReferenceName === sourceZoneName
      );
      if (sourceSection?.pageItemTemplateID != null) {
        const sectionMapping = sectionMapper.getSectionMappingByID(sourceSection.pageItemTemplateID, "source");
        const targetSection = sectionMapping
          ? targetSections.find((t) => t?.pageItemTemplateID === sectionMapping.targetPageItemTemplateID)
          : null;
        if (targetSection?.pageItemTemplateReferenceName) {
          targetZoneName = targetSection.pageItemTemplateReferenceName;
        }
      }
    }

    if (!targetZoneName && targetNames.indexOf(sourceZoneName) !== -1) {
      targetZoneName = sourceZoneName;
    }

    if (targetZoneName && !matchedTargetNames.has(targetZoneName)) {
      translatedZones[targetZoneName] = zoneContent;
      matchedTargetNames.add(targetZoneName);
    } else {
      remainingSourceEntries.push([sourceZoneName, zoneContent]);
    }
  }

  // Pass 2: positional fallback for whatever's left over — legacy behavior for zones that
  // can't be resolved by ID or name (e.g. a section renamed on both sides between pulls).
  const remainingTargetNames = targetNames.filter((name) => !matchedTargetNames.has(name));

  for (let i = 0; i < remainingSourceEntries.length && i < remainingTargetNames.length; i++) {
    const [, zoneContent] = remainingSourceEntries[i];
    translatedZones[remainingTargetNames[i]] = zoneContent;
  }

  // Overflow: more leftover source zones than leftover target sections — combine the extras
  // into the main (first, by itemOrder) target zone instead of dropping them.
  if (remainingSourceEntries.length > remainingTargetNames.length && targetNames.length > 0) {
    const mainZoneName = targetNames[0];
    const mainZoneModules = Array.isArray(translatedZones[mainZoneName]) ? [...translatedZones[mainZoneName]] : [];

    for (let i = remainingTargetNames.length; i < remainingSourceEntries.length; i++) {
      const [, zoneContent] = remainingSourceEntries[i];
      if (Array.isArray(zoneContent) && zoneContent.length > 0) {
        mainZoneModules.push(...zoneContent);
      }
    }

    translatedZones[mainZoneName] = mainZoneModules;
  }

  return translatedZones;
}
