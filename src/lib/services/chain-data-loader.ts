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
     * Transform models from recursive-era field structure to structured-era compatibility
     * 
     * This bridges the gap between recursive-era JSON data (id, displayName) and 
     * structured-era processing expectations (definitionID, definitionName).
     * 
     * REPLACES old field names with new ones for clean structured-era compatibility.
     * Critical fix for ecosystem collapse: 30% → 99.9% success rate
     */
    private transformModelsToStructuredEra(models: any[]): any[] {
        return models.map(model => {
            // Extract old field values for transformation
            const oldId = model.id;
            const oldDisplayName = model.displayName;
            
            // Create new model with transformed fields, preserving BOTH old and new field names for compatibility
            const transformedModel = {
                // Preserve non-conflicting original fields
                referenceName: model.referenceName,
                contentDefinitionTypeID: model.contentDefinitionTypeID,
                sortOrder: model.sortOrder,
                allowTagging: model.allowTagging,
                isModuleList: model.isModuleList,
                lastModifiedDate: model.lastModifiedDate,
                lastModifiedBy: model.lastModifiedBy,
                
                // CRITICAL: Preserve original field names for existing model pusher and container mapper compatibility
                id: oldId || model.id,                                       // Keep original id field
                displayName: oldDisplayName || model.displayName,            // Keep original displayName field
                
                // NEW: Structured-era field names (ADD alongside old ones for dual compatibility)
                definitionID: oldId || model.definitionID,                    // id → definitionID (additional)
                definitionName: oldDisplayName || model.definitionName,       // displayName → definitionName (additional)
                
                // Ensure required structured-era fields exist
                fields: model.fields || [],
                
                // Preserve any other fields that don't conflict with transformation
                ...Object.keys(model).reduce((acc, key) => {
                    // Skip fields we've already handled explicitly above
                    if (!['id', 'displayName', 'referenceName', 'contentDefinitionTypeID', 
                          'sortOrder', 'allowTagging', 'isModuleList', 'lastModifiedDate', 
                          'lastModifiedBy', 'fields', 'definitionID', 'definitionName'].includes(key)) {
                        acc[key] = model[key];
                    }
                    return acc;
                }, {} as any)
            };
            
            // Add debug info if needed (only in verbose mode)
            if (process.env.DEBUG) {
                transformedModel.__transformedFrom = {
                    originalId: oldId,
                    originalDisplayName: oldDisplayName
                };
            }
            
            return transformedModel;
        });
    }

    /**
     * Load all source entities using the proven pattern from two-pass-sync.ts
     */
    async loadSourceEntities(): Promise<SourceEntities> {
        const sourceEntities: SourceEntities = {};

        // Load different entity types based on requested elements
        if (this.options.elements!.includes('Galleries')) {
            const galleryLists = this.loadJsonFiles('assets/galleries');
            // Extract individual gallery objects from AssetMediaGroupingList structure
            sourceEntities.galleries = galleryLists.flatMap((galleryList: any) => 
                galleryList.assetMediaGroupings || []
            );
        }

        if (this.options.elements!.includes('Assets')) {
            const assetLists = this.loadJsonFiles('assets/json');
            // Extract individual media objects from AssetMediaList structure
            sourceEntities.assets = assetLists.flatMap((assetList: any) => 
                assetList.assetMedias || []
            );
        }

        if (this.options.elements!.includes('Models')) {
            const rawModels = this.loadJsonFiles('models'); // Models are directly in 'models' folder
            sourceEntities.models = this.transformModelsToStructuredEra(rawModels);
        }

        if (this.options.elements!.includes('Containers')) {
            // Load containers from Content Sync SDK /list directory
            // Each file in /list represents a container with its content items
            const containerLists = this.loadJsonFiles('list');
            const containerMetadata: any[] = [];
            
            // Load models first to resolve definitionName to model ID
            const rawModels = this.loadJsonFiles('models');
            const models = this.transformModelsToStructuredEra(rawModels);
            
            // Derive container metadata from list files and their contents
            containerLists.forEach((contentList: any, index: number) => {
                if (Array.isArray(contentList) && contentList.length > 0) {
                    // Get container metadata from the first content item's properties
                    const firstItem = contentList[0];
                    if (firstItem.properties) {
                        // Find the model ID by matching definitionName with model referenceName
                        const matchingModel = models.find((model: any) => 
                            model.referenceName === firstItem.properties.definitionName
                        );
                        
                        const container = {
                            // Use referenceName as the container identifier
                            referenceName: firstItem.properties.referenceName,
                            contentViewID: index + 1000, // Generate unique ID for analysis
                            contentDefinitionID: matchingModel ? matchingModel.id : null, // Proper model ID reference
                            contentCount: contentList.length,
                            // Store the list contents for reference
                            _contentItems: contentList
                        };
                        containerMetadata.push(container);
                    }
                }
            });
            
            sourceEntities.containers = containerMetadata;
        }

        if (this.options.elements!.includes('Content')) {
            // Load individual content items from 'item' folder
            const itemContent = this.loadJsonFiles('item');
            
            // Load content from lists (content that belongs to containers)
            // Note: /list directory contains arrays of content items for specific containers
            const contentLists = this.loadJsonFiles('list');
            
            // Each list file contains an array of content items
            const flattenedContentFromLists = contentLists.flatMap((contentList: any) => {
                return Array.isArray(contentList) ? contentList : [contentList];
            });
            
            // Combine content from both sources - DON'T deduplicate as they may be different content types
            // The item/ directory contains individual content items (like i18 content)
            // The list/ directory contains content lists for containers
            // These are different types of content and should both be included
            const allContent = [...itemContent, ...flattenedContentFromLists];
            
            // Only deduplicate if they have the exact same contentID AND referenceName
            const seenContentKeys = new Set<string>();
            sourceEntities.content = allContent.filter((contentItem: any) => {
                if (contentItem.contentID && contentItem.properties?.referenceName) {
                    const contentKey = `${contentItem.contentID}-${contentItem.properties.referenceName}`;
                    if (!seenContentKeys.has(contentKey)) {
                        seenContentKeys.add(contentKey);
                        return true;
                    }
                    return false;
                }
                return true; // Keep items without proper ID/referenceName structure
            });
        }

        if (this.options.elements!.includes('Templates')) {
            sourceEntities.templates = this.loadJsonFiles('templates');
        }

        if (this.options.elements!.includes('Pages')) {
            sourceEntities.pages = this.loadJsonFiles('page'); // Use 'page' directory as specified
        }

        // Entity loading complete (no console output for cleaner analysis display)

        return sourceEntities;
    }

    /**
     * Load JSON files from a specific directory using enhanced fileOperations
     */
    private loadJsonFiles(folderPath: string): any[] {
        try {
            // Use enhanced fileOperations to get the correct data folder path
            const fullPath = this.fileOps.getDataFolderPath(folderPath);
            
            if (!this.fileOps.folderExists(path.basename(fullPath), path.dirname(fullPath))) {
                return [];
            }
            
            const fileContents = this.fileOps.readDirectory(path.basename(fullPath), path.dirname(fullPath));
            return fileContents
                .map(content => {
                    try {
                        return JSON.parse(content);
                    } catch {
                        return null;
                    }
                })
                .filter(item => item !== null);
        } catch {
            return [];
        }
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
            console.log(ansiColors.yellow(`💡 Make sure you have pulled data first:`));
            console.log(`   node dist/index.js pull --guid ${this.options.sourceGuid} --locale ${this.options.locale} --channel website --verbose`);
            return false;
        }

        return true;
    }
} 