/**
 * Source Publish Status Checker
 * 
 * Reads source instance files from the agility-files folder to determine
 * which items are published in the source instance. This allows workflow operations
 * to only process items in the target that match the source publish state.
 * Uses fileOperations for consistent filesystem access.
 */

import { fileOperations } from '../../core';
import {
    ContentMapping,
    PageMapping,
    ItemState,
    SourceItemData,
    PublishStatusResult
} from '../../types';

// Re-export types for convenience
export { ItemState, SourceItemData, PublishStatusResult };

/**
 * Check if an item is published based on its state
 */
export function isPublished(itemState: number): boolean {
    return itemState === ItemState.Published;
}

/**
 * Read source item data using fileOperations
 */
function readSourceItem(fileOps: fileOperations, type: 'item' | 'page', id: number): SourceItemData | null {
    try {
        const data = fileOps.readJsonFile(`${type}/${id}.json`);
        return data as SourceItemData | null;
    } catch (error: any) {
        return null;
    }
}

/**
 * Filter content mappings to only include items that are published in the source
 */
export function filterPublishedContent(
    contentMappings: ContentMapping[],
    sourceGuid: string,
    locales: string[]
): PublishStatusResult {
    const result: PublishStatusResult = {
        publishedContentIds: [],
        unpublishedContentIds: [],
        publishedPageIds: [],
        unpublishedPageIds: [],
        errors: []
    };

    for (const mapping of contentMappings) {
        let found = false;
        let isItemPublished = false;

        // Try each locale to find the source item
        for (const locale of locales) {
            const fileOps = new fileOperations(sourceGuid, locale);
            const sourceItem = readSourceItem(fileOps, 'item', mapping.sourceContentID);
            
            if (sourceItem && sourceItem.properties) {
                found = true;
                isItemPublished = isPublished(sourceItem.properties.state);
                break;
            }
        }

        if (!found) {
            result.errors.push(`Source content item ${mapping.sourceContentID} not found in local files`);
            // Default to publishing if source not found (preserve existing behavior)
            result.publishedContentIds.push(mapping.targetContentID);
        } else if (isItemPublished) {
            result.publishedContentIds.push(mapping.targetContentID);
        } else {
            result.unpublishedContentIds.push(mapping.targetContentID);
        }
    }

    return result;
}

/**
 * Filter page mappings to only include pages that are published in the source
 */
export function filterPublishedPages(
    pageMappings: PageMapping[],
    sourceGuid: string,
    locales: string[]
): PublishStatusResult {
    const result: PublishStatusResult = {
        publishedContentIds: [],
        unpublishedContentIds: [],
        publishedPageIds: [],
        unpublishedPageIds: [],
        errors: []
    };

    for (const mapping of pageMappings) {
        let found = false;
        let isItemPublished = false;

        // Try each locale to find the source page
        for (const locale of locales) {
            const fileOps = new fileOperations(sourceGuid, locale);
            const sourceItem = readSourceItem(fileOps, 'page', mapping.sourcePageID);
            
            if (sourceItem && sourceItem.properties) {
                found = true;
                isItemPublished = isPublished(sourceItem.properties.state);
                break;
            }
        }

        if (!found) {
            result.errors.push(`Source page ${mapping.sourcePageID} not found in local files`);
            // Default to publishing if source not found (preserve existing behavior)
            result.publishedPageIds.push(mapping.targetPageID);
        } else if (isItemPublished) {
            result.publishedPageIds.push(mapping.targetPageID);
        } else {
            result.unpublishedPageIds.push(mapping.targetPageID);
        }
    }

    return result;
}

/**
 * Check publish status for all content and page mappings
 * Returns filtered lists of target IDs that should be published
 * CRITICAL: All ID arrays are deduplicated to prevent "item already in batch" errors
 */
export function checkSourcePublishStatus(
    contentMappings: ContentMapping[],
    pageMappings: PageMapping[],
    sourceGuid: string,
    locales: string[]
): PublishStatusResult {
    const contentResult = filterPublishedContent(contentMappings, sourceGuid, locales);
    const pageResult = filterPublishedPages(pageMappings, sourceGuid, locales);

    // CRITICAL: Deduplicate all ID arrays to prevent "item already in batch" API errors
    // Duplicate IDs can occur when the same source→target mapping appears multiple times
    // (e.g., from multiple locales or duplicate entries in mapping files)
    return {
        publishedContentIds: Array.from(new Set(contentResult.publishedContentIds)),
        unpublishedContentIds: Array.from(new Set(contentResult.unpublishedContentIds)),
        publishedPageIds: Array.from(new Set(pageResult.publishedPageIds)),
        unpublishedPageIds: Array.from(new Set(pageResult.unpublishedPageIds)),
        errors: [...contentResult.errors, ...pageResult.errors]
    };
}
