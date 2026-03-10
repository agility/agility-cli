/**
 * Mapping Reader Utility
 * 
 * Reads content and page mappings from the file system to extract target IDs
 * for workflow operations. Uses fileOperations for consistent filesystem access.
 */

import { fileOperations } from '../../core';
import { state } from '../../core/state';
import { ContentMapping, PageMapping, MappingReadResult } from '../../types';

// Re-export types for convenience
export { ContentMapping, PageMapping, MappingReadResult };

/**
 * Read all mappings for a source/target GUID pair across all locales
 * Uses fileOperations for consistent filesystem access
 */
export function readMappingsForGuidPair(
    sourceGuid: string,
    targetGuid: string,
    locales: string[]
): MappingReadResult {
    const result: MappingReadResult = {
        contentIds: [],
        pageIds: [],
        contentMappings: [],
        pageMappings: [],
        errors: []
    };

    for (const locale of locales) {
        // Use fileOperations for consistent access
        const fileOps = new fileOperations(targetGuid, locale);
        
        // Read content mappings using fileOperations getMappingFile
        const contentMappings = fileOps.getMappingFile('item', sourceGuid, targetGuid, locale);
        if (contentMappings && contentMappings.length > 0) {
            result.contentMappings.push(...contentMappings as ContentMapping[]);
            result.contentIds.push(...contentMappings.map((m: ContentMapping) => m.targetContentID));
        }

        // Read page mappings using fileOperations getMappingFile
        const pageMappings = fileOps.getMappingFile('page', sourceGuid, targetGuid, locale);
        if (pageMappings && pageMappings.length > 0) {
            result.pageMappings.push(...pageMappings as PageMapping[]);
            result.pageIds.push(...pageMappings.map((m: PageMapping) => m.targetPageID));
        }
    }

    // Deduplicate IDs (same content/page might appear in multiple locales)
    result.contentIds = Array.from(new Set(result.contentIds));
    result.pageIds = Array.from(new Set(result.pageIds));

    return result;
}

/**
 * List available mapping directories to discover source/target pairs
 * Uses fileOperations for consistent filesystem access
 */
export function listAvailableMappingPairs(): Array<{ sourceGuid: string; targetGuid: string; locales: string[] }> {
    const fileOps = new fileOperations('', '');
    const mappingsDir = fileOps.getMappingFilePath('', '');
    
    // Get the root mappings folder from state
    const rootMappingsPath = `${state.rootPath}/mappings`;
    
    if (!fileOps.fileExists(rootMappingsPath)) {
        return [];
    }

    const pairs: Array<{ sourceGuid: string; targetGuid: string; locales: string[] }> = [];
    
    try {
        const dirs = fileOps.getFolderContents(rootMappingsPath);
        
        for (const dir of dirs) {
            // Directory format: {sourceGuid}-{targetGuid}
            const fullPath = `${rootMappingsPath}/${dir}`;
            
            // Find locales in this directory
            const locales: string[] = [];
            try {
                const contents = fileOps.getFolderContents(fullPath);
                
                for (const item of contents) {
                    // Check if it looks like a locale (e.g., en-us, es-us)
                    if (/^[a-z]{2}-[a-z]{2}$/i.test(item)) {
                        locales.push(item);
                    }
                }
            } catch (e) {
                // Skip directories we can't read
                continue;
            }

            if (locales.length > 0) {
                // Parse the directory name to extract source and target GUIDs
                // Format: {sourceGuid}-{targetGuid} where GUIDs are like "c39c63bd-us2"
                const guidPattern = /^([a-zA-Z0-9]+-[a-zA-Z0-9]+)-([a-zA-Z0-9]+-[a-zA-Z0-9]+)$/;
                const match = dir.match(guidPattern);
                
                if (match) {
                    pairs.push({
                        sourceGuid: match[1],
                        targetGuid: match[2],
                        locales
                    });
                }
            }
        }
    } catch (error: any) {
        console.error(`Error listing mapping directories: ${error.message}`);
    }

    return pairs;
}

/**
 * Get mapping summary for display
 */
export function getMappingSummary(
    sourceGuid: string,
    targetGuid: string,
    locales: string[]
): { totalContent: number; totalPages: number; localesFound: string[] } {
    const result = readMappingsForGuidPair(sourceGuid, targetGuid, locales);
    const fileOps = new fileOperations('', '');
    
    const localesFound = locales.filter(locale => {
        const ops = new fileOperations(targetGuid, locale);
        const contentMappings = ops.getMappingFile('item', sourceGuid, targetGuid, locale);
        const pageMappings = ops.getMappingFile('page', sourceGuid, targetGuid, locale);
        return (contentMappings && contentMappings.length > 0) || (pageMappings && pageMappings.length > 0);
    });
    
    return {
        totalContent: result.contentIds.length,
        totalPages: result.pageIds.length,
        localesFound
    };
}
