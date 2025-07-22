import ansiColors from "ansi-colors";
import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
import { getAssetFilePath } from "../shared";
import { state } from "../../core/state";
import { getAssetAndChangeOperationDecision } from "../changeDetector/asset-change-detection";
import { ChangeDeltaFileWorker } from "lib/shared/change-delta-file-worker";
const FormData = require("form-data");
import { getApiClient } from "../../core/state";
import { fileOperations } from "../../core/fileOperations";


export async function pushAssets(
  sourceData: any, // TODO: Type these
  targetData: any, // TODO: Type these
  referenceMapper: ReferenceMapperV2,
  changeDeltaWorker: ChangeDeltaFileWorker,
  onProgress?: (processed: number, total: number, status?: "success" | "error") => void,
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
              const relativeFilePath = `assets/${getAssetFilePath(media.originUrl)}`; // Uses imported util with consistent decoding
        const absoluteLocalFilePath = fileOps.getDataFilePath(relativeFilePath);
        const folderPath = fileOps.getDataFolderPath(relativeFilePath);

      const existingMedia = await getAssetAndChangeOperationDecision(
        media,
        targetData,
        referenceMapper,
        changeDeltaWorker
      );

      if(existingMedia === null){
        console.error(`Unable to get change operation for asset: ${media.mediaID}`);
      }
      const { asset, shouldUpdate, shouldCreate } = existingMedia;

      if (shouldCreate) {
        // Asset needs to be created (doesn't exist in target)
        const createdAsset = await createAsset(
          media,
          absoluteLocalFilePath,
          folderPath,
          apiClient,
          targetGuid[0],
          referenceMapper,
        );
        referenceMapper.addMapping("asset", media, createdAsset);
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
          referenceMapper,
        );
        referenceMapper.addMapping("asset", media, updatedAsset);
        successful++;
      } else {
        // Asset exists and is up to date - skip
        const sourceFileName = media.originUrl.split("/").pop()?.split("?")[0];
        const targetFileName = asset?.originUrl?.split("/").pop()?.split("?")[0];
        console.log(
          `✓ Asset ${ansiColors.underline(sourceFileName || "unknown")} ${ansiColors.bold.grey(
            "exists, skipping",
          )} - ${ansiColors.green(targetGuid[0])}: mediaID:${asset?.mediaID} (${targetFileName})`,
        );

        // Add mapping for existing asset
        if (asset) {
          referenceMapper.addMapping("asset", media, asset);
        }
        skipped++;
      }
    } catch (error: any) {
      console.log(ansiColors.red('error'), JSON.stringify(error, null, 2))
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
    ansiColors.yellow(`Processed ${successful}/${totalAssets} assets (${failed} failed, ${skipped} skipped)`),
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
  referenceMapper: ReferenceMapperV2,
): Promise<mgmtApi.Media> {
  // Handle gallery if present
  let targetMediaGroupingID = await resolveGalleryMapping(media, apiClient, targetGuid, referenceMapper);

  const fileOps = new fileOperations(targetGuid);
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

  console.log(
    `✓ Asset ${ansiColors.underline.cyan(media.fileName)} uploaded to path ${folderPath} - ${ansiColors.green(
      state.sourceGuid[0],
    )}: ${media.mediaID} ${ansiColors.green(targetGuid)}: ${uploadedMedia.mediaID}`,
  );

  return uploadedMedia;
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
  referenceMapper: ReferenceMapperV2,
): Promise<mgmtApi.Media> {
  // Handle gallery if present
  let targetMediaGroupingID = await resolveGalleryMapping(media, apiClient, targetGuid, referenceMapper);
  const fileOps = new fileOperations(targetGuid);
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

  console.log(
    `✓ Asset ${ansiColors.underline.cyan(media.fileName)} updated in path ${folderPath} - ${ansiColors.green(
      state.sourceGuid[0],
    )}: ${media.mediaID} ${ansiColors.green(targetGuid)}: ${uploadedMedia.mediaID}`,
  );

  return uploadedMedia;
}

/**
 * Resolve gallery mapping for an asset
 * Returns the target gallery ID or -1 if no gallery
 */
async function resolveGalleryMapping(
  media: mgmtApi.Media,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  referenceMapper: ReferenceMapperV2,
): Promise<number> {
  let targetMediaGroupingID = -1;

  if (media.mediaGroupingID > 0 && media.mediaGroupingName) {
    try {
      // Check mapper first for existing gallery mapping
      const galleryMapping = referenceMapper.getMappingByKey<mgmtApi.assetMediaGrouping>(
        "gallery",
        "name",
        media.mediaGroupingName,
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
        `[Asset] Gallery ${media.mediaGroupingName} not found - asset will upload without gallery association`,
      );
    }
  }

  return targetMediaGroupingID;
}
