import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { Logs } from "core/logs";
import { state, getState, getApiClient, getLoggerForGuid } from "core/state";
import { GalleryMapper } from "lib/mappers/gallery-mapper";

/**
 * Extract meaningful error message from API errors
 */
function extractErrorMessage(error: any): string {
  // Check for axios response data (actual API error message)
  if (error?.innerError?.response?.data) {
    const data = error.innerError.response.data;
    if (typeof data === 'string') return data;
    if (data.message) return data.message;
    if (data.error) return data.error;
    if (data.Message) return data.Message;
    if (data.Error) return data.Error;
  }
  // Check for direct response data
  if (error?.response?.data) {
    const data = error.response.data;
    if (typeof data === 'string') return data;
    if (data.message) return data.message;
    if (data.error) return data.error;
  }
  // Fall back to error message
  return error?.message || error?.innerError?.message || String(error);
}

/**
 * Enhanced gallery finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Change Delta SECOND → Conflict Resolution
 */

export async function pushGalleries(
  sourceData: mgmtApi.assetMediaGrouping[],
  targetData: mgmtApi.assetMediaGrouping[]
  // onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void
): Promise<{ status: "success" | "error"; successful: number; failed: number; skipped: number }> {
  // Extract data from sourceData - unified parameter pattern
  const galleries: mgmtApi.assetMediaGrouping[] = sourceData || [];

  const { sourceGuid, targetGuid, overwrite } = state;

  
  // Get the GUID logger from state instead of creating a new one
  const logger = getLoggerForGuid(sourceGuid[0]) || new Logs("push", "gallery", sourceGuid[0]);

  if (!galleries || galleries.length === 0) {
    console.log("No galleries found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  // Get API client
  const apiClient = getApiClient();

  const referenceMapper = new GalleryMapper(sourceGuid[0], targetGuid[0]);

  const totalGroupings = galleries.length;
  let successful = 0;
  let failed = 0;
  let skipped = 0;
  let processedCount = 0;
  let overallStatus: "success" | "error" = "success";

  
  for (const sourceGallery of galleries) {
    let currentStatus: "success" | "error" = "success";
    try {
      const existingMapping = referenceMapper.getGalleryMapping(sourceGallery, "source");
      
      // Check both: mapping file AND if gallery exists by name in target data
      const targetGalleryByName = targetData.find(t => t.name === sourceGallery.name);
      const targetGalleryById = targetData.find(t => t.mediaGroupingID === existingMapping?.targetMediaGroupingID);
      
      // If no mapping but gallery exists by name in target, create/update the mapping
      if (!existingMapping && targetGalleryByName) {
        // Gallery exists in target by name but no mapping - add mapping and skip
        referenceMapper.addMapping(sourceGallery, targetGalleryByName);
        logger.gallery.skipped(sourceGallery, "already exists in target by name", targetGuid[0]);
        skipped++;
        continue;
      }
        
      const shouldCreate = existingMapping === null && !targetGalleryByName;

      if (shouldCreate) {
        // Gallery needs to be created (doesn't exist in target)
        await createGallery(sourceGallery, apiClient, targetGuid[0], referenceMapper, logger);
        successful++;
      } else if (existingMapping) {
        const targetGallery = targetGalleryById || targetGalleryByName;
        const isTargetSafe = referenceMapper.hasTargetChanged(targetGallery);
        const hasSourceChanges = referenceMapper.hasSourceChanged(sourceGallery);
        let shouldUpdate = isTargetSafe && hasSourceChanges;
        let shouldSkip = !isTargetSafe && !hasSourceChanges;

        if (overwrite) {
          shouldUpdate = true;
          shouldSkip = false;
        }

        if (shouldUpdate) {
          // Gallery exists but needs updating
          await updateGallery(sourceGallery, existingMapping.targetMediaGroupingID, apiClient, targetGuid[0], referenceMapper, logger);
          successful++;
        } else if (shouldSkip) {
          // Gallery exists and is up to date - skip
          logger.gallery.skipped(sourceGallery, "up to date, skipping", targetGuid[0]);
          skipped++;
        }
      }
    } catch (error: any) {
      const errorMsg = extractErrorMessage(error);
      logger.gallery.error(sourceGallery, errorMsg, targetGuid[0]);
      failed++;
      currentStatus = "error";
      overallStatus = "error";
    } finally {
      processedCount++;
    }
  }

  console.log(
    ansiColors.yellow(
      `Processed ${successful}/${totalGroupings} gallery groupings (${failed} failed, ${skipped} skipped)`
    )
  );
  return { status: overallStatus, successful, failed, skipped };
}

/**
 * Create a new gallery in the target instance
 * Only sends essential fields - lets the API set modifiedBy/modifiedOn
 */
async function createGallery(
  mediaGrouping: mgmtApi.assetMediaGrouping,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  referenceMapper: GalleryMapper,
  logger: Logs
): Promise<void> {
  // Build payload with essential fields; API will set modifiedBy/modifiedOn automatically
  // Include all required type fields with null for optional server-set values
  const payload: mgmtApi.assetMediaGrouping = {
    mediaGroupingID: 0, // 0 = create new
    groupingType: null, // Let API set this
    groupingTypeID: mediaGrouping.groupingTypeID ?? 1, // 1 = gallery
    name: mediaGrouping.name,
    description: mediaGrouping.description ?? null,
    modifiedBy: null, // Let API set this
    modifiedByName: null, // Let API set this
    modifiedOn: null, // Let API set this
    isDeleted: false,
    isFolder: mediaGrouping.isFolder ?? false,
    metaData: mediaGrouping.metaData && Object.keys(mediaGrouping.metaData).length > 0 
      ? mediaGrouping.metaData 
      : {}
  };
  // Let errors propagate to caller for proper failure tracking
  const savedGallery = await apiClient.assetMethods.saveGallery(targetGuid, payload);
  referenceMapper.addMapping(mediaGrouping, savedGallery);
  logger.gallery.created(mediaGrouping, "created", targetGuid);
}

/**
 * Update an existing gallery in the target instance
 * Only sends essential fields - lets the API set modifiedBy/modifiedOn
 */
async function updateGallery(
  sourceGallery: mgmtApi.assetMediaGrouping,
  targetID: number,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  referenceMapper: GalleryMapper,
  logger: Logs
): Promise<void> {
  // Build payload with essential fields; API will set modifiedBy/modifiedOn automatically
  // Include all required type fields with null for optional server-set values
  const payload: mgmtApi.assetMediaGrouping = {
    mediaGroupingID: targetID, // Use target's ID for update
    groupingType: null, // Let API set this
    groupingTypeID: sourceGallery.groupingTypeID ?? 1,
    name: sourceGallery.name,
    description: sourceGallery.description ?? null,
    modifiedBy: null, // Let API set this
    modifiedByName: null, // Let API set this
    modifiedOn: null, // Let API set this
    isDeleted: sourceGallery.isDeleted ?? false,
    isFolder: sourceGallery.isFolder ?? false,
    metaData: sourceGallery.metaData && Object.keys(sourceGallery.metaData).length > 0 
      ? sourceGallery.metaData 
      : {}
  };
  const savedGallery = await apiClient.assetMethods.saveGallery(targetGuid, payload);
  referenceMapper.addMapping(sourceGallery, savedGallery);
  logger.gallery.updated(sourceGallery, "updated", targetGuid);
}
