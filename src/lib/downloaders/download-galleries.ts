import { fileOperations } from "../../core/fileOperations";
import { getApiClient, getState } from "../../core/state";
import ansiColors from "ansi-colors";
import { ContentHashComparer } from "../shared/content-hash-comparer";

export async function downloadAllGalleries(
  fileOps: fileOperations, 
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {
  // Get values from fileOps which is already configured for this specific GUID/locale
  const guid = fileOps.guid;
  const update = getState().update; // Use state.update instead of parameter
  const apiClient = getApiClient();

  if (!guid) {
    throw new Error('Source GUID not available in state');
  }

  let pageSize = 250;
  let rowIndex = 0;
  let index = 1;
  let processedCount = 0;
  let skippedCount = 0;
  const startTime = Date.now(); // Track start time for performance measurement

  try {
    let initialRecords = await apiClient.assetMethods.getGalleries(
      guid,
      "",
      pageSize,
      rowIndex
    );

    let totalRecords = initialRecords.totalCount;
    let iterations = Math.ceil(totalRecords / pageSize);
    
    if (iterations === 0) {
      iterations = 1;
    }

    fileOps.createFolder("assets/galleries");
    
    // Process initial records
    const initialFilePath = fileOps.getDataFolderPath(`assets/galleries/${index}.json`);
    if (!update) {
      const hashComparison = ContentHashComparer.getHashComparison(initialRecords, initialFilePath);
      
      if (hashComparison.status === 'unchanged') {
        const hashDisplay = hashComparison.shortHashes 
          ? `${ansiColors.green(`[${hashComparison.shortHashes.api}]`)}`
          : '';
        console.log(ansiColors.grey.italic('Found'), ansiColors.gray(`galleries-${index}.json`), ansiColors.grey.italic('content unchanged, skipping'), hashDisplay);
        skippedCount++;
      } else {
        fileOps.exportFiles("assets/galleries", index, initialRecords);
        
        if (hashComparison.status === 'modified') {
          const hashDisplay = hashComparison.shortHashes 
            ? `${ansiColors.red(`[${hashComparison.shortHashes.local}`)} → ${ansiColors.green(`${hashComparison.shortHashes.api}]`)}`
            : '';
          console.log(`✓ Updated gallery ${ansiColors.cyan(`galleries-${index}.json`)} ${ansiColors.gray('(content changed)')} ${hashDisplay}`);
        } else if (hashComparison.status === 'not-exists') {
          const hashDisplay = hashComparison.apiHash 
            ? `${ansiColors.green(`[${hashComparison.apiHash.substring(0, 6)}]`)}`
            : '';
          console.log(`✓ Downloaded gallery ${ansiColors.cyan(`galleries-${index}.json`)} ${ansiColors.gray('(new file)')} ${hashDisplay}`);
        } else {
          console.log(`✓ Downloaded gallery ${ansiColors.cyan(`galleries-${index}.json`)} ${ansiColors.gray('(error reading local file)')}`);
        }
      }
    } else {
      // Force update mode
      fileOps.exportFiles("assets/galleries", index, initialRecords);
      console.log(`✓ Downloaded gallery ${ansiColors.cyan(`galleries-${index}.json`)} ${ansiColors.gray('(forced update)')}`);
    }
    
    processedCount++;
    index++;

    // Process remaining pages if needed
    if (totalRecords > pageSize) {
      for (let i = 1; i < iterations; i++) {
        rowIndex += pageSize;
        
        let galleries = await apiClient.assetMethods.getGalleries(
          guid,
          "",
          pageSize,
          rowIndex
        );

        const galleryFilePath = fileOps.getDataFolderPath(`assets/galleries/${index}.json`);
        
        if (!update) {
          const hashComparison = ContentHashComparer.getHashComparison(galleries, galleryFilePath);
          
          if (hashComparison.status === 'unchanged') {
            const hashDisplay = hashComparison.shortHashes 
              ? `${ansiColors.green(`[${hashComparison.shortHashes.api}]`)}`
              : '';
            console.log(ansiColors.grey.italic('Found'), ansiColors.gray(`galleries-${index}.json`), ansiColors.grey.italic('content unchanged, skipping'), hashDisplay);
            skippedCount++;
          } else {
            fileOps.exportFiles("assets/galleries", index, galleries);
            
            if (hashComparison.status === 'modified') {
              const hashDisplay = hashComparison.shortHashes 
                ? `${ansiColors.red(`[${hashComparison.shortHashes.local}`)} → ${ansiColors.green(`${hashComparison.shortHashes.api}]`)}`
                : '';
              console.log(`✓ Updated gallery ${ansiColors.cyan(`galleries-${index}.json`)} ${ansiColors.gray('(content changed)')} ${hashDisplay}`);
            } else if (hashComparison.status === 'not-exists') {
              const hashDisplay = hashComparison.apiHash 
                ? `${ansiColors.green(`[${hashComparison.apiHash.substring(0, 6)}]`)}`
                : '';
              console.log(`✓ Downloaded gallery ${ansiColors.cyan(`galleries-${index}.json`)} ${ansiColors.gray('(new file)')} ${hashDisplay}`);
            } else {
              console.log(`✓ Downloaded gallery ${ansiColors.cyan(`galleries-${index}.json`)} ${ansiColors.gray('(error reading local file)')}`);
            }
          }
        } else {
          // Force update mode
          fileOps.exportFiles("assets/galleries", index, galleries);
          console.log(`✓ Downloaded gallery ${ansiColors.cyan(`galleries-${index}.json`)} ${ansiColors.gray('(forced update)')}`);
        }
        
        processedCount++;
        index++;
        
        if (progressCallback) progressCallback(processedCount, totalRecords, 'progress');
      }
    }

    // Summary
    const downloadedCount = processedCount - skippedCount;
    const elapsedTime = Date.now() - startTime;
    const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
    console.log(ansiColors.yellow(`\nDownloaded ${downloadedCount} galleries (${downloadedCount}/${processedCount} galleries, ${skippedCount} skipped, 0 errors) in ${elapsedSeconds}s\n`));
    
    if (progressCallback) progressCallback(processedCount, totalRecords, 'success');
  } catch (error) {
    console.error("\nError downloading galleries:", error);
    if (progressCallback) progressCallback(0, 1, 'error');
    throw error;
  }
} 