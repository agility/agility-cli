import { state } from "../../../../core";
import { ContentItemMapping } from "lib/mappers/content-item-mapper";
import * as mgmtApi from "@agility/management-sdk";

/**
 * Simple change detection for content items
 */
export interface ChangeDetection {
  entity: mgmtApi.ContentItem | null;
  shouldUpdate: boolean;
  shouldCreate: boolean;
  shouldSkip: boolean;
  isConflict: boolean;
  reason: string;
}

export function changeDetection(
  sourceEntity: mgmtApi.ContentItem,
  targetEntity: mgmtApi.ContentItem | null,
  mapping: ContentItemMapping,
  locale: string
): ChangeDetection {
  const { overwrite } = state;
  // Validate source entity structure
  if (!sourceEntity || !sourceEntity.properties) {
    // console.error(`[ChangeDetection] Invalid source entity structure:`, sourceEntity);
    return {
      entity: null,
      shouldUpdate: false,
      shouldCreate: false,
      shouldSkip: true,
      isConflict: false,
      reason: "Invalid source entity structure",
    };
  }

  const itemName = sourceEntity.properties?.referenceName || `ID:${sourceEntity.contentID}`;

  if (!mapping && !targetEntity) {
    //if we have no target content and no mapping
    // if (state.verbose) {
    // 	console.log(`[ChangeDetection] ${itemName}: No mapping and no target entity → CREATE`);
    // }
    return {
      entity: null,
      shouldUpdate: false,
      shouldCreate: true,
      shouldSkip: false,
      isConflict: false,
      reason: "Mapping and Target Content Item doesn't exist",
    };
  }

  // Check if update is needed based on version or modification date
  const sourceVersion = sourceEntity.properties?.versionID || 0;
  const targetVersion = targetEntity?.properties?.versionID || 0;

  const mappedSourceVersion = (mapping?.sourceVersionID || 0) as number;
  const mappedTargetVersion = (mapping?.targetVersionID || 0) as number;

  if (mapping && !targetEntity) {
    // PROD-2603: the mapping points at a target item that is no longer in the pulled target data —
    // it was deleted, or unpublished (the pull omits state-7 items, so the two are indistinguishable
    // here). Previously this fell into the "source update only" branch with a null entity, the batch
    // processor created a brand-new item, and addMapping refused to repoint the stale record, so the
    // same create repeated on every run (and under reverse-sync the orphans then round-tripped).
    //
    // - Source unchanged: nothing to push; respect the target-side removal and skip.
    // - Source changed, no --overwrite: surface it as a conflict so the user decides.
    // - Source changed, --overwrite: recreate (the batch processor reuses the mapped ID per PROD-1320,
    //   or repoints the mapping when the API assigns a new one).
    if (sourceVersion <= mappedSourceVersion) {
      return {
        entity: null,
        shouldUpdate: false,
        shouldCreate: false,
        shouldSkip: true,
        isConflict: false,
        reason: "Mapped target item no longer exists (deleted or unpublished) and the source is unchanged; nothing to push",
      };
    }
    if (overwrite) {
      return {
        entity: null,
        shouldUpdate: true,
        shouldCreate: false,
        shouldSkip: false,
        isConflict: false,
        reason: "Overwrite mode enabled: mapped target item no longer exists and will be recreated",
      };
    }
    const sourceUrl = `https://app.agilitycms.com/instance/${state.sourceGuid}/${locale}/content/listitem-${sourceEntity.contentID}`;
    return {
      entity: null,
      shouldUpdate: false,
      shouldCreate: false,
      shouldSkip: false,
      isConflict: true,
      reason:
        `Mapped target item (contentID ${mapping.targetContentID}) no longer exists on the target — it was deleted or unpublished. ` +
        `Use --overwrite to recreate it and repoint the mapping.\n   - source: ${sourceUrl}`,
    };
  }

  if (sourceVersion > 0 && targetVersion > 0) {
    //both the source and the target exist

    if (sourceVersion > mappedSourceVersion && targetVersion > mappedTargetVersion) {
      //CONFLICT DETECTION
      // Source version is newer than mapped source version
      // and target version is newer than mapped target version

      //build the url to the source and target entity
      const sourceUrl = `https://app.agilitycms.com/instance/${state.sourceGuid}/${locale}/content/listitem-${sourceEntity.contentID}`;
      const targetUrl = `https://app.agilitycms.com/instance/${state.targetGuid}/${locale}/content/listitem-${targetEntity.contentID}`;

      if (overwrite) {
        return {
          entity: targetEntity,
          shouldUpdate: true,
          shouldCreate: false,
          shouldSkip: false,
          isConflict: false,
          reason: "Overwrite mode enabled",
        };
      } else {
        return {
          entity: targetEntity,
          shouldUpdate: false,
          shouldCreate: false,
          shouldSkip: false,
          isConflict: true,
          reason: `Both source and target versions have been updated. Please resolve manually.\n   - source: ${sourceUrl} \n   - target: ${targetUrl}`,
        };
      }
    }
  }

  if (sourceVersion > mappedSourceVersion && targetVersion <= mappedTargetVersion) {
    //SOURCE UPDATE ONLY
    // Source version is newer the mapped source version
    // and target version is NOT newer than mapped target version
    return {
      entity: targetEntity,
      shouldUpdate: true,
      shouldCreate: false,
      shouldSkip: false,
      isConflict: false,
      reason: "Source version is newer.",
    };
  }

  return {
    entity: targetEntity,
    shouldUpdate: false,
    shouldCreate: false,
    shouldSkip: true,
    isConflict: false,
    // No update needed, target is up to date
    reason: "Entity exists and is up to date",
  };
}
