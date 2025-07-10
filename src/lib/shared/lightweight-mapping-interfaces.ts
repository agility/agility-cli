/**
 * Lightweight Mapping Interfaces - V2 Mapping System
 * 
 * Provides simplified mapping storage with 70-80% size reduction while maintaining
 * full API compatibility with the existing reference mapper.
 */

/**
 * Entity classification for storage organization
 */
export const ENTITY_CLASSIFICATION = {
  instanceLevel: ['models', 'assets', 'containers', 'templates', 'galleries'] as const,
  localeSpecific: ['content', 'pages'] as const
} as const;

export type InstanceLevelEntity = typeof ENTITY_CLASSIFICATION.instanceLevel[number];
export type LocaleSpecificEntity = typeof ENTITY_CLASSIFICATION.localeSpecific[number];
export type EntityType = InstanceLevelEntity | LocaleSpecificEntity;

/**
 * Core lightweight mapping record
 */
export interface LightweightMapping {
  sourceID: number | string;           // Primary identifier (ID, referenceName, URL)
  sourceVersionID?: number;            // Only for content/pages with versionID support
  sourceChangeDate: string;            // ISO 8601 date for change detection
  targetID: number | string;           // Primary identifier (ID, referenceName, URL)
  targetVersionID?: number;            // Only for content/pages with versionID support
  targetChangeDate: string;            // ISO 8601 date for change detection
}

/**
 * Version information extraction result
 */
export interface EntityVersionInfo {
  id: number | string;                 // Primary identifier
  versionID?: number;                  // Version ID if available (content/pages)
  changeDate: string;                  // Last modified date (ISO 8601)
  entityClass: 'instanceLevel' | 'localeSpecific';
}

/**
 * Change detection result
 */
export interface ChangeDetectionResult {
  needsUpdate: boolean;
  reason: 'versionID_changed' | 'date_changed' | 'no_mapping' | 'up_to_date';
  sourceVersion?: EntityVersionInfo;
  targetVersion?: EntityVersionInfo;
}

/**
 * Entity identifier patterns for mapping lookup
 */
export const ENTITY_IDENTIFIER_PATTERNS = {
  models: {
    primary: 'referenceName',           // String identifier
    secondary: 'id',                    // Numeric identifier
    changeDate: 'lastModifiedDate'     // No versionID available
  },
  containers: {
    primary: 'referenceName',           // String identifier  
    secondary: 'contentViewID',         // Numeric identifier
    changeDate: 'lastModifiedDate'     // No versionID available
  },
  content: {
    primary: 'contentID',               // Numeric identifier
    secondary: null,                    // No secondary identifier
    changeDate: 'properties.modified', // ISO 8601 date
    versionField: 'properties.versionID' // Version ID available
  },
  assets: {
    primary: 'originUrl',               // String identifier (URL)
    secondary: 'mediaID',               // Numeric identifier
    changeDate: 'dateModified'         // ISO 8601 date
  },
  templates: {
    primary: 'pageTemplateName',        // String identifier
    secondary: 'pageTemplateID',        // Numeric identifier
    changeDate: 'lastModifiedDate'     // No versionID available
  },
  pages: {
    primary: 'pageID',                  // Numeric identifier
    secondary: null,                    // No secondary identifier
    changeDate: 'properties.modified', // ISO 8601 date
    versionField: 'properties.versionID' // Version ID available
  },
  galleries: {
    primary: 'name',                    // String identifier
    secondary: 'mediaGroupingID',       // Numeric identifier
    changeDate: 'modifiedOn'           // ISO 8601 date
  }
} as const;

/**
 * Type for entity patterns with optional version field
 */
type EntityPattern = {
  primary: string;
  secondary: string | null;
  changeDate: string;
  versionField?: string;
};

/**
 * Mapping file paths for V2 system
 */
export interface MappingFilePaths {
  instanceLevel: {
    models: string;      // /{sourceGuid}-x-{targetGuid}/models.json
    assets: string;      // /{sourceGuid}-x-{targetGuid}/assets.json
    containers: string;  // /{sourceGuid}-x-{targetGuid}/containers.json
    templates: string;   // /{sourceGuid}-x-{targetGuid}/templates.json
    galleries: string;   // /{sourceGuid}-x-{targetGuid}/galleries.json
  };
  localeSpecific: {
    content: string;     // /{sourceGuid}-x-{targetGuid}/{locale}/content.json
    pages: string;       // /{sourceGuid}-x-{targetGuid}/{locale}/pages.json
  };
}

/**
 * V2 mapping file structure
 */
export interface V2MappingFile {
  version: 'v2';
  sourceGuid: string;
  targetGuid: string;
  locale?: string;                     // Only for locale-specific files
  entityType: EntityType;
  mappings: LightweightMapping[];
  metadata: {
    createdAt: string;                 // ISO 8601
    updatedAt: string;                 // ISO 8601
    entityCount: number;
    mappingCount: number;
  };
}

/**
 * Utility functions for entity version extraction
 */
export class EntityVersionExtractor {
  
  /**
   * Extract version information from entity based on type
   */
  static extractVersionInfo(entity: any, entityType: EntityType): EntityVersionInfo {
    const pattern = ENTITY_IDENTIFIER_PATTERNS[entityType] as EntityPattern;
    if (!pattern) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

    // Extract primary identifier
    const id = this.extractPrimaryId(entity, entityType);
    
    // Extract version ID if available
    let versionID: number | undefined;
    if (pattern.versionField) {
      // For nested properties like 'properties.versionID'
      if (pattern.versionField.includes('.')) {
        const parts = pattern.versionField.split('.');
        let value = entity;
        for (const part of parts) {
          value = value?.[part];
          if (value === undefined) break;
        }
        if (typeof value === 'number') {
          versionID = value;
        }
      } else {
        // For direct properties
        const value = entity[pattern.versionField];
        if (typeof value === 'number') {
          versionID = value;
        }
      }
    }

    // Extract change date
    const changeDate = this.extractChangeDate(entity, entityType);
    
    // Determine entity classification
    const entityClass = ENTITY_CLASSIFICATION.instanceLevel.includes(entityType as any) 
      ? 'instanceLevel' as const
      : 'localeSpecific' as const;

    return {
      id,
      versionID,
      changeDate,
      entityClass
    };
  }

  /**
   * Extract primary identifier from entity
   */
  static extractPrimaryId(entity: any, entityType: EntityType): number | string {
    const pattern = ENTITY_IDENTIFIER_PATTERNS[entityType] as EntityPattern;
    
    // Try primary identifier
    const primaryValue = entity[pattern.primary];
    if (primaryValue !== undefined && primaryValue !== null) {
      return primaryValue;
    }
    
    // Try secondary identifier if available
    if (pattern.secondary) {
      const secondaryValue = entity[pattern.secondary];
      if (secondaryValue !== undefined && secondaryValue !== null) {
        return secondaryValue;
      }
    }
    
    throw new Error(`Could not extract identifier from ${entityType} entity: ${JSON.stringify(entity)}`);
  }

  /**
   * Extract change date from entity
   */
  static extractChangeDate(entity: any, entityType: EntityType): string {
    const pattern = ENTITY_IDENTIFIER_PATTERNS[entityType] as EntityPattern;
    
    // Handle nested properties like 'properties.modified'
    if (pattern.changeDate.includes('.')) {
      const parts = pattern.changeDate.split('.');
      let value = entity;
      for (const part of parts) {
        value = value?.[part];
        if (value === undefined) break;
      }
      
      if (typeof value === 'string') {
        return value;
      }
    } else {
      // Handle direct properties
      const value = entity[pattern.changeDate];
      if (typeof value === 'string') {
        return value;
      }
    }
    
    // Fallback to current time if no change date found
    console.warn(`No change date found for ${entityType}, using current time`);
    return new Date().toISOString();
  }
}

/**
 * Change detection utilities
 */
export class ChangeDetector {
  
  /**
   * Determine if entity needs update based on version/date comparison
   */
  static needsUpdate(
    sourceEntity: any, 
    targetMapping: LightweightMapping | null, 
    entityType: EntityType
  ): ChangeDetectionResult {
    
    // Extract source version info
    const sourceVersion = EntityVersionExtractor.extractVersionInfo(sourceEntity, entityType);
    
    // No existing mapping - needs update
    if (!targetMapping) {
      return {
        needsUpdate: true,
        reason: 'no_mapping',
        sourceVersion
      };
    }
    
    // Create target version info from mapping
    const targetVersion: EntityVersionInfo = {
      id: targetMapping.targetID,
      versionID: targetMapping.targetVersionID,
      changeDate: targetMapping.targetChangeDate,
      entityClass: sourceVersion.entityClass
    };
    
    // Version ID comparison (for content/pages)
    if (sourceVersion.versionID !== undefined && targetVersion.versionID !== undefined) {
      if (sourceVersion.versionID !== targetVersion.versionID) {
        return {
          needsUpdate: true,
          reason: 'versionID_changed',
          sourceVersion,
          targetVersion
        };
      }
    }
    
    // Date comparison (for all entities)
    if (sourceVersion.changeDate !== targetVersion.changeDate) {
      // Parse dates for comparison
      const sourceDate = new Date(sourceVersion.changeDate);
      const targetDate = new Date(targetVersion.changeDate);
      
      if (sourceDate > targetDate) {
        return {
          needsUpdate: true,
          reason: 'date_changed',
          sourceVersion,
          targetVersion
        };
      }
    }
    
    // No update needed
    return {
      needsUpdate: false,
      reason: 'up_to_date',
      sourceVersion,
      targetVersion
    };
  }
}

/**
 * File path generation utilities
 */
export class MappingPathGenerator {
  
  /**
   * Generate mapping file paths for V2 system
   */
  static generatePaths(sourceGuid: string, targetGuid: string, locale?: string): MappingFilePaths {
    const baseDir = `agility-files/mappings/v2/${sourceGuid}-x-${targetGuid}`;
    
    return {
      instanceLevel: {
        models: `${baseDir}/models.json`,
        assets: `${baseDir}/assets.json`,
        containers: `${baseDir}/containers.json`,
        templates: `${baseDir}/templates.json`,
        galleries: `${baseDir}/galleries.json`
      },
      localeSpecific: {
        content: `${baseDir}/${locale}/content.json`,
        pages: `${baseDir}/${locale}/pages.json`
      }
    };
  }
  
  /**
   * Get file path for specific entity type
   */
  static getEntityFilePath(
    entityType: EntityType, 
    sourceGuid: string, 
    targetGuid: string, 
    locale?: string
  ): string {
    const paths = this.generatePaths(sourceGuid, targetGuid, locale);
    
    if (ENTITY_CLASSIFICATION.instanceLevel.includes(entityType as any)) {
      return paths.instanceLevel[entityType as InstanceLevelEntity];
    } else {
      if (!locale) {
        throw new Error(`Locale required for locale-specific entity type: ${entityType}`);
      }
      return paths.localeSpecific[entityType as LocaleSpecificEntity];
    }
  }
  
  /**
   * Check if entity type is locale-specific
   */
  static isLocaleSpecific(entityType: EntityType): boolean {
    return ENTITY_CLASSIFICATION.localeSpecific.includes(entityType as any);
  }
} 