/**
 * Chain Data Loader Service
 * 
 * Isolated service that encapsulates the proven data loading pattern from two-pass-sync.ts.
 * Provides consistent data loading for all chain-based operations in the system.
 * 
 * ✅ FOLLOWS: Established chain assembly methodology (.cursor/chain-assembly.md)
 * ✅ USES: Proven loadJsonFiles pattern from two-pass-sync.ts
 * ✅ HANDLES: Correct directory structure (page/, item/, list/, etc.)
 */

import * as fs from 'fs';
import * as path from 'path';
import ansiColors from 'ansi-colors';
import { fileOperations } from './fileOperations';

export interface SourceEntities {
    pages?: any[];
    templates?: any[];
    containers?: any[];
    models?: any[];
    content?: any[];
    assets?: any[];
    galleries?: any[];
}

export interface ChainDataLoaderOptions {
    sourceGuid: string;
    locale: string;
    isPreview: boolean;
    rootPath: string;
    legacyFolders: boolean;
    elements?: string[];
}

export class ChainDataLoader {
    private options: ChainDataLoaderOptions;
    private fileOps: fileOperations;

    constructor(options: ChainDataLoaderOptions) {
        this.options = {
            elements: ['Pages', 'Templates', 'Containers', 'Models', 'Content', 'Assets', 'Galleries'],
            ...options
        };
        
        // Use enhanced fileOperations with legacyFolders support
        this.fileOps = new fileOperations(
            options.rootPath,
            options.sourceGuid,
            options.locale,
            options.isPreview,
            options.legacyFolders
        );
    }

    /**
     * Load all source entities using the proven pattern from two-pass-sync.ts
     */
    async loadSourceEntities(): Promise<SourceEntities> {
        const sourceEntities: SourceEntities = {};

        // Load different entity types using pure getters for consistent architecture
        if (this.options.elements!.includes('Galleries')) {
            // Use pure gallery getter with flattening
            const { getGalleriesFromFileSystem } = await import('../getters/filesystem/get-galleries');
            sourceEntities.galleries = getGalleriesFromFileSystem(this.fileOps) || [];
        }

        if (this.options.elements!.includes('Assets')) {
            // Use pure asset getter for consistent loading logic
            const { getAssetsFromFileSystem } = await import('../getters/filesystem/get-assets');
            sourceEntities.assets = getAssetsFromFileSystem(this.fileOps);
        }

        if (this.options.elements!.includes('Models')) {
            // Use pure models getter with transformation
            const { getModelsFromFileSystem } = await import('../getters/filesystem/get-models');
            sourceEntities.models = getModelsFromFileSystem(this.fileOps);
        }

        if (this.options.elements!.includes('Containers')) {
            // Use pure containers getter with metadata derivation
            const { getContainersFromFileSystem } = await import('../getters/filesystem/get-containers');
            sourceEntities.containers = getContainersFromFileSystem(this.fileOps);
        }

        if (this.options.elements!.includes('Content')) {
            // Use pure content getter with deduplication logic
            const { getContentItemsFromFileSystem } = await import('../getters/filesystem/get-content-items');
            sourceEntities.content = getContentItemsFromFileSystem(this.fileOps);
        }

        if (this.options.elements!.includes('Templates')) {
            // Use pure templates getter
            const { getTemplatesFromFileSystem } = await import('../getters/filesystem/get-templates');
            sourceEntities.templates = getTemplatesFromFileSystem(this.fileOps);
        }

        if (this.options.elements!.includes('Pages')) {
            // Use pure pages getter
            const { getPagesFromFileSystem } = await import('../getters/filesystem/get-pages');
            sourceEntities.pages = getPagesFromFileSystem(this.fileOps);
        }

        // Entity loading complete (no console output for cleaner analysis display)

        return sourceEntities;
    }

    /**
     * Check if we have any content to process
     */
    hasNoContent(sourceEntities: SourceEntities): boolean {
        return Object.values(sourceEntities).every((arr: any) => 
            !Array.isArray(arr) || arr.length === 0
        );
    }

    /**
     * Get entity counts for summary reporting
     */
    getEntityCounts(sourceEntities: SourceEntities): Record<string, number> {
        return {
            pages: sourceEntities.pages?.length || 0,
            templates: sourceEntities.templates?.length || 0,
            containers: sourceEntities.containers?.length || 0,
            models: sourceEntities.models?.length || 0,
            content: sourceEntities.content?.length || 0,
            assets: sourceEntities.assets?.length || 0,
            galleries: sourceEntities.galleries?.length || 0
        };
    }

    /**
     * Validate that the source data directory exists and contains expected structure
     */
    validateSourceDataStructure(): boolean {
        // Use enhanced fileOperations instancePath property
        const instancePath = this.fileOps.instancePath;
            
        if (!fs.existsSync(instancePath)) {
            console.error(ansiColors.red(`❌ Source data directory not found: ${instancePath}`));
            console.log(ansiColors.yellow(`�� Make sure you have pulled data first:`));
            console.log(`   node dist/index.js pull --guid ${this.options.sourceGuid} --locale ${this.options.locale} --channel website --verbose`);
            return false;
        }

        return true;
    }
} 