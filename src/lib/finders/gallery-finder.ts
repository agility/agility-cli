import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../shared/reference-mapper";
import ansiColors from "ansi-colors";
import { getState } from "../../core/state";

export async function findGalleryInTargetInstance(
  sourceGallery: mgmtApi.assetMediaGrouping,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  targetData: any,
  referenceMapper: ReferenceMapper
): Promise<{ gallery: mgmtApi.assetMediaGrouping | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean }> {
  const state = getState();
  const overwrite = state.overwrite;
  let existsInTarget = false;

  // STEP 1: Check for existing mapping of source gallery to target gallery
  const existingMapping = referenceMapper.getMappingByKey<mgmtApi.assetMediaGrouping>("gallery", "mediaGroupingID", sourceGallery.mediaGroupingID);
  let targetGalleryFromMapping: mgmtApi.assetMediaGrouping | null = existingMapping?.target || null;

  // STEP 2: Find target instance data (local file data) for this gallery
  const targetInstanceData = targetData.galleries?.find((g: any) => {
    // Try multiple matching strategies for target data
    if (targetGalleryFromMapping) {
      // If we have a mapping, match by target gallery properties
      return (
        g.mediaGroupingID === targetGalleryFromMapping.mediaGroupingID ||
        g.name === targetGalleryFromMapping.name
      );
    } else {
      // If no mapping, match by source gallery properties
      return g.name === sourceGallery.name;
    }
  });

  if (targetInstanceData) {
    existsInTarget = true;
  }

  // STEP 3: Decision logic based on mapping and target data
  let shouldUpdate = false;
  let shouldCreate = false;
  let shouldSkip = false;
  let finalTargetGallery: mgmtApi.assetMediaGrouping | null = null;

  if (targetInstanceData) {
    // Target gallery exists in target instance
    finalTargetGallery = targetInstanceData;
    shouldCreate = false;

    if (targetGalleryFromMapping) {
      // Both mapping and target data exist - compare dates for update decision
      const mappingDate = new Date(targetGalleryFromMapping.modifiedOn || 0);
      const targetDataDate = new Date(targetInstanceData.modifiedOn || 0);

      if (targetDataDate > mappingDate) {
        shouldUpdate = true;
        shouldSkip = false;
      } else {
        shouldUpdate = false;
        shouldSkip = true;
      }
    } else {
      // Target data exists but no mapping - this is an existing gallery, add mapping
      shouldUpdate = false;
      shouldSkip = true;
    }

    // REMOVED: Do not update mapping here - let the pusher handle it after successful operations
  } else {
    // No target instance data found - gallery doesn't exist in target
    shouldCreate = true;
    shouldUpdate = false;
    shouldSkip = false;
    finalTargetGallery = null;
    // console.log(ansiColors.blue(`Gallery ${sourceGallery.name} not found in target - should create`));
  }

  // STEP 4: Handle overwrite flag
  if (overwrite) {
    shouldUpdate = existsInTarget;
    shouldCreate = !existsInTarget;
    shouldSkip = false;
  }

  return {
    gallery: finalTargetGallery,
    shouldUpdate,
    shouldCreate,
    shouldSkip,
  };
} 