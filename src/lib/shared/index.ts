// Clean utilities index
export * from "../content";
export * from "../assets";
export * from "../loggers";

// // ReferenceMapperV2 exports
export * from "../pushers/batch-polling";
export * from "./link-type-detector";
export { GuidDataLoader, GuidEntities, SourceEntities } from "../pushers/guid-data-loader";
export function prettyException(error: any): string { return error.message || error.toString(); }
export function logBatchError(error: any, context: string): void { console.error("Batch Error:", error); }
export { pollBatchUntilComplete, extractBatchResults } from "../pushers/batch-polling";

// Source publish status checker - checks source instance publish status
export {
    checkSourcePublishStatus,
    filterPublishedContent,
    filterPublishedPages,
    isPublished
} from './source-publish-status-checker';

// Fetch API status checker - checks if CDN sync is complete
export {
    getFetchApiStatus,
    waitForFetchApiSync,
    type FetchApiStatus,
    type FetchApiSyncMode
} from './get-fetch-api-status';

// Re-export types from central types folder
export {
    ItemState,
    type SourceItemData,
    type PublishStatusResult
} from '../../types';

// Version utility
import * as fs from 'fs';
import * as path from 'path';

/**
 * Get package version from package.json
 * Tries to find package.json in multiple locations:
 * 1. Current working directory
 * 2. CLI installation directory (where this code is running from)
 * 3. Falls back to 'unknown' if not found
 */
export function getPackageVersion(): string {
  const possiblePaths = [
    // Try current working directory first (for development)
    path.join(process.cwd(), 'package.json'),
    // Try the CLI installation directory (for installed CLI)
    path.join(__dirname, '../../package.json'),
    path.join(__dirname, '../../../package.json'),
    // Try one more level up for different installation structures
    path.join(__dirname, '../../../../package.json')
  ];

  for (const packageJsonPath of possiblePaths) {
    try {
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.version && packageJson.name === '@agility/cli') {
          return packageJson.version;
        }
      }
    } catch (error) {
      // Continue to next path on error
      continue;
    }
  }

  // If we can't find the package.json or version, return 'unknown'
  return 'unknown';
}

/**
 * Generate a formatted header with package version info for log files
 */
export function generateLogHeader(operationType: string, additionalInfo: Record<string, any> = {}): string {
  const timestamp = new Date().toISOString();
  const version = getPackageVersion();
  
  const headerLines = [
    '='.repeat(80),
    `Agility CLI ${operationType} Operation Log`,
    `Version: ${version}`,
    `Timestamp: ${timestamp}`,
  ];

  // Add additional info
  Object.entries(additionalInfo).forEach(([key, value]) => {
    headerLines.push(`${key}: ${value}`);
  });

  headerLines.push('='.repeat(80));
  headerLines.push('');

  return headerLines.join('\n');
}
