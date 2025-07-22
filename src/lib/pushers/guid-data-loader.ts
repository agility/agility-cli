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
import ansiColors from 'ansi-colors';
import { fileOperations } from '../../core/fileOperations';
import { getApiClient, getState } from '../../core/state';

export interface GuidEntities {
    pages: any[];
    templates: any[];
    containers: any[];
    lists: any[];
    models: any[];
    content: any[];
    assets: any[];
    galleries: any[];
}

export class GuidDataLoader {
  
    private guid: string;
    private locales: string[];

    constructor(guid: string) {
        const state = getState();
        this.locales = state.locale;
        this.guid = guid;
    }

    async loadGuidEntitiesForAllLocales(): Promise<{locales: any[], guidEntities: GuidEntities}> {
        const mgmtApi = getApiClient();
        const locales = await mgmtApi.instanceMethods.getLocales(this.guid);

        for(const locale of locales as any){
            const guidEntities = await this.loadGuidEntities(locale.localeCode);
            return {
                locales,
                guidEntities
            }
        }

        
    }
    /**
     * Load all entities for the specified GUID - guarantees arrays are always returned
     */
    async loadGuidEntities(locale: string): Promise<GuidEntities> {
        const state = getState();
        const elements = state.elements.split(',');

        const guidFileOps = new fileOperations(this.guid);
        const localeFileOps = new fileOperations(this.guid, locale);
        
        // Initialize with empty arrays - no nulls/undefined ever
        const guidEntities: GuidEntities = {
            pages: [],
            templates: [],
            containers: [],
            lists: [],
            models: [],
            content: [],
            assets: [],
            galleries: []
        };

        // Load different entity types using pure getters for consistent architecture
        if (elements.includes('Galleries')) {
            const { getGalleriesFromFileSystem } = await import('../getters/filesystem/get-galleries');
            const galleries = getGalleriesFromFileSystem(guidFileOps);
            guidEntities.galleries = Array.isArray(galleries) ? galleries : [];
        }

        if (elements.includes('Assets')) {
            const { getAssetsFromFileSystem } = await import('../getters/filesystem/get-assets');
            const assets = getAssetsFromFileSystem(guidFileOps);
            guidEntities.assets = Array.isArray(assets) ? assets : [];
        }

        if (elements.includes('Models')) {
            const { getModelsFromFileSystem } = await import('../getters/filesystem/get-models');
            const models = getModelsFromFileSystem(guidFileOps);
            guidEntities.models = Array.isArray(models) ? models : [];
        }

        if (elements.includes('Containers')) {
            const { getListsFromFileSystem, getContainersFromFileSystem } = await import('../getters/filesystem/get-containers');
            const containers = getContainersFromFileSystem(guidFileOps);
            guidEntities.containers = Array.isArray(containers) ? containers : [];

            const lists = getListsFromFileSystem(guidFileOps);
            guidEntities.lists = Array.isArray(lists) ? lists : [];
        }

        if (elements.includes('Content')) {
            const { getContentItemsFromFileSystem } = await import('../getters/filesystem/get-content-items');
            const content = getContentItemsFromFileSystem(localeFileOps);
            guidEntities.content = Array.isArray(content) ? content : [];
        }

        if (elements.includes('Templates')) {
            const { getTemplatesFromFileSystem } = await import('../getters/filesystem/get-templates');
            const templates = getTemplatesFromFileSystem(guidFileOps);
            guidEntities.templates = Array.isArray(templates) ? templates : [];
        }

        if (elements.includes('Pages')) {
            const { getPagesFromFileSystem } = await import('../getters/filesystem/get-pages');
            const pages = getPagesFromFileSystem(localeFileOps);
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
            lists: guidEntities.lists.length,
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
        const instancePath = new fileOperations(this.guid).instancePath;
            
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
// SourceDataLoader deprecated - use GuidDataLoader directly
export type SourceEntities = GuidEntities; 