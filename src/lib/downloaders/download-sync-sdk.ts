import * as path from "path";
import * as fs from "fs";
import * as agilitySync from "@agility/content-sync";
import { state, getApiKeysForGuid, getLoggerForGuid } from "core/state";
import { fileOperations } from "core/fileOperations";
import { handleSyncToken } from "./sync-token-handler";
import { getAllChannels } from "lib/shared/get-all-channels";

const storeInterfaceFileSystem = require("./store-interface-filesystem");

export async function downloadAllSyncSDK(guid: string) {
  const locales: string[] = state.guidLocaleMap.get(guid);
  const channels = await getAllChannels(guid, locales[0]);
  const downloads: Promise<any>[] = [];



  channels.forEach(channel => {
    locales.forEach(locale => {
      downloads.push(downloadSyncSDKByLocaleAndChannel(guid, channel.channel.toLowerCase(), locale));
    });
  });

  await Promise.allSettled(downloads);
  
}

export async function downloadSyncSDKByLocaleAndChannel(
  guid: string,
  channel: string,
  locale: string
): Promise<void> {

  const fileOps = new fileOperations(guid, locale);

  // Get API keys for this specific GUID
  const { previewKey: apiKey } = getApiKeysForGuid(guid);
  const startTime = Date.now(); // Track start time for performance measurement

  // Build the path to the instance-specific folder
  const instanceSpecificPath = fileOps.getDataFolderPath();
  const syncTokenPath = fileOps.getDataFilePath('state', 'sync.json');

  const isIncrementalSync = await handleSyncToken(syncTokenPath, state.reset);


  const logger = getLoggerForGuid(guid);
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
        logger: logger,
        // NEW: Pass change delta tracker and mode
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
}
