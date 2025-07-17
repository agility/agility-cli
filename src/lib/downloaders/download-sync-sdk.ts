
import { getState } from "../../core/state";
import * as path from "path";
import * as fs from "fs";
import ansiColors from "ansi-colors";
import * as agilitySync from "@agility/content-sync";
import { SyncDeltaTracker } from "../shared/sync-delta-tracker";
import { state, getApiKeysForGuid } from "../../core/state";
import { fileOperations } from "core/fileOperations";
import { handleSyncToken } from "lib/shared/sync-token-handler";

const storeInterfaceFileSystem = require("./store-interface-filesystem");

export async function downloadAllSyncSDK(
  guid: string, 
  locale: string, 
  channel: string, 
  syncDeltaTracker?: SyncDeltaTracker
): Promise<void> {
  
  console.log(`\nDownloading GUID: ${guid} | Locale: ${locale}`);
  const fileOps = new fileOperations(guid, locale);
  // Get API keys for this specific GUID
  const { previewKey:apiKey} = getApiKeysForGuid(guid);  
  const startTime = Date.now(); // Track start time for performance measurement
  
  // Build the path to the instance-specific folder
  const instanceSpecificPath = fileOps.getDataFolderPath();
  const syncTokenPath = fileOps.getDataFilePath('state', 'sync.json');
  const isIncrementalSync = await handleSyncToken(syncTokenPath, state.update);

  // Configure the Agility Sync client
  const agilityConfig = {
    guid: guid,
    apiKey: apiKey,
    isPreview: true,
    languages: [locale],
    channels: [channel],
    store: {
      interface: storeInterfaceFileSystem,
      options: {
        rootPath: instanceSpecificPath,
        // NEW: Pass sync delta tracker and mode
        syncDeltaTracker: syncDeltaTracker,
        isIncrementalSync: isIncrementalSync
      }
    }
  };

  // RACE CONDITION FIX: Initialize progress tracking for this specific instance
  if (storeInterfaceFileSystem.initializeProgress && typeof storeInterfaceFileSystem.initializeProgress === 'function') {
    storeInterfaceFileSystem.initializeProgress(instanceSpecificPath);
  }

  // RE-ENABLED: Sync SDK with race condition fix applied
  // Create the sync client const agilitySync = await import("@agility/content-sync");using dynamic import with flexible export handling
  
  const syncClient = agilitySync.getSyncClient(agilityConfig);

  // Content Sync SDK handles pages, containers, content, sitemaps, redirections
  await syncClient.runSync();
  
  // Get enhanced sync stats (pass rootPath for instance isolation)
  if (storeInterfaceFileSystem.getAndClearSavedItemStats && typeof storeInterfaceFileSystem.getAndClearSavedItemStats === 'function') {
    const syncResults = storeInterfaceFileSystem.getAndClearSavedItemStats(instanceSpecificPath);
    
    // Log summary by item type
    const typeBreakdown = Object.entries(syncResults.itemsByType)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    
    const summary = syncResults.summary;
    console.log(`Content Sync completed: ${summary.totalItems} items in ${(summary.elapsedTime / 1000).toFixed(1)}s`);
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
  console.log(ansiColors.yellow(`Content Sync SDK completed in ${elapsedSeconds}s`));
  console.log(itemsFoundMessage);
} 