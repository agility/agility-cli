import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../services/fileOperations';

/**
 * Get content items from filesystem without side effects
 * Includes complex deduplication logic combining item/ and list/ content (from ChainDataLoader logic)
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getContentItemsFromFileSystem(
    fileOps: fileOperations
): mgmtApi.ContentItem[] {
    const allContent: any[] = [];
    const processedContentIds = new Set<number>();

    // Load content from /item directory (individual content items)
    const itemContent = fileOps.readJsonFilesFromFolder('item');
    for (const contentData of itemContent) {
        if (contentData.contentID && !processedContentIds.has(contentData.contentID)) {
            allContent.push(contentData);
            processedContentIds.add(contentData.contentID);
        }
    }

    // Load content from /list directory (container content lists) - exact logic from ChainDataLoader
    const listContent = fileOps.readJsonFilesFromFolder('list');
    for (const contentList of listContent) {
        if (Array.isArray(contentList)) {
            for (const contentItem of contentList) {
                if (contentItem.contentID && !processedContentIds.has(contentItem.contentID)) {
                    allContent.push(contentItem);
                    processedContentIds.add(contentItem.contentID);
                }
            }
        }
    }

    return allContent;
}
