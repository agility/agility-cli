import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "./reference-mapper";

export interface BulkFilterResult {
    unmappedItems: mgmtApi.ContentItem[];
    alreadyMapped: mgmtApi.ContentItem[];
    mappingStats: {
        total: number;
        mapped: number;
        unmapped: number;
        percentMapped: number;
    };
}

/**
 * Filter content items based on existing mappings for performance optimization
 * This prevents re-processing content that's already been synchronized
 */
export async function bulkFilterByExistingMappings(
    contentItems: mgmtApi.ContentItem[],
    referenceMapper: ReferenceMapper,
    overwrite: boolean = false
): Promise<BulkFilterResult> {
    
    // If overwrite is enabled, process all items (no filtering)
    if (overwrite) {
        return {
            unmappedItems: contentItems,
            alreadyMapped: [],
            mappingStats: {
                total: contentItems.length,
                mapped: 0,
                unmapped: contentItems.length,
                percentMapped: 0
            }
        };
    }

    // Extract content IDs for bulk mapping lookup
    const contentIds = contentItems
        .map(item => item.contentID)
        .filter(id => id && id > 0);

    // Perform bulk mapping lookup (single operation vs individual calls)
    const bulkMappings = referenceMapper.getBulkContentMappings(contentIds);
    
    // Create set of mapped IDs for fast lookup
    const mappedIds = new Set(
        bulkMappings
            .filter(mapping => mapping.target !== null)
            .map(mapping => mapping.source)
    );
    
    // Split content items into mapped vs unmapped
    const unmappedItems = contentItems.filter(item => !mappedIds.has(item.contentID));
    const alreadyMapped = contentItems.filter(item => mappedIds.has(item.contentID));
    
    // Calculate statistics
    const mappingStats = {
        total: contentItems.length,
        mapped: alreadyMapped.length,
        unmapped: unmappedItems.length,
        percentMapped: contentItems.length > 0 
            ? Math.round((alreadyMapped.length / contentItems.length) * 100)
            : 0
    };

    return {
        unmappedItems,
        alreadyMapped,
        mappingStats
    };
}

/**
 * Generic bulk filter function for any entity type
 */
export async function bulkFilterByExistingMappingsGeneric<T extends { [key: string]: any }>(
    items: T[],
    referenceMapper: ReferenceMapper,
    entityType: 'model' | 'container' | 'content' | 'asset' | 'gallery' | 'template' | 'page',
    idField: keyof T,
    overwrite: boolean = false
): Promise<{
    unmappedItems: T[];
    alreadyMapped: T[];
    mappingStats: {
        total: number;
        mapped: number;
        unmapped: number;
        percentMapped: number;
    };
}> {
    
    // If overwrite is enabled, process all items
    if (overwrite) {
        return {
            unmappedItems: items,
            alreadyMapped: [],
            mappingStats: {
                total: items.length,
                mapped: 0,
                unmapped: items.length,
                percentMapped: 0
            }
        };
    }

    // Extract IDs for bulk lookup
    const ids = items
        .map(item => item[idField] as number)
        .filter(id => id && id > 0);

    // Perform bulk mapping lookup based on entity type
    const bulkMappings = referenceMapper.getBulkMappings(entityType, ids);
    
    // Create set of mapped IDs
    const mappedIds = new Set(
        bulkMappings
            .filter(mapping => mapping.target !== null)
            .map(mapping => mapping.source)
    );
    
    // Filter items
    const unmappedItems = items.filter(item => !mappedIds.has(item[idField] as number));
    const alreadyMapped = items.filter(item => mappedIds.has(item[idField] as number));
    
    // Calculate statistics
    const mappingStats = {
        total: items.length,
        mapped: alreadyMapped.length,
        unmapped: unmappedItems.length,
        percentMapped: items.length > 0 
            ? Math.round((alreadyMapped.length / items.length) * 100)
            : 0
    };

    return {
        unmappedItems,
        alreadyMapped,
        mappingStats
    };
} 