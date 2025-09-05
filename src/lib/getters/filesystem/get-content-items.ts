import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../../core';

/**
 * Get content items from filesystem without side effects
 * Loads ONLY from /item directory (individual content items)
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getContentItemsFromFileSystem(fileOps: fileOperations): mgmtApi.ContentItem[] {
  const allContent: any[] = [];
  const processedContentIds = new Set<number>();

  // Load content from /item directory (individual content items)
  const itemContent = fileOps.readJsonFilesFromFolder('item');
  for (const contentData of itemContent) {
    // if (contentData.contentID && !processedContentIds.has(contentData.contentID)) {
    allContent.push(contentData);
    // processedContentIds.add(contentData.contentID);
    // }
  }

  // REMOVED: /list directory loading - should only load from /item
  // User confirmed we should ONLY load from /item directory

  return allContent;
}
