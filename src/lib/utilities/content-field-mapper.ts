/**
 * Enhanced Content Field Mapper
 * 
 * Extracted and enhanced from topological-two-pass-orchestrator.ts mapContentReferences()
 * Handles sophisticated reference transformation for content fields:
 * - ContentID mapping (contentid, contentID, ValueField patterns)
 * - Asset URL transformation (CDN URL remapping)
 * - Gallery reference mapping
 * - Link-type-specific mapping strategies
 */

import { ReferenceMapper } from '../reference-mapper';
import { AssetReferenceExtractor, LinkTypeDetector, ContentFieldValidator, type ContentValidationOptions } from './index';
import * as mgmtApi from '@agility/management-sdk';

export interface ContentFieldMappingOptions {
    referenceMapper: ReferenceMapper;
    sourceAssets?: any[];
    targetAssets?: any[];
    sourceGalleries?: any[];
    targetGalleries?: any[];
    sourceContainers?: any[];
    models?: any[];
    apiClient?: mgmtApi.ApiClient;
    targetGuid?: string;
}

export class ContentFieldMapper {
    private assetExtractor: AssetReferenceExtractor;
    private linkTypeDetector: LinkTypeDetector;
    private validator: ContentFieldValidator;
    private assetUrlMappingCache: Map<string, string> = new Map();

    constructor() {
        this.assetExtractor = new AssetReferenceExtractor();
        this.linkTypeDetector = new LinkTypeDetector();
        this.validator = new ContentFieldValidator();
    }

    /**
     * Enhanced content field mapping with validation and reference transformation
     * Based on proven mapContentReferences() pattern from topological-two-pass-orchestrator.ts
     */
    public mapContentFields(fields: any, options: ContentFieldMappingOptions): {
        mappedFields: any;
        validationWarnings: number;
        validationErrors: number;
        mappingStats: any;
    } {
        if (!fields || typeof fields !== 'object') {
            return {
                mappedFields: fields,
                validationWarnings: 0,
                validationErrors: 0,
                mappingStats: { fieldCount: 0, transformedFields: 0 }
            };
        }

        // Build asset URL mapping table if not cached
        if (this.assetUrlMappingCache.size === 0) {
            this.buildAssetUrlMappingTable(options);
        }

        // Validate fields first
        const validationOptions: ContentValidationOptions = {
            referenceMapper: options.referenceMapper,
            sourceAssets: options.sourceAssets,
            sourceContainers: options.sourceContainers,
            strictMode: false // Use warnings for missing references during mapping
        };

        const validationResult = this.validator.validateContentFields(fields, validationOptions);

        // Map the validated fields
        const mappedFields = this.mapFieldsRecursively(validationResult.validatedFields, options, '');

        // Generate mapping statistics
        const mappingStats = this.generateMappingStats(fields, mappedFields);

        return {
            mappedFields,
            validationWarnings: validationResult.totalWarnings,
            validationErrors: validationResult.totalErrors,
            mappingStats
        };
    }

    /**
     * Recursive field mapping that preserves structure while transforming references
     */
    private mapFieldsRecursively(obj: any, options: ContentFieldMappingOptions, path: string): any {
        if (!obj || typeof obj !== 'object') {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map((item, index) => 
                this.mapFieldsRecursively(item, options, `${path}[${index}]`)
            );
        }

        const mappedObj: any = {};

        for (const [fieldKey, fieldValue] of Object.entries(obj)) {
            const fieldPath = path ? `${path}.${fieldKey}` : fieldKey;
            mappedObj[fieldKey] = this.mapSingleField(fieldKey, fieldValue, options, fieldPath);
        }

        return mappedObj;
    }

    /**
     * Map a single field with type-specific logic
     */
    private mapSingleField(fieldKey: string, fieldValue: any, options: ContentFieldMappingOptions, fieldPath: string): any {
        // Handle null/undefined values
        if (fieldValue === null || fieldValue === undefined) {
            return fieldValue;
        }

        // Handle object fields with content references
        if (typeof fieldValue === 'object' && fieldValue !== null) {
            return this.mapObjectField(fieldKey, fieldValue, options, fieldPath);
        }

        // Handle string fields
        if (typeof fieldValue === 'string') {
            return this.mapStringField(fieldKey, fieldValue, options, fieldPath);
        }

        // Handle primitive fields (numbers, booleans)
        return fieldValue;
    }

    /**
     * Map object fields (nested content references, etc.)
     */
    private mapObjectField(fieldKey: string, fieldValue: any, options: ContentFieldMappingOptions, fieldPath: string): any {
        // Content reference patterns - enhanced from original mapContentReferences()
        if ('contentid' in fieldValue) {
            const contentid = fieldValue.contentid;
            const mappedContentId = options.referenceMapper.getMappedId('content', contentid);
            return {
                ...fieldValue,
                contentid: mappedContentId || contentid
            };
        }

        if ('contentID' in fieldValue) {
            const contentID = fieldValue.contentID;
            const mappedContentId = options.referenceMapper.getMappedId('content', contentID);
            return {
                ...fieldValue,
                contentID: mappedContentId || contentID
            };
        }

        // LinkedContentDropdown pattern with sortids
        if (fieldValue.referencename && fieldValue.sortids) {
            const sortIds = fieldValue.sortids.toString().split(',').filter((id: string) => id.trim());
            const mappedSortIds = sortIds.map((sortId: string) => {
                const numericId = parseInt(sortId.trim());
                if (!isNaN(numericId)) {
                    return options.referenceMapper.getMappedId('content', numericId) || numericId;
                }
                return sortId;
            });

            return {
                ...fieldValue,
                sortids: mappedSortIds.join(','),
                referencename: this.mapContainerReference(fieldValue.referencename, options)
            };
        }

        // Gallery reference mapping
        if (fieldValue.mediaGroupingID) {
            const mappedGalleryId = options.referenceMapper.getMappedId('gallery', fieldValue.mediaGroupingID);
            return {
                ...fieldValue,
                mediaGroupingID: mappedGalleryId || fieldValue.mediaGroupingID
            };
        }

        // Recursive mapping for nested objects
        return this.mapFieldsRecursively(fieldValue, options, fieldPath);
    }

    /**
     * Map string fields (asset URLs, content ID strings, etc.)
     */
    private mapStringField(fieldKey: string, fieldValue: string, options: ContentFieldMappingOptions, fieldPath: string): string {
        // Asset URL transformation
        if (fieldValue.includes('cdn.aglty.io')) {
            return this.mapAssetUrl(fieldValue);
        }

        // Content ID string fields (CategoryID, ValueField patterns)
        if (this.isContentIdField(fieldKey, fieldValue)) {
            return this.mapContentIdString(fieldValue, options);
        }

        // Regular string field
        return fieldValue;
    }

    /**
     * Check if field is a content ID reference field
     */
    private isContentIdField(fieldKey: string, fieldValue: string): boolean {
        const lowercaseKey = fieldKey.toLowerCase();
        
        // Known content ID field patterns
        if (lowercaseKey.includes('categoryid') || 
            lowercaseKey.includes('valuefield') ||
            lowercaseKey.includes('tags') ||
            lowercaseKey.includes('links')) {
            
            // Check if value is numeric or comma-separated numeric
            const cleanValue = fieldValue.trim();
            if (cleanValue.includes(',')) {
                return cleanValue.split(',').every(id => !isNaN(parseInt(id.trim())));
            }
            return !isNaN(parseInt(cleanValue));
        }

        return false;
    }

    /**
     * Map content ID string (handles comma-separated values)
     */
    private mapContentIdString(fieldValue: string, options: ContentFieldMappingOptions): string {
        if (fieldValue.includes(',')) {
            // Comma-separated content IDs
            const contentIds = fieldValue.split(',').filter(id => id.trim());
            const mappedIds = contentIds.map(contentIdStr => {
                const numericId = parseInt(contentIdStr.trim());
                if (!isNaN(numericId)) {
                    return options.referenceMapper.getMappedId('content', numericId) || numericId;
                }
                return contentIdStr;
            });
            return mappedIds.join(',');
        } else {
            // Single content ID
            const numericId = parseInt(fieldValue.trim());
            if (!isNaN(numericId)) {
                const mappedId = options.referenceMapper.getMappedId('content', numericId);
                return (mappedId || numericId).toString();
            }
            return fieldValue;
        }
    }

    /**
     * Map asset URL using cached mapping table
     */
    private mapAssetUrl(sourceUrl: string): string {
        // Check cache first
        const cachedUrl = this.assetUrlMappingCache.get(sourceUrl);
        if (cachedUrl) {
            return cachedUrl;
        }

        // For now, return original URL - full asset URL mapping requires target asset info
        // TODO: Implement full asset URL transformation when target assets are available
        return sourceUrl;
    }

    /**
     * Map container reference name
     */
    private mapContainerReference(referenceName: string, options: ContentFieldMappingOptions): string {
        // Look up container by reference name in the reference mapper
        const containerMapping = options.referenceMapper.getRecordsByType('container').find(record => 
            record.source?.referenceName === referenceName
        );
        
        if (containerMapping && containerMapping.target) {
            return containerMapping.target.referenceName;
        }
        
        // Return original if no mapping found
        return referenceName;
    }

    /**
     * Build asset URL mapping table from source and target assets
     */
    private buildAssetUrlMappingTable(options: ContentFieldMappingOptions): void {
        if (!options.sourceAssets || !options.targetAssets) {
            return;
        }

        // Build mapping table: sourceAssetUrl → targetAssetUrl
        options.sourceAssets.forEach(sourceAsset => {
            // Find corresponding target asset using reference mapper
            const mappedAssetId = options.referenceMapper.getMappedId('asset', sourceAsset.mediaID);
            if (mappedAssetId) {
                const targetAsset = options.targetAssets?.find(a => a.mediaID === mappedAssetId);
                if (targetAsset) {
                    // Map all URL variants
                    if (sourceAsset.originUrl && targetAsset.originUrl) {
                        this.assetUrlMappingCache.set(sourceAsset.originUrl, targetAsset.originUrl);
                    }
                    if (sourceAsset.url && targetAsset.url) {
                        this.assetUrlMappingCache.set(sourceAsset.url, targetAsset.url);
                    }
                    if (sourceAsset.edgeUrl && targetAsset.edgeUrl) {
                        this.assetUrlMappingCache.set(sourceAsset.edgeUrl, targetAsset.edgeUrl);
                    }
                }
            }
        });
    }

    /**
     * Clear cached mappings (call when processing different instances)
     */
    public clearCache(): void {
        this.assetUrlMappingCache.clear();
    }

    /**
     * Create basic shell fields for Pass 1 (simple fields only)
     */
    public createShellFields(fields: any): any {
        if (!fields || typeof fields !== 'object') {
            return {};
        }

        const shellFields: any = {};

        for (const [fieldKey, fieldValue] of Object.entries(fields)) {
            // Include only simple fields for shell creation
            if (typeof fieldValue === 'string' || 
                typeof fieldValue === 'number' || 
                typeof fieldValue === 'boolean' ||
                fieldValue === null || 
                fieldValue === undefined) {
                shellFields[fieldKey] = fieldValue;
            }
        }

        return shellFields;
    }

    /**
     * Generate mapping statistics comparing original and mapped fields
     */
    private generateMappingStats(originalFields: any, mappedFields: any): {
        fieldCount: number;
        transformedFields: number;
        assetUrlMappings: number;
        contentIdMappings: number;
    } {
        const fieldCount = Object.keys(originalFields || {}).length;
        let transformedFields = 0;
        let contentIdMappings = 0;

        // Count fields that were actually transformed
        if (originalFields && mappedFields) {
            for (const [key, originalValue] of Object.entries(originalFields)) {
                const mappedValue = mappedFields[key];
                if (JSON.stringify(originalValue) !== JSON.stringify(mappedValue)) {
                    transformedFields++;
                    
                    // Count content ID mappings specifically
                    if (this.containsContentId(originalValue) && this.containsContentId(mappedValue)) {
                        contentIdMappings++;
                    }
                }
            }
        }

        return {
            fieldCount,
            transformedFields,
            assetUrlMappings: this.assetUrlMappingCache.size,
            contentIdMappings
        };
    }

    /**
     * Helper to check if a value contains content ID references
     */
    private containsContentId(value: any): boolean {
        if (!value) return false;
        if (typeof value === 'object') {
            return 'contentid' in value || 'contentID' in value || 
                   (value.sortids && typeof value.sortids === 'string');
        }
        return false;
    }

    /**
     * Get mapping statistics for debugging
     */
    public getMappingStats(): {
        assetUrlMappings: number;
    } {
        return {
            assetUrlMappings: this.assetUrlMappingCache.size
        };
    }
}

/**
 * Factory function for easy usage
 */
export function createContentFieldMapper(): ContentFieldMapper {
    return new ContentFieldMapper();
}

/**
 * Standalone mapping function for compatibility with existing code
 */
export function mapContentFields(fields: any, options: ContentFieldMappingOptions): any {
    const mapper = new ContentFieldMapper();
    return mapper.mapContentFields(fields, options);
} 