
import { getState } from "../../core/state";
import * as path from "path";
import * as fs from "fs";
import ansiColors from "ansi-colors";
import * as agilitySync from "@agility/content-sync";
import { SyncDeltaTracker } from "../shared/sync-delta-tracker";

const storeInterfaceFileSystem = require("./store-interface-filesystem");

export async function downloadAllSyncSDK(
  guid: string, 
  locale: string, 
  isPreview: boolean, 
  channel: string, 
  rootPath: string, 
  update: boolean,
  syncDeltaTracker?: SyncDeltaTracker
): Promise<void> {
  // Import helper function
  const { getApiKeysForGuid } = await import('../../core/state');
  
  if (!guid) {
    throw new Error('GUID parameter is required for sync operation');
  }
  
  if (!locale) {
    throw new Error('Locale parameter is required for sync operation');
  }
  
  console.log(`\nDownloading GUID: ${guid} | Locale: ${locale}`);
  
  // Get API keys for this specific GUID
  const apiKeys = getApiKeysForGuid(guid);
  if (!apiKeys) {
    throw new Error(`API keys not found for GUID: ${guid}`);
  }
  
  const apiKey = isPreview ? apiKeys.previewKey : apiKeys.fetchKey;
  const startTime = Date.now(); // Track start time for performance measurement
  
  // Build the path to the instance-specific folder
  const instanceSpecificPath = path.join(rootPath, guid, locale, isPreview ? 'preview' : 'live');

  // Create the instance-specific folder if it doesn't exist
  if (!fs.existsSync(instanceSpecificPath)) {
    fs.mkdirSync(instanceSpecificPath, { recursive: true });
  }

  // Handle sync token clearing logic based on --update flag
  const syncTokenPath = path.join(instanceSpecificPath, "state", "sync.json");
  
  // Detect sync mode for delta tracking
  const syncTokenExists = fs.existsSync(syncTokenPath);
  const isIncrementalSync = !update && syncTokenExists;
  
  // Get current state only for UI mode checking (not for core functionality)
  const currentState = getState();
  
  // --update=false (default): Use existing sync tokens for incremental sync
  // --update=true: Clear sync tokens for complete refresh
  if (!update) {
    // Logic for --update=false (default): if sync token exists, use it for incremental sync
    if (syncTokenExists) {
      if (currentState.useVerbose) console.log("--update=false (default): Existing content sync token found. Performing incremental content sync.");
      else if (currentState.useHeadless) console.log("--update=false (default): Existing content sync token found. Performing incremental content sync.");
    } else {
      if (currentState.useVerbose) console.log("--update=false (default): No existing content sync token. Performing full content sync by default.");
      else if (currentState.useHeadless) console.log("--update=false (default): No existing content sync token. Performing full content sync by default.");
    }
  } else {
    // --update=true: Clear sync tokens for complete refresh
    if (syncTokenExists) {
      try {
        fs.rmSync(syncTokenPath, { force: true });
        if (currentState.useVerbose) console.log("--update=true: Cleared existing sync token. Performing full content sync.");
        else if (currentState.useHeadless) console.log("--update=true: Cleared existing sync token. Performing full content sync.");
      } catch (error: any) {
        if (currentState.useVerbose) console.log(`--update=true: Error clearing sync token: ${error.message}. Proceeding with full sync.`);
        else if (currentState.useHeadless) console.log(`--update=true: Error clearing sync token: ${error.message}. Proceeding with full sync.`);
      }
    } else {
      if (currentState.useVerbose) console.log("--update=true: No existing sync token. Performing full content sync.");
      else if (currentState.useHeadless) console.log("--update=true: No existing sync token. Performing full content sync.");
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
    if (currentState.useVerbose) {
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