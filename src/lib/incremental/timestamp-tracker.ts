/**
 * Timestamp tracking system for incremental pull operations
 *
 * Stores last successful pull timestamps per entity type to enable
 * incremental downloading of only changed entities.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LastPullTimestamps {
  models?: string;
  containers?: string;
  content?: string;
  assets?: string;
  pages?: string;
  galleries?: string;
  templates?: string; // Always full refresh, but track for consistency
}

/**
 * Get the path to the timestamp tracking file for an instance
 * @param guid Instance GUID
 * @param rootPath Root path (e.g., "agility-files")
 * @returns Path to the .last-pull-timestamps.json file
 */
function getTimestampFilePath(guid: string, rootPath: string): string {
  return path.join(process.cwd(), rootPath, guid, '.last-pull-timestamps.json');
}

/**
 * Load last pull timestamps for an instance
 * @param guid Instance GUID
 * @param rootPath Root path (e.g., "agility-files")
 * @returns LastPullTimestamps object or empty object if file doesn't exist
 */
export function loadLastPullTimestamps(guid: string, rootPath: string): LastPullTimestamps {
  try {
    const timestampFile = getTimestampFilePath(guid, rootPath);

    if (!fs.existsSync(timestampFile)) {
      // No timestamp file exists, return empty timestamps (will trigger full pull)
      return {};
    }

    const content = fs.readFileSync(timestampFile, 'utf-8');
    const timestamps: LastPullTimestamps = JSON.parse(content);

    // Validate that all timestamps are valid ISO 8601 dates
    const validatedTimestamps: LastPullTimestamps = {};
    for (const [entityType, timestamp] of Object.entries(timestamps)) {
      if (timestamp && typeof timestamp === 'string') {
        const parsed = new Date(timestamp);
        if (!isNaN(parsed.getTime())) {
          validatedTimestamps[entityType as keyof LastPullTimestamps] = timestamp;
        } else {
          console.warn(`Invalid timestamp for ${entityType}: ${timestamp}`);
        }
      }
    }

    return validatedTimestamps;
  } catch (error) {
    console.warn(`Error loading last pull timestamps for ${guid}:`, error);
    return {};
  }
}

/**
 * Save last pull timestamps for an instance
 * @param guid Instance GUID
 * @param rootPath Root path (e.g., "agility-files")
 * @param timestamps Timestamps to save
 */
export function saveLastPullTimestamps(
  guid: string,
  rootPath: string,
  timestamps: LastPullTimestamps
): void {
  try {
    const timestampFile = getTimestampFilePath(guid, rootPath);
    const instanceDir = path.dirname(timestampFile);

    // Ensure instance directory exists
    if (!fs.existsSync(instanceDir)) {
      fs.mkdirSync(instanceDir, { recursive: true });
    }

    // Sort keys for consistent file format
    const sortedTimestamps: LastPullTimestamps = {};
    const entityTypes = [
      'models',
      'containers',
      'content',
      'assets',
      'pages',
      'galleries',
      'templates',
    ];

    for (const entityType of entityTypes) {
      const timestamp = timestamps[entityType as keyof LastPullTimestamps];
      if (timestamp) {
        sortedTimestamps[entityType as keyof LastPullTimestamps] = timestamp;
      }
    }

    const content = JSON.stringify(sortedTimestamps, null, 2);
    fs.writeFileSync(timestampFile, content, 'utf-8');

    console.log(`Saved last pull timestamps for ${guid}`);
  } catch (error) {
    console.error(`Error saving last pull timestamps for ${guid}:`, error);
  }
}

/**
 * Update timestamp for a specific entity type
 * @param guid Instance GUID
 * @param rootPath Root path (e.g., "agility-files")
 * @param entityType Entity type to update
 * @param timestamp ISO 8601 timestamp
 */
export function updateEntityTypeTimestamp(
  guid: string,
  rootPath: string,
  entityType: string,
  timestamp: string
): void {
  try {
    const currentTimestamps = loadLastPullTimestamps(guid, rootPath);
    currentTimestamps[entityType as keyof LastPullTimestamps] = timestamp;
    saveLastPullTimestamps(guid, rootPath, currentTimestamps);
  } catch (error) {
    console.error(`Error updating timestamp for ${entityType}:`, error);
  }
}

/**
 * Get the last pull timestamp for a specific entity type
 * @param guid Instance GUID
 * @param rootPath Root path (e.g., "agility-files")
 * @param entityType Entity type to check
 * @returns ISO 8601 timestamp or null if no previous pull
 */
export function getLastPullTimestamp(
  guid: string,
  rootPath: string,
  entityType: string
): string | null {
  const timestamps = loadLastPullTimestamps(guid, rootPath);
  return timestamps[entityType as keyof LastPullTimestamps] || null;
}

/**
 * Check if an entity has been modified since the last pull
 * @param entityModifiedDate Entity's modified date (ISO 8601)
 * @param lastPullTimestamp Last pull timestamp (ISO 8601) or null
 * @returns true if entity was modified since last pull, false otherwise
 */
export function isEntityModifiedSinceLastPull(
  entityModifiedDate: string | null,
  lastPullTimestamp: string | null
): boolean {
  // If no entity modified date, we can't determine if it was modified
  if (!entityModifiedDate) {
    return true; // Default to "modified" to be safe
  }

  // If no last pull timestamp, this is the first pull
  if (!lastPullTimestamp) {
    return true; // First pull, consider everything "modified"
  }

  try {
    const entityDate = new Date(entityModifiedDate);
    const lastPullDate = new Date(lastPullTimestamp);

    if (isNaN(entityDate.getTime()) || isNaN(lastPullDate.getTime())) {
      console.warn(
        `Invalid dates for comparison: entity=${entityModifiedDate}, lastPull=${lastPullTimestamp}`
      );
      return true; // Default to "modified" on parsing errors
    }

    // Entity is modified if its modified date is after the last pull
    return entityDate > lastPullDate;
  } catch (error) {
    console.warn(
      `Error comparing dates: entity=${entityModifiedDate}, lastPull=${lastPullTimestamp}`,
      error
    );
    return true; // Default to "modified" on errors
  }
}

/**
 * Mark the start of a pull operation with current timestamp
 * @returns Current ISO 8601 timestamp
 */
export function markPullStart(): string {
  return new Date().toISOString();
}

/**
 * Mark the start of a push operation with current timestamp
 * @returns Current ISO 8601 timestamp
 */
export function markPushStart(): string {
  return new Date().toISOString();
}

/**
 * Clear all timestamps for an instance (used with --reset flag)
 * @param guid Instance GUID
 * @param rootPath Root path (e.g., "agility-files")
 */
export function clearTimestamps(guid: string, rootPath: string): void {
  try {
    const timestampFile = getTimestampFilePath(guid, rootPath);

    if (fs.existsSync(timestampFile)) {
      fs.unlinkSync(timestampFile);
      console.log(`Cleared timestamps for ${guid} (--reset mode)`);
    }
  } catch (error) {
    console.warn(`Error clearing timestamps for ${guid}:`, error);
  }
}

/**
 * Get incremental pull decision for an entity type
 * @param guid Instance GUID
 * @param rootPath Root path (e.g., "agility-files")
 * @param entityType Entity type to check
 * @returns "incremental" | "full" | "skip"
 */
export function getIncrementalPullDecision(
  guid: string,
  rootPath: string,
  entityType: string
): 'incremental' | 'full' | 'skip' {
  try {
    // Templates always require full refresh (no modified dates)
    if (entityType.toLowerCase() === 'templates') {
      return 'full';
    }

    const lastPullTimestamp = getLastPullTimestamp(guid, rootPath, entityType);

    // No previous pull recorded
    if (!lastPullTimestamp) {
      return 'full';
    }

    // Previous pull recorded, can do incremental
    return 'incremental';
  } catch (error) {
    console.warn(`Error determining pull decision for ${entityType}:`, error);
    return 'full'; // Default to full on errors
  }
}
