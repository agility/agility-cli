// Clean utilities index
export * from "../generators";
export * from "../content";
export * from "../assets";
export * from "../models";
export * from "../loggers";
export { ContentHashComparer } from "./content-hash-comparer";
export * from './sync-delta-tracker';
export * from "./instance-lister";
export { LinkTypeDetector } from "./link-type-detector";
export { ReferenceMapper } from "./reference-mapper";

// // ReferenceMapperV2 exports
// export * from './reference-mapper-v2';
// export * from './reference-mapper-v2-compatibility';
export * from "../pushers/batch-polling";
export * from "./sitemap-hierarchy";
export * from "./bulk-mapping-filter";
export { GuidDataLoader, GuidEntities, SourceEntities } from "../pushers/guid-data-loader";
export { EntityComparer, EntityComparison, ComparisonResult } from "./entity-comparer";
export function prettyException(error: any): string { return error.message || error.toString(); }
export function logBatchError(error: any, context: string): void { console.error("Batch Error:", error); }
export { pollBatchUntilComplete, extractBatchResults } from "../pushers/batch-polling";

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
