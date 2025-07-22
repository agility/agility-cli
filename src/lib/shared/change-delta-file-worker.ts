import { EntityType, EntityChangeAction, EntityChange, EntityPayload, ChangeDeltaSummary, generateEntityKey } from "./change-delta-tracker";
import { fileOperations } from "../../core/fileOperations";

const ENTITY_TYPES: EntityType[] = ["model", "container", "asset", "gallery", "template", "page", "content-item"];

/*
 * Worker class to read and clean the change delta file
*/
export class ChangeDeltaFileWorker
{
  private _inMemoryChangeDelta: ChangeDeltaSummary | null = null;
  private _fileOps: fileOperations;

  constructor(guid: string){
    this._fileOps = new fileOperations(guid);
    this.loadChangeDelta()
  }

  /**
   * Load change delta from file system into memory
   */
  loadChangeDelta(): ChangeDeltaSummary | null {
    try {
      const changeDeltaPath = this._fileOps.getFilePath("change-delta.json");
      
      if (!this._fileOps.checkFileExists(changeDeltaPath)) {
        this._inMemoryChangeDelta = null;
        return null;
      }

      const content = this._fileOps.readFile(changeDeltaPath);
      this._inMemoryChangeDelta = JSON.parse(content) as ChangeDeltaSummary;
      return this._inMemoryChangeDelta;
    } catch (error) {
      console.warn("Warning: Could not load change delta file:", error);
      this._inMemoryChangeDelta = null;
      return null;
    }
  }

  /**
   * Check if an entity is marked for create/update in change delta
   */
  getChangeDeltaEntity(
    type: EntityType,
    entityPayload: EntityPayload,
  ): EntityChangeAction {
    if (!this._inMemoryChangeDelta) {
      console.error('change delta does not exist');
      throw new Error('change delta does not exist');
    }

    const entityKey = generateEntityKey(entityPayload)

    const changeDeltaCreatedPartition = this._inMemoryChangeDelta.entities[type]['created'];
    const changeDeltaUpdatedPartition = this._inMemoryChangeDelta.entities[type]['updated'];

    if (changeDeltaCreatedPartition[entityKey]) return 'created';
    if (changeDeltaUpdatedPartition[entityKey]) return 'updated';

    throw new Error(`No entity with GUID: ${entityPayload.guid}, LOCALE: ${entityPayload.locale}, CHANNEL: ${entityPayload.channel}, ID: ${entityPayload.id}, REFERENCE_NAME: ${entityPayload.referenceName} found in change delta for type ${type}`);
  }

  /**
   * Remove an entity change from the in-memory change delta
   * Mirrors the recordChange method signature from ChangeDelta class
   */
  removeRecord(change: EntityChange): void {
    if (!this._inMemoryChangeDelta) {
      console.warn("Warning: No change delta loaded in memory. Call loadChangeDelta() first.");
      return;
    }

    const { locale, channel, type, referenceName, id, action } = change;
    
    // Create entity payload for key generation
    const entityPayload: EntityPayload = {
      guid: this._inMemoryChangeDelta.guid,
      locale,
      channel,
      referenceName,
      id
    };
    
    const entityKey = generateEntityKey(entityPayload);
    
    // Remove from the appropriate action partition
    if (this._inMemoryChangeDelta.entities[type]?.[action]?.[entityKey]) {
      delete this._inMemoryChangeDelta.entities[type][action][entityKey];
      
      // Recalculate total changes
      let newTotalChanges = 0;
      ENTITY_TYPES.forEach(entityType => {
        const createdCount = Object.keys(this._inMemoryChangeDelta!.entities[entityType]?.['created'] || {}).length;
        const updatedCount = Object.keys(this._inMemoryChangeDelta!.entities[entityType]?.['updated'] || {}).length;
        newTotalChanges += createdCount + updatedCount;
      });
      
      this._inMemoryChangeDelta.totalChanges = newTotalChanges;
      
      console.log(`✅ Removed entity from change delta: ${type} ${action} ${entityKey}`);
    } else {
      console.warn(`⚠️  Entity not found in change delta: ${type} ${action} ${entityKey}`);
    }
  }

  /**
   * Write the in-memory change delta back to the file system
   */
  writeChangeDeltaToFile(): boolean {
    if (!this._inMemoryChangeDelta) {
      console.warn("Warning: No change delta loaded in memory. Call loadChangeDelta() first.");
      return false;
    }

    try {
      // Use file operations to write the change delta file
      // const fileOps = new fileOperations("change-delta", ""); // Create fileOps instance for file operations
      const changeDeltaPath = this._fileOps.getFilePath("change-delta.json");
      
      // Ensure agility-files directory exists
      const agilityFilesDir = this._fileOps.getFolderPath("agility-files");
      if (!this._fileOps.checkFileExists(agilityFilesDir)) {
        this._fileOps.createFolder(agilityFilesDir);
      }

      this._fileOps.createFile(changeDeltaPath, JSON.stringify(this._inMemoryChangeDelta, null, 2));
      
      console.log(`✅ Change delta written to file: ${changeDeltaPath}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to write change delta to file:`, error);
      return false;
    }
  }

  /**
   * Get the current in-memory change delta
   */
  getInMemoryChangeDelta(): ChangeDeltaSummary | null {
    return this._inMemoryChangeDelta;
  }

  /**
   * Clear the in-memory change delta
   */
  clearInMemoryChangeDelta(): void {
    this._inMemoryChangeDelta = null;
    console.log("✅ In-memory change delta cleared");
  }

  /**
   * Clear the change delta file from the file system
   */
  clearChangeDeltaFile(): boolean {
    try {
      // Use file operations to clear the change delta file
      // const fileOps = new fileOperations("change-delta", ""); // Create fileOps instance for file operations
      const changeDeltaPath = this._fileOps.getFilePath("change-delta.json");
      
      if (this._fileOps.checkFileExists(changeDeltaPath)) {
        this._fileOps.deleteFile(changeDeltaPath);
        console.log(`✅ Change delta file cleared: ${changeDeltaPath}`);
        return true;
      } else {
        console.log(`ℹ️  Change delta file does not exist: ${changeDeltaPath}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to clear change delta file:`, error);
      return false;
    }
  }
}
