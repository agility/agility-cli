/**
 * Source Data Loader Service
 * 
 * Loads all entity types from the filesystem using consistent getter patterns.
 * Provides unified data loading for sync operations.
 * 
 * ✅ USES: Proven filesystem getter pattern
 * ✅ HANDLES: Correct directory structure (page/, item/, list/, etc.)
 * ✅ SUPPORTS: All Agility CMS entity types
 */

import * as fs from 'fs';
import * as path from 'path';
import ansiColors from 'ansi-colors';
import { fileOperations } from '../../core/fileOperations';
import { getState } from '../../core/state';

export interface SourceEntities {
    pages: any[];
    templates: any[];
    containers: any[];
    models: any[];
    content: any[];
    assets: any[];
    galleries: any[];
}

export class SourceDataLoader {
    private fileOps: fileOperations;

    constructor() {
        const state = getState();
        
        // Use enhanced fileOperations with legacyFolders support
        this.fileOps = new fileOperations(
            state.rootPath,
            state.sourceGuid,
            state.locale,
            state.preview,
            state.legacyFolders
        );
    }

    /**
     * Load all source entities - guarantees arrays are always returned
     */
    async loadSourceEntities(): Promise<SourceEntities> {
        const state = getState();
        const elements = state.elements.split(',');
        
        // Initialize with empty arrays - no nulls/undefined ever
        const sourceEntities: SourceEntities = {
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
            sourceEntities.galleries = Array.isArray(galleries) ? galleries : [];
        }

        if (elements.includes('Assets')) {
            const { getAssetsFromFileSystem } = await import('../getters/filesystem/get-assets');
            const assets = getAssetsFromFileSystem(this.fileOps);
            sourceEntities.assets = Array.isArray(assets) ? assets : [];
        }

        if (elements.includes('Models')) {
            const { getModelsFromFileSystem } = await import('../getters/filesystem/get-models');
            const models = getModelsFromFileSystem(this.fileOps);
            sourceEntities.models = Array.isArray(models) ? models : [];
        }

        if (elements.includes('Containers')) {
            const { getContainersFromFileSystem } = await import('../getters/filesystem/get-containers');
            const containers = getContainersFromFileSystem(this.fileOps);
            sourceEntities.containers = Array.isArray(containers) ? containers : [];
        }

        if (elements.includes('Content')) {
            const { getContentItemsFromFileSystem } = await import('../getters/filesystem/get-content-items');
            const content = getContentItemsFromFileSystem(this.fileOps);
            sourceEntities.content = Array.isArray(content) ? content : [];
        }

        if (elements.includes('Templates')) {
            const { getTemplatesFromFileSystem } = await import('../getters/filesystem/get-templates');
            const templates = getTemplatesFromFileSystem(this.fileOps);
            sourceEntities.templates = Array.isArray(templates) ? templates : [];
        }

        if (elements.includes('Pages')) {
            const { getPagesFromFileSystem } = await import('../getters/filesystem/get-pages');
            const pages = getPagesFromFileSystem(this.fileOps);
            sourceEntities.pages = Array.isArray(pages) ? pages : [];
        }

        return sourceEntities;
    }

    /**
     * Check if we have any content to process
     */
    hasNoContent(sourceEntities: SourceEntities): boolean {
        return Object.values(sourceEntities).every((arr: any[]) => arr.length === 0);
    }

    /**
     * Get entity counts for summary reporting
     */
    getEntityCounts(sourceEntities: SourceEntities): Record<string, number> {
        return {
            pages: sourceEntities.pages.length,
            templates: sourceEntities.templates.length,
            containers: sourceEntities.containers.length,
            models: sourceEntities.models.length,
            content: sourceEntities.content.length,
            assets: sourceEntities.assets.length,
            galleries: sourceEntities.galleries.length
        };
    }

    /**
     * Validate that the source data directory exists and contains expected structure
     */
    validateSourceDataStructure(): boolean {
        const state = getState();
        // Use enhanced fileOperations instancePath property
        const instancePath = this.fileOps.instancePath;
            
        if (!fs.existsSync(instancePath)) {
            console.error(ansiColors.red(`❌ Source data directory not found: ${instancePath}`));
            console.log(ansiColors.yellow(`💡 Make sure you have pulled data first:`));
            console.log(`   node dist/index.js pull --sourceGuid ${state.sourceGuid} --locale ${state.locale} --channel website --verbose`);
            return false;
        }

        return true;
    }
} 