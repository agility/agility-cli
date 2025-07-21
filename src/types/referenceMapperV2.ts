/**
 * ReferenceMapperV2 TypeScript Interfaces
 * Canonical storage approach - each mapping stored once under lexicographically smaller GUID
 */

export type EntityType = 'model' | 'container' | 'content' | 'asset' | 'gallery' | 'template' | 'page';

export interface EntityReference {
  guid: string;
  id: number;
  referenceName?: string;
  modified?: string | number; // ISO date string or versionID
}

export interface MappingEntry {
  entityA: EntityReference;
  entityB: EntityReference;
  lastSyncDirection: string;  // "guidA→guidB"
  syncHistory: SyncHistoryEntry[];
}

export interface SyncHistoryEntry {
  direction: string;       // "guidA→guidB" 
  timestamp: string;       // ISO date string
  syncType?: string;       // "create", "update", "overwrite"
}

export interface EntityMappingFile {
  metadata: {
    canonicalGuid: string;   // The GUID this file belongs to (lexicographically smaller)
    lastUpdated: string;     // ISO date
    version: string;         // "2.0"
    entityType: EntityType;  // Type of entities in this file
  };
  mappings: {
    [relationshipGuid: string]: {  // Other GUID in the relationship
      [compoundKey: string]: MappingEntry;  // "sourceId-targetId" or unique identifier
    };
  };
}

export interface MappingLookupResult {
  entry: MappingEntry;
  targetId: number;
  canonicalLocation: string;  // File path where mapping is stored
}

export interface MappingContext {
  sourceGuid: string;
  targetGuid: string;
  locale?: string;
}

// Backward compatibility interfaces
export interface CoreReferenceResult<T> {
  source: T;
  target: T | null;
  sourceGUID: string;
  targetGUID: string;
}

export interface BulkMappingResult {
  source: number;
  target: number | null;
}

// Configuration interface
export interface ReferenceMapperV2Config {
  enableLegacyMode?: boolean;    // Use v1 format for compatibility
  autoMigrate?: boolean;         // Automatically migrate v1 to v2
  enableBackupOnWrite?: boolean; // Create backups before writing
  cacheSize?: number;           // LRU cache size for mapping files
} 