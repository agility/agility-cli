import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../shared/reference-mapper";
import ansiColors from "ansi-colors";
import { getState } from "../../core/state";
import { FinderDecisionEngine, FinderDecision } from "../shared/target-safety-detector";

/**
 * Enhanced gallery finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Sync Delta SECOND → Conflict Resolution
 */
export async function findGalleryInTargetInstance(
  sourceGallery: mgmtApi.assetMediaGrouping,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  targetData: any,
  referenceMapper: ReferenceMapper
): Promise<{ gallery: mgmtApi.assetMediaGrouping | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean; decision?: FinderDecision }> {
  const state = getState();

  // STEP 1: Find existing mapping
  const existingMapping = referenceMapper.getMappingByKey<mgmtApi.assetMediaGrouping>("gallery", "mediaGroupingID", sourceGallery.mediaGroupingID);
  let targetGalleryFromMapping: mgmtApi.assetMediaGrouping | null = existingMapping?.target || null;

  // STEP 2: Find target instance data
  const targetInstanceData = targetData.galleries?.find((g: any) => {
    if (targetGalleryFromMapping) {
      return (
        g.mediaGroupingID === targetGalleryFromMapping.mediaGroupingID ||
        g.name === targetGalleryFromMapping.name
      );
    } else {
      return g.name === sourceGallery.name;
    }
  });

  // STEP 3: Use FinderDecisionEngine for proper conflict resolution
  const decision = FinderDecisionEngine.makeDecision(
    'gallery',
    sourceGallery.mediaGroupingID,
    sourceGallery.name || `Gallery-${sourceGallery.mediaGroupingID}`,
    sourceGallery,
    targetGalleryFromMapping,
    targetInstanceData
  );

  return {
    gallery: decision.entity,
    shouldUpdate: decision.shouldUpdate,
    shouldCreate: decision.shouldCreate,
    shouldSkip: decision.shouldSkip,
    decision: decision
  };
} 