/**
 * ReferenceMapperV2 File Operations
 * Handles canonical storage with lexicographic GUID sorting
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  EntityType, 
  EntityMappingFile, 
  MappingEntry, 
  ReferenceMapperV2Config,
  MappingContext 
} from '../../types/referenceMapperV2';

export class ReferenceMapperV2FileOperations {
  private rootPath: string;
  private config: ReferenceMapperV2Config;
  private fileCache: Map<string, EntityMappingFile> = new Map();

  constructor(rootPath: string = 'agility-files', config: ReferenceMapperV2Config = {}) {
    this.rootPath = rootPath;
    this.config = {
      enableLegacyMode: false,
      autoMigrate: true,
      enableBackupOnWrite: true,
      cacheSize: 50,
      ...config
    };
  }

  /**
   * Get canonical GUID (lexicographically smaller) for storing mappings
   */
  getCanonicalGuid(guidA: string, guidB: string): string {
    return [guidA, guidB].sort()[0];
  }

  /**
   * Get relationship GUID (the other GUID in the pair)
   */
  getRelationshipGuid(canonicalGuid: string, guidA: string, guidB: string): string {
    return canonicalGuid === guidA ? guidB : guidA;
  }

  /**
   * Generate compound key for mapping entry
   */
  generateCompoundKey(entityA: { id: number }, entityB: { id: number }): string {
    // Use consistent ordering: smaller ID first
    const ids = [entityA.id, entityB.id].sort((a, b) => a - b);
    return `${ids[0]}-${ids[1]}`;
  }

  /**
   * Get file path for canonical mapping storage
   */
  getMappingFilePath(canonicalGuid: string, entityType: EntityType, locale?: string): string {
    const basePath = path.join(this.rootPath, 'mappings', canonicalGuid);
    
    if (entityType === 'content' || entityType === 'page') {
      if (!locale) {
        throw new Error(`Locale required for ${entityType} mappings`);
      }
      const entityDir = entityType === 'content' ? 'item' : 'page';
      return path.join(basePath, locale, entityDir, 'mappings.json');
    } else {
      // Global entities: models, containers, assets, galleries, templates
      return path.join(basePath, entityType + 's', 'mappings.json');
    }
  }

  /**
   * Load mapping file from disk with caching
   */
  loadMappingFile(canonicalGuid: string, entityType: EntityType, locale?: string): EntityMappingFile | null {
    const filePath = this.getMappingFilePath(canonicalGuid, entityType, locale);
    const cacheKey = `${canonicalGuid}:${entityType}:${locale || 'global'}`;

    // Check cache first
    if (this.fileCache.has(cacheKey)) {
      return this.fileCache.get(cacheKey)!;
    }

    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const mappingFile: EntityMappingFile = JSON.parse(content);

      // Validate file structure
      if (!mappingFile.metadata || !mappingFile.mappings) {
        console.warn(`[ReferenceMapperV2] Invalid mapping file structure: ${filePath}`);
        return null;
      }

      // Cache the loaded file
      this.cacheFile(cacheKey, mappingFile);
      
      return mappingFile;
    } catch (error: any) {
      console.error(`[ReferenceMapperV2] Error loading mapping file ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * Save mapping file to disk with atomic writes
   */
  saveMappingFile(
    canonicalGuid: string, 
    entityType: EntityType, 
    mappingFile: EntityMappingFile,
    locale?: string
  ): void {
    const filePath = this.getMappingFilePath(canonicalGuid, entityType, locale);
    const cacheKey = `${canonicalGuid}:${entityType}:${locale || 'global'}`;

    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Create backup if enabled
      if (this.config.enableBackupOnWrite && fs.existsSync(filePath)) {
        const backupPath = filePath + '.backup';
        fs.copyFileSync(filePath, backupPath);
      }

      // Update metadata
      mappingFile.metadata.lastUpdated = new Date().toISOString();
      mappingFile.metadata.canonicalGuid = canonicalGuid;
      mappingFile.metadata.entityType = entityType;
      mappingFile.metadata.version = '2.0';

      // Atomic write: write to temp file then rename
      const tempPath = filePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(mappingFile, null, 2), 'utf8');
      fs.renameSync(tempPath, filePath);

      // Update cache
      this.cacheFile(cacheKey, mappingFile);

      console.log(`[ReferenceMapperV2] Saved mapping file: ${filePath}`);
    } catch (error: any) {
      console.error(`[ReferenceMapperV2] Error saving mapping file ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * Create new empty mapping file
   */
  createEmptyMappingFile(canonicalGuid: string, entityType: EntityType): EntityMappingFile {
    return {
      metadata: {
        canonicalGuid,
        lastUpdated: new Date().toISOString(),
        version: '2.0',
        entityType
      },
      mappings: {}
    };
  }

  /**
   * Get or create mapping file
   */
  getOrCreateMappingFile(canonicalGuid: string, entityType: EntityType, locale?: string): EntityMappingFile {
    let mappingFile = this.loadMappingFile(canonicalGuid, entityType, locale);
    
    if (!mappingFile) {
      mappingFile = this.createEmptyMappingFile(canonicalGuid, entityType);
    }

    return mappingFile;
  }

  /**
   * Cache management
   */
  private cacheFile(cacheKey: string, mappingFile: EntityMappingFile): void {
    // Implement LRU cache eviction if needed
    if (this.fileCache.size >= (this.config.cacheSize || 50)) {
      const firstKey = this.fileCache.keys().next().value;
      this.fileCache.delete(firstKey);
    }

    this.fileCache.set(cacheKey, mappingFile);
  }

  /**
   * Clear cache for specific file or all files
   */
  clearCache(cacheKey?: string): void {
    if (cacheKey) {
      this.fileCache.delete(cacheKey);
    } else {
      this.fileCache.clear();
    }
  }

  /**
   * Check if mapping file exists
   */
  mappingFileExists(canonicalGuid: string, entityType: EntityType, locale?: string): boolean {
    const filePath = this.getMappingFilePath(canonicalGuid, entityType, locale);
    return fs.existsSync(filePath);
  }

  /**
   * Delete mapping file
   */
  deleteMappingFile(canonicalGuid: string, entityType: EntityType, locale?: string): void {
    const filePath = this.getMappingFilePath(canonicalGuid, entityType, locale);
    const cacheKey = `${canonicalGuid}:${entityType}:${locale || 'global'}`;

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[ReferenceMapperV2] Deleted mapping file: ${filePath}`);
      }

      this.fileCache.delete(cacheKey);
    } catch (error: any) {
      console.error(`[ReferenceMapperV2] Error deleting mapping file ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * List all mapping files for a canonical GUID
   */
  listMappingFiles(canonicalGuid: string): string[] {
    const basePath = path.join(this.rootPath, 'mappings', canonicalGuid);
    
    if (!fs.existsSync(basePath)) {
      return [];
    }

    const files: string[] = [];
    
    // Walk directory tree and collect mapping.json files
    const walkDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name === 'mappings.json') {
          files.push(path.relative(this.rootPath, fullPath));
        }
      }
    };

    walkDir(basePath);
    return files;
  }
} 