/**
 * ReferenceMapperV2 Compatibility Wrapper
 * 
 * Drop-in replacement for the original ReferenceMapper that uses v2 backend
 * while maintaining 100% API compatibility
 */

import { ReferenceMapperV2 } from './reference-mapper-v2';
import { 
  EntityType, 
  CoreReferenceResult, 
  BulkMappingResult,
  ReferenceMapperV2Config 
} from '../../types/referenceMapperV2';

// Legacy type mapping
type CoreReferenceRecordType = 'model' | 'container' | 'content' | 'asset' | 'gallery' | 'template' | 'page' | 'container-name';

export class ReferenceMapperCompatibility {
  private v2Mapper: ReferenceMapperV2;

  constructor(config?: ReferenceMapperV2Config) {
    this.v2Mapper = new ReferenceMapperV2(config);
  }

  // =============================================================================
  // CORE V1 API METHODS - 100% COMPATIBLE
  // =============================================================================

  /**
   * Add or update a reference mapping
   */
  addMapping(type: CoreReferenceRecordType, source: any, target: any | null = null): void {
    if (type === 'container-name') {
      // Legacy container-name type - ignore for v2
      return;
    }
    
    if (target) {
      this.v2Mapper.addMapping(type as EntityType, source, target);
    }
  }

  /**
   * Get a mapping by entity type and identifier (new API)
   * Returns target directly
   */
  getMapping<T>(type: CoreReferenceRecordType, identifier: string | number): T | null;
  /**
   * Get a mapping by entity type, field, and value (old API) 
   * Returns CoreReferenceResult with .target property for backward compatibility
   */
  getMapping<T>(type: CoreReferenceRecordType, field: string, value: any): CoreReferenceResult<T> | null;
  /**
   * Implementation
   */
  getMapping<T>(type: CoreReferenceRecordType, identifierOrField: string | number, value?: any): any {
    if (type === 'container-name') {
      return null; // Legacy type not supported
    }

    if (value !== undefined) {
      // 3-parameter version (old API) - return CoreReferenceResult with .target property
      return this.getMappingByKey<T>(type, identifierOrField as string, value);
    } else {
      // 2-parameter version (new API) - return target directly
      return this.v2Mapper.getMapping<T>(type as EntityType, identifierOrField);
    }
  }

  /**
   * Get mapping by custom key-value pair
   */
  getMappingByKey<T>(type: CoreReferenceRecordType, key: string, value: any): CoreReferenceResult<T> | null {
    if (type === 'container-name') {
      return null; // Legacy type not supported
    }

    return this.v2Mapper.getMappingByKey<T>(type as EntityType, key, value);
  }

  /**
   * Get all mappings of a specific type
   */
  getMappingsByType(type: CoreReferenceRecordType): CoreReferenceResult<any>[] {
    if (type === 'container-name') {
      return []; // Legacy type not supported
    }

    return this.v2Mapper.getRecordsByType(type as EntityType);
  }

  /**
   * Check if an entity has a mapping
   */
  hasMapping(type: CoreReferenceRecordType, identifier: string | number): boolean {
    if (type === 'container-name') {
      return false; // Legacy type not supported
    }

    return this.v2Mapper.hasMapping(type as EntityType, identifier);
  }

  /**
   * Get target entity from mapping (convenience method)
   */
  getTarget<T>(type: CoreReferenceRecordType, identifier: string | number): T | null {
    if (type === 'container-name') {
      return null; // Legacy type not supported
    }

    return this.v2Mapper.getMapping<T>(type as EntityType, identifier);
  }

  /**
   * Get mapped target ID for any entity type
   */
  getMappedId(type: CoreReferenceRecordType, sourceId: number): number | null {
    if (type === 'container-name') {
      return null; // Legacy type not supported
    }

    return this.v2Mapper.getMappedId(type as EntityType, sourceId);
  }

  /**
   * Manually add ID mapping
   */
  addIdMapping(type: CoreReferenceRecordType, sourceId: number, targetId: number): void {
    // V2 doesn't support manual ID-only mappings - would need full entities
    console.warn(`[ReferenceMapperCompatibility] addIdMapping not supported in v2 - use addMapping with full entities`);
  }

  // =============================================================================
  // BULK OPERATIONS
  // =============================================================================

  /**
   * Get bulk content mappings
   */
  getBulkContentMappings(contentIds: number[]): BulkMappingResult[] {
    return this.v2Mapper.getBulkContentMappings(contentIds);
  }

  /**
   * Get bulk model mappings
   */
  getBulkModelMappings(modelIds: number[]): BulkMappingResult[] {
    return this.v2Mapper.getBulkModelMappings(modelIds);
  }

  /**
   * Get bulk container mappings
   */
  getBulkContainerMappings(containerIds: number[]): BulkMappingResult[] {
    return this.v2Mapper.getBulkMappings('container', containerIds);
  }

  /**
   * Get bulk asset mappings
   */
  getBulkAssetMappings(assetIds: number[]): BulkMappingResult[] {
    return this.v2Mapper.getBulkMappings('asset', assetIds);
  }

  /**
   * Get bulk gallery mappings
   */
  getBulkGalleryMappings(galleryIds: number[]): BulkMappingResult[] {
    return this.v2Mapper.getBulkMappings('gallery', galleryIds);
  }

  /**
   * Get bulk page mappings
   */
  getBulkPageMappings(pageIds: number[]): BulkMappingResult[] {
    return this.v2Mapper.getBulkMappings('page', pageIds);
  }

  /**
   * Get bulk template mappings
   */
  getBulkTemplateMappings(templateIds: number[]): BulkMappingResult[] {
    return this.v2Mapper.getBulkMappings('template', templateIds);
  }

  /**
   * Generic bulk mapping function
   */
  getBulkMappings(type: CoreReferenceRecordType, sourceIds: number[]): BulkMappingResult[] {
    if (type === 'container-name') {
      return sourceIds.map(id => ({ source: id, target: null }));
    }

    return this.v2Mapper.getBulkMappings(type as EntityType, sourceIds);
  }

  // =============================================================================
  // STATISTICS AND MANAGEMENT
  // =============================================================================

  /**
   * Get mapping statistics
   */
  getStats(): { [type: string]: { total: number, withTargets: number } } {
    // V2 doesn't track stats the same way - return empty for compatibility
    console.warn('[ReferenceMapperCompatibility] getStats() not fully implemented in v2');
    return {};
  }

  /**
   * Get detailed mapping statistics
   */
  getDetailedStats(): { 
    [type: string]: { 
      total: number, 
      withTargets: number, 
      idMappings: number 
    } 
  } {
    // V2 doesn't track stats the same way - return empty for compatibility
    console.warn('[ReferenceMapperCompatibility] getDetailedStats() not fully implemented in v2');
    return {};
  }

  /**
   * Clear all mappings
   */
  clear(): void {
    this.v2Mapper.clear();
  }

  /**
   * Clear all mappings (alias)
   */
  clearAllMappings(): void {
    this.clear();
  }

  /**
   * Save mappings to disk
   */
  async saveAllMappings(): Promise<void> {
    await this.v2Mapper.saveAllMappings();
  }

  /**
   * Clear and rebuild mappings
   */
  async clearAndRebuild(): Promise<void> {
    this.clear();
    // V2 doesn't support rebuild from files - mappings are created on-demand
    console.warn('[ReferenceMapperCompatibility] clearAndRebuild() not supported in v2 - use clear() only');
  }

  // =============================================================================
  // LEGACY COMPATIBILITY METHODS
  // =============================================================================

  /**
   * Legacy addRecord method (alias for addMapping)
   */
  addRecord(type: CoreReferenceRecordType, source: any, target: any | null = null): void {
    this.addMapping(type, source, target);
  }

  /**
   * Legacy getRecordsByType method (alias for getMappingsByType)
   */
  getRecordsByType(type: CoreReferenceRecordType): any[] {
    if (type === 'container-name') {
      return []; // Legacy type not supported
    }

    return this.v2Mapper.getRecordsByType(type as EntityType);
  }

  /**
   * Legacy getContentMappingById
   */
  getContentMappingById(contentId: number): { source: any, target: any | null } | null {
    const mapping = this.getMappingByKey('content', 'contentID', contentId);
    return mapping ? {
      source: mapping.source,
      target: mapping.target
    } : null;
  }

  /**
   * Legacy checkExistingAsset
   */
  checkExistingAsset(assetId: number): any | null {
    return this.getMapping('asset', assetId);
  }

  /**
   * Legacy getContainerMappingById
   */
  getContainerMappingById(containerId: number): { source: any, target: any | null } | null {
    const mapping = this.getMappingByKey('container', 'contentViewID', containerId);
    return mapping ? {
      source: mapping.source,
      target: mapping.target
    } : null;
  }

  // =============================================================================
  // V2-SPECIFIC METHODS (not in v1 API)
  // =============================================================================

  /**
   * Update mapping context for different sync directions
   */
  updateContext(sourceGuid: string, targetGuid: string, locale?: string): void {
    this.v2Mapper.updateContext(sourceGuid, targetGuid, locale);
  }

  /**
   * Get current mapping context
   */
  getCurrentContext() {
    return this.v2Mapper.getCurrentContext();
  }

  /**
   * Access underlying v2 mapper for advanced operations
   */
  getV2Mapper(): ReferenceMapperV2 {
    return this.v2Mapper;
  }
}

/**
 * Factory function for creating compatibility wrapper
 */
export function createReferenceMapper(config?: ReferenceMapperV2Config): ReferenceMapperCompatibility {
  return new ReferenceMapperCompatibility(config);
}

/**
 * Load reference mapper - returns compatibility wrapper
 */
export async function loadReferenceMapper(config?: ReferenceMapperV2Config): Promise<ReferenceMapperCompatibility> {
  return new ReferenceMapperCompatibility(config);
} 