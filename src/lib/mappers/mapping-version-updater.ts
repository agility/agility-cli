/**
 * Mapping Version Updater
 * 
 * After publishing, updates the mappings with the new versionIDs
 * by reading the refreshed data from the filesystem using fileOperations.
 */

import { fileOperations } from '../../core';
import { getLogger } from '../../core/state';
import { ContentItemMapper } from './content-item-mapper';
import { PageMapper } from './page-mapper';
import { getContentItemsFromFileSystem } from '../getters/filesystem/get-content-items';
import { getPagesFromFileSystem } from '../getters/filesystem/get-pages';
import ansiColors from 'ansi-colors';
import { MappingUpdateResult } from '../../types';

// Re-export type for convenience
export { MappingUpdateResult };

/**
 * Version change detail for logging
 */
export interface VersionChangeDetail {
    id: number;
    oldVersion: number;
    newVersion: number;
    changed: boolean;
    name?: string;      // Content title/name or page title
    refName?: string;   // Content referenceName or page path
    modelName?: string; // Content model (definitionName)
}

/**
 * Helper to log to both logger and capture lines
 */
function logLine(line: string, logLines: string[]): void {
    const logger = getLogger();
    if (logger) {
        logger.info(line);
    } else {
        console.log(line);
    }
    logLines.push(line);
}

/**
 * Update content item mappings with new targetVersionID after publishing
 * Only updates targetVersionID - sourceVersionID should only change during sync operations
 */
export async function updateContentMappingsAfterPublish(
    publishedContentIds: number[],
    sourceGuid: string,
    targetGuid: string,
    locale: string
): Promise<{ updated: number; errors: string[]; changes: VersionChangeDetail[] }> {
    const errors: string[] = [];
    const changes: VersionChangeDetail[] = [];
    let updated = 0;

    // Deduplicate IDs - API may return duplicates for nested content
    const uniqueContentIds = Array.from(new Set(publishedContentIds));

    if (uniqueContentIds.length === 0) {
        return { updated: 0, errors: [], changes: [] };
    }

    try {
        // Create file operations for target (we only need target data for versionID)
        const targetFileOps = new fileOperations(targetGuid, locale);

        // Load content items from target filesystem (refreshed after pull)
        const targetContentItems = getContentItemsFromFileSystem(targetFileOps);

        // Create content item mapper
        const contentMapper = new ContentItemMapper(sourceGuid, targetGuid, locale);

        // Create lookup map for quick access
        const targetContentMap = new Map(
            targetContentItems.map(item => [item.contentID, item])
        );

        // Update targetVersionID for each published content item
        for (const targetContentId of uniqueContentIds) {
            const targetItem = targetContentMap.get(targetContentId);
            if (!targetItem) {
                errors.push(`Target content item ${targetContentId} not found in filesystem`);
                continue;
            }

            // Update only the target versionID in the mapping
            const result = contentMapper.updateTargetVersionID(
                targetContentId,
                targetItem.properties.versionID
            );
            
            if (result.success) {
                updated++;
                // Track all version updates with display info
                changes.push({
                    id: targetContentId,
                    oldVersion: result.oldVersionID!,
                    newVersion: result.newVersionID!,
                    changed: result.oldVersionID !== result.newVersionID,
                    name: targetItem.fields?.title || targetItem.fields?.name || `Item ${targetContentId}`,
                    refName: targetItem.properties?.referenceName,
                    modelName: targetItem.properties?.definitionName
                });
            } else {
                errors.push(`No mapping found for target content ID ${targetContentId}`);
            }
        }

        return { updated, errors, changes };
    } catch (error: any) {
        errors.push(`Content mapping update failed: ${error.message}`);
        return { updated, errors, changes: [] };
    }
}

/**
 * Update page mappings with new targetVersionID after publishing
 * Only updates targetVersionID - sourceVersionID should only change during sync operations
 */
export async function updatePageMappingsAfterPublish(
    publishedPageIds: number[],
    sourceGuid: string,
    targetGuid: string,
    locale: string
): Promise<{ updated: number; errors: string[]; changes: VersionChangeDetail[] }> {
    const errors: string[] = [];
    const changes: VersionChangeDetail[] = [];
    let updated = 0;

    // Deduplicate IDs - API may return duplicates
    const uniquePageIds = Array.from(new Set(publishedPageIds));

    if (uniquePageIds.length === 0) {
        return { updated: 0, errors: [], changes: [] };
    }

    try {
        // Create file operations for target (we only need target data for versionID)
        const targetFileOps = new fileOperations(targetGuid, locale);

        // Load pages from target filesystem (refreshed after pull)
        const targetPages = getPagesFromFileSystem(targetFileOps);

        // Create page mapper
        const pageMapper = new PageMapper(sourceGuid, targetGuid, locale);

        // Create lookup map for quick access
        const targetPageMap = new Map(
            targetPages.map(page => [page.pageID, page])
        );

        // Update targetVersionID for each published page
        for (const targetPageId of uniquePageIds) {
            const targetPage = targetPageMap.get(targetPageId);
            if (!targetPage) {
                errors.push(`Target page ${targetPageId} not found in filesystem`);
                continue;
            }

            // Update only the target versionID in the mapping
            const result = pageMapper.updateTargetVersionID(
                targetPageId,
                targetPage.properties.versionID
            );
            
            if (result.success) {
                updated++;
                // Track all version updates with display info
                changes.push({
                    id: targetPageId,
                    oldVersion: result.oldVersionID!,
                    newVersion: result.newVersionID!,
                    changed: result.oldVersionID !== result.newVersionID,
                    name: targetPage.title || targetPage.name || `Page ${targetPageId}`,
                    refName: targetPage.name ? `/${targetPage.name}` : undefined
                });
            } else {
                errors.push(`No mapping found for target page ID ${targetPageId}`);
            }
        }

        return { updated, errors, changes };
    } catch (error: any) {
        errors.push(`Page mapping update failed: ${error.message}`);
        return { updated, errors, changes: [] };
    }
}

/**
 * Format version change for display
 * Format: ● [guid][locale] content ID: {id} - Name (Type) v1565 → v1593 mapping updated
 */
function formatVersionChange(
    change: VersionChangeDetail, 
    entityType: string, 
    targetGuid: string, 
    locale: string
): string {
    const symbol = change.changed ? ansiColors.green('●') : ansiColors.yellow('○');
    const guidDisplay = change.changed ? ansiColors.green(`[${targetGuid}]`) : ansiColors.yellow(`[${targetGuid}]`);
    const localeDisplay = ansiColors.gray(`[${locale}]`);
    const entityDisplay = ansiColors.white(entityType);
    const idDisplay = ansiColors.cyan.underline(String(change.id));
    const nameDisplay = ansiColors.white(change.name || '');
    
    // Build the type display (model name for content, path for pages)
    let typeDisplay = '';
    if (change.modelName) {
        typeDisplay = ansiColors.gray(` (${change.modelName})`);
    } else if (change.refName) {
        typeDisplay = ansiColors.gray(` (${change.refName})`);
    }
    
    if (change.changed) {
        const versionDisplay = ansiColors.gray(`v${change.oldVersion} → v${change.newVersion}`);
        const action = ansiColors.green('mapping updated');
        // Format: ● [guid][locale] content ID: {id} - Name (Type) v1565 → v1593 mapping updated
        return `${symbol} ${guidDisplay}${localeDisplay} ${entityDisplay} ID: ${idDisplay} - ${nameDisplay}${typeDisplay} ${versionDisplay} ${action}`;
    } else {
        const versionDisplay = ansiColors.gray(`v${change.newVersion}`);
        return `${symbol} ${guidDisplay}${localeDisplay} ${entityDisplay} ID: ${idDisplay} - ${nameDisplay}${typeDisplay} ${versionDisplay} ${ansiColors.gray('unchanged')}`;
    }
}

/**
 * Display version changes with summary and full details
 * Returns formatted lines for logging
 */
function displayVersionChanges(
    label: string,
    entityType: string,
    changes: VersionChangeDetail[],
    totalUpdated: number,
    targetGuid: string,
    locale: string,
    logLines: string[]
): void {
    if (changes.length === 0) return;
    
    // Show all items using the logger
    changes.forEach(change => {
        const line = formatVersionChange(change, entityType, targetGuid, locale);
        logLine(line, logLines);
    });
}

/**
 * Update all mappings after publishing
 * Returns result and log lines for the logger
 */
export async function updateMappingsAfterPublish(
    publishedContentIds: number[],
    publishedPageIds: number[],
    sourceGuid: string,
    targetGuid: string,
    locale: string
): Promise<{ result: MappingUpdateResult; logLines: string[] }> {
    const logLines: string[] = [];
    
    logLine(ansiColors.cyan('\nUpdating mappings with new version IDs...'), logLines);

    const result: MappingUpdateResult = {
        contentMappingsUpdated: 0,
        pageMappingsUpdated: 0,
        errors: []
    };

    // Update content mappings
    if (publishedContentIds.length > 0) {
        const contentResult = await updateContentMappingsAfterPublish(
            publishedContentIds,
            sourceGuid,
            targetGuid,
            locale
        );
        result.contentMappingsUpdated = contentResult.updated;
        result.errors.push(...contentResult.errors);
        
        displayVersionChanges('content item', 'content', contentResult.changes, contentResult.updated, targetGuid, locale, logLines);
    }

    // Update page mappings
    if (publishedPageIds.length > 0) {
        const pageResult = await updatePageMappingsAfterPublish(
            publishedPageIds,
            sourceGuid,
            targetGuid,
            locale
        );
        result.pageMappingsUpdated = pageResult.updated;
        result.errors.push(...pageResult.errors);
        
        displayVersionChanges('page', 'page', pageResult.changes, pageResult.updated, targetGuid, locale, logLines);
    }

    // Summary line
    logLine(ansiColors.green(`✓ Mappings updated: ${result.contentMappingsUpdated} content, ${result.pageMappingsUpdated} pages`), logLines);

    // Report any errors
    if (result.errors.length > 0) {
        logLine(ansiColors.yellow(`  ⚠️ ${result.errors.length} mapping update errors (see logs)`), logLines);
    }

    return { result, logLines };
}
