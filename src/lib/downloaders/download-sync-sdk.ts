import * as path from "path";
import * as fs from "fs";
import * as agilitySync from "@agility/content-sync";
import { state, getApiKeysForGuid, getLoggerForGuid } from "core/state";
import { fileOperations } from "core/fileOperations";
import { handleSyncToken } from "./sync-token-handler";
import { getAllChannels } from "lib/shared/get-all-channels";
import { Auth } from "core/auth";
import { clearLocalJson, removeLocalJsonOlderThan } from "./reconcile-local-files";

const storeInterfaceFileSystem = require("./store-interface-filesystem");

export async function downloadAllSyncSDK(guid: string) {
  const locales: string[] = state.guidLocaleMap.get(guid);
  const channels = await getAllChannels(guid, locales[0]);
  const logger = getLoggerForGuid(guid);
  const log = (m: string) => logger?.info?.(m);

  // PROD-2614: the sync SDK only delivers deletes as events on an INCREMENTAL run. A full run (no
  // sync token, or --fullPull) rewrites every current item and page but never touches files for items
  // deleted while no token was in place, so those ghosts survived forever. Decide per locale, before
  // any run starts, whether this is a full pull; afterwards remove whatever the full pull did not
  // rewrite. List files are merged incrementally too, so on a full pull they are rebuilt from scratch.
  const runStartedAt = Date.now();
  const fullPullLocales = new Set<string>();
  for (const locale of locales) {
    const fileOps = new fileOperations(guid, locale);
    const tokenPath = fileOps.getDataFilePath("state", "sync.json");
    if (state.fullPull || !fs.existsSync(tokenPath)) {
      fullPullLocales.add(locale);
      clearLocalJson(fileOps.getDataFolderPath("list"));
    }
  }

  const downloads: Promise<any>[] = [];
  const runsByLocale = new Map<string, Promise<any>[]>();
  channels.forEach((channel) => {
    locales.forEach((locale) => {
      const run = downloadSyncSDKByLocaleAndChannel(guid, channel.channel.toLowerCase(), locale);
      downloads.push(run);
      if (!runsByLocale.has(locale)) runsByLocale.set(locale, []);
      runsByLocale.get(locale).push(run);
    });
  });

  await Promise.allSettled(downloads);

  // Reconcile only locales whose every channel run completed: a failed or interrupted full pull has
  // not rewritten everything, and deleting on top of it would wipe valid files. A 2s tolerance
  // covers filesystems with coarse mtime granularity.
  for (const locale of Array.from(fullPullLocales)) {
    const settled = await Promise.allSettled(runsByLocale.get(locale) || []);
    if (settled.some((r) => r.status === "rejected")) {
      logger?.warning?.(
        `[${locale}] Full content pull did not complete for every channel; skipping removal of stale content/page files.`
      );
      continue;
    }
    const fileOps = new fileOperations(guid, locale);
    const cutoff = runStartedAt - 2000;
    removeLocalJsonOlderThan(fileOps.getDataFolderPath("item"), cutoff, `content [${locale}]`, log);
    removeLocalJsonOlderThan(fileOps.getDataFolderPath("page"), cutoff, `page [${locale}]`, log);
  }
}

export async function downloadSyncSDKByLocaleAndChannel(guid: string, channel: string, locale: string): Promise<void> {
  const fileOps = new fileOperations(guid, locale);

  // Get API keys for this specific GUID
  const { previewKey: apiKey } = getApiKeysForGuid(guid);
  const startTime = Date.now(); // Track start time for performance measurement

  // Build the path to the instance-specific folder
  const instanceSpecificPath = fileOps.getDataFolderPath();
  const syncTokenPath = fileOps.getDataFilePath("state", "sync.json");

  // PROD-2614: --fullPull discards the stored token so this becomes a full content pull.
  const isIncrementalSync = await handleSyncToken(syncTokenPath, state.fullPull === true);

  const logger = getLoggerForGuid(guid);
  // Configure the Agility Sync client
  // NOTE: Use determineFetchUrl (not determineBaseUrl) because:
  // - Content Fetch/Sync API is always cloud-based (based on GUID suffix)
  // The baseUrl must include the GUID path segment for the SDK to construct correct URLs:
  // e.g., https://api-dev.aglty.io/{guid} → https://api-dev.aglty.io/{guid}/preview/{locale}/sync/items
  const auth = new Auth();
  const fetchUrl = auth.determineFetchUrl(guid);
  const baseUrlWithGuid = `${fetchUrl}/${guid}`;
  const agilityConfig = {
    guid: guid,
    apiKey: apiKey,
    isPreview: true,
    languages: [locale],
    channels: [channel],
    baseUrl: baseUrlWithGuid,
    store: {
      interface: storeInterfaceFileSystem,
      options: {
        rootPath: instanceSpecificPath,
        logger: logger,
        // NEW: Pass change delta tracker and mode
        isIncrementalSync: isIncrementalSync,
      },
    },
  };

  // RACE CONDITION FIX: Initialize progress tracking for this specific instance
  if (
    storeInterfaceFileSystem.initializeProgress &&
    typeof storeInterfaceFileSystem.initializeProgress === "function"
  ) {
    storeInterfaceFileSystem.initializeProgress(instanceSpecificPath);
  }

  // RE-ENABLED: Sync SDK with race condition fix applied
  // Create the sync client const agilitySync = await import("@agility/content-sync");using dynamic import with flexible export handling

  const syncClient = agilitySync.getSyncClient(agilityConfig);

  // Content Sync SDK handles pages, containers, content, sitemaps, redirections
  await syncClient.runSync();

  // Get enhanced sync stats (pass rootPath for instance isolation)
  if (
    storeInterfaceFileSystem.getAndClearSavedItemStats &&
    typeof storeInterfaceFileSystem.getAndClearSavedItemStats === "function"
  ) {
    const syncResults = storeInterfaceFileSystem.getAndClearSavedItemStats(instanceSpecificPath);
  }

  // After sync, count the items in the 'item' folder for verification
  const itemsPath = path.join(instanceSpecificPath, "item");
  let itemCount = 0;
  let itemsFoundMessage = "Content items sync attempted.";
  try {
    if (fs.existsSync(itemsPath)) {
      const files = fs.readdirSync(itemsPath);
      itemCount = files.filter((file) => path.extname(file).toLowerCase() === ".json").length;
      itemsFoundMessage = `Verified ${itemCount} content item(s) on disk.`;
    }
  } catch (countError: any) {
    itemsFoundMessage = `Error counting items: ${countError.message}`;
  }

  // Summary of sync operation
  const elapsedTime = Date.now() - startTime;
  const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
}
