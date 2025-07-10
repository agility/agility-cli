/**
 * ReferenceMapper - Handles entity mappings between Agility CMS instances
 * 
 * This class supports both forward (A→B) and reverse (B→A) lookups using an improved mapping file format.
 * The same methods work naturally in both directions based on which mapping file is loaded.
 * 
 * IMPROVED MAPPING FILE FORMAT:
 * - Files are now saved as: {sourceGUID}-to-{targetGUID}-{locale}.json
 * - Example: "abc123-to-def456-en-us.json"
 * - Stored centrally in /agility-files/mappings/ (not per-instance)
 * 
 * BIDIRECTIONAL MAPPING CAPABILITY:
 * - Forward sync A→B: Uses "A-to-B-locale.json" mapping file
 * - Reverse sync B→A: First tries "B-to-A-locale.json", falls back to "A-to-B-locale.json" (auto-flipped)
 * - All methods (getMappedId, hasMapping, etc.) work the same way regardless of direction
 * - No data duplication - one mapping serves both directions
 * 
 * PERSISTENCE INTEGRATION:
 * - Built-in integration point for external persistence (cloud storage, databases, etc.)
 * - Supports scenarios where mappings need to survive beyond ephemeral agents
 * 
 * Example Usage:
 * ```typescript
 * // A→B sync: Automatic fallback loading in constructor
 * const mapper = new ReferenceMapper(); // Uses global state, auto-loads A→B mappings
 * const targetModelId = mapper.getMappedId('model', sourceModelId);
 * 
 * // B→A sync: Automatic fallback loading in constructor  
 * const mapper = new ReferenceMapper(); // Uses global state, auto-loads B→A or flipped A→B mappings
 * const targetModelId = mapper.getMappedId('model', sourceModelId); // Same API works both ways
 * ```
 */

import { fileOperations } from '../../core/fileOperations';
import { getState } from '../../core/state';

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

interface BulkMappingResult {
    source: number;
    target: number | null;
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

    constructor() {
        const state = getState();
        this.sourceGUID = state.sourceGuid[0];
        this.targetGUID = state.targetGuid[0];
        
        // Create fileOperations service for disk persistence using locale from state
        this.fileOps = new fileOperations(state.rootPath, state.sourceGuid[0], state.locale[0], state.preview, state.legacyFolders);
        
        // Automatically load existing mappings with fallback support
        this.loadMappingWithFallback(this.sourceGUID, this.targetGUID);
    }

    /**
     * Add or update a reference mapping
     * Core mapping logic without file persistence or complex deduplication
     * Automatically populates ID maps for quick lookups
     */
    addMapping(type: CoreReferenceRecord['type'], source: any, target: any | null = null): void {
        const existingIndex = this.findExistingMappingIndex(type, source);

        // DEBUG: Log mapping update operation
        const sourceId = source?.id || source?.contentID || source?.pageID || 'unknown';
        const targetId = target?.id || target?.contentID || target?.pageID || 'unknown';
        
        if (type === 'model') {
            if (existingIndex !== -1) {
                const existingTargetId = this.records[existingIndex].target?.id;
            }
        }

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
                    if (source.mediaGroupingID && target.mediaGroupingID) {
                        this.galleryIds.set(source.mediaGroupingID, target.mediaGroupingID);
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
     * Works in both directions based on which mapping file is loaded:
     * - A→B sync: Returns target ID for source entity
     * - B→A sync (after loadMappingWithFallback): Returns target ID for source entity
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
     * Get bulk content mappings for performance optimization
     * Input: [102, 29, 440]
     * Output: [{source: 102, target: 404}, {source: 29, target: null}, {source: 440, target: 156}]
     */
    getBulkContentMappings(contentIds: number[]): BulkMappingResult[] {
        return contentIds.map(id => ({
            source: id,
            target: this.contentIds.get(id) || null
        }));
    }

    /**
     * Get bulk model mappings for performance optimization
     */
    getBulkModelMappings(modelIds: number[]): BulkMappingResult[] {
        return modelIds.map(id => ({
            source: id,
            target: this.modelIds.get(id) || null
        }));
    }

    /**
     * Get bulk container mappings for performance optimization
     */
    getBulkContainerMappings(containerIds: number[]): BulkMappingResult[] {
        return containerIds.map(id => ({
            source: id,
            target: this.containerIds.get(id) || null
        }));
    }

    /**
     * Get bulk asset mappings for performance optimization
     */
    getBulkAssetMappings(assetIds: number[]): BulkMappingResult[] {
        return assetIds.map(id => ({
            source: id,
            target: this.assetIds.get(id) || null
        }));
    }

    /**
     * Get bulk gallery mappings for performance optimization
     */
    getBulkGalleryMappings(galleryIds: number[]): BulkMappingResult[] {
        return galleryIds.map(id => ({
            source: id,
            target: this.galleryIds.get(id) || null
        }));
    }

    /**
     * Get bulk page mappings for performance optimization
     */
    getBulkPageMappings(pageIds: number[]): BulkMappingResult[] {
        return pageIds.map(id => ({
            source: id,
            target: this.pageIds.get(id) || null
        }));
    }

    /**
     * Get bulk template mappings for performance optimization
     */
    getBulkTemplateMappings(templateIds: number[]): BulkMappingResult[] {
        return templateIds.map(id => ({
            source: id,
            target: this.templateIds.get(id) || null
        }));
    }

    /**
     * Generic bulk mapping function for any entity type
     */
    getBulkMappings(type: CoreReferenceRecord['type'], sourceIds: number[]): BulkMappingResult[] {
        const mappingMap = this.getIdMapForType(type);
        return sourceIds.map(id => ({
            source: id,
            target: mappingMap.get(id) || null
        }));
    }

    /**
     * Get the appropriate ID mapping Map for a given entity type
     */
    private getIdMapForType(type: CoreReferenceRecord['type']): Map<number, number> {
        switch (type) {
            case 'model':
                return this.modelIds;
            case 'content':
                return this.contentIds;
            case 'container':
                return this.containerIds;
            case 'template':
                return this.templateIds;
            case 'page':
                return this.pageIds;
            case 'asset':
                return this.assetIds;
            case 'gallery':
                return this.galleryIds;
            default:
                return new Map(); // Return empty map for unknown types
        }
    }

    /**
     * Clear all mappings
     */
    clear(): void {
        this.records = [];
        // Clear forward ID mappings
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
     * Save mappings to disk using fileOperations
     */
    async saveAllMappings(): Promise<void> {
        try {
            const mappingData = {
                sourceGUID: this.sourceGUID,
                targetGUID: this.targetGUID,
                records: this.records,
                // ID mappings (A→B)
                modelIds: Array.from(this.modelIds.entries()),
                contentIds: Array.from(this.contentIds.entries()),
                containerIds: Array.from(this.containerIds.entries()),
                templateIds: Array.from(this.templateIds.entries()),
                pageIds: Array.from(this.pageIds.entries()),
                assetIds: Array.from(this.assetIds.entries()),
                galleryIds: Array.from(this.galleryIds.entries())
            };

            // fileOps.saveMappingFile now uses source-to-target naming and centralized storage
            this.fileOps.saveMappingFile(this.sourceGUID, this.targetGUID, mappingData);
        } catch (error) {
            console.warn('Warning: Could not save mappings to disk:', error);
        }
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
        // DEBUG: Add debugging for model mapping lookups
        if (type === 'model' && source?.id) {
            const matchingIndices = this.records.map((r, index) => {
                if (r.type === 'model' && r.source?.id === source.id) {
                    return index;
                }
                return -1;
            }).filter(index => index !== -1);
            
            if (matchingIndices.length > 1) {
                // console.warn(`[ReferenceMapper] Multiple model mappings found for source ID ${source.id}: indices ${matchingIndices.join(', ')}`);
                // Return the first match for now
                return matchingIndices[0];
            }
        }
        
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
     * Load existing mappings from disk (called by constructor)
     */
    private loadMappingsFromDisk(): void {
        try {
            const mappingData = this.fileOps.loadMappingFile(this.sourceGUID, this.targetGUID);
            
            if (mappingData) {
                // Load new format with records
                if (mappingData.records && Array.isArray(mappingData.records)) {
                    this.records = mappingData.records;
                }
                
                // Load ID mappings
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
            this.fileOps.clearMappingFile(this.sourceGUID, this.targetGUID);
            this.clear(); // Clear in-memory mappings too
        } catch (error) {
            console.warn('Warning: Could not clear mappings cache:', error);
        }
    }

    /**
     * Remove specific mapping by type and identifier
     */
    removeMapping(type: CoreReferenceRecord['type'], identifier: string | number): boolean {
        const indexToRemove = this.records.findIndex(record => {
            if (record.type !== type) return false;
            return this.matchesIdentifier(record.source, type, identifier);
        });

        if (indexToRemove !== -1) {
            const removedRecord = this.records[indexToRemove];
            this.records.splice(indexToRemove, 1);
            
            // Also remove from ID mappings if applicable
            if (removedRecord.source && removedRecord.target) {
                this.removeIdMapping(type, removedRecord.source, removedRecord.target);
            }
            
            return true; // Successfully removed
        }
        
        return false; // No mapping found to remove
    }

    /**
     * Remove ID mapping for specific entity
     */
    private removeIdMapping(type: CoreReferenceRecord['type'], source: any, target: any): void {
        const sourceId = this.extractId(source);
        
        if (sourceId) {
            switch (type) {
                case 'model':
                    this.modelIds.delete(sourceId);
                    break;
                case 'content':
                    this.contentIds.delete(sourceId);
                    break;
                case 'container':
                    this.containerIds.delete(sourceId);
                    break;
                case 'template':
                    this.templateIds.delete(sourceId);
                    break;
                case 'page':
                    this.pageIds.delete(sourceId);
                    break;
                case 'asset':
                    this.assetIds.delete(sourceId);
                    break;
                case 'gallery':
                    this.galleryIds.delete(sourceId);
                    break;
            }
        }
    }

    /**
     * Extract ID from entity based on type
     */
    private extractId(entity: any): number | null {
        if (!entity) return null;
        
        // Try common ID field patterns
        if (typeof entity.id === 'number') return entity.id;
        if (typeof entity.contentID === 'number') return entity.contentID;
        if (typeof entity.contentViewID === 'number') return entity.contentViewID;
        if (typeof entity.pageID === 'number') return entity.pageID;
        if (typeof entity.mediaID === 'number') return entity.mediaID;
        if (typeof entity.galleryID === 'number') return entity.galleryID;
        if (typeof entity.pageTemplateID === 'number') return entity.pageTemplateID;
        
        return null;
    }

    /**
     * Try to load mapping file, checking both direct and reverse directions
     * For B→A sync: First try B→A mapping file, then fallback to A→B file with swapped GUIDs
     */
    loadMappingWithFallback(sourceGUID: string, targetGUID: string): boolean {
        try {
            // Set the desired source and target GUIDs
            this.sourceGUID = sourceGUID;
            this.targetGUID = targetGUID;
            
            // First try to load direct mapping file (B→A)
            const directMappingData = this.fileOps.loadMappingFile(sourceGUID, targetGUID);
            if (directMappingData && directMappingData.sourceGUID === sourceGUID && directMappingData.targetGUID === targetGUID) {
                // Direct B→A mapping file exists, load it directly
                
                // Load new format with records
                if (directMappingData.records && Array.isArray(directMappingData.records)) {
                    this.records = directMappingData.records;
                }
                
                // Load ID mappings
                this.modelIds = new Map(directMappingData.modelIds || []);
                this.contentIds = new Map(directMappingData.contentIds || []);
                this.containerIds = new Map(directMappingData.containerIds || []);
                this.templateIds = new Map(directMappingData.templateIds || []);
                this.pageIds = new Map(directMappingData.pageIds || []);
                this.assetIds = new Map(directMappingData.assetIds || []);
                this.galleryIds = new Map(directMappingData.galleryIds || []);
                
                console.log(`[ReferenceMapper] Loaded direct mapping file for ${sourceGUID}→${targetGUID}`);
                return true;
            }
            
            // Try to load reverse mapping file (A→B) 
            const reverseMappingData = this.fileOps.loadMappingFile(targetGUID, sourceGUID);
            if (reverseMappingData && reverseMappingData.sourceGUID === targetGUID && reverseMappingData.targetGUID === sourceGUID) {
                // A→B mapping file exists, use it for B→A by flipping the mapping data
                
                // Flip the records: A→B becomes B→A
                this.records = (reverseMappingData.records || []).map((record: CoreReferenceRecord) => ({
                    type: record.type,
                    source: record.target,  // Flip: B is now source
                    target: record.source,  // Flip: A is now target  
                    sourceGUID: sourceGUID, // B is source
                    targetGUID: targetGUID  // A is target
                }));
                
                // Flip the ID mappings: A→B becomes B→A
                this.modelIds = new Map((reverseMappingData.modelIds || []).map(([k, v]: [number, number]) => [v, k]));
                this.contentIds = new Map((reverseMappingData.contentIds || []).map(([k, v]: [number, number]) => [v, k]));
                this.containerIds = new Map((reverseMappingData.containerIds || []).map(([k, v]: [number, number]) => [v, k]));
                this.templateIds = new Map((reverseMappingData.templateIds || []).map(([k, v]: [number, number]) => [v, k]));
                this.pageIds = new Map((reverseMappingData.pageIds || []).map(([k, v]: [number, number]) => [v, k]));
                this.assetIds = new Map((reverseMappingData.assetIds || []).map(([k, v]: [number, number]) => [v, k]));
                this.galleryIds = new Map((reverseMappingData.galleryIds || []).map(([k, v]: [number, number]) => [v, k]));
                
                console.log(`[ReferenceMapper] Loaded and flipped reverse mapping file for ${sourceGUID}→${targetGUID} (using ${targetGUID}→${sourceGUID} file)`);
                return true;
            }
            
            console.warn(`[ReferenceMapper] No mapping file found for ${sourceGUID}→${targetGUID} or ${targetGUID}→${sourceGUID}`);
            return false;
            
        } catch (error) {
            console.warn(`[ReferenceMapper] Error loading mapping with fallback: ${error}`);
            return false;
        }
    }


}

/**
 * Factory function to create a new ReferenceMapper instance
 * Gets configuration from state automatically
 */
export function createReferenceMapper(): ReferenceMapper {
    return new ReferenceMapper();
}

/**
 * Centralized reference mapper loader for pushers
 * Eliminates prop drilling by creating mapper at pusher level
 */
export async function loadReferenceMapper(): Promise<ReferenceMapper> {
    const referenceMapper = new ReferenceMapper();
    
    // ReferenceMapper automatically loads existing mappings in constructor
    // via loadMappingWithFallback() - supports both direct and reverse mapping files
    
    return referenceMapper;
} 