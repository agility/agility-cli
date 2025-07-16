import * as fs from 'fs';
import * as path from 'path';

/**
 * Entity change information
 */
export interface EntityChange {
  id: string | number;
  type: 'model' | 'container' | 'asset' | 'gallery' | 'template' | 'page' | 'content-item';
  action: 'created' | 'updated' | 'unchanged' | 'error';
  name?: string;
  referenceName?: string;
  hash?: {
    api: string;
    local: string;
    matches: boolean;
  };
  timestamp: string;
}

/**
 * Sync delta summary for writing to file
 */
export interface SyncDelta {
  guid: string;
  locale: string;
  channel: string;
  timestamp: string;
  totalChanges: number;
  changesByType: Record<string, number>;
  changesByAction: Record<string, number>;
  entities: EntityChange[];
}

/**
 * Tracks all entity changes during a download/sync operation
 * and writes a comprehensive delta report to sync-delta.json
 */
export class SyncDeltaTracker {
  private changes: EntityChange[] = [];
  private guid: string;
  private locale: string;
  private channel: string;
  private startTime: string;

  constructor(guid: string, locale: string, channel: string) {
    this.guid = guid;
    this.locale = locale;
    this.channel = channel;
    this.startTime = new Date().toISOString();
  }

  /**
   * Record an entity change
   */
  recordChange(change: EntityChange): void {
    this.changes.push({
      ...change,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Record multiple entity changes
   */
  recordChanges(changes: EntityChange[]): void {
    changes.forEach(change => this.recordChange(change));
  }

  /**
   * Get all recorded changes
   */
  getChanges(): EntityChange[] {
    return [...this.changes];
  }

  /**
   * Get changes by entity type
   */
  getChangesByType(type: EntityChange['type']): EntityChange[] {
    return this.changes.filter(change => change.type === type);
  }

  /**
   * Get changes by action
   */
  getChangesByAction(action: EntityChange['action']): EntityChange[] {
    return this.changes.filter(change => change.action === action);
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalChanges: number;
    changesByType: Record<string, number>;
    changesByAction: Record<string, number>;
    modifiedEntities: number;
  } {
    const changesByType: Record<string, number> = {};
    const changesByAction: Record<string, number> = {};

    this.changes.forEach(change => {
      changesByType[change.type] = (changesByType[change.type] || 0) + 1;
      changesByAction[change.action] = (changesByAction[change.action] || 0) + 1;
    });

    const modifiedEntities = this.changes.filter(c => 
      c.action === 'created' || c.action === 'updated'
    ).length;

    return {
      totalChanges: this.changes.length,
      changesByType,
      changesByAction,
      modifiedEntities
    };
  }

  /**
   * Write sync delta to JSON file in agility-files directory
   */
  async writeSyncDelta(rootPath: string = process.cwd()): Promise<string> {
    const summary = this.getSummary();
    
    // Filter out unchanged items - only include created, updated, and error items
    const changedEntities = this.changes.filter(change => 
      change.action === 'created' || change.action === 'updated' || change.action === 'error'
    );
    
    // Recalculate stats for changed items only
    const changesByType: Record<string, number> = {};
    const changesByAction: Record<string, number> = {};
    
    changedEntities.forEach(change => {
      changesByType[change.type] = (changesByType[change.type] || 0) + 1;
      changesByAction[change.action] = (changesByAction[change.action] || 0) + 1;
    });
    
    const syncDelta: SyncDelta = {
      guid: this.guid,
      locale: this.locale,
      channel: this.channel,
      timestamp: this.startTime,
      totalChanges: changedEntities.length,
      changesByType: changesByType,
      changesByAction: changesByAction,
      entities: changedEntities
    };

    // Fix double path issue - check if rootPath already ends with agility-files
    const agilityFilesDir = rootPath.endsWith('agility-files') 
      ? rootPath 
      : path.join(rootPath, 'agility-files');
    const filePath = path.join(agilityFilesDir, 'sync-delta.json');

    // Ensure agility-files directory exists
    if (!fs.existsSync(agilityFilesDir)) {
      fs.mkdirSync(agilityFilesDir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(syncDelta, null, 2));
    
    return filePath;
  }

  /**
   * Clear all recorded changes
   */
  clear(): void {
    this.changes = [];
  }

  /**
   * Get formatted summary for console output
   */
  getFormattedSummary(): string {
    const summary = this.getSummary();
    
    const lines = [
      '=== SYNC DELTA SUMMARY ===',
      `Total Changes: ${summary.totalChanges}`,
      `Modified Entities: ${summary.modifiedEntities}`,
      '',
      'Changes by Type:'
    ];

    Object.entries(summary.changesByType).forEach(([type, count]) => {
      lines.push(`  ${type}: ${count}`);
    });

    lines.push('', 'Changes by Action:');
    Object.entries(summary.changesByAction).forEach(([action, count]) => {
      lines.push(`  ${action}: ${count}`);
    });

    return lines.join('\n');
  }
} 

/**
 * Static utility methods for reading sync delta data
 */
export class SyncDeltaReader {
  /**
   * Load sync delta from file system
   */
  static loadSyncDelta(rootPath: string = process.cwd()): SyncDelta | null {
    try {
      const agilityFilesDir = rootPath.endsWith('agility-files') 
        ? rootPath 
        : path.join(rootPath, 'agility-files');
      const filePath = path.join(agilityFilesDir, 'sync-delta.json');
      
      if (!fs.existsSync(filePath)) {
        return null;
      }
      
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content) as SyncDelta;
    } catch (error) {
      console.warn('Warning: Could not load sync delta file:', error);
      return null;
    }
  }

  /**
   * Check if an entity is marked for update in sync delta
   */
  static isEntityInSyncDelta(
    entityType: string,
    entityId: string | number,
    referenceName?: string,
    rootPath: string = process.cwd()
  ): boolean {
    const syncDelta = this.loadSyncDelta(rootPath);
    if (!syncDelta) {
      return false;
    }

    return syncDelta.entities.some(entity => {
      // Match by type first
      if (entity.type !== entityType) {
        return false;
      }
      
      // Match by ID or referenceName
      const idMatches = entity.id.toString() === entityId.toString();
      const nameMatches = referenceName && entity.referenceName === referenceName;
      
      // Entity is in sync delta if it matches by ID or name AND has an action that requires updating
      return (idMatches || nameMatches) && (entity.action === 'updated' || entity.action === 'created');
    });
  }

  /**
   * Get sync delta entity by type and identifier
   */
  static getSyncDeltaEntity(
    entityType: string,
    entityId: string | number,
    referenceName?: string,
    rootPath: string = process.cwd()
  ): EntityChange | null {
    const syncDelta = this.loadSyncDelta(rootPath);
    if (!syncDelta) {
      return null;
    }

    return syncDelta.entities.find(entity => {
      if (entity.type !== entityType) {
        return false;
      }
      
      const idMatches = entity.id.toString() === entityId.toString();
      const nameMatches = referenceName && entity.referenceName === referenceName;
      
      return idMatches || nameMatches;
    }) || null;
  }
} 