import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
// We don't import ContentService as we are assuming syncSDK handles content item files.
import * as fs from "fs";
import * as path from "path";
import * as ansiColors from "ansi-colors";
import { fileOperations } from "../services/fileOperations";

export async function downloadAllContent(
  guid: string,
  locale: string,
  isPreview: boolean,
  options: mgmtApi.Options,
  multibar: cliProgress.MultiBar,
  basePath: string, // e.g., agility-files/{guid}/{locale}/{isPreview ? "preview" : "live"}
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {
  const apiClient = new mgmtApi.ApiClient(options);
  const fileOps = new fileOperations(basePath, guid, locale, isPreview);
  
  let processedContainers = 0;
  let totalContentItems = 0;
  let totalListFiles = 0;
  let successfulDownloads = 0;
  let errorCount = 0;
  let containerFiles: string[] = [];

  try {
    console.log('📦 Starting Management SDK content download...');
    
    // Create the /item and /list directories
    const itemPath = path.join(basePath, 'item');
    const listPath = path.join(basePath, 'list');
    
    if (!fs.existsSync(itemPath)) {
      fs.mkdirSync(itemPath, { recursive: true });
    }
    if (!fs.existsSync(listPath)) {
      fs.mkdirSync(listPath, { recursive: true });
    }

    // First, we need to discover containers to get content from
    const containersPath = path.join(basePath, 'containers');
    if (!fs.existsSync(containersPath)) {
      console.log(ansiColors.yellow('⚠️  No containers directory found. Content download requires containers to be downloaded first.'));
      if (progressCallback) progressCallback(1, 1, 'success'); 
      return;
    }

    // Load all containers
    containerFiles = fs.readdirSync(containersPath).filter(f => f.endsWith('.json'));
    console.log(`🔍 Found ${containerFiles.length} containers to check for content...`);
    
    if (progressCallback) {
      progressCallback(0, containerFiles.length, 'progress');
    }

    // Process each container for content
    for (const containerFile of containerFiles) {
      try {
        const containerData = JSON.parse(
          fs.readFileSync(path.join(containersPath, containerFile), 'utf8')
        );
        
        const container = containerData as mgmtApi.Container;
        const containerName = container.referenceName;
        
        if (!containerName) {
          console.log(`⚠️  Skipping container ${containerFile} - no reference name`);
          processedContainers++;
          continue;
        }

        // Skip deleted containers
        if (container.contentViewID === -1) {
          console.log(`⚠️  Skipping deleted container: ${containerName}`);
          processedContainers++;
          continue;
        }

        console.log(`📋 Checking container: ${ansiColors.cyan(containerName)}`);

        // Get content list from this container
        const contentList = await apiClient.contentMethods.getContentList(
          containerName, 
          guid, 
          locale, 
          null // No specific take/skip - get all content
        );

        if (contentList && contentList.items && contentList.items.length > 0) {
          console.log(`   📝 Found ${contentList.items.length} content items`);
          
          // Save as list file (array of content items)
          const listFileName = `${containerName}.json`;
          const listFilePath = path.join(listPath, listFileName);
          fs.writeFileSync(listFilePath, JSON.stringify(contentList.items, null, 2));
          totalListFiles++;
          
          console.log(`   ✅ Saved list: ${listFileName}`);

          // Save individual content items to /item directory
          for (const contentItem of contentList.items) {
            try {
              const itemFileName = `${contentItem.contentID}.json`;
              const itemFilePath = path.join(itemPath, itemFileName);
              fs.writeFileSync(itemFilePath, JSON.stringify(contentItem));
              totalContentItems++;
              console.log(`   ✅ Saved item: ${contentItem.contentID}`);
            } catch (itemError: any) {
              console.error(`   ❌ Error saving content item ${contentItem.contentID}: ${itemError.message}`);
              errorCount++;
            }
          }
          
          successfulDownloads += contentList.items.length;
        } else {
          console.log(`   📭 No content found in container: ${containerName}`);
        }

      } catch (containerError: any) {
        console.error(`❌ Error processing container ${containerFile}: ${containerError.message}`);
        errorCount++;
      }

      processedContainers++;
      if (progressCallback) {
        progressCallback(processedContainers, containerFiles.length, 'progress');
      }
    }

    // Final summary
    const summaryMessage = `Content download complete: ${totalContentItems} items, ${totalListFiles} lists from ${processedContainers} containers (${errorCount} errors)`;
    
    if (errorCount === 0) {
      console.log(ansiColors.green(summaryMessage));
      if (progressCallback) progressCallback(processedContainers, containerFiles.length, 'success');
    } else {
      console.log(ansiColors.yellow(summaryMessage));
      if (progressCallback) progressCallback(processedContainers, containerFiles.length, 'error');
    }

  } catch (error: any) {
    console.error(ansiColors.red(`❌ Fatal error during content download: ${error.message}`));
    if (progressCallback) progressCallback(processedContainers, containerFiles.length || 1, 'error');
    throw error;
  }
} 