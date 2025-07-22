import ansiColors from "ansi-colors";
import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
import { getAssetFilePath } from "../shared";
import { state, getState } from "../../core/state";
const FormData = require("form-data");
import { getApiClient } from "../../core/state";
import { fileOperations } from "../../core/fileOperations";

/**
 * Simple change detection for assets
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
      reason: 'Asset does not exist in target'
    };
  }
  
  const targetEntity = targetFromData || targetFromMapping;
  
  // For assets, check file modification dates or sizes if available
  const sourceModified = new Date(sourceEntity.dateModified || 0);
  const targetModified = new Date(targetEntity.dateModified || 0);
  
  if (sourceModified > targetModified) {
    return {
      entity: targetEntity,
      shouldUpdate: true,
      shouldCreate: false,
      shouldSkip: false,
      reason: 'Source asset is newer'
    };
  }
  
  return {
    entity: targetEntity,
    shouldUpdate: false,
    shouldCreate: false,
    shouldSkip: true,
    reason: 'Asset exists and is up to date'
  };
}

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
): Promise<{ asset: mgmtApi.Media | null; shouldUpdate: boolean; shouldCreate: boolean; decision?: ChangeDetection }> {
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

  // STEP 3: Use change detection for conflict resolution
  const decision = changeDetection(
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

export async function pushAssets(
  sourceData: any,
  targetData: any,
  referenceMapper: ReferenceMapperV2,
  onProgress?: (processed: number, total: number, status?: "success" | "error") => void
): Promise<{ status: "success" | "error"; successful: number; failed: number; skipped: number }> {
  // Extract data from sourceData - unified parameter pattern
  const assets: mgmtApi.Media[] = sourceData.assets || [];
  

  if (!assets || assets.length === 0) {
    console.log("No assets found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  // Get state values instead of prop drilling
  const { sourceGuid, targetGuid, locale, preview: isPreview } = state;
 
  const apiClient = getApiClient();

  let defaultContainer: mgmtApi.assetContainer | null = null;
  try {
    defaultContainer = await apiClient.assetMethods.getDefaultContainer(targetGuid[0]);
  } catch (err: any) {
    console.error("✗ Error fetching default asset container:", err.message);
    return { status: "error", successful: 0, failed: 0, skipped: 0 };
  }

  const totalAssets = assets.length;
  let successful = 0;
  let failed = 0;
  let skipped = 0;
  let processedAssetsCount = 0;
  let overallStatus: "success" | "error" = "success";

  const fileOps = new fileOperations(sourceGuid[0]);
  const basePath = fileOps.getDataFolderPath();

 

  for (const media of assets) {
    let currentStatus: "success" | "error" = "success";
    try {
      const relativeFilePath = getAssetFilePath(media.originUrl).replace(/%20/g, " "); // Uses imported util
      const absoluteLocalFilePath = fileOps.getDataFilePath(relativeFilePath);
      const folderPath = fileOps.getDataFolderPath(relativeFilePath);

      const existingMedia = await findAssetInTargetInstance(
        media,
        apiClient,
        targetGuid[0],
        targetData,
        referenceMapper
      );
      const { asset, shouldUpdate, shouldCreate } = existingMedia;

      if (shouldCreate) {
        // Asset needs to be created (doesn't exist in target)
        const createdAsset = await createAsset(
          media,
          absoluteLocalFilePath,
          folderPath,
          apiClient,
          targetGuid[0],
          referenceMapper
        );
        // referenceMapper.addRecord("asset", media, createdAsset);
        successful++;
      } else if (shouldUpdate) {
        // Asset exists but needs updating
        const updatedAsset = await updateAsset(
          media,
          asset,
          absoluteLocalFilePath,
          folderPath,
          apiClient,
          targetGuid[0],
          referenceMapper
        );
        // referenceMapper.addRecord("asset", media, updatedAsset);

        successful++;
      } else {
        // Asset exists and is up to date - skip
        const sourceFileName = media.originUrl.split("/").pop()?.split("?")[0];
        const targetFileName = asset?.originUrl?.split("/").pop()?.split("?")[0];
        console.log(
          `✓ Asset ${ansiColors.underline(sourceFileName || "unknown")} ${ansiColors.bold.grey(
            "exists, skipping"
          )} - ${ansiColors.green(targetGuid[0])}: mediaID:${asset?.mediaID} (${targetFileName})`
        );

        // Add mapping for existing asset
        // if (asset) {
        //   referenceMapper.addRecord("asset", media, asset);
        // }
        skipped++;
      }
    } catch (error: any) {
      console.error(`✗ Error processing asset ${media.fileName || media.originUrl}:`, error.message);
      failed++;
      currentStatus = "error";
      overallStatus = "error";
    } finally {
      // Increment and call progress for each media item
      processedAssetsCount++;
      if (onProgress) {
        onProgress(processedAssetsCount, totalAssets, overallStatus);
      }
    }
  }

  console.log(
    ansiColors.yellow(`Processed ${successful}/${totalAssets} assets (${failed} failed, ${skipped} skipped)`)
  );
  return { status: overallStatus, successful, failed, skipped };
}

/**
 * Create a new asset in the target instance
 */
async function createAsset(
  media: mgmtApi.Media,
  absoluteLocalFilePath: string,
  folderPath: string,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  referenceMapper: ReferenceMapperV2
): Promise<void> {
  // Handle gallery if present
  let targetMediaGroupingID = await resolveGalleryMapping(media, apiClient, targetGuid, referenceMapper);

  const fileOps = new fileOperations(targetGuid[0]);
  // Upload the asset
  const form = new FormData();
  if (!fileOps.checkFileExists(absoluteLocalFilePath)) {
    throw new Error(`Local asset file not found: ${absoluteLocalFilePath}`);
  }
  const fileBuffer = fileOps.readFile(absoluteLocalFilePath);
  form.append("files", fileBuffer, media.fileName);

  const uploadedMediaArray = await apiClient.assetMethods.upload(form, folderPath, targetGuid, targetMediaGroupingID);

  if (!uploadedMediaArray || uploadedMediaArray.length === 0) {
    throw new Error(`API did not return uploaded media details for ${media.fileName}`);
  }

  const uploadedMedia = uploadedMediaArray[0];

  // Add mapping for successful upload
  referenceMapper.addRecord("asset", media, uploadedMedia);
  console.log(
    `✓ Asset ${ansiColors.underline.cyan(media.fileName)} uploaded to path ${folderPath} - ${ansiColors.green(
      state.sourceGuid[0]
    )}: ${media.mediaID} ${ansiColors.green(targetGuid)}: ${uploadedMedia.mediaID}`
  );
}

/**
 * Update an existing asset in the target instance
 */
async function updateAsset(
  media: mgmtApi.Media,
  existingAsset: mgmtApi.Media,
  absoluteLocalFilePath: string,
  folderPath: string,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  referenceMapper: ReferenceMapperV2
): Promise<void> {
  // Handle gallery if present
  let targetMediaGroupingID = await resolveGalleryMapping(media, apiClient, targetGuid, referenceMapper);
  const fileOps = new fileOperations(targetGuid[0]);
  // Upload the asset (this will replace the existing one)
  const form = new FormData();
  if (!fileOps.checkFileExists(absoluteLocalFilePath)) {
    throw new Error(`Local asset file not found: ${absoluteLocalFilePath}`);
  }
  const fileBuffer = fileOps.readFile(absoluteLocalFilePath);
  form.append("files", fileBuffer, media.fileName);

  const uploadedMediaArray = await apiClient.assetMethods.upload(form, folderPath, targetGuid, targetMediaGroupingID);

  if (!uploadedMediaArray || uploadedMediaArray.length === 0) {
    throw new Error(`API did not return uploaded media details for ${media.fileName}`);
  }
  const uploadedMedia = uploadedMediaArray[0];

  // Add mapping for successful update
  referenceMapper.addRecord("asset", media, uploadedMedia);
  console.log(
    `✓ Asset ${ansiColors.underline.cyan(media.fileName)} updated in path ${folderPath} - ${ansiColors.green(
      state.sourceGuid[0]
    )}: ${media.mediaID} ${ansiColors.green(targetGuid)}: ${uploadedMedia.mediaID}`
  );
}

/**
 * Resolve gallery mapping for an asset
 * Returns the target gallery ID or -1 if no gallery
 */
async function resolveGalleryMapping(
  media: mgmtApi.Media,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  referenceMapper: ReferenceMapperV2
): Promise<number> {
  let targetMediaGroupingID = -1;

  if (media.mediaGroupingID > 0 && media.mediaGroupingName) {
    try {
      // Check mapper first for existing gallery mapping
      const galleryMapping = referenceMapper.getMappingByKey<mgmtApi.assetMediaGrouping>(
        "gallery",
        "name",
        media.mediaGroupingName
      );
      if (galleryMapping && galleryMapping.target) {
        targetMediaGroupingID = galleryMapping.target.mediaGroupingID;
      } else {
        // Fallback: Check API directly if not in mapper
        const gallery = await apiClient.assetMethods.getGalleryByName(targetGuid, media.mediaGroupingName);
        if (gallery) {
          targetMediaGroupingID = gallery.mediaGroupingID;
        }
      }
    } catch (error: any) {
      // Gallery doesn't exist - this is normal, asset will upload without gallery
      console.log(
        `[Asset] Gallery ${media.mediaGroupingName} not found - asset will upload without gallery association`
      );
    }
  }

  return targetMediaGroupingID;
}
