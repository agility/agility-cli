import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState } from "../../core/state";
import { SyncDeltaTracker } from "../shared/sync-delta-tracker";
import * as fs from "fs";
import * as path from "path";
import ansiColors from "ansi-colors";

export async function downloadAllSitemaps(  
  fileOps: fileOperations, 
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void,
  syncDeltaTracker?: SyncDeltaTracker
): Promise<void> {
  // Get values from fileOps which is already configured for this specific GUID/locale
  const guid = fileOps.guid;
  const locale = fileOps.locale;
  const update = getState().update;
  const apiClient = getApiClient();

  if (!guid) {
    throw new Error('Source GUID not available in fileOps');
  }

  if (!locale) {
    throw new Error('Locale not available in fileOps');
  }

  console.log(`\nDownloading sitemaps for ${guid} (${locale})...`);

  // Use fileOperations to create sitemaps folder
  fileOps.createFolder('sitemaps');

  const startTime = Date.now();

  try {
    // Get the sitemap from API
    const sitemap = await apiClient.pageMethods.getSitemap(guid, locale);
    
    if (!sitemap || sitemap.length === 0) {
      console.log("No sitemap found to download.");
      if (progressCallback) progressCallback(0, 0, 'success');
      return;
    }

    // File path for the sitemap
    const sitemapFileName = `sitemap-${guid}-${locale}.json`;
    const sitemapFilePath = fileOps.getDataFolderPath(`sitemaps/${sitemapFileName}`);
    
    // Get local sitemap info for comparison
    const localSitemapInfo = getLocalSitemapInfo(sitemapFilePath);
    
    // Check if download is needed (sitemap is an array, so we use the first channel for lastModified check)
    const firstChannel = sitemap[0];
    const sitemapDownloadDecision = shouldDownloadSitemap(firstChannel, localSitemapInfo, update);

    if (progressCallback) progressCallback(0, 1, 'progress');

    if (sitemapDownloadDecision.shouldDownload) {
      // Write sitemap file
      fs.writeFileSync(sitemapFilePath, JSON.stringify(sitemap, null, 2));
      
      // Track in sync delta if provided
      if (syncDeltaTracker) {
        syncDeltaTracker.recordChange({
          id: `sitemap-${guid}-${locale}`,
          type: 'page', // Sitemaps are page-related
          action: localSitemapInfo.exists ? 'updated' : 'created',
          name: `Sitemap ${guid} (${locale})`,
          referenceName: sitemapFileName,
          timestamp: '' // Will be overridden by recordChange
        });
      }

      console.log(`✓ Downloaded ${ansiColors.underline.cyan(sitemapFileName)} ${ansiColors.gray(`(${sitemapDownloadDecision.reason})`)}`);
      if (progressCallback) progressCallback(1, 1, 'success');
    } else {
      console.log(ansiColors.yellow(`⚠ Skipped ${sitemapFileName} ${ansiColors.gray(`(${sitemapDownloadDecision.reason})`)}`));
      if (progressCallback) progressCallback(1, 1, 'success');
    }

    const endTime = Date.now();
    const duration = Math.floor((endTime - startTime) / 1000);
    console.log(`Sitemap download completed in ${duration}s`);

  } catch (error: any) {
    console.error(`❌ Failed to download sitemap: ${error.message}`);
    if (progressCallback) progressCallback(0, 1, 'error');
    throw error;
  }
}

function getLocalSitemapInfo(filePath: string): { lastModified?: string; exists: boolean } {
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false };
    }
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      lastModified: content.lastModified,
      exists: true
    };
  } catch (error) {
    return { exists: false };
  }
}

function shouldDownloadSitemap(
  channel: any, 
  localSitemapInfo: { lastModified?: string; exists: boolean },
  forceUpdate: boolean = false
): { shouldDownload: boolean; reason: string } {
  if (forceUpdate) {
    return { shouldDownload: true, reason: 'forced update' };
  }
  
  if (!localSitemapInfo.exists) {
    return { shouldDownload: true, reason: 'local file does not exist' };
  }
  
  // Check if the channel has lastModified date
  const channelLastModified = channel?.lastModified || channel?.lastModifiedDate;
  if (channelLastModified && localSitemapInfo.lastModified !== channelLastModified) {
    return { shouldDownload: true, reason: 'local file is outdated' };
  }
  
  return { shouldDownload: false, reason: 'local file is up to date' };
}
