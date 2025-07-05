import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import { assets as AssetsService } from "../services/assets";
import { fileOperations } from "../services/fileOperations";
import { state } from "../services/state";
import * as fs from "fs";
import * as path from "path";
import ansiColors from "ansi-colors"; // For colored logging

export async function downloadAllAssets(
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
  if (!locale) {
    throw new Error('Locale not available in state');
  }
  if (!options) {
    throw new Error('Management API options not available in state');
  }

  const mainAssetsPath = fileOps.getDataFolderPath("assets");
  const assetJsonMetaPath = path.join(mainAssetsPath, "json");

  // Individual asset file existence checking is now handled by the AssetsService

  // Use fileOperations to create folders instead of fs directly
  fileOps.createFolder("assets");
  fileOps.createFolder("assets/json");

  const assetsServiceInstance = new AssetsService(options, multibar, fileOps, false, progressCallback);

  try {
    // AssetsService already calls progressCallback internally for its multiple steps.
    // Initial call to set to 0% for the overall "Assets" step in pull.ts was handled before calling this.
    // If progressCallback is directly passed and used by AssetsService, we don't need to call it here explicitly for start/end of this function.
    await assetsServiceInstance.getAssets(guid, locale, isPreview, update);
    
    // Final success call might be redundant if AssetsService calls it with 100%.
    // However, to ensure the step in pull.ts is marked complete if AssetsService doesn't do a final 100%:
    // if (progressCallback) progressCallback(1, 1, 'success'); 
    // Let AssetsService manage its own detailed progress. pull.ts will mark success upon non-error completion of this function.
  } catch (error) {
    // AssetsService should ideally call progressCallback with error status.
    // If not, this error will propagate, and pull.ts will mark the step as error.
    throw error; 
  }
} 