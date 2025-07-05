import * as fs from 'fs';
import * as crypto from 'crypto';

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
  static sanitizeModelContent(modelContent: any): any {
    if (!modelContent || typeof modelContent !== 'object') {
      return modelContent;
    }

    // Deep clone the content to avoid modifying the original
    const sanitized = JSON.parse(JSON.stringify(modelContent));

    // Remove fieldID from all fields if they exist
    if (sanitized.fields && Array.isArray(sanitized.fields)) {
      sanitized.fields.forEach((field: any) => {
        if (field && typeof field === 'object' && field.fieldID) {
          delete field.fieldID;
        }
      });
    }

    return sanitized;
  }

  /**
   * Calculate hash for model content, excluding dynamic fieldID values
   */
  static calculateModelHash(modelContent: any): string {
    const sanitized = this.sanitizeModelContent(modelContent);
    const jsonString = JSON.stringify(sanitized);
    return crypto.createHash('sha256').update(jsonString).digest('hex');
  }

  /**
   * Calculate hash for model file content, excluding dynamic fieldID values
   */
  static calculateModelFileHash(filePath: string): string | null {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const parsedContent = JSON.parse(fileContent);
      const sanitized = this.sanitizeModelContent(parsedContent);
      const jsonString = JSON.stringify(sanitized);
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
      const localHash = this.calculateModelFileHash(localFilePath);
      
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
} 