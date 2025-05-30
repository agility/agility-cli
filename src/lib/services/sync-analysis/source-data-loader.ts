/**
 * Source Data Loader Service
 * 
 * Handles loading source data from the local file system for sync analysis.
 * Provides methods to load different entity types and validate content availability.
 */

import ansiColors from 'ansi-colors';
import { fileOperations } from '../fileOperations';
import { 
    SourceEntities, 
    SyncAnalysisContext, 
    SyncAnalysisService 
} from './types';

export class SourceDataLoader implements SyncAnalysisService {
    private context?: SyncAnalysisContext;
    private fileOps?: fileOperations;

    /**
     * Initialize the service with context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.fileOps = new fileOperations(
            context.rootPath, 
            context.sourceGuid, 
            context.locale, 
            context.isPreview
        );
    }

    /**
     * Load source data from local file system
     */
    async loadSourceData(): Promise<SourceEntities> {
        if (!this.context || !this.fileOps) {
            throw new Error('SourceDataLoader not initialized. Call initialize() first.');
        }

        const sourceEntities: SourceEntities = {};

        // Helper function to load JSON files from a directory
        const loadJsonFiles = (folderPath: string): any[] => {
            try {
                // Construct the full path using the fileOps basePath structure
                const fullPath = `${this.context!.sourceGuid}/${this.context!.locale}/${this.context!.isPreview ? 'preview' : 'live'}/${folderPath}`;
                
                if (!this.fileOps!.folderExists(fullPath, this.context!.rootPath)) {
                    return [];
                }
                
                const fileContents = this.fileOps!.readDirectory(fullPath, this.context!.rootPath);
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
        };

        // Load different entity types based on requested elements
        if (this.context.elements.includes('Galleries')) {
            const galleryLists = loadJsonFiles('assets/galleries');
            // Extract individual gallery objects from AssetMediaGroupingList structure
            sourceEntities.galleries = galleryLists.flatMap((galleryList: any) => 
                galleryList.assetMediaGroupings || []
            );
        }

        if (this.context.elements.includes('Assets')) {
            const assetLists = loadJsonFiles('assets/json');
            // Extract individual media objects from AssetMediaList structure
            sourceEntities.assets = assetLists.flatMap((assetList: any) => 
                assetList.assetMedias || []
            );
        }

        if (this.context.elements.includes('Models')) {
            sourceEntities.models = loadJsonFiles('models'); // Models are directly in 'models' folder
        }

        if (this.context.elements.includes('Containers')) {
            sourceEntities.containers = loadJsonFiles('containers');
        }

        if (this.context.elements.includes('Content')) {
            sourceEntities.content = loadJsonFiles('item'); // Content items are in 'item' folder
        }

        if (this.context.elements.includes('Templates')) {
            sourceEntities.templates = loadJsonFiles('templates');
        }

        if (this.context.elements.includes('Pages')) {
            sourceEntities.pages = loadJsonFiles('page'); // Only use 'page' directory as specified
        }

        // Log summary
        const totalEntities = Object.values(sourceEntities).reduce((sum: number, arr: any) => 
            sum + (Array.isArray(arr) ? arr.length : 0), 0);

        console.log(ansiColors.green(`✅ Loaded ${totalEntities} entities from local files`));

        return sourceEntities;
    }

    /**
     * Check if we have any content to sync
     */
    hasNoContent(sourceEntities: SourceEntities): boolean {
        return Object.values(sourceEntities).every((arr: any) => 
            !Array.isArray(arr) || arr.length === 0
        );
    }

    /**
     * Get entity counts for reporting
     */
    getEntityCounts(sourceEntities: SourceEntities): { [key: string]: number } {
        return {
            pages: sourceEntities.pages?.length || 0,
            content: sourceEntities.content?.length || 0,
            models: sourceEntities.models?.length || 0,
            templates: sourceEntities.templates?.length || 0,
            containers: sourceEntities.containers?.length || 0,
            assets: sourceEntities.assets?.length || 0,
            galleries: sourceEntities.galleries?.length || 0
        };
    }

    /**
     * Validate that required entity types are loaded
     */
    validateRequiredEntities(sourceEntities: SourceEntities, requiredTypes: string[]): string[] {
        const missing: string[] = [];

        requiredTypes.forEach(type => {
            const entityArray = sourceEntities[type.toLowerCase() as keyof SourceEntities];
            if (!entityArray || !Array.isArray(entityArray) || entityArray.length === 0) {
                missing.push(type);
            }
        });

        return missing;
    }
} 