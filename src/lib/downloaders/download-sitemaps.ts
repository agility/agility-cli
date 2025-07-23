import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState, state } from "../../core/state";
import * as fs from "fs";
import * as path from "path";
import ansiColors from "ansi-colors";
import { getAllChannels } from "../shared/get-all-channels";

export async function downloadAllSitemaps(  
  guid: string,
): Promise<void> {
  const fileOps = new fileOperations(guid);
  const locales = state.guidLocaleMap.get(guid);
  const update = state.update;
  const apiClient = getApiClient();
  

  // const changeDelta = new ChangeDelta(guid);


  // Use fileOperations to create sitemaps folder
  fileOps.createFolder('sitemaps');

  const startTime = Date.now();

  try {
    // Get the sitemap from API
    const sitemap = await apiClient.pageMethods.getSitemap(guid, locales[0]);
    
    if (!sitemap || sitemap.length === 0) {
      console.log("No sitemap found to download.");
      return;
    }

    // File path for the sitemap
    const sitemapFileName = `sitemap.json`;
    const sitemapFilePath = fileOps.getDataFolderPath(`sitemaps/${sitemapFileName}`);
    
    // Get local sitemap info for comparison
    const localSitemapInfo = getLocalSitemapInfo(sitemapFilePath);
    
    // Check if download is needed (sitemap is an array, so we use the first channel for lastModified check)
    const firstChannel = sitemap[0];
    const sitemapDownloadDecision = shouldDownloadSitemap(firstChannel, localSitemapInfo, update);

    if (sitemapDownloadDecision.shouldDownload) {
      // Write sitemap file
      fs.writeFileSync(sitemapFilePath, JSON.stringify(sitemap, null, 2));
      console.log(`✓ Downloaded ${ansiColors.underline.cyan(sitemapFileName)} ${ansiColors.gray(`(${sitemapDownloadDecision.reason})`)}`);
    } else {
      console.log(ansiColors.yellow(`⚠ Skipped ${sitemapFileName} ${ansiColors.gray(`(${sitemapDownloadDecision.reason})`)}`));
    }

    const endTime = Date.now();
    const duration = Math.floor((endTime - startTime) / 1000);
    console.log(`Sitemap download completed in ${duration}s`);

  } catch (error: any) {
    console.error(`❌ Failed to download sitemap: ${error.message}`);
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
  if (state.update === false){
    return { shouldDownload: false, reason: '' };
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
