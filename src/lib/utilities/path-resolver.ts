/**
 * Path Resolution Utility
 * 
 * Provides consistent path resolution for both pull and sync operations.
 * Follows the established pattern from pull.ts for early path establishment.
 */

import * as path from 'path';
import { fileOperations } from '../services/fileOperations';

export interface PathResolutionOptions {
    rootPath: string;
    legacyFolders: boolean;
    guid: string;
    locale: string;
    isPreview: boolean;
}

export interface ResolvedPath {
    /** The absolute root path for agility files (e.g., /cwd/agility-files or /cwd/custom-test) */
    resolvedRootPath: string;
    
    /** The instance-specific path - flat for legacy, nested for normal */
    instancePath: string;
    
    /** Path for mappings directory */
    mappingsPath: string;
    
    /** Whether the paths use legacy flat structure */
    isLegacy: boolean;
    
    /** File operations service configured for these paths */
    fileOps: fileOperations;
}

/**
 * Resolve all paths early using the established pattern from pull.ts
 */
export function resolveInstancePaths(options: PathResolutionOptions): ResolvedPath {
    const currentWorkingDir = process.cwd();
    
    // Step 1: Resolve the root path (always relative to process.cwd())
    const resolvedRootPath = path.resolve(currentWorkingDir, options.rootPath);

    // Step 2: Calculate instance-specific path based on legacyFolders flag
    let instancePath: string;
    if (options.legacyFolders) {
        // Legacy mode: flat structure - {rootPath}/item, {rootPath}/list
        instancePath = resolvedRootPath;
    } else {
        // Normal mode: nested structure - {rootPath}/{guid}/{locale}/{mode}/
        instancePath = path.join(
            resolvedRootPath, 
            options.guid, 
            options.locale, 
            options.isPreview ? "preview" : "live"
        );
    }

    // Step 3: Calculate mappings path
    let mappingsPath: string;
    if (options.legacyFolders) {
        // Legacy mode: {rootPath}/mappings/
        mappingsPath = path.join(resolvedRootPath, 'mappings');
    } else {
        // Normal mode: {rootPath}/{guid}/mappings/
        mappingsPath = path.join(resolvedRootPath, options.guid, 'mappings');
    }

    // Step 4: Create fileOperations service
    // Note: fileOperations expects nested structure, so for legacy mode we need to work around this
    let fileOps: fileOperations;
    if (options.legacyFolders) {
        // Legacy mode: create fileOperations with root path and empty nesting
        fileOps = new fileOperations(resolvedRootPath, '', '', true);
    } else {
        // Normal mode: let fileOperations handle the full nested structure
        fileOps = new fileOperations(resolvedRootPath, options.guid, options.locale, options.isPreview);
    }

    return {
        resolvedRootPath,
        instancePath,
        mappingsPath,
        isLegacy: options.legacyFolders,
        fileOps
    };
}

/**
 * Ensure all necessary directories exist
 */
export function ensurePathsExist(resolvedPath: ResolvedPath): void {
    // Use fileOperations to ensure directories exist
    resolvedPath.fileOps.createBaseFolder(resolvedPath.resolvedRootPath);
    resolvedPath.fileOps.createFolder(resolvedPath.instancePath);
    resolvedPath.fileOps.createFolder(resolvedPath.mappingsPath);
}

/**
 * Get the full path to a specific data folder (models, assets, etc.)
 */
export function getDataFolderPath(resolvedPath: ResolvedPath, folderName: string): string {
    return path.join(resolvedPath.instancePath, folderName);
}

/**
 * Get the full path to the nested sitemap file
 */
export function getNestedSitemapPath(resolvedPath: ResolvedPath): string {
    return path.join(resolvedPath.instancePath, 'nestedsitemap', 'website.json');
}

/**
 * Get the full path for a mapping file
 */
export function getMappingFilePath(resolvedPath: ResolvedPath, targetGuid: string): string {
    return path.join(resolvedPath.mappingsPath, `${targetGuid}.json`);
} 