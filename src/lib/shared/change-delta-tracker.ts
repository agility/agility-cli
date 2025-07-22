import * as path from "path";
import { fileOperations } from "../../core/fileOperations";

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
 * Change delta summary for writing to file
 */
export interface ChangeDeltaSummary {
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
 * and writes a comprehensive delta report to change-delta.json
 */
export class ChangeDelta {
  private _changes: EntityChangeStore;
  private _guid: string;
  private _startTime: string;

  constructor(guid: string) {
    this._guid = guid;
    this._startTime = new Date().toISOString();

    // Create action maps
    this._changes = {} as EntityChangeStore;

    for (const type of ENTITY_TYPES) {
      this._changes[type] = {} as Record<EntityChangeAction, Record<string, EntityChange>>;
      for (const action of ENTITY_ACTIONS) {
        this._changes[type][action] = {};
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
   * Write change delta to JSON file in agility-files directory
   */
  async writeChangeDelta(guid: string): Promise<string> {
    const changedEntities = structuredClone(this._changes);

    let totalChanges = 0;

    ENTITY_TYPES.forEach(entityType => {
      const createdCount = Object.keys(changedEntities[entityType]?.['created'] || {}).length;
      const updatedCount = Object.keys(changedEntities[entityType]?.['updated'] || {}).length;

      totalChanges = totalChanges + createdCount + updatedCount;
    })

    const changeDelta: ChangeDeltaSummary = {
      guid: this._guid,
      timestamp: this._startTime,
      totalChanges: totalChanges,
      entities: changedEntities,
    };

    // Use file operations to write the files
    const fileOps = new fileOperations(guid, ""); // Create fileOps instance for file operations
    const changeDeltaPath = path.join(process.cwd(), "agility-files", "change-delta.json");
    
    // Ensure agility-files directory exists
    const agilityFilesDir = path.dirname(changeDeltaPath);
    if (!fileOps.checkFileExists(agilityFilesDir)) {
      fileOps.createFolder(agilityFilesDir);
    }

    fileOps.createFile(changeDeltaPath, JSON.stringify(changeDelta, null, 2));

    return changeDeltaPath;
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
      "=== CHANGE DELTA SUMMARY ===",
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



