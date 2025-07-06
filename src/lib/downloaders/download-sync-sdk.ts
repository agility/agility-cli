import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import * as agilitySync from "@agility/content-sync";
import { fileOperations } from "../../core/fileOperations";
import { state, getApiClient } from "../../core/state";
import * as path from "path";
import * as fs from "fs";
import ansiColors from "ansi-colors";

const storeInterfaceFileSystem = require("./store-interface-filesystem");

export async function downloadAllSyncSDK(
  multibar: cliProgress.MultiBar,
  fileOps: fileOperations,
  update: boolean, // Controls whether to update existing files
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {
  // Get state values instead of parameters
  const guid = state.sourceGuid;
  const locale = state.locale;
  const isPreview = state.preview;
  const apiKey = state.apiKeyForPull;
  const channel = state.channel;
  const rootPath = state.rootPath;

  if (!guid) {
    throw new Error('Source GUID not available in state');
  }
  if (!apiKey) {
    throw new Error('API Key for sync not available in state');
  }

  const startTime = Date.now(); // Track start time for performance measurement
  
  try {
    // Initialize progress
    if (progressCallback) progressCallback(0, 1, 'progress');

    // Build the path to the instance-specific folder
    const instanceSpecificPath = path.join(rootPath, guid, locale, isPreview ? 'preview' : 'live');
    
    // Create the instance-specific folder if it doesn't exist
    if (!fs.existsSync(instanceSpecificPath)) {
      fs.mkdirSync(instanceSpecificPath, { recursive: true });
    }

    // Handle sync token clearing logic based on --update flag
    const syncTokenPath = path.join(instanceSpecificPath, "state", "sync.json");
    
    // --update=false (default): Use existing sync tokens for incremental sync
    // --update=true: Clear sync tokens for complete refresh
    if (!update) {
      // Logic for --update=false (default): if sync token exists, use it for incremental sync
      if (fs.existsSync(syncTokenPath)) {
        if (state.useVerbose) console.log("--update=false (default): Existing content sync token found. Performing incremental content sync.");
        else if (state.useHeadless) console.log("--update=false (default): Existing content sync token found. Performing incremental content sync.");
      } else {
        if (state.useVerbose) console.log("--update=false (default): No existing content sync token. Performing full content sync by default.");
        else if (state.useHeadless) console.log("--update=false (default): No existing content sync token. Performing full content sync by default.");
      }
    } else {
      // --update=true: Clear sync tokens for complete refresh
      if (fs.existsSync(syncTokenPath)) {
        try {
          fs.rmSync(syncTokenPath, { force: true });
          if (state.useVerbose) console.log("--update=true: Cleared existing sync token. Performing full content sync.");
          else if (state.useHeadless) console.log("--update=true: Cleared existing sync token. Performing full content sync.");
        } catch (error: any) {
          if (state.useVerbose) console.log(`--update=true: Error clearing sync token: ${error.message}. Proceeding with full sync.`);
          else if (state.useHeadless) console.log(`--update=true: Error clearing sync token: ${error.message}. Proceeding with full sync.`);
        }
      } else {
        if (state.useVerbose) console.log("--update=true: No existing sync token. Performing full content sync.");
        else if (state.useHeadless) console.log("--update=true: No existing sync token. Performing full content sync.");
      }
    }

    // Configure the Agility Sync client
    const agilityConfig = {
      guid: guid,
      apiKey: apiKey,
      isPreview: isPreview,
      languages: [locale],
      channels: [channel],
      store: {
        interface: storeInterfaceFileSystem,
        options: {
          rootPath: instanceSpecificPath,
          forceOverwrite: update // Use update flag to control force overwrite
        }
      }
    };

    // Create the sync client
    const syncClient = agilitySync.getSyncClient(agilityConfig);

    // Content Sync SDK handles pages, containers, content, sitemaps, redirections
    await syncClient.runSync();
    
    // Get enhanced sync stats
    if (storeInterfaceFileSystem.getAndClearSavedItemStats && typeof storeInterfaceFileSystem.getAndClearSavedItemStats === 'function') {
      const syncResults = storeInterfaceFileSystem.getAndClearSavedItemStats();
      
      // Log summary by item type
      const typeBreakdown = Object.entries(syncResults.itemsByType)
        .map(([type, count]) => `${type}: ${count}`)
        .join(', ');
      
      const summary = syncResults.summary;
      console.log(`✓ Content Sync completed: ${summary.totalItems} items in ${(summary.elapsedTime / 1000).toFixed(1)}s`);
      console.log(`  Breakdown: ${typeBreakdown}`);
      console.log(`  Performance: ${summary.itemsPerSecond.toFixed(1)} items/sec`);
      
      // Detailed logging for verbose mode
      if (state.useVerbose) {
        console.log("--- Detailed Sync Results ---");
        Object.entries(syncResults.itemsByType).forEach(([itemType, count]) => {
          console.log(`  ${ansiColors.cyan(itemType)}: ${count} items`);
        });
      }
    }

    // After sync, count the items in the 'item' folder for verification
    const itemsPath = path.join(instanceSpecificPath, "item");
    let itemCount = 0;
    let itemsFoundMessage = "Content items sync attempted.";
    try {
      if (fs.existsSync(itemsPath)) {
        const files = fs.readdirSync(itemsPath);
        itemCount = files.filter(file => path.extname(file).toLowerCase() === '.json').length;
        itemsFoundMessage = `Verified ${itemCount} content item(s) on disk.`;
      }
    } catch (countError: any) { 
      itemsFoundMessage = `Error counting items: ${countError.message}`; 
    }

    // Summary of sync operation
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    console.log(ansiColors.yellow(`\nContent Sync SDK completed in ${elapsedSeconds}s`));
    console.log(itemsFoundMessage);

    if (progressCallback) progressCallback(1, 1, 'success');
  } catch (error) {
    console.error("\nError during Content Sync SDK operation:", error);
    if (progressCallback) progressCallback(0, 1, 'error');
    throw error;
  }
} 