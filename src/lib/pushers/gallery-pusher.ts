import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
import { state, getState } from '../../core/state';

/**
 * Simple change detection for galleries
 */
interface ChangeDetection {
  entity: any;
  shouldUpdate: boolean;
  shouldCreate: boolean;
  shouldSkip: boolean;
  reason: string;
}

function changeDetection(
  sourceEntity: any,
  targetFromMapping: any,
  targetFromData: any
): ChangeDetection {
  if (!targetFromMapping && !targetFromData) {
    return {
      entity: null,
      shouldUpdate: false,
      shouldCreate: true,
      shouldSkip: false,
      reason: 'Gallery does not exist in target'
    };
  }
  
  const targetEntity = targetFromData || targetFromMapping;
  
  // For galleries, check modification dates
  const sourceModified = new Date(sourceEntity.modifiedOn || 0);
  const targetModified = new Date(targetEntity.modifiedOn || 0);
  
  if (sourceModified > targetModified) {
    return {
      entity: targetEntity,
      shouldUpdate: true,
      shouldCreate: false,
      shouldSkip: false,
      reason: 'Source gallery is newer'
    };
  }
  
  return {
    entity: targetEntity,
    shouldUpdate: false,
    shouldCreate: false,
    shouldSkip: true,
    reason: 'Gallery exists and is up to date'
  };
}

/**
 * Enhanced gallery finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Sync Delta SECOND → Conflict Resolution
 */
export async function findGalleryInTargetInstance(
  sourceGallery: mgmtApi.assetMediaGrouping,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  targetData: any,
  referenceMapper: ReferenceMapperV2
): Promise<{ gallery: mgmtApi.assetMediaGrouping | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean; decision?: ChangeDetection }> {
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

  // STEP 3: Use change detection for conflict resolution
  const decision = changeDetection(
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

export async function pushGalleries(
    sourceData: any,
    targetData: any,
    referenceMapper: ReferenceMapperV2,
    onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: 'success' | 'error', successful: number, failed: number, skipped: number }> {
    
    // Extract data from sourceData - unified parameter pattern
    const galleries: mgmtApi.assetMediaGrouping[] = sourceData.galleries || [];
 
    if (!galleries || galleries.length === 0) {
        console.log('No galleries found to process.');
        return { status: 'success', successful: 0, failed: 0, skipped: 0 };
    }

    // Get state values instead of prop drilling
    const { targetGuid } = state;
    const { getApiClient } = await import('../../core/state');
    const apiClient = getApiClient();

    const totalGroupings = galleries.length;
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let processedCount = 0;
    let overallStatus: 'success' | 'error' = 'success';

    for (const mediaGrouping of galleries) {
        let currentStatus: 'success' | 'error' = 'success';
        try {
            // Use gallery-finder to determine what action to take
            const existingGallery = await findGalleryInTargetInstance(mediaGrouping, apiClient, targetGuid[0], targetData, referenceMapper);
            const { gallery, shouldUpdate, shouldCreate, shouldSkip } = existingGallery;

            if (shouldCreate) {
                // Gallery needs to be created (doesn't exist in target)
                await createGallery(mediaGrouping, apiClient, targetGuid[0], referenceMapper);
                successful++;
                
            } else if (shouldUpdate) {
                // Gallery exists but needs updating
                await updateGallery(mediaGrouping, gallery, apiClient, targetGuid[0], referenceMapper);
                successful++;
                
            } else if (shouldSkip) {
                // Gallery exists and is up to date - skip
                console.log(`✓ Gallery ${ansiColors.underline(mediaGrouping.name)} ${ansiColors.bold.gray('up to date, skipping')}`);
                
                // Add mapping for existing gallery
                if (gallery) {
                    referenceMapper.addRecord('gallery', mediaGrouping, gallery);
                }
                skipped++;
            }

        } catch (error: any) {
            console.error(`✗ Error processing gallery ${mediaGrouping.name}:`, error.message);
            failed++;
            currentStatus = 'error';
            overallStatus = 'error';
        } finally {
            processedCount++;
            if (onProgress) {
                onProgress(processedCount, totalGroupings, currentStatus);
            }
        }
    }

    console.log(ansiColors.yellow(`Processed ${successful}/${totalGroupings} gallery groupings (${failed} failed, ${skipped} skipped)`));
    return { status: overallStatus, successful, failed, skipped };
}

/**
 * Create a new gallery in the target instance
 */
async function createGallery(
    mediaGrouping: mgmtApi.assetMediaGrouping,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    referenceMapper: ReferenceMapperV2
): Promise<void> {
    const payload = { ...mediaGrouping, mediaGroupingID: 0 };
    const savedGallery = await apiClient.assetMethods.saveGallery(targetGuid, payload);
    referenceMapper.addRecord('gallery', mediaGrouping, savedGallery);
    console.log(`✓ Gallery created: ${mediaGrouping.name} - ${ansiColors.green('Source')}: ${mediaGrouping.mediaGroupingID} ${ansiColors.green(targetGuid)}: ${savedGallery.mediaGroupingID}`);
}

/**
 * Update an existing gallery in the target instance
 */
async function updateGallery(
    sourceGallery: mgmtApi.assetMediaGrouping,
    existingGallery: mgmtApi.assetMediaGrouping,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    referenceMapper: ReferenceMapperV2
): Promise<void> {
    const payload = { ...sourceGallery, mediaGroupingID: existingGallery.mediaGroupingID };
    const savedGallery = await apiClient.assetMethods.saveGallery(targetGuid, payload);
    referenceMapper.addRecord('gallery', sourceGallery, savedGallery);
    console.log(`✓ Gallery updated: ${sourceGallery.name} - ${ansiColors.green('Source')}: ${sourceGallery.mediaGroupingID} ${ansiColors.green(targetGuid)}: ${savedGallery.mediaGroupingID}`);
}