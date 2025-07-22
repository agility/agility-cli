/**
 * ReferenceMapperV2 - Canonical Storage Implementation
 *
 * Features:
 * - Zero duplication: Each relationship stored once under lexicographically smaller GUID
 * - Multi-directional: Supports A→B, B→A, A→C, B→C, etc.
 * - Reversible: Smart lookup handles any sync direction
 * - Backward compatible: Same API as v1 ReferenceMapper
 */

import { getState } from '../../core/state';
import { ReferenceMapperV2FileOperations } from './reference-mapper-v2-file-operations';
import {
  EntityType,
  EntityReference,
  MappingEntry,
  MappingContext,
  MappingLookupResult,
  CoreReferenceResult,
  BulkMappingResult,
  ReferenceMapperV2Config,
  SyncHistoryEntry
} from '../../types/referenceMapperV2';

export class ReferenceMapperV2 {
  private fileOps: ReferenceMapperV2FileOperations;
  private context: MappingContext;

  // In-memory caches for performance
  private idMappingCache: Map<string, Map<number, number>> = new Map();

  constructor(config: ReferenceMapperV2Config = {}) {
    const state = getState();

    this.context = {
      sourceGuid: state.sourceGuid[0],
      targetGuid: state.targetGuid[0],
      locale: state.locale[0]
    };

    this.fileOps = new ReferenceMapperV2FileOperations(state.rootPath, config);
  }

  /**
   * Update current mapping context (for different sync directions)
   */
  updateContext(sourceGuid: string, targetGuid: string, locale?: string): void {
    this.context = { sourceGuid, targetGuid, locale };
    // Clear caches when context changes
    this.idMappingCache.clear();
  }

  /**
   * Get current mapping context
   */
  getCurrentContext(): MappingContext {
    return this.context;
  }

  // =============================================================================
  // CORE MAPPING OPERATIONS
  // =============================================================================

  /**
   * Add or update a mapping between two entities
   */
  addMapping(type: EntityType, source: any, target: any): void {
    const { sourceGuid, targetGuid, locale } = this.context;

    // Extract entity references
    const sourceRef: EntityReference = this.extractEntityReference(source, sourceGuid);
    const targetRef: EntityReference = this.extractEntityReference(target, targetGuid);

    // Determine canonical storage location
    const canonicalGuid = this.fileOps.getCanonicalGuid(sourceGuid, targetGuid);
    const relationshipGuid = this.fileOps.getRelationshipGuid(canonicalGuid, sourceGuid, targetGuid);

    // Load or create mapping file
    const mappingFile = this.fileOps.getOrCreateMappingFile(canonicalGuid, type, locale);

    // Ensure relationship section exists
    if (!mappingFile.mappings[relationshipGuid]) {
      mappingFile.mappings[relationshipGuid] = {};
    }

    // Generate compound key
    const compoundKey = this.fileOps.generateCompoundKey(sourceRef, targetRef);

    // Create or update mapping entry
    const existingEntry = mappingFile.mappings[relationshipGuid][compoundKey];
    const syncDirection = `${sourceGuid}→${targetGuid}`;

    const newHistoryEntry: SyncHistoryEntry = {
      direction: syncDirection,
      timestamp: new Date().toISOString(),
      syncType: existingEntry ? 'update' : 'create'
    };

    const mappingEntry: MappingEntry = {
      entityA: sourceRef,
      entityB: targetRef,
      lastSyncDirection: syncDirection,
      syncHistory: existingEntry ? [...existingEntry.syncHistory, newHistoryEntry] : [newHistoryEntry]
    };

    // Store mapping
    mappingFile.mappings[relationshipGuid][compoundKey] = mappingEntry;

    // Save to disk
    this.fileOps.saveMappingFile(canonicalGuid, type, mappingFile, locale);

    // Update in-memory cache
    this.updateIdMappingCache(type, sourceRef.id, targetRef.id);

    // console.log(`[ReferenceMapperV2] Added mapping: ${type} ${sourceRef.id} → ${targetRef.id} (${syncDirection})`);
  }

  /**
   * Get mapped target ID for a source entity ID
   */
  getMappedId(type: EntityType, sourceId: number): number | null {
    const { sourceGuid, targetGuid, locale } = this.context;

    // Check in-memory cache first
    const cacheKey = `${type}:${sourceGuid}→${targetGuid}`;
    const cachedMapping = this.idMappingCache.get(cacheKey);
    if (cachedMapping?.has(sourceId)) {
      return cachedMapping.get(sourceId)!;
    }

    // Perform lookup
    const lookupResult = this.findMapping(type, sourceGuid, sourceId, targetGuid);

    if (lookupResult) {
      // Cache the result
      this.updateIdMappingCache(type, sourceId, lookupResult.targetId);
      return lookupResult.targetId;
    }

    return null;
  }

  /**
   * Get mapped target ID for a source entity ID
   */
  getMappedEntityById(type: EntityType, sourceId: number) {
    const { sourceGuid, targetGuid, locale } = this.context;

    // Perform lookup
    return this.findMapping(type, sourceGuid, sourceId, targetGuid);

  }

  /**
   * Check if a mapping exists for the given entity
   */
  hasMapping(type: EntityType, identifier: string | number): boolean {
    if (typeof identifier === 'number') {
      return this.getMappedId(type, identifier) !== null;
    } else {
      // Handle string identifier (reference name, etc.)
      return this.getMapping(type, identifier) !== null;
    }
  }

  /**
   * Get target entity mapping (backward compatibility)
   */
  getMapping<T>(type: EntityType, identifier: string | number): T | null {
    if (typeof identifier === 'number') {
      // ID lookup
      const targetId = this.getMappedId(type, identifier);
      return targetId as unknown as T;
    } else {
      // Reference name lookup - need to search through mappings
      const lookupResult = this.findMappingByReferenceName(type, identifier);
      return lookupResult?.entry as unknown as T;
    }
  }

  /**
   * Get target entity mapping (backward compatibility)
   */
  getMappingEntity(type: EntityType, identifier: string | number): MappingLookupResult | null {
    if (typeof identifier === 'number') {
      // ID lookup
      return this.getMappedEntityById(type, identifier);

    } else {
      // Reference name lookup - need to search through mappings
      const lookupResult = this.findMappingByReferenceName(type, identifier);
      return lookupResult
    }
  }

  /**
   * Get mapping by custom key-value pair (backward compatibility)
   */
  getMappingByKey<T>(type: EntityType, key: string, value: any): CoreReferenceResult<T> | null {
    // Search through mappings for the key-value pair
    const result = this.findMappingByCustomKey(type, key, value);

    if (result) {
      return {
        source: result.entry.entityA as unknown as T,
        target: result.entry.entityB as unknown as T,
        sourceGUID: result.entry.entityA.guid,
        targetGUID: result.entry.entityB.guid
      };
    }

    return null;
  }

  /**
   * Save all mappings (no-op for v2 - mappings are saved immediately)
   */
  async saveAllMappings(): Promise<void> {
    // V2 saves mappings immediately, so this is a no-op for compatibility
    console.log('[ReferenceMapperV2] saveAllMappings() called - mappings already persisted');
  }

  // =============================================================================
  // BULK OPERATIONS (for performance)
  // =============================================================================

  /**
   * Get bulk content mappings
   */
  getBulkContentMappings(contentIds: number[]): BulkMappingResult[] {
    return contentIds.map(id => ({
      source: id,
      target: this.getMappedId('content', id)
    }));
  }

  /**
   * Get bulk model mappings
   */
  getBulkModelMappings(modelIds: number[]): BulkMappingResult[] {
    return modelIds.map(id => ({
      source: id,
      target: this.getMappedId('model', id)
    }));
  }

  /**
   * Get bulk mappings for any entity type
   */
  getBulkMappings(type: EntityType, sourceIds: number[]): BulkMappingResult[] {
    return sourceIds.map(id => ({
      source: id,
      target: this.getMappedId(type, id)
    }));
  }

  // =============================================================================
  // LEGACY COMPATIBILITY METHODS
  // =============================================================================

  /**
   * Legacy addRecord method (alias for addMapping)
   */
  addRecord(type: EntityType, source: any, target: any): void {
    this.addMapping(type, source, target);
  }

  /**
   * Legacy getRecordsByType method
   */
  getRecordsByType(type: EntityType): any[] {
    // This is expensive - load all mappings for the type
    const { sourceGuid, targetGuid, locale } = this.context;
    const canonicalGuid = this.fileOps.getCanonicalGuid(sourceGuid, targetGuid);
    const mappingFile = this.fileOps.loadMappingFile(canonicalGuid, type, locale);

    if (!mappingFile) {
      return [];
    }

    const results: any[] = [];
    const relationshipGuid = this.fileOps.getRelationshipGuid(canonicalGuid, sourceGuid, targetGuid);
    const relationships = mappingFile.mappings[relationshipGuid] || {};

    Object.values(relationships).forEach(entry => {
      results.push({
        source: entry.entityA,
        target: entry.entityB,
        sourceGUID: entry.entityA.guid,
        targetGUID: entry.entityB.guid
      });
    });

    return results;
  }

  /**
   * Clear all mappings
   */
  clear(): void {
    // For v2, we don't clear files immediately - this just clears caches
    this.idMappingCache.clear();
    this.fileOps.clearCache();
    console.log('[ReferenceMapperV2] Cleared caches');
  }

  // =============================================================================
  // PRIVATE HELPER METHODS
  // =============================================================================

  /**
   * Extract entity reference from entity object
   */
  private extractEntityReference(entity: any, guid: string): EntityReference {
    // Extract ID based on entity type
    let id: number;
    let referenceName: string | undefined;
    let modified: string | number | undefined;

    if (entity.id !== undefined) {
      id = entity.id;
      referenceName = entity.referenceName;
      modified = entity.lastModifiedDate || entity.modified;
    } else if (entity.contentID !== undefined) {
      id = entity.contentID;
      referenceName = entity.properties?.referenceName;
      modified = entity.properties?.modified || entity.properties?.versionID;
    } else if (entity.pageID !== undefined) {
      id = entity.pageID;
      referenceName = entity.name;
      modified = entity.properties?.modified || entity.properties?.versionID;
    } else if (entity.mediaID !== undefined) {
      id = entity.mediaID;
      referenceName = entity.fileName;
      modified = entity.lastModifiedDate;
    } else if (entity.contentViewID !== undefined) {
      id = entity.contentViewID;
      referenceName = entity.referenceName;
      modified = entity.lastModifiedDate;
    } else if (entity.pageTemplateID !== undefined) {
      id = entity.pageTemplateID;
      referenceName = entity.pageTemplateName;
      modified = entity.lastModifiedDate;
    } else if (entity.mediaGroupingID !== undefined) {
      id = entity.mediaGroupingID;
      referenceName = entity.name;
      modified = entity.modifiedOn;
    } else {
      throw new Error(`Cannot extract ID from entity: ${JSON.stringify(entity)}`);
    }

    return { guid, id, referenceName, modified };
  }

  /**
   * Find mapping using smart lookup algorithm
   */
  private findMapping(type: EntityType, sourceGuid: string, sourceId: number, targetGuid: string): MappingLookupResult | null {
    const locale = type === 'content' || type === 'page' ? this.context.locale : undefined;

    // Try both canonical locations
    const canonicalGuid = this.fileOps.getCanonicalGuid(sourceGuid, targetGuid);
    const relationshipGuid = this.fileOps.getRelationshipGuid(canonicalGuid, sourceGuid, targetGuid);

    const mappingFile = this.fileOps.loadMappingFile(canonicalGuid, type, locale);

    if (!mappingFile || !mappingFile.mappings[relationshipGuid]) {
      return null;
    }

    // Search through all mappings for one involving our source entity
    const relationships = mappingFile.mappings[relationshipGuid];

    for (const [compoundKey, entry] of Object.entries(relationships)) {
      const { entityA, entityB } = entry;

      // Check if this mapping involves our source entity
      if (entityA.guid === sourceGuid && entityA.id === sourceId) {
        return {
          entry,
          targetId: entityB.id,
          canonicalLocation: this.fileOps.getMappingFilePath(canonicalGuid, type, locale)
        };
      } else if (entityB.guid === sourceGuid && entityB.id === sourceId) {
        return {
          entry,
          targetId: entityA.id,
          canonicalLocation: this.fileOps.getMappingFilePath(canonicalGuid, type, locale)
        };
      }
    }

    return null;
  }

  /**
   * Find mapping by reference name
   */
  private findMappingByReferenceName(type: EntityType, referenceName: string): MappingLookupResult | null {
    const { sourceGuid, targetGuid, locale } = this.context;
    const canonicalGuid = this.fileOps.getCanonicalGuid(sourceGuid, targetGuid);
    const relationshipGuid = this.fileOps.getRelationshipGuid(canonicalGuid, sourceGuid, targetGuid);

    const mappingFile = this.fileOps.loadMappingFile(canonicalGuid, type, locale);

    if (!mappingFile || !mappingFile.mappings[relationshipGuid]) {
      return null;
    }

    const relationships = mappingFile.mappings[relationshipGuid];

    for (const [compoundKey, entry] of Object.entries(relationships)) {
      const { entityA, entityB } = entry;

      if ((entityA.referenceName === referenceName && entityA.guid === sourceGuid) ||
        (entityB.referenceName === referenceName && entityB.guid === sourceGuid)) {

        const targetId = entityA.guid === sourceGuid ? entityB.id : entityA.id;
        return {
          entry,
          targetId,
          canonicalLocation: this.fileOps.getMappingFilePath(canonicalGuid, type, locale)
        };
      }
    }

    return null;
  }

  /**
   * Find mapping by custom key-value pair
   */
  private findMappingByCustomKey(type: EntityType, key: string, value: any): MappingLookupResult | null {
    // For now, handle common key patterns
    if (key === 'referenceName') {
      return this.findMappingByReferenceName(type, value);
    }

    // For other keys, we'd need to extend this logic
    // console.warn(`[ReferenceMapperV2] Custom key lookup not implemented for key: ${key}`);
    return null;
  }

  /**
   * Update in-memory ID mapping cache
   */
  private updateIdMappingCache(type: EntityType, sourceId: number, targetId: number): void {
    const { sourceGuid, targetGuid } = this.context;
    const cacheKey = `${type}:${sourceGuid}→${targetGuid}`;

    if (!this.idMappingCache.has(cacheKey)) {
      this.idMappingCache.set(cacheKey, new Map());
    }

    this.idMappingCache.get(cacheKey)!.set(sourceId, targetId);
  }
}

/**
 * Factory function for creating ReferenceMapperV2 instance
 */
export function createReferenceMapperV2(config?: ReferenceMapperV2Config): ReferenceMapperV2 {
  return new ReferenceMapperV2(config);
}

/**
 * Load reference mapper - returns v2 by default
 */
export async function loadReferenceMapperV2(config?: ReferenceMapperV2Config): Promise<ReferenceMapperV2> {
  return new ReferenceMapperV2(config);
}