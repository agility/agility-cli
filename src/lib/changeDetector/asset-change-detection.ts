import { Media } from "@agility/management-sdk";
import { ReferenceMapperV2 } from "lib/refMapper";
import { ChangeDeltaFileWorker } from "lib/shared/change-delta-file-worker";
import { ChangeDetection } from "./change-detection-models";
import { getState } from "../../core/state";

/**
 * Enhanced asset finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Change Delta SECOND → Conflict Resolution
 */
export async function getAssetAndChangeOperationDecision(
  sourceAsset: Media,
  targetData: any,
  referenceMapper: ReferenceMapperV2,
  changeDeltaWorker: ChangeDeltaFileWorker
): Promise<{ asset: Media | null; shouldUpdate: boolean; shouldCreate: boolean; decision?: ChangeDetection }> {
  const existingMapping = referenceMapper.getMappingByKey<Media>("asset", "mediaID", sourceAsset.mediaID);
  const isInitialSync = existingMapping === null;

  // Get asset based on id, url or filename
  const targetInstanceData = targetData.assets?.find((a: any) => {
    return (
      a.fileName === sourceAsset.fileName ||
      a.originUrl === sourceAsset.originUrl ||
      a.url === sourceAsset.originUrl ||
      a.edgeUrl === sourceAsset.originUrl
    );
  });

  let decision: ChangeDetection = null;

  // If no mapping, assume initial sync
  if (isInitialSync) {
    decision = firstRunChangeDetection(sourceAsset, targetInstanceData);

    return {
      asset: decision.entity,
      shouldUpdate: decision.shouldUpdate,
      shouldCreate: decision.shouldCreate,
      decision: decision,
    };
  } else {
    // If there is a mapping, implement the new logic flow
    decision = secondRunChangeDetection(sourceAsset, existingMapping, targetInstanceData, changeDeltaWorker);

    return {
      asset: decision.entity,
      shouldUpdate: decision.shouldUpdate,
      shouldCreate: decision.shouldCreate,
      decision: decision,
    };
  }

}

function secondRunChangeDetection(sourceEntity: Media, targetFromMapping: any, targetFromData: any, changeDeltaWorker: ChangeDeltaFileWorker): ChangeDetection {
  const state = getState();
  
  // Check if mapping versionID/changeData differs from downloaded data
  const mappingVersionID = targetFromMapping?.versionID || targetFromMapping?.dateModified;
  const targetVersionID = targetFromData?.versionID || targetFromData?.dateModified;
  
  if (mappingVersionID !== targetVersionID) {
    // CONFLICT: User has made changes in target instance outside of CLI
    return {
      entity: targetFromData,
      shouldUpdate: false,
      shouldCreate: false,
      shouldSkip: true,
      reason: "CONFLICT: User has created a conflict between the mapping and the target instance data by making a change in the target instance outside of the CLI",
    };
  }

  // No conflict, check ChangeDelta for updates
  try {
    // Use the first target GUID from the state
    const targetGuid = state.targetGuid[0];
    if (!targetGuid) {
      return {
        entity: targetFromData,
        shouldUpdate: false,
        shouldCreate: false,
        shouldSkip: true,
        reason: "No target GUID found in state",
      };
    }

    const entityPayload = {
      guid: targetGuid,
      id: sourceEntity.mediaID
    };

    const changeEntity = changeDeltaWorker.getChangeDeltaEntity('asset', entityPayload);


    if (changeEntity === 'created' || changeEntity === 'updated') {
      // UPDATE the asset
      return {
        entity: targetFromData,
        shouldUpdate: true,
        shouldCreate: false,
        shouldSkip: false,
        reason: `Asset has ${changeEntity} changes in change delta`,
      };
    } else {
      // Skip updating the asset
      return {
        entity: targetFromData,
        shouldUpdate: false,
        shouldCreate: false,
        shouldSkip: true,
        reason: "No changes detected in change delta",
      };
    }
  } catch (error) {
    // Asset not found in change delta, skip updating
    return {
      entity: targetFromData,
      shouldUpdate: false,
      shouldCreate: false,
      shouldSkip: true,
      reason: "Asset not found in change delta",
    };
  }
}

function firstRunChangeDetection(sourceEntity: Media, targetFromData: any): ChangeDetection {
  if (!targetFromData) {
    return {
      entity: null,
      shouldUpdate: false,
      shouldCreate: true,
      shouldSkip: false,
      reason: "Asset does not exist in target",
    };
  }

  const targetEntity = targetFromData;

  // For assets, check file modification dates or sizes if available
  const sourceModified = new Date(sourceEntity.dateModified || 0);
  const targetModified = new Date(targetEntity.dateModified || 0);

  if (sourceModified > targetModified) {
    return {
      entity: targetEntity,
      shouldUpdate: true,
      shouldCreate: false,
      shouldSkip: false,
      reason: "Source asset is newer",
    };
  }

  return {
    entity: targetEntity,
    shouldUpdate: false,
    shouldCreate: false,
    shouldSkip: true,
    reason: "Asset exists and is up to date",
  };
}
