/**
 * Core Reference Mapper - Lightweight mapping service with fileOperations integration
 * 
 * Focuses purely on mapping source entities to target entities
 * Uses enhanced fileOperations for clean disk persistence
 * No bloated URL processing or complex asset finding logic
 */

import { fileOperations } from './services/fileOperations';

interface CoreReferenceRecord {
    type: 'model' | 'container' | 'content' | 'asset' | 'gallery' | 'template' | 'page' | 'container-name';
    source: any;
    target: any | null;
    sourceGUID: string;
    targetGUID: string;
}

interface CoreReferenceResult<T> {
    source: T;
    target: T | null;
    sourceGUID: string;
    targetGUID: string;
}

/**
 * Entity identification strategies based on data-relationships.md
 */
export class ReferenceMapper {
    private records: CoreReferenceRecord[] = [];
    private sourceGUID: string;
    private targetGUID: string;
    private fileOps: fileOperations;

    // Multi-level mapping relationships for direct ID lookups
    public modelIds: Map<number, number> = new Map();
    public contentIds: Map<number, number> = new Map();
    public containerIds: Map<number, number> = new Map();
    public templateIds: Map<number, number> = new Map();
    public pageIds: Map<number, number> = new Map();
    public assetIds: Map<number, number> = new Map();
    public galleryIds: Map<number, number> = new Map();

    constructor(sourceGUID: string, targetGUID: string, rootPath: string = 'agility-files', legacyFolders: boolean = false) {
        this.sourceGUID = sourceGUID;
        this.targetGUID = targetGUID;
        
        // Create fileOperations service for disk persistence
        this.fileOps = new fileOperations(rootPath, sourceGUID, 'en-us', true, legacyFolders);
        
        // Automatically load existing mappings on construction
        this.loadMappingsFromDisk();
    }

    /**
     * Add or update a reference mapping
     * Core mapping logic without file persistence or complex deduplication
     * Automatically populates ID maps for quick lookups
     */
    addMapping(type: CoreReferenceRecord['type'], source: any, target: any | null = null): void {
        const existingIndex = this.findExistingMappingIndex(type, source);

        const mappingRecord: CoreReferenceRecord = {
            type,
            source,
            target,
            sourceGUID: this.sourceGUID,
            targetGUID: this.targetGUID
        };

        if (existingIndex >= 0) {
            // Update existing - prefer records with targets
            const existingRecord = this.records[existingIndex];
            if (target || !existingRecord.target) {
                this.records[existingIndex] = mappingRecord;
                // Update ID mappings when updating record
                this.updateIdMappings(type, source, target);
            }
        } else {
            // Add new record
            this.records.push(mappingRecord);
            // Update ID mappings when adding new record
            this.updateIdMappings(type, source, target);
        }
    }

    /**
     * Update ID mappings for direct lookups
     */
    private updateIdMappings(type: CoreReferenceRecord['type'], source: any, target: any | null): void {
        if (!source || !target) return;

        try {
            switch (type) {
                case 'model':
                    const sourceModelId = source.id || source.definitionID;
                    const targetModelId = target.id || target.definitionID;
                    if (sourceModelId && targetModelId) {
                        this.modelIds.set(sourceModelId, targetModelId);
                    }
                    break;

                case 'content':
                    if (source.contentID && target.contentID) {
                        this.contentIds.set(source.contentID, target.contentID);
                    }
                    break;

                case 'container':
                    if (source.containerID && target.containerID) {
                        this.containerIds.set(source.containerID, target.containerID);
                    }
                    break;

                case 'template':
                    const sourceTemplateId = source.id || source.pageTemplateID;
                    const targetTemplateId = target.id || target.pageTemplateID;
                    if (sourceTemplateId && targetTemplateId) {
                        this.templateIds.set(sourceTemplateId, targetTemplateId);
                    }
                    break;

                case 'page':
                    if (source.pageID && target.pageID) {
                        this.pageIds.set(source.pageID, target.pageID);
                    }
                    break;

                case 'asset':
                    if (source.mediaID && target.mediaID) {
                        this.assetIds.set(source.mediaID, target.mediaID);
                    }
                    break;

                case 'gallery':
                    if (source.galleryID && target.galleryID) {
                        this.galleryIds.set(source.galleryID, target.galleryID);
                    }
                    break;
            }
        } catch (error) {
            // Silently handle ID mapping errors to not disrupt main mapping logic
            console.warn(`Warning: Could not update ID mapping for ${type}:`, error);
        }
    }

    /**
     * Get a mapping by entity type and identifier (new API)
     * Returns target directly
     */
    getMapping<T>(type: CoreReferenceRecord['type'], identifier: string | number): T | null;
    /**
     * Get a mapping by entity type, field, and value (old API) 
     * Returns CoreReferenceResult with .target property for backward compatibility
     */
    getMapping<T>(type: CoreReferenceRecord['type'], field: string, value: any): CoreReferenceResult<T> | null;
    /**
     * Implementation
     */
    getMapping<T>(type: CoreReferenceRecord['type'], identifierOrField: string | number, value?: any): any {
        if (value !== undefined) {
            // 3-parameter version (old API) - return CoreReferenceResult with .target property
            return this.getMappingByKey<T>(type, identifierOrField as string, value);
        } else {
            // 2-parameter version (new API) - return target directly
            const record = this.records.find(r => {
                if (r.type !== type) return false;
                return this.matchesIdentifier(r.source, type, identifierOrField);
            });
            return record?.target || null;
        }
    }

    /**
     * Get full mapping result including source/target/GUIDs
     */
    getMappingResult<T>(type: CoreReferenceRecord['type'], identifier: string | number): CoreReferenceResult<T> | null {
        const record = this.records.find(r => {
            if (r.type !== type) return false;
            return this.matchesIdentifier(r.source, type, identifier);
        });

        return record ? {
            source: record.source,
            target: record.target,
            sourceGUID: record.sourceGUID,
            targetGUID: record.targetGUID
        } : null;
    }

    /**
     * Get mapping by custom key-value pair
     * For cases where standard identifier isn't sufficient
     */
    getMappingByKey<T>(type: CoreReferenceRecord['type'], key: string, value: any): CoreReferenceResult<T> | null {
        const record = this.records.find(r => 
            r.type === type && 
            r.source && 
            this.compareValues(r.source[key], value)
        );

        return record ? {
            source: record.source,
            target: record.target,
            sourceGUID: record.sourceGUID,
            targetGUID: record.targetGUID
        } : null;
    }

    /**
     * Get all mappings of a specific type
     */
    getMappingsByType(type: CoreReferenceRecord['type']): CoreReferenceResult<any>[] {
        return this.records
            .filter(r => r.type === type)
            .map(r => ({
                source: r.source,
                target: r.target,
                sourceGUID: r.sourceGUID,
                targetGUID: r.targetGUID
            }));
    }

    /**
     * Check if an entity has a mapping
     */
    hasMapping(type: CoreReferenceRecord['type'], identifier: string | number): boolean {
        return this.getMapping(type, identifier) !== null;
    }

    /**
     * Get target entity from mapping (convenience method)
     */
    getTarget<T>(type: CoreReferenceRecord['type'], identifier: string | number): T | null {
        return this.getMapping<T>(type, identifier);
    }

    /**
     * Get mapped target ID for any entity type
     */
    getMappedId(type: CoreReferenceRecord['type'], sourceId: number): number | null {
        switch (type) {
            case 'model':
                return this.modelIds.get(sourceId) || null;
            case 'content':
                return this.contentIds.get(sourceId) || null;
            case 'container':
                return this.containerIds.get(sourceId) || null;
            case 'template':
                return this.templateIds.get(sourceId) || null;
            case 'page':
                return this.pageIds.get(sourceId) || null;
            case 'asset':
                return this.assetIds.get(sourceId) || null;
            case 'gallery':
                return this.galleryIds.get(sourceId) || null;
            default:
                return null;
        }
    }

    /**
     * Manually add ID mapping (for cases where we know IDs but don't have full entities)
     */
    addIdMapping(type: CoreReferenceRecord['type'], sourceId: number, targetId: number): void {
        switch (type) {
            case 'model':
                this.modelIds.set(sourceId, targetId);
                break;
            case 'content':
                this.contentIds.set(sourceId, targetId);
                break;
            case 'container':
                this.containerIds.set(sourceId, targetId);
                break;
            case 'template':
                this.templateIds.set(sourceId, targetId);
                break;
            case 'page':
                this.pageIds.set(sourceId, targetId);
                break;
            case 'asset':
                this.assetIds.set(sourceId, targetId);
                break;
            case 'gallery':
                this.galleryIds.set(sourceId, targetId);
                break;
        }
    }

    /**
     * Get mapping statistics including ID map sizes
     */
    getDetailedStats(): { 
        [type: string]: { 
            total: number, 
            withTargets: number, 
            idMappings: number 
        } 
    } {
        const stats: any = {};
        
        // Get basic stats from records
        for (const type of ['model', 'container', 'content', 'asset', 'gallery', 'template', 'page']) {
            const recordsOfType = this.records.filter(r => r.type === type);
            stats[type] = {
                total: recordsOfType.length,
                withTargets: recordsOfType.filter(r => r.target !== null).length,
                idMappings: 0
            };
        }

        // Add ID mapping counts
        stats.model.idMappings = this.modelIds.size;
        stats.content.idMappings = this.contentIds.size;
        stats.container.idMappings = this.containerIds.size;
        stats.template.idMappings = this.templateIds.size;
        stats.page.idMappings = this.pageIds.size;
        stats.asset.idMappings = this.assetIds.size;
        stats.gallery.idMappings = this.galleryIds.size;

        return stats;
    }

    /**
     * Clear all mappings
     */
    clear(): void {
        this.records = [];
        // Clear ID mappings too
        this.modelIds.clear();
        this.contentIds.clear();
        this.containerIds.clear();
        this.templateIds.clear();
        this.pageIds.clear();
        this.assetIds.clear();
        this.galleryIds.clear();
    }

    /**
     * Legacy API compatibility: Clear all mappings (alias for clear)
     */
    clearAllMappings(): void {
        this.clear();
    }

    /**
     * Legacy API compatibility: Save mappings (no-op for in-memory mapper)
     */
    async saveAllMappings(): Promise<void> {
        // No-op for in-memory mapper - legacy compatibility
    }

    /**
     * Legacy API compatibility: Clear and rebuild mappings
     */
    async clearAndRebuild(): Promise<void> {
        this.clear();
        // In the original mapper this would rebuild from files, but we're in-memory only
    }

    /**
     * Legacy API compatibility: addRecord (alias for addMapping)
     */
    addRecord(type: CoreReferenceRecord['type'], source: any, target: any | null = null): void {
        this.addMapping(type, source, target);
    }

    /**
     * Legacy API compatibility: getRecordsByType (alias for getMappingsByType)
     */
    getRecordsByType(type: CoreReferenceRecord['type']): any[] {
        if (type === 'container-name') {
            // Legacy container name mappings - return empty array for now
            return [];
        }
        
        return this.records
            .filter(r => r.type === type)
            .map(r => ({
                source: r.source,
                target: r.target,
                sourceGUID: r.sourceGUID,
                targetGUID: r.targetGUID
            }));
    }

    /**
     * Legacy API compatibility: getContentMappingById
     */
    getContentMappingById(contentId: number): { source: any, target: any | null } | null {
        const record = this.records.find(r => 
            r.type === 'content' && 
            r.source && 
            r.source.contentID === contentId
        );

        return record ? {
            source: record.source,
            target: record.target
        } : null;
    }

    /**
     * Legacy API compatibility: checkExistingAsset
     */
    checkExistingAsset(assetId: number): any | null {
        return this.getMapping('asset', assetId);
    }

    /**
     * Legacy API compatibility: getContainerMappingById
     */
    getContainerMappingById(containerId: number): { source: any, target: any | null } | null {
        const record = this.records.find(r => 
            r.type === 'container' && 
            r.source && 
            r.source.containerID === containerId
        );

        return record ? {
            source: record.source,
            target: record.target
        } : null;
    }

    /**
     * Get mapping statistics
     */
    getStats(): { [type: string]: { total: number, withTargets: number } } {
        const stats: { [type: string]: { total: number, withTargets: number } } = {};
        
        for (const record of this.records) {
            if (!stats[record.type]) {
                stats[record.type] = { total: 0, withTargets: 0 };
            }
            stats[record.type].total++;
            if (record.target) {
                stats[record.type].withTargets++;
            }
        }
        
        return stats;
    }

    /**
     * Private: Find existing mapping index for deduplication
     */
    private findExistingMappingIndex(type: CoreReferenceRecord['type'], source: any): number {
        return this.records.findIndex(r => {
            if (r.type !== type) return false;
            
            // Entity-specific identification strategies from data-relationships.md
            switch (type) {
                case 'model':
                    return r.source.id === source.id;
                case 'container':
                    return r.source.contentViewID === source.contentViewID;
                case 'content':
                    return r.source.contentID === source.contentID;
                case 'asset':
                    return r.source.originUrl === source.originUrl || r.source.mediaID === source.mediaID;
                case 'template':
                    return r.source.pageTemplateName === source.pageTemplateName || r.source.pageTemplateID === source.pageTemplateID;
                case 'page':
                    return r.source.pageID === source.pageID;
                case 'gallery':
                    return r.source.mediaGroupingID === source.mediaGroupingID;
                default:
                    // Fallback to JSON comparison for unknown types
                    return JSON.stringify(r.source) === JSON.stringify(source);
            }
        });
    }

    /**
     * Private: Check if source entity matches identifier
     */
    private matchesIdentifier(source: any, type: CoreReferenceRecord['type'], identifier: string | number): boolean {
        switch (type) {
            case 'model':
                return source.id === identifier || source.referenceName === identifier;
            case 'container':
                return source.contentViewID === identifier || source.referenceName === identifier;
            case 'content':
                return source.contentID === identifier;
            case 'asset':
                return source.mediaID === identifier || source.originUrl === identifier;
            case 'template':
                return source.pageTemplateID === identifier || source.pageTemplateName === identifier;
            case 'page':
                return source.pageID === identifier;
            case 'gallery':
                return source.mediaGroupingID === identifier;
            default:
                return false;
        }
    }

    /**
     * Private: Compare values with case-insensitive string matching
     */
    private compareValues(sourceValue: any, targetValue: any): boolean {
        if (typeof sourceValue === 'string' && typeof targetValue === 'string') {
            return sourceValue.toLowerCase() === targetValue.toLowerCase();
        }
        return sourceValue === targetValue;
    }

    /**
     * Save mappings to disk using fileOperations
     */
    saveMappingsToDisk(): void {
        try {
            const mappingData = {
                sourceGUID: this.sourceGUID,
                targetGUID: this.targetGUID,
                records: this.records,
                modelIds: Array.from(this.modelIds.entries()),
                contentIds: Array.from(this.contentIds.entries()),
                containerIds: Array.from(this.containerIds.entries()),
                templateIds: Array.from(this.templateIds.entries()),
                pageIds: Array.from(this.pageIds.entries()),
                assetIds: Array.from(this.assetIds.entries()),
                galleryIds: Array.from(this.galleryIds.entries())
            };

            this.fileOps.saveMappingFile(this.targetGUID, mappingData);
        } catch (error) {
            console.warn('Warning: Could not save mappings to disk:', error);
        }
    }

    /**
     * Load mappings from disk using fileOperations
     */
    private loadMappingsFromDisk(): void {
        try {
            const mappingData = this.fileOps.loadMappingFile(this.targetGUID);
            
            if (mappingData) {
                this.records = mappingData.records || [];
                
                // Restore ID mappings
                this.modelIds = new Map(mappingData.modelIds || []);
                this.contentIds = new Map(mappingData.contentIds || []);
                this.containerIds = new Map(mappingData.containerIds || []);
                this.templateIds = new Map(mappingData.templateIds || []);
                this.pageIds = new Map(mappingData.pageIds || []);
                this.assetIds = new Map(mappingData.assetIds || []);
                this.galleryIds = new Map(mappingData.galleryIds || []);
            }
        } catch (error) {
            console.warn('Warning: Could not load mappings from disk:', error);
        }
    }

    /**
     * Clear mappings cache using fileOperations
     */
    clearMappingsCache(): void {
        try {
            this.fileOps.clearMappingFile(this.targetGUID);
            this.clear(); // Clear in-memory mappings too
        } catch (error) {
            console.warn('Warning: Could not clear mappings cache:', error);
        }
    }
} 