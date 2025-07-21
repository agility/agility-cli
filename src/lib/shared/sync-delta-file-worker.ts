import * as fs from "fs";
import * as path from "path";
import { EntityType, EntityChangeAction, EntityChange, EntityPayload, SyncDeltaSummary, generateEntityKey } from "./sync-delta-tracker";
import { fileOperations } from "../../core/fileOperations";

const ENTITY_TYPES: EntityType[] = ["model", "container", "asset", "gallery", "template", "page", "content-item"];

/*
 * Worker class to read and clean the sync delta file
*/
export class SyncDeltaFileWorker
{
  private _inMemorySyncDelta: SyncDeltaSummary | null = null;
  private _rootPath: string = process.cwd();

  SyncDeltaFileWorker(){
    this.loadSyncDelta()
  }

  /**
   * Load sync delta from file system into memory
   */
  loadSyncDelta(rootPath: string = process.cwd()): SyncDeltaSummary | null {
    try {
      this._rootPath = rootPath;
      
      // Use file operations to read the sync delta file
      const fileOps = new fileOperations("sync-delta", ""); // Create fileOps instance for reading
      const syncDeltaPath = path.join(rootPath, "agility-files", "sync-delta.json");
      
      if (!fileOps.checkFileExists(syncDeltaPath)) {
        this._inMemorySyncDelta = null;
        return null;
      }

      const content = fileOps.readFile(syncDeltaPath);
      this._inMemorySyncDelta = JSON.parse(content) as SyncDeltaSummary;
      return this._inMemorySyncDelta;
    } catch (error) {
      console.warn("Warning: Could not load sync delta file:", error);
      this._inMemorySyncDelta = null;
      return null;
    }
  }

  /**
   * Check if an entity is marked for create/update in sync delta
   */
  getSyncDeltaEntity(
    type: EntityType,
    entityPayload: EntityPayload,
    rootPath: string = process.cwd(),
  ): EntityChangeAction {
    if (!this._inMemorySyncDelta) {
      console.error('sync delta does not exist');
      throw new Error('sync delta does not exist');
    }

    const entityKey = generateEntityKey(entityPayload)

    const syncDeltaCreatedPartition = this._inMemorySyncDelta.entities[type]['created'];
    const syncDeltaUpdatedPartition = this._inMemorySyncDelta.entities[type]['updated'];

    if (syncDeltaCreatedPartition[entityKey]) return 'created';
    if (syncDeltaUpdatedPartition[entityKey]) return 'updated';

    throw new Error(`No entity with GUID: ${entityPayload.guid}, LOCALE: ${entityPayload.locale}, CHANNEL: ${entityPayload.channel}, ID: ${entityPayload.id}, REFERENCE_NAME: ${entityPayload.referenceName} found in sync delta for type ${type}`);
  }

  /**
   * Remove an entity change from the in-memory sync delta
   * Mirrors the recordChange method signature from SyncDelta class
   */
  removeRecord(change: EntityChange): void {
    if (!this._inMemorySyncDelta) {
      console.warn("Warning: No sync delta loaded in memory. Call loadSyncDelta() first.");
      return;
    }

    const { locale, channel, type, referenceName, id, action } = change;
    
    // Create entity payload for key generation
    const entityPayload: EntityPayload = {
      guid: this._inMemorySyncDelta.guid,
      locale,
      channel,
      referenceName,
      id
    };
    
    const entityKey = generateEntityKey(entityPayload);
    
    // Remove from the appropriate action partition
    if (this._inMemorySyncDelta.entities[type]?.[action]?.[entityKey]) {
      delete this._inMemorySyncDelta.entities[type][action][entityKey];
      
      // Recalculate total changes
      let newTotalChanges = 0;
      ENTITY_TYPES.forEach(entityType => {
        const createdCount = Object.keys(this._inMemorySyncDelta!.entities[entityType]?.['created'] || {}).length;
        const updatedCount = Object.keys(this._inMemorySyncDelta!.entities[entityType]?.['updated'] || {}).length;
        newTotalChanges += createdCount + updatedCount;
      });
      
      this._inMemorySyncDelta.totalChanges = newTotalChanges;
      
      console.log(`✅ Removed entity from sync delta: ${type} ${action} ${entityKey}`);
    } else {
      console.warn(`⚠️  Entity not found in sync delta: ${type} ${action} ${entityKey}`);
    }
  }

  /**
   * Write the in-memory sync delta back to the file system
   */
  writeSyncDeltaToFile(): boolean {
    if (!this._inMemorySyncDelta) {
      console.warn("Warning: No sync delta loaded in memory. Call loadSyncDelta() first.");
      return false;
    }

    try {
      // Use file operations to write the sync delta file
      const fileOps = new fileOperations("sync-delta", ""); // Create fileOps instance for file operations
      const syncDeltaPath = path.join(this._rootPath, "agility-files", "sync-delta.json");
      
      // Ensure agility-files directory exists
      const agilityFilesDir = path.dirname(syncDeltaPath);
      if (!fileOps.checkFileExists(agilityFilesDir)) {
        fileOps.createFolder(agilityFilesDir);
      }

      fileOps.createFile(syncDeltaPath, JSON.stringify(this._inMemorySyncDelta, null, 2));
      
      console.log(`✅ Sync delta written to file: ${syncDeltaPath}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to write sync delta to file:`, error);
      return false;
    }
  }

  /**
   * Get the current in-memory sync delta
   */
  getInMemorySyncDelta(): SyncDeltaSummary | null {
    return this._inMemorySyncDelta;
  }

  /**
   * Clear the in-memory sync delta
   */
  clearInMemorySyncDelta(): void {
    this._inMemorySyncDelta = null;
    console.log("✅ In-memory sync delta cleared");
  }

  /**
   * Clear the sync delta file from the file system
   */
  clearSyncDeltaFile(rootPath: string = process.cwd()): boolean {
    try {
      // Use file operations to clear the sync delta file
      const fileOps = new fileOperations("sync-delta", ""); // Create fileOps instance for file operations
      const syncDeltaPath = path.join(rootPath, "agility-files", "sync-delta.json");
      
      if (fileOps.checkFileExists(syncDeltaPath)) {
        fileOps.deleteFile(syncDeltaPath);
        console.log(`✅ Sync delta file cleared: ${syncDeltaPath}`);
        return true;
      } else {
        console.log(`ℹ️  Sync delta file does not exist: ${syncDeltaPath}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to clear sync delta file:`, error);
      return false;
    }
  }
}
