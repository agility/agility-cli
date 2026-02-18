import ansiColors from "ansi-colors";
import * as mgmtApi from "@agility/management-sdk";
import { getAssetFilePath } from "../shared";
import { state, getApiClient, getLoggerForGuid } from "../../core/state";
import { AssetMapper } from "../mappers/asset-mapper";
import { Logs } from "../../core/logs";
const FormData = require("form-data");
import { fileOperations } from "../../core/fileOperations";
import path from "path";
import { GalleryMapper } from "lib/mappers/gallery-mapper";

/**
 * Extract meaningful error message from API errors
 */
function extractErrorMessage(error: any): string {
  // Check for direct axios response data first (our direct axios calls)
  if (error?.response?.data) {
    const data = error.response.data;
    if (typeof data === 'string') return data;
    if (data.exceptionMessage) return data.exceptionMessage; // Agility API format
    if (data.message) return data.message;
    if (data.error) return data.error;
    if (data.Message) return data.Message;
    if (data.Error) return data.Error;
    if (data.title) return data.title;
  }
  // Check for SDK-wrapped axios response data
  if (error?.innerError?.response?.data) {
    const data = error.innerError.response.data;
    if (typeof data === 'string') return data;
    if (data.exceptionMessage) return data.exceptionMessage;
    if (data.message) return data.message;
    if (data.error) return data.error;
    if (data.Message) return data.Message;
    if (data.Error) return data.Error;
  }
  // Fall back to error message
  return error?.message || error?.innerError?.message || String(error);
}

export async function pushAssets(
  sourceData: mgmtApi.Media[], // TODO: Type these
  targetData: mgmtApi.Media[], // TODO: Type these
  onProgress?: (processed: number, total: number, status?: "success" | "error") => void
): Promise<{ status: "success" | "error"; successful: number; failed: number; skipped: number }> {
  // Extract data from sourceData - unified parameter pattern
  const assets: mgmtApi.Media[] = sourceData || [];

  // Get state values and logger
  const { sourceGuid, targetGuid, locale, preview: isPreview } = state;
  const logger = getLoggerForGuid(sourceGuid[0]);

  if (!assets || assets.length === 0) {
    logger.log("INFO", "No assets found to process.");
    console.log("No assets found to process.");
    return { status: "success", successful: 0, failed: 0, skipped: 0 };
  }

  const apiClient = getApiClient();

  // Initialize reference mapper and asset mapper
  // const referenceMapper = new ReferenceMapperV2();
  const referenceMapper = new AssetMapper(sourceGuid[0], targetGuid[0]);

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

      // Extract container folder path from asset's originUrl (not local path)
      const assetRelativePath = getAssetFilePath(media.originUrl); // e.g., "folder/file.jpg" or "file.jpg"
      const containerFolderPath = path.dirname(assetRelativePath); // e.g., "folder" or "."

      // root level folder needs to be "/", otherwise the variable is OK to use.
      let folderPath = containerFolderPath === "." ? "/" : containerFolderPath;


      // Use simplified change detection pattern
      const existingMapping = referenceMapper.getAssetMapping(media, "source");
      
      // Also check if asset already exists in target by originKey (path+filename)
      const targetAssetByOriginKey = targetData.find(t => t.originKey === media.originKey);
      
      // Debug logging for asset matching (verbose mode)
      if (state.verbose && !existingMapping && !targetAssetByOriginKey) {
        // Show first few target originKeys for comparison
        const sampleTargetKeys = targetData.slice(0, 3).map(t => t.originKey);
      }
      
      // If no mapping but asset exists by originKey in target, create mapping and skip
      if (!existingMapping && targetAssetByOriginKey) {
        referenceMapper.addMapping(media, targetAssetByOriginKey);
        logger.asset.skipped(media, "already exists in target by path", targetGuid[0]);
        skipped++;
        continue;
      }
      
      const shouldCreate = existingMapping === null && !targetAssetByOriginKey;

      // get the target asset, check if the source and targets need updates
      const targetAsset: mgmtApi.Media = targetData.find(targetAsset => targetAsset.mediaID === existingMapping?.targetMediaID) || null;
      const isTargetSafe = existingMapping !== null && referenceMapper.hasTargetChanged(targetAsset);
      const hasSourceChanges = existingMapping !== null && referenceMapper.hasSourceChanged(media);
      const shouldUpdate = existingMapping !== null && isTargetSafe && hasSourceChanges;
      const shouldSkip = existingMapping !== null && !isTargetSafe && !hasSourceChanges;


      if (shouldCreate) {
        // Asset needs to be created (doesn't exist in target)
        const createdAsset = await createAsset(
          media,
          absoluteLocalFilePath,
          folderPath,
          apiClient,
          sourceGuid[0],
          targetGuid[0],
          referenceMapper,
          logger
        );
        referenceMapper.addMapping(media, createdAsset);
        successful++;
      } else if (shouldUpdate) {
        // Asset exists but needs updating
        const updatedAsset = await updateAsset(
          media,
          absoluteLocalFilePath,
          folderPath,
          apiClient,
          sourceGuid[0],
          targetGuid[0],
          referenceMapper,
          logger
        );
        referenceMapper.addMapping(media, updatedAsset);
        successful++;
      } else if (shouldSkip) {
        // Asset exists and is up to date - skip
        logger.asset.skipped(media, "up to date, skipping", targetGuid[0]);
        skipped++;
      }
    } catch (error: any) {
      const errorMsg = extractErrorMessage(error);
      logger.asset.error(media, errorMsg, targetGuid[0]);
      
      
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
 * Note: We make direct axios call instead of SDK because SDK doesn't include form-data headers
 */
async function createAsset(
  media: mgmtApi.Media,
  absoluteLocalFilePath: string,
  folderPath: string,
  apiClient: mgmtApi.ApiClient,
  sourceGuid: string,
  targetGuid: string,
  referenceMapper: AssetMapper,
  logger: Logs
): Promise<mgmtApi.Media> {
  // Handle gallery if present
  let targetMediaGroupingID = await resolveGalleryMapping(media, apiClient, sourceGuid, targetGuid);

  const fs = require('fs');
  const pathModule = require('path');
  
  // Resolve to absolute path from workspace root
  const resolvedPath = pathModule.resolve(process.cwd(), absoluteLocalFilePath);
  
  // Check file exists and has content
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Local asset file not found: ${resolvedPath}`);
  }
  
  const fileStats = fs.statSync(resolvedPath);
  if (fileStats.size === 0) {
    throw new Error(`Local asset file is empty (0 bytes): ${resolvedPath}`);
  }

  
  // Build form data with file stream using resolved absolute path
  const form = new FormData();
  const fileStream = fs.createReadStream(resolvedPath);
  form.append("files", fileStream, media.fileName);

  // Make direct axios call with form-data headers (SDK bug workaround)
  // The SDK's executePost doesn't include form.getHeaders() which is required for multipart uploads
  const axios = require('axios');
  
  // Get the base URL from the API client's options
  const baseUrl = (apiClient as any)._options?.baseUrl || determineBaseUrl(targetGuid);
  const token = (apiClient as any)._options?.token;
  
  const apiPath = `asset/upload?folderPath=${encodeURIComponent(folderPath)}&groupingID=${targetMediaGroupingID}`;
  const url = `${baseUrl}/api/v1/instance/${targetGuid}/${apiPath}`;
  
  const response = await axios.post(url, form, {
    headers: {
      ...form.getHeaders(), // Critical: include multipart boundary
      'Authorization': `Bearer ${token}`,
      'Cache-Control': 'no-cache'
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    httpsAgent: state.local ? new (require('https').Agent)({ rejectUnauthorized: false }) : undefined
  });

  const uploadedMediaArray = response.data as mgmtApi.Media[];

  if (!uploadedMediaArray || uploadedMediaArray.length === 0) {
    throw new Error(`API did not return uploaded media details for ${media.fileName}`);
  }

  const uploadedMedia = uploadedMediaArray[0];

  logger.asset.uploaded(media, "uploaded", targetGuid);

  return uploadedMedia;
}

/**
 * Determine base URL for a GUID (fallback if not available from SDK)
 */
function determineBaseUrl(guid: string): string {
  const separator = guid.split('-');
  if (separator[1] === 'd') return "https://mgmt-dev.aglty.io";
  if (separator[1] === 'u') return "https://mgmt.aglty.io";
  if (separator[1] === 'us2') return "https://mgmt-usa2.aglty.io";
  if (separator[1] === 'c') return "https://mgmt-ca.aglty.io";
  if (separator[1] === 'e') return "https://mgmt-eu.aglty.io";
  if (separator[1] === 'a') return "https://mgmt-aus.aglty.io";
  return "https://mgmt.aglty.io";
}

/**
 * Update an existing asset in the target instance
 * Note: We make direct axios call instead of SDK because SDK doesn't include form-data headers
 */
async function updateAsset(
  media: mgmtApi.Media,
  absoluteLocalFilePath: string,
  folderPath: string,
  apiClient: mgmtApi.ApiClient,
  sourceGuid: string,
  targetGuid: string,
  referenceMapper: AssetMapper,
  logger: Logs
): Promise<mgmtApi.Media> {
  // Handle gallery if present
  let targetMediaGroupingID = await resolveGalleryMapping(media, apiClient, sourceGuid, targetGuid);
  
  const fs = require('fs');
  const pathModule = require('path');
  
  // Resolve to absolute path from workspace root
  const resolvedPath = pathModule.resolve(process.cwd(), absoluteLocalFilePath);
  
  // Check file exists and has content
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Local asset file not found: ${resolvedPath}`);
  }
  
  const fileStats = fs.statSync(resolvedPath);
  if (fileStats.size === 0) {
    throw new Error(`Local asset file is empty (0 bytes): ${resolvedPath}`);
  }
  
  // Build form data with file stream using resolved absolute path
  const form = new FormData();
  const fileStream = fs.createReadStream(resolvedPath);
  form.append("files", fileStream, media.fileName);

  // Make direct axios call with form-data headers (SDK bug workaround)
  const axios = require('axios');
  
  const baseUrl = (apiClient as any)._options?.baseUrl || determineBaseUrl(targetGuid);
  const token = (apiClient as any)._options?.token;
  
  const apiPath = `asset/upload?folderPath=${encodeURIComponent(folderPath)}&groupingID=${targetMediaGroupingID}`;
  const url = `${baseUrl}/api/v1/instance/${targetGuid}/${apiPath}`;
  
  const response = await axios.post(url, form, {
    headers: {
      ...form.getHeaders(),
      'Authorization': `Bearer ${token}`,
      'Cache-Control': 'no-cache'
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    httpsAgent: state.local ? new (require('https').Agent)({ rejectUnauthorized: false }) : undefined
  });

  const uploadedMediaArray = response.data as mgmtApi.Media[];

  if (!uploadedMediaArray || uploadedMediaArray.length === 0) {
    throw new Error(`API did not return uploaded media details for ${media.fileName}`);
  }
  
  const uploadedMedia = uploadedMediaArray[0];

  logger.asset.uploaded(media, "uploaded", targetGuid);

  return uploadedMedia;
}

/**
 * Resolve gallery mapping for an asset
 * Returns the target gallery ID or -1 if no gallery
 */
async function resolveGalleryMapping(
  media: mgmtApi.Media,
  apiClient: mgmtApi.ApiClient,

  sourceGuid: string,
  targetGuid: string
  // referenceMapper: AssetMapper,
): Promise<number> {
  let targetMediaGroupingID = -1;

  // we need to get the gallery from the media
  const galleryName = media.mediaGroupingName;

  const referenceMapper = new GalleryMapper(sourceGuid, targetGuid);

  if (media.mediaGroupingID > 0 && media.mediaGroupingName) {
    try {
      // Check mapper first for existing gallery mapping
      const galleryMapping = referenceMapper.getGalleryMappingByMediaGroupingID(media.mediaGroupingID, "source");
      if (galleryMapping) {
        targetMediaGroupingID = galleryMapping.targetMediaGroupingID;
      } else {
        // Fallback: Check API directly if not in mapper
        // TODO: use local target instance files to get the gallery
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
