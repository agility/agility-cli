import * as mgmtApi from '@agility/management-sdk';

export function translateZoneNames(
  sourceZones: any,
  targetTemplate: mgmtApi.PageModel | null
): any {
  if (!sourceZones || !targetTemplate?.contentSectionDefinitions) {
    return sourceZones || {}; // No template or sections, return as-is
  }

  const translatedZones: any = {};
  const sectionNames = targetTemplate.contentSectionDefinitions
    .sort((a, b) => (a.itemOrder || 0) - (b.itemOrder || 0)) // Sort by item order
    .map((def) => def.pageItemTemplateReferenceName);

  // Map source zones to template section names in order
  const sourceZoneEntries = Object.entries(sourceZones);

  for (let i = 0; i < sourceZoneEntries.length && i < sectionNames.length; i++) {
    const [sourceZoneName, zoneContent] = sourceZoneEntries[i];
    const targetZoneName = sectionNames[i];
    translatedZones[targetZoneName] = zoneContent;
  }

  // CRITICAL FIX: Instead of dropping extra zones, combine them into the main zone
  if (sourceZoneEntries.length > sectionNames.length && sectionNames.length > 0) {
    const mainZoneName = sectionNames[0]; // Use first (main) zone as target
    const mainZoneModules = Array.isArray(translatedZones[mainZoneName])
      ? [...translatedZones[mainZoneName]]
      : [];

    for (let i = sectionNames.length; i < sourceZoneEntries.length; i++) {
      const [sourceZoneName, zoneContent] = sourceZoneEntries[i];
      if (Array.isArray(zoneContent) && zoneContent.length > 0) {
        mainZoneModules.push(...zoneContent);
      }
    }

    translatedZones[mainZoneName] = mainZoneModules;
  }

  return translatedZones;
}
