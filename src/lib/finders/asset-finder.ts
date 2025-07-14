import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../shared/reference-mapper";
import ansiColors from "ansi-colors";
import { getState } from "../../core/state";

export async function findAssetInTargetInstance(
  sourceAsset: mgmtApi.Media,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  targetData: any,
  referenceMapper: ReferenceMapper
): Promise<{ asset: mgmtApi.Media | null; shouldUpdate: boolean; shouldCreate: boolean }> {
  const state = getState();
  const overwrite = state.overwrite;
  let existsInTarget = false;

  // STEP 1: Check for existing mapping of source asset to target asset
  const existingMapping = referenceMapper.getMappingByKey<mgmtApi.Media>("asset", "mediaID", sourceAsset.mediaID);
  let targetAssetFromMapping: mgmtApi.Media | null = existingMapping?.target || null;

  // STEP 2: Find target instance data (local file data) for this asset
  const targetInstanceData = targetData.assets?.find((a: any) => {
    // Try multiple matching strategies for target data
    if (targetAssetFromMapping) {
      // If we have a mapping, match by target asset properties
      return (
        a.mediaID === targetAssetFromMapping.mediaID ||
        a.fileName === targetAssetFromMapping.fileName ||
        a.originUrl === targetAssetFromMapping.originUrl
      );
    } else {
      // If no mapping, match by source asset properties
      return (
        a.fileName === sourceAsset.fileName ||
        a.originUrl === sourceAsset.originUrl ||
        a.url === sourceAsset.originUrl ||
        a.edgeUrl === sourceAsset.originUrl
      );
    }
  });

  if (targetInstanceData) {
    existsInTarget = true;
  }
 

  // STEP 3: Decision logic based on mapping and target data
  let shouldUpdate = false;
  let shouldCreate = false;
  let finalTargetAsset: mgmtApi.Media | null = null;

  if (targetInstanceData) {
    // Target asset exists in target instance
    finalTargetAsset = targetInstanceData;
    shouldCreate = false;

    if (targetAssetFromMapping) {
      // Both mapping and target data exist - compare dates for update decision
      const mappingDate = new Date(targetAssetFromMapping.dateModified || 0);
      const targetDataDate = new Date(targetInstanceData.dateModified || 0);

      console.log(ansiColors.magenta(`mappingDate: ${mappingDate}`));
      console.log(ansiColors.magenta(`targetDataDate: ${targetDataDate}`));
      if (targetDataDate > mappingDate) {
        shouldUpdate = true;       
      } else {
        shouldUpdate = false;
      }
    } else {
      // Target data exists but no mapping - this is an existing asset, add mapping
      shouldUpdate = false; // Don't update since it already exists
    }

    // REMOVED: Do not update mapping here - let the pusher handle it after successful operations
  } else {
    // No target instance data found - asset doesn't exist in target
    shouldCreate = true;
    shouldUpdate = false;
    finalTargetAsset = null;
    // console.log(ansiColors.blue(`Asset ${sourceAsset.fileName} not found in target - should create`));
  }

  // STEP 4: Handle overwrite flag
  if (overwrite) {
    shouldUpdate = existsInTarget;
    shouldCreate = !existsInTarget;
  }

  return {
    asset: finalTargetAsset,
    shouldUpdate,
    shouldCreate,
  };
}
