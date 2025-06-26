// Clean utilities index
export * from "./generators";
export * from "./content";
export * from "./assets";
export * from "./models";
export * from "./loggers";
export { ReferenceMapper } from "./reference-mapper";
export { LinkTypeDetector } from "./link-type-detector";
export { SourceDataLoader } from "./source-data-loader";
export * from "./bulk-mapping-filter";
export * from "./instance-lister";
export * from "./sitemap-hierarchy";
export function prettyException(error: any): string { return error.message || error.toString(); }
export function logBatchError(error: any, context: string): void { console.error("Batch Error:", error); }
export { pollBatchUntilComplete, extractBatchResults } from "./batch-polling";

// Version utility
import * as fs from 'fs';
import * as path from 'path';

/**
 * Get package version from package.json
 */
export function getPackageVersion(): string {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || 'unknown';
  } catch (error) {
    console.warn('Could not read package version:', error);
    return 'unknown';
  }
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
