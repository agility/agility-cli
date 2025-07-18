import * as fs from 'fs';
import * as crypto from 'crypto';
import { EntityChange } from './sync-delta-tracker';

/**
 * Content Hash Comparer utility for optimizing download decisions
 * Instead of just checking if files exist, this compares content hashes
 * to determine if files actually need updating
 */
export class ContentHashComparer {
  /**
   * Calculate SHA-256 hash of content
   */
  static calculateHash(content: any): string {
    const jsonString = JSON.stringify(content);
    return crypto.createHash('sha256').update(jsonString).digest('hex');
  }

  /**
   * Calculate SHA-256 hash of file content
   */
  static calculateFileHash(filePath: string): string | null {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      return crypto.createHash('sha256').update(fileContent).digest('hex');
    } catch (error) {
      return null;
    }
  }

  /**
   * Create a sanitized copy of model content by removing dynamic fieldID values
   */
  /**
   * Recursively remove all dynamic properties from an object or array.
   * This ensures that fieldID and other dynamic values are stripped from all nested locations.
   */
  static sanitizeModelContent(modelContent: unknown): unknown {
    function deepStripDynamicFields(obj: unknown): unknown {
      if (Array.isArray(obj)) {
        return obj.map(deepStripDynamicFields);
      } else if (obj && typeof obj === 'object') {
        // Create a new object to avoid mutating the original
        const newObj: Record<string, unknown> = {};
        for (const key of Object.keys(obj)) {
          // Skip dynamic fields that vary between instances
          if (key === 'fieldID') continue; // Skip fieldID everywhere
          newObj[key] = deepStripDynamicFields((obj as Record<string, unknown>)[key]);
        }
        return newObj;
      }
      return obj;
    }
    return deepStripDynamicFields(modelContent);
  }

  /**
   * Calculate hash for model content, excluding dynamic fieldID values
   */
  static calculateModelHash(modelContent: any): string {
    const sanitized = this.sanitizeModelContent(modelContent);
    const jsonString = this.deterministicStringify(sanitized);
    return crypto.createHash('sha256').update(jsonString).digest('hex');
  }

  /**
   * Deterministic JSON stringify that sorts keys to ensure consistent ordering
   */
  static deterministicStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.deterministicStringify(item)).join(',') + ']';
    }
    
    const sortedKeys = Object.keys(obj).sort();
    const keyValuePairs = sortedKeys.map(key => 
      JSON.stringify(key) + ':' + this.deterministicStringify(obj[key])
    );
    
    return '{' + keyValuePairs.join(',') + '}';
  }

  /**
   * Calculate hash for model file content, excluding dynamic fieldID values
   */
  static calculateModelFileHash(filePath: string): string | null {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const parsedContent = JSON.parse(fileContent);
      const sanitized = this.sanitizeModelContent(parsedContent);
      const jsonString = this.deterministicStringify(sanitized);
      return crypto.createHash('sha256').update(jsonString).digest('hex');
    } catch (error) {
      return null;
    }
  }

  /**
   * Get model-specific hash comparison that excludes dynamic fieldID values
   */
  static getModelHashComparison(apiContent: any, localFilePath: string): {
    status: 'not-exists' | 'modified' | 'unchanged' | 'error';
    apiHash: string | null;
    localHash: string | null;
    shortHashes: { api: string; local: string; matches: boolean } | null;
  } {
    if (!fs.existsSync(localFilePath)) {
      const apiHash = this.calculateModelHash(apiContent);
      return {
        status: 'not-exists',
        apiHash,
        localHash: null,
        shortHashes: null
      };
    }

    try {
      const apiHash = this.calculateModelHash(apiContent);

      const localContent = fs.readFileSync(localFilePath, 'utf8');

    
      const localContentJson = JSON.parse(localContent);

      // console.log('localContentJson', JSON.stringify(localContentJson, null, 2))
      const localHash = this.calculateModelHash(localContentJson);
      
      if (!localHash) {
        return {
          status: 'error',
          apiHash,
          localHash: null,
          shortHashes: null
        };
      }

      const matches = apiHash === localHash;

if(!matches){
  const sanitizedApi = this.sanitizeModelContent(apiContent);
  const sanitizedLocal = this.sanitizeModelContent(localContentJson);
  // console.log('=== HASH MISMATCH DEBUG ===');
  // console.log('apiHash:', apiHash);
  // console.log('localHash:', localHash);
  
  const differences = this.findObjectDifferences(sanitizedApi, sanitizedLocal);
  if (differences.length > 0) {
    // console.log('Differences found:');
    // differences.forEach((diff, index) => {
    //   console.log(`  ${index + 1}. ${diff}`);
    // });
  } else {
    console.log('No differences found in sanitized content - JSON serialization order issue?');
    console.log('sanitizedApi keys:', Object.keys(sanitizedApi as any));
    console.log('sanitizedLocal keys:', Object.keys(sanitizedLocal as any));
  }
}
      
      const shortHashes = {
        api: apiHash.substring(0, 6),
        local: localHash.substring(0, 6),
        matches
      };

      return {
        status: matches ? 'unchanged' : 'modified',
        apiHash,
        localHash,
        shortHashes
      };
    } catch (error) {
      return {
        status: 'error',
        apiHash: null,
        localHash: null,
        shortHashes: null
      };
    }
  }

  /**
   * Compare content with file and determine if update is needed
   */
  static shouldUpdate(apiContent: any, localFilePath: string): boolean {
    if (!fs.existsSync(localFilePath)) {
      return true; // File doesn't exist, need to create it
    }

    try {
      const apiHash = this.calculateHash(apiContent);
      const localHash = this.calculateFileHash(localFilePath);
      
      if (!localHash) {
        return true; // Error reading local file, update to be safe
      }

      return apiHash !== localHash;
    } catch (error) {
      return true; // Error in comparison, update to be safe
    }
  }

  /**
   * Get content change status for logging purposes
   */
  static getChangeStatus(apiContent: any, localFilePath: string): 'not-exists' | 'modified' | 'unchanged' | 'error' {
    if (!fs.existsSync(localFilePath)) {
      return 'not-exists';
    }

    try {
      const apiHash = this.calculateHash(apiContent);
      const localHash = this.calculateFileHash(localFilePath);
      
      if (!localHash) {
        return 'error';
      }

      return apiHash === localHash ? 'unchanged' : 'modified';
    } catch (error) {
      return 'error';
    }
  }

  /**
   * Get detailed hash comparison for debugging/display purposes
   */
  static getHashComparison(apiContent: any, localFilePath: string): {
    status: 'not-exists' | 'modified' | 'unchanged' | 'error';
    apiHash: string | null;
    localHash: string | null;
    shortHashes: { api: string; local: string; matches: boolean } | null;
  } {
    if (!fs.existsSync(localFilePath)) {
      const apiHash = this.calculateHash(apiContent);
      return {
        status: 'not-exists',
        apiHash,
        localHash: null,
        shortHashes: null
      };
    }

    try {
      const apiHash = this.calculateHash(apiContent);
      const localHash = this.calculateFileHash(localFilePath);
      
      if (!localHash) {
        return {
          status: 'error',
          apiHash,
          localHash: null,
          shortHashes: null
        };
      }

      const matches = apiHash === localHash;
      const shortHashes = {
        api: apiHash.substring(0, 6),
        local: localHash.substring(0, 6),
        matches
      };

      return {
        status: matches ? 'unchanged' : 'modified',
        apiHash,
        localHash,
        shortHashes
      };
    } catch (error) {
      return {
        status: 'error',
        apiHash: null,
        localHash: null,
        shortHashes: null
      };
    }
  }

  /**
   * DEBUG: Get detailed comparison info to debug hash mismatches
   */
  static getDebugComparison(apiContent: any, localFilePath: string): {
    apiJson: string;
    localJson: string;
    apiHash: string;
    localHash: string;
    matches: boolean;
    fileExists: boolean;
  } {
    const apiJson = JSON.stringify(apiContent);
    const apiHash = crypto.createHash('sha256').update(apiJson).digest('hex');
    
    let localJson = '';
    let localHash = '';
    let fileExists = false;
    
    try {
      if (fs.existsSync(localFilePath)) {
        fileExists = true;
        localJson = fs.readFileSync(localFilePath, 'utf8');
        localHash = crypto.createHash('sha256').update(localJson).digest('hex');
      }
    } catch (error) {
      // Error reading file
    }
    
    return {
      apiJson,
      localJson,
      apiHash,
      localHash,
      matches: apiHash === localHash,
      fileExists
    };
  }

  /**
   * DEBUG: Compare two objects and identify specific differences
   */
  static findObjectDifferences(obj1: any, obj2: any, path: string = ''): string[] {
    const differences: string[] = [];
    
    const keys1 = Object.keys(obj1 || {});
    const keys2 = Object.keys(obj2 || {});
    const allKeys = Array.from(new Set([...keys1, ...keys2]));
    
    for (const key of allKeys) {
      const currentPath = path ? `${path}.${key}` : key;
      const val1 = obj1?.[key];
      const val2 = obj2?.[key];
      
      if (val1 === undefined && val2 !== undefined) {
        differences.push(`Missing in obj1: ${currentPath} = ${JSON.stringify(val2)}`);
      } else if (val2 === undefined && val1 !== undefined) {
        differences.push(`Missing in obj2: ${currentPath} = ${JSON.stringify(val1)}`);
      } else if (Array.isArray(val1) && Array.isArray(val2)) {
        if (val1.length !== val2.length) {
          differences.push(`Array length differs at ${currentPath}: ${val1.length} vs ${val2.length}`);
        } else {
          for (let i = 0; i < val1.length; i++) {
            if (typeof val1[i] === 'object' && typeof val2[i] === 'object') {
              differences.push(...this.findObjectDifferences(val1[i], val2[i], `${currentPath}[${i}]`));
            } else if (val1[i] !== val2[i]) {
              differences.push(`${currentPath}[${i}]: "${val1[i]}" vs "${val2[i]}"`);
            }
          }
        }
      } else if (typeof val1 === 'object' && typeof val2 === 'object' && val1 !== null && val2 !== null) {
        differences.push(...this.findObjectDifferences(val1, val2, currentPath));
      } else if (val1 !== val2) {
        differences.push(`${currentPath}: "${val1}" vs "${val2}"`);
      }
    }
    
    return differences;
  }

  /**
   * Generate EntityChange object for model content
   */
  static generateModelEntityChange(
    modelContent: any, 
    localFilePath: string, 
    entityType: EntityChange['type'] = 'model'
  ): EntityChange {
    const comparison = this.getModelHashComparison(modelContent, localFilePath);
    
    let action: EntityChange['action'];
    if (comparison.status === 'not-exists') {
      action = 'created';
    } else if (comparison.status === 'modified') {
      action = 'updated';
    } 

    return {
      id: modelContent.id || modelContent.contentID || 'unknown',
      type: entityType,
      action,
      name: modelContent.displayName || modelContent.name || undefined,
      referenceName: modelContent.referenceName || undefined,
      hash: comparison.shortHashes || undefined,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate EntityChange object for regular content
   */
  static generateEntityChange(
    apiContent: any, 
    localFilePath: string, 
    entityType: EntityChange['type'],
    idField: string = 'id'
  ): EntityChange {
    const comparison = this.getHashComparison(apiContent, localFilePath);
    
    let action: EntityChange['action'];
    if (comparison.status === 'not-exists') {
      action = 'created';
    } else if (comparison.status === 'modified') {
      action = 'updated';
    } 

    return {
      id: apiContent[idField] || 'unknown',
      type: entityType,
      action,
      name: apiContent.displayName || apiContent.name || apiContent.fileName || undefined,
      referenceName: apiContent.referenceName || undefined,
      hash: comparison.shortHashes || undefined,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate EntityChange for asset
   */
  static generateAssetEntityChange(assetContent: any, localFilePath: string): EntityChange {
    return this.generateEntityChange(assetContent, localFilePath, 'asset', 'mediaID');
  }

  /**
   * Generate EntityChange for container
   */
  static generateContainerEntityChange(containerContent: any, localFilePath: string): EntityChange {
    return this.generateEntityChange(containerContent, localFilePath, 'container', 'contentID');
  }

  /**
   * Generate EntityChange for gallery
   */
  static generateGalleryEntityChange(galleryContent: any, localFilePath: string): EntityChange {
    return this.generateEntityChange(galleryContent, localFilePath, 'gallery', 'galleryID');
  }

  /**
   * Generate EntityChange for template
   */
  static generateTemplateEntityChange(templateContent: any, localFilePath: string): EntityChange {
    return this.generateEntityChange(templateContent, localFilePath, 'template', 'pageTemplateID');
  }

  /**
   * Generate EntityChange for page
   */
  static generatePageEntityChange(pageContent: any, localFilePath: string): EntityChange {
    return this.generateEntityChange(pageContent, localFilePath, 'page', 'pageID');
  }

  /**
   * Generate EntityChange for content item
   */
  static generateContentItemEntityChange(contentContent: any, localFilePath: string): EntityChange {
    return this.generateEntityChange(contentContent, localFilePath, 'content-item', 'contentID');
  }
} 
