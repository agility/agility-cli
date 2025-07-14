/**
 * GUID Data Loader Service
 * 
 * Loads all entity types from the filesystem using consistent getter patterns.
 * Provides unified data loading for sync operations for any specified GUID.
 * 
 * ✅ USES: Proven filesystem getter pattern
 * ✅ HANDLES: Correct directory structure (page/, item/, list/, etc.)
 * ✅ SUPPORTS: All Agility CMS entity types
 * ✅ FLEXIBLE: Works with any GUID (source or target)
 */

import * as fs from 'fs';
import * as path from 'path';
import ansiColors from 'ansi-colors';
import { fileOperations } from '../../core/fileOperations';
import { getState } from '../../core/state';

export interface GuidEntities {
    pages: any[];
    templates: any[];
    containers: any[];
    models: any[];
    content: any[];
    assets: any[];
    galleries: any[];
}

export class GuidDataLoader {
    private fileOps: fileOperations;
    private guid: string;

    constructor(guid: string) {
        const state = getState();
        
        this.guid = guid;
        
        // Use enhanced fileOperations with the specified GUID
        this.fileOps = new fileOperations(
            state.rootPath,
            guid,
            state.locale[0],
            state.preview,
            state.legacyFolders
        );
    }

    /**
     * Load all entities for the specified GUID - guarantees arrays are always returned
     */
    async loadGuidEntities(): Promise<GuidEntities> {
        const state = getState();
        const elements = state.elements.split(',');
        
        // Initialize with empty arrays - no nulls/undefined ever
        const guidEntities: GuidEntities = {
            pages: [],
            templates: [],
            containers: [],
            models: [],
            content: [],
            assets: [],
            galleries: []
        };

        // Load different entity types using pure getters for consistent architecture
        if (elements.includes('Galleries')) {
            const { getGalleriesFromFileSystem } = await import('../getters/filesystem/get-galleries');
            const galleries = getGalleriesFromFileSystem(this.fileOps);
            guidEntities.galleries = Array.isArray(galleries) ? galleries : [];
        }

        if (elements.includes('Assets')) {
            const { getAssetsFromFileSystem } = await import('../getters/filesystem/get-assets');
            const assets = getAssetsFromFileSystem(this.fileOps);
            guidEntities.assets = Array.isArray(assets) ? assets : [];
        }

        if (elements.includes('Models')) {
            const { getModelsFromFileSystem } = await import('../getters/filesystem/get-models');
            const models = getModelsFromFileSystem(this.fileOps);
            guidEntities.models = Array.isArray(models) ? models : [];
        }

        if (elements.includes('Containers')) {
            const { getContainersFromFileSystem } = await import('../getters/filesystem/get-containers');
            const containers = getContainersFromFileSystem(this.fileOps);
            guidEntities.containers = Array.isArray(containers) ? containers : [];
        }

        if (elements.includes('Content')) {
            const { getContentItemsFromFileSystem } = await import('../getters/filesystem/get-content-items');
            const content = getContentItemsFromFileSystem(this.fileOps);
            guidEntities.content = Array.isArray(content) ? content : [];
        }

        if (elements.includes('Templates')) {
            const { getTemplatesFromFileSystem } = await import('../getters/filesystem/get-templates');
            const templates = getTemplatesFromFileSystem(this.fileOps);
            guidEntities.templates = Array.isArray(templates) ? templates : [];
        }

        if (elements.includes('Pages')) {
            const { getPagesFromFileSystem } = await import('../getters/filesystem/get-pages');
            const pages = getPagesFromFileSystem(this.fileOps);
            guidEntities.pages = Array.isArray(pages) ? pages : [];
        }

        return guidEntities;
    }

    /**
     * Check if we have any content to process
     */
    hasNoContent(guidEntities: GuidEntities): boolean {
        return Object.values(guidEntities).every((arr: any[]) => arr.length === 0);
    }

    /**
     * Get entity counts for summary reporting
     */
    getEntityCounts(guidEntities: GuidEntities): Record<string, number> {
        return {
            pages: guidEntities.pages.length,
            templates: guidEntities.templates.length,
            containers: guidEntities.containers.length,
            models: guidEntities.models.length,
            content: guidEntities.content.length,
            assets: guidEntities.assets.length,
            galleries: guidEntities.galleries.length
        };
    }

    /**
     * Validate that the data directory exists and contains expected structure
     */
    validateDataStructure(): boolean {
        const state = getState();
        // Use enhanced fileOperations instancePath property
        const instancePath = this.fileOps.instancePath;
            
        if (!fs.existsSync(instancePath)) {
            console.error(ansiColors.red(`❌ Data directory not found for GUID ${this.guid}: ${instancePath}`));
            console.log(ansiColors.yellow(`💡 Make sure you have pulled data first:`));
            console.log(`   node dist/index.js pull --guid ${this.guid} --locale ${state.locale} --channel website --verbose`);
            return false;
        }

        return true;
    }

    /**
     * Get the GUID this loader is configured for
     */
    getGuid(): string {
        return this.guid;
    }
}

// Keep backward compatibility with existing code
export const SourceDataLoader = GuidDataLoader;
export type SourceEntities = GuidEntities; 