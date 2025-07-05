import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import { models as ModelsService } from "../services/models"; // Renamed import
import { fileOperations } from "../services/fileOperations";
import { state } from "../services/state";
import * as fs from "fs";
import * as path from "path";
import ansiColors from "ansi-colors"; // For colored logging

export async function downloadAllModels(
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

  // Individual model file existence checking is now handled by the models service

  // Use fileOperations to create folder instead of fs directly
  fileOps.createFolder("models");

  // Instantiate the models service, passing the progressCallback.
  const modelsServiceInstance = new ModelsService(options, multibar, fileOps, false, progressCallback);

  try {
    // console.log("Starting download of all content and page models...");
    // Initial progress can be set here if desired, but getModels will also call it.
    await modelsServiceInstance.getModels(guid, locale, isPreview, update);
    
    // Final success/error callback is handled by modelsServiceInstance.getModels
  } catch (error) {
    // Error-specific callback is handled by modelsServiceInstance.getModels.
    // Re-throw to allow pull.ts to manage its step status.
    throw error;
  }
} 