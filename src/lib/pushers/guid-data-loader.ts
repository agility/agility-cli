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

export interface ModelFilterOptions {
    models?: string[]; // Simple model filtering
    modelsWithDeps?: string[]; // Model filtering with dependency tree
}

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

    constructor(guid: string) {
        this.guid = guid;
    }

    /**
     * Load all entities for the specified GUID and locale - guarantees arrays are always returned
     */
    async loadGuidEntities(locale: string, filterOptions?: ModelFilterOptions): Promise<GuidEntities> {
        const state = getState();
        const elements = state.elements.split(',');

        const guidFileOps = new fileOperations(this.guid);
        const localeFileOps = new fileOperations(this.guid, locale);

        // Initialize with empty arrays - no nulls/undefined ever
        const guidEntities: GuidEntities = {
            galleries: [],
            assets: [],
            models: [],
            containers: [],
            lists: [],
            content: [],
            pages: [],
            templates: []
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

        // Apply model filtering if requested
        if (filterOptions) {
            return await this.applyModelFiltering(guidEntities, filterOptions, locale);
        }

        return guidEntities;
    }

    /**
     * Apply model filtering using existing ModelDependencyTreeBuilder
     */
    private async applyModelFiltering(guidEntities: GuidEntities, filterOptions: ModelFilterOptions, locale: string): Promise<GuidEntities> {
        // Determine which filtering mode to use
        let modelNames: string[] = [];
        let useFullDependencyTree = false;

        if (filterOptions.modelsWithDeps && filterOptions.modelsWithDeps.length > 0) {
            modelNames = filterOptions.modelsWithDeps;
            useFullDependencyTree = true;
        } else if (filterOptions.models && filterOptions.models.length > 0) {
            modelNames = filterOptions.models;
            useFullDependencyTree = false;
        } else {
            // No filtering requested
            return guidEntities;
        }

        console.log(`🔍 ${useFullDependencyTree ? 'Model dependency tree' : 'Simple model'} filtering: ${modelNames.join(', ')}`);

        // Import and use ModelDependencyTreeBuilder (reuse existing logic from sync.ts)
        const { ModelDependencyTreeBuilder } = await import('../models/model-dependency-tree-builder');
        const treeBuilder = new ModelDependencyTreeBuilder(guidEntities);

        // Validate that specified models exist
        const validation = treeBuilder.validateModels(modelNames);
        if (validation.invalid.length > 0) {
            console.log(ansiColors.red(`Invalid model names: ${validation.invalid.join(', ')}`));
            console.log(ansiColors.gray(`Available models: ${guidEntities.models.map((m: any) => m.referenceName).join(', ')}`));
            return guidEntities; // Return unfiltered data if validation fails
        }

        if (useFullDependencyTree) {
            // Build dependency tree and filter all related entities
            const dependencyTree = treeBuilder.buildDependencyTree(validation.valid, locale);
            return this.filterGuidEntitiesByDependencyTree(guidEntities, dependencyTree);
        } else {
            // Simple filtering - just filter models and their direct content
            return this.filterGuidEntitiesByModels(guidEntities, validation.valid);
        }
    }

    /**
     * Filter entities by dependency tree (full dependency filtering)
     */
    private filterGuidEntitiesByDependencyTree(guidEntities: GuidEntities, dependencyTree: any): GuidEntities {
        return {
            models: guidEntities.models.filter((m: any) => dependencyTree.models.has(m.referenceName)),
            containers: guidEntities.containers.filter((c: any) => dependencyTree.containers.has(c.contentViewID)),
            lists: guidEntities.lists.filter((l: any) => dependencyTree.lists.has(l.contentViewID)),
            content: guidEntities.content.filter((c: any) => dependencyTree.content.has(c.contentID)),
            templates: guidEntities.templates.filter((t: any) => dependencyTree.templates.has(t.id)),
            pages: guidEntities.pages.filter((p: any) => dependencyTree.pages.has(p.pageID)),
            assets: guidEntities.assets.filter((a: any) => dependencyTree.assets.has(a.url || a.originUrl || a.edgeUrl)),
            galleries: guidEntities.galleries.filter((g: any) => dependencyTree.galleries.has(g.galleryID))
        };
    }

    /**
     * Filter entities by models only (simple filtering)
     */
    private filterGuidEntitiesByModels(guidEntities: GuidEntities, modelNames: string[]): GuidEntities {
        const modelSet = new Set(modelNames);

        return {
            models: guidEntities.models.filter((m: any) => modelSet.has(m.referenceName)),
            containers: guidEntities.containers.filter((c: any) => {
                // Include containers that use the specified models
                const model = guidEntities.models.find((m: any) => m.id === c.contentDefinitionID);
                return model && modelSet.has(model.referenceName);
            }),
            lists: guidEntities.lists.filter((l: any) => {
                // Include lists that use the specified models
                const model = guidEntities.models.find((m: any) => m.id === l.contentDefinitionID);
                return model && modelSet.has(model.referenceName);
            }),
            content: guidEntities.content.filter((c: any) => {
                // Include content that uses the specified models
                return modelSet.has(c.properties?.definitionName);
            }),
            // For simple filtering, don't include templates, pages, assets, galleries unless they're directly related
            templates: [],
            pages: [],
            assets: [],
            galleries: []
        };
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
    validateDataStructure(locale: string): boolean {
        const state = getState();
        // Use enhanced fileOperations instancePath property
        const instancePath = new fileOperations(this.guid).instancePath;

        if (!fs.existsSync(instancePath)) {
            console.error(ansiColors.red(`❌ Data directory not found for GUID ${this.guid}: ${instancePath}`));
            console.log(ansiColors.yellow(`💡 Make sure you have pulled data first:`));
            console.log(`   node dist/index.js pull --guid ${this.guid} --locale ${locale} --channel website --verbose`);
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
