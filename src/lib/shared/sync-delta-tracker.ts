import * as fs from "fs";
import * as path from "path";

export type EntityType = "model" | "container" | "asset" | "gallery" | "template" | "page" | "content-item";
export type EntityChangeAction = "created" | "updated";

const ENTITY_TYPES: EntityType[] = ["model", "container", "asset", "gallery", "template", "page", "content-item"];
const ENTITY_ACTIONS: EntityChangeAction[] = ["created", "updated"];

export interface EntityPayload {
  guid: string;
  locale?: string;
  channel?: string;
  referenceName?: string;
  id?: string | number;
}

/**
 * Entity change information
 */
export interface EntityChange {
  id: string | number;
  type: EntityType;
  action: EntityChangeAction;
  timestamp?: string;
  locale?: string;
  channel?: string;
  hash?: {
    api: string;
    local: string;
    matches: boolean;
  };
  name?: string;
  referenceName?: string;
}

type EntityChangeStore = Record<EntityType, Record<EntityChangeAction, Record<string, EntityChange>>>;

/**
 * Sync delta summary for writing to file
 */
export interface SyncDeltaSummary {
  guid: string;
  timestamp: string;
  totalChanges: number;
  entities: EntityChangeStore;
}

/**
 * Generates an entity key for the map
 */
export function generateEntityKey(entityPayload: EntityPayload): string {
  const { guid, locale, channel, referenceName, id } = entityPayload;
  const parts: (string | number | undefined)[] = [guid, locale, channel, referenceName, id];

  return parts.filter((part) => part !== undefined && part !== null && part !== "").join(":");
}

/**
 * Tracks all entity changes during a download/sync operation
 * and writes a comprehensive delta report to sync-delta.json
 */
export class SyncDelta {
  private _changes: EntityChangeStore;
  private _guid: string;
  private _startTime: string;

  constructor(guid: string) {
    this._guid = guid;
    this._startTime = new Date().toISOString();

    // Create action maps
    this._changes = {} as EntityChangeStore;

    for (const action of ENTITY_ACTIONS) {
      this._changes[action] = {} as Record<EntityType, Record<string, EntityChange>>;
      for (const type of ENTITY_TYPES) {
        this._changes[action][type] = {};
      }
    }
  }

  /**
   * Record an entity change
   */
  recordChange(change: EntityChange): void {
    const { locale, channel, type, referenceName, id, action } = change;
    const entityKey = generateEntityKey({ guid: this._guid, locale, channel, referenceName, id });
    change.timestamp = new Date().toISOString();
    this._changes[type][action][entityKey] = change;
  }

  /**
   * Record multiple entity changes
   */
  recordChanges(changes: EntityChange[]): void {
    changes.forEach((change) => this.recordChange(change));
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
    
    let totalChanges = 0;
    let modifiedEntities = 0;

    // Count directly from the nested structure (now type -> action -> key)
    for (const type of ENTITY_TYPES) {
      let typeCount = 0;
      
      for (const action of ENTITY_ACTIONS) {
        const actionChanges = this._changes[type][action];
        const actionCount = Object.keys(actionChanges).length;
        
        // Add to action totals
        changesByAction[action] = (changesByAction[action] || 0) + actionCount;
        
        // Add to type totals
        typeCount += actionCount;
        
        // Count by action type
        if (action === 'created' || action === 'updated') {
          modifiedEntities += actionCount;
        }
      }
      
      changesByType[type] = typeCount;
      totalChanges += typeCount;
    }

    return {
      totalChanges,
      changesByType,
      changesByAction,
      modifiedEntities,
    };
  }

  /**
   * Write sync delta to JSON file in agility-files directory
   */
  async writeSyncDelta(rootPath: string = process.cwd()): Promise<string> {
    const changedEntities = structuredClone(this._changes);

    let totalChanges = 0;

    ENTITY_TYPES.forEach(entityType => {
      const createdCount = Object.keys(changedEntities[entityType]?.['created'] || {}).length;
      const updatedCount = Object.keys(changedEntities[entityType]?.['updated'] || {}).length;

      totalChanges = totalChanges + createdCount + updatedCount;
    })

    const syncDelta: SyncDeltaSummary = {
      guid: this._guid,
      timestamp: this._startTime,
      totalChanges: totalChanges,
      entities: changedEntities,
    };

    // Fix double path issue - check if rootPath already ends with agility-files
    const agilityFilesDir = rootPath.endsWith("agility-files") ? rootPath : path.join(rootPath, "agility-files");
    const filePath = path.join(agilityFilesDir, "sync-delta.json");

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
    // Reset the changes store to empty
    for (const type of ENTITY_TYPES) {
      for (const action of ENTITY_ACTIONS) {
        this._changes[type][action] = {};
      }
    }
  }

  /**
   * Get formatted summary for console output
   */
  getFormattedSummary(): string {
    const summary = this.getSummary();

    const lines = [
      "=== SYNC DELTA SUMMARY ===",
      `Total Changes: ${summary.totalChanges}`,
      `Modified Entities: ${summary.modifiedEntities}`,
      "",
      "Changes by Type:",
    ];

    Object.entries(summary.changesByType).forEach(([type, count]) => {
      lines.push(`  ${type}: ${count}`);
    });

    lines.push("", "Changes by Action:");
    Object.entries(summary.changesByAction).forEach(([action, count]) => {
      lines.push(`  ${action}: ${count}`);
    });

    return lines.join("\n");
  }



}



