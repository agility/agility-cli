import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import { assets as AssetsService } from "../services/assets";
import { fileOperations } from "../services/fileOperations";
import { state } from "../services/state";
import * as fs from "fs";
import * as path from "path";
import ansiColors from "ansi-colors"; // For colored logging

export async function downloadAllGalleries(
  multibar: cliProgress.MultiBar,
  fileOps: fileOperations, 
  update: boolean, // Controls whether to update existing files
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {
  // Get state values instead of parameters
  const guid = state.sourceGuid;
  const locale = state.locale;
  const isPreview = state.preview;
  const options = state.mgmtApiOptions;

  if (!guid) {
    throw new Error('Source GUID not available in state');
  }
  if (!options) {
    throw new Error('Management API options not available in state');
  }

  const galleriesParentPath = fileOps.getDataFolderPath("assets"); // Parent for galleries
  const galleriesFolderPath = fileOps.getDataFolderPath("assets/galleries");

  // Gallery file existence checking is handled by the AssetsService

  // Use fileOperations to create folders instead of fs directly
  fileOps.createFolder("assets");
  fileOps.createFolder("assets/galleries");

  const assetsServiceInstance = new AssetsService(options, multibar, fileOps, false);

  try {
    if (progressCallback) progressCallback(0, 1, 'progress'); // Initial progress before actual download
    await assetsServiceInstance.getGalleries(guid, locale, isPreview);
    
    if (progressCallback) progressCallback(1, 1, 'success');
  } catch (error) {
    console.error(`\nError during gallery download process for ${guid}/${locale}:`, error);
    if (progressCallback) progressCallback(0, 1, 'error');
    throw error;
  }
} 