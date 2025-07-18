import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
import ansiColors from "ansi-colors";
import { getState } from "../../core/state";
import { FinderDecisionEngine, FinderDecision } from "../shared/target-safety-detector";

/**
 * Enhanced asset finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Sync Delta SECOND → Conflict Resolution
 */
export async function findAssetInTargetInstance(
  sourceAsset: mgmtApi.Media,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  targetData: any,
  referenceMapper: ReferenceMapperV2
): Promise<{ asset: mgmtApi.Media | null; shouldUpdate: boolean; shouldCreate: boolean; decision?: FinderDecision }> {
  const state = getState();

  // STEP 1: Find existing mapping
  const existingMapping = referenceMapper.getMappingByKey<mgmtApi.Media>("asset", "mediaID", sourceAsset.mediaID);
  let targetAssetFromMapping: mgmtApi.Media | null = existingMapping?.target || null;

  // STEP 2: Find target instance data with enhanced URL matching
  const targetInstanceData = targetData.assets?.find((a: any) => {
    if (targetAssetFromMapping) {
      return (
        a.mediaID === targetAssetFromMapping.mediaID ||
        a.fileName === targetAssetFromMapping.fileName ||
        a.originUrl === targetAssetFromMapping.originUrl
      );
    } else {
      // Enhanced URL matching for assets (critical for asset reference resolution)
      return (
        a.fileName === sourceAsset.fileName ||
        a.originUrl === sourceAsset.originUrl ||
        a.url === sourceAsset.originUrl ||
        a.edgeUrl === sourceAsset.originUrl
      );
    }
  });

  // STEP 3: Use FinderDecisionEngine for proper conflict resolution
  const decision = FinderDecisionEngine.makeDecision(
    'asset',
    sourceAsset.mediaID,
    sourceAsset.fileName || `Asset-${sourceAsset.mediaID}`,
    sourceAsset,
    targetAssetFromMapping,
    targetInstanceData
  );

  return {
    asset: decision.entity,
    shouldUpdate: decision.shouldUpdate,
    shouldCreate: decision.shouldCreate,
    decision: decision
  };
}
