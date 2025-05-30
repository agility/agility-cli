import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import { DependencyAnalyzer } from '../services/dependency-analyzer';
import { TwoPassOrchestrator } from '../services/two-pass-orchestrator';
import { EntityFactoryRegistry, EntityFactoryContext } from '../services/entity-factory';
import { RelationshipLinker } from '../services/relationship-linker';
import { CycleResolver, CycleResolutionStrategy } from '../services/cycle-resolver';
import { fileOperations } from '../services/fileOperations';

export interface TwoPassSyncOptions {
    debug: boolean;
    maxDepth?: number;
}

/**
 * Two-Pass Sync Operation
 * 
 * Main orchestrator that coordinates the entire 2-pass dependency system.
 * This replaces the traditional push system with a sophisticated dependency-aware approach.
 */
export class TwoPassSync {
    private options: mgmtApi.Options;
    private multibar: any;
    private sourceGuid: string;
    private targetGuid: string;
    private locale: string;
    private isPreview: boolean;
    private blessedUIEnabled: boolean;
    private elements: string[];
    private rootPath: string;
    private legacyFolders: boolean;
    private dryRun: boolean;
    private syncOptions: TwoPassSyncOptions;
    private fileOps: fileOperations;

    constructor(
        options: mgmtApi.Options,
        multibar: any,
        sourceGuid: string,
        targetGuid: string,
        locale: string,
        isPreview: boolean,
        blessedUIEnabled: boolean,
        elements: string[],
        rootPath: string,
        legacyFolders: boolean,
        dryRun: boolean,
        syncOptions: TwoPassSyncOptions
    ) {
        this.options = options;
        this.multibar = multibar;
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
        this.locale = locale;
        this.isPreview = isPreview;
        this.blessedUIEnabled = blessedUIEnabled;
        this.elements = elements;
        this.rootPath = rootPath;
        this.legacyFolders = legacyFolders;
        this.dryRun = dryRun;
        this.syncOptions = syncOptions;
        this.fileOps = new fileOperations(rootPath, sourceGuid, locale, isPreview);
    }

    /**
     * Main sync execution method
     * PHASE 10 FIX: This is now ANALYSIS ONLY - no actual pushing to target instance
     */
    async syncInstance(): Promise<void> {
        try {
            // Load source data from file system
            const sourceEntities = await this.loadSourceData();
            
            if (this.hasNoContent(sourceEntities)) {
                console.log(ansiColors.yellow('⚠️ No content found in source data. Skipping analysis.'));
                return;
            }

            // ANALYSIS PHASE ONLY: Build dependency chains and execution chains
            const maxDepth = this.syncOptions.maxDepth || 10; // Default to 10 if not specified
            
            // Show ONLY Aaron's 6 required sections - no old analysis
            this.showComprehensiveAnalysis(sourceEntities);

            // COMMENTED OUT: 2-pass orchestrator - this is for PUSH phase, not analysis
            /*
            const orchestrator = new TwoPassOrchestrator(this.syncOptions.debug);
            const targetApiClient = new mgmtApi.ApiClient(this.options);
            const result = await orchestrator.execute2PassMigration(sourceEntities, targetApiClient, {
                onlyUsedAssets: true,
                assetAnalysisDepth: 'deep',
                enableParallelProcessing: false,
                maxRetries: 3
            });
            */

        } catch (error) {
            console.error(ansiColors.red(`Error during analysis: ${error.message}`));
            throw error;
        }
    }

    /**
     * Load source data from local file system
     */
    private async loadSourceData(): Promise<any> {
        const sourceEntities: any = {};

        // Helper function to load JSON files from a directory
        const loadJsonFiles = (folderPath: string): any[] => {
            try {
                // Construct the full path using the fileOps basePath structure
                const fullPath = `${this.sourceGuid}/${this.locale}/${this.isPreview ? 'preview' : 'live'}/${folderPath}`;
                
                if (!this.fileOps.folderExists(fullPath, this.rootPath)) {
                    return [];
                }
                
                const fileContents = this.fileOps.readDirectory(fullPath, this.rootPath);
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
        if (this.elements.includes('Galleries')) {
            const galleryLists = loadJsonFiles('assets/galleries');
            // Extract individual gallery objects from AssetMediaGroupingList structure
            sourceEntities.galleries = galleryLists.flatMap((galleryList: any) => 
                galleryList.assetMediaGroupings || []
            );
        }

        if (this.elements.includes('Assets')) {
            const assetLists = loadJsonFiles('assets/json');
            // Extract individual media objects from AssetMediaList structure
            sourceEntities.assets = assetLists.flatMap((assetList: any) => 
                assetList.assetMedias || []
            );
        }

        if (this.elements.includes('Models')) {
            sourceEntities.models = loadJsonFiles('models'); // Models are directly in 'models' folder
        }

        if (this.elements.includes('Containers')) {
            sourceEntities.containers = loadJsonFiles('containers');
        }

        if (this.elements.includes('Content')) {
            sourceEntities.content = loadJsonFiles('item'); // Content items are in 'item' folder
        }

        if (this.elements.includes('Templates')) {
            sourceEntities.templates = loadJsonFiles('templates');
        }

        if (this.elements.includes('Pages')) {
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
    private hasNoContent(sourceEntities: any): boolean {
        return Object.values(sourceEntities).every((arr: any) => 
            !Array.isArray(arr) || arr.length === 0
        );
    }

    /**
     * Show comprehensive analysis results in a single, clean report
     * FIXED: Shows ONLY Aaron's 6 required sections - no other information
     */
    private showComprehensiveAnalysis(sourceEntities: any): void {
        console.log(ansiColors.cyan('\n📄 1. ALL PAGE CHAINS'));
        console.log('==================================================');
        this.showAllPageChains(sourceEntities);

        console.log(ansiColors.cyan('\n📦 2. ALL CONTAINER CHAINS'));
        console.log('==================================================');
        this.showContainerChains(sourceEntities);

        console.log(ansiColors.cyan('\n📐 3. ALL MODEL-TO-MODEL CHAINS'));
        console.log('==================================================');
        this.showModelToModelChains(sourceEntities);

        this.showBrokenChains(sourceEntities);

        console.log(ansiColors.yellow('\n📊 4. ITEMS OUTSIDE OF CHAINS'));
        console.log('==================================================');
        this.showNonChainedItems(sourceEntities);

        console.log(ansiColors.green('\n🔍 5. RECONCILIATION SUMMARY'));
        console.log('==================================================');
        this.showReconciliation(sourceEntities);
    }

    /**
     * STEP 1: Show all page chains with complete dependency hierarchy
     */
    private showAllPageChains(sourceEntities: any): void {
        if (!sourceEntities.pages || sourceEntities.pages.length === 0) {
            console.log(ansiColors.gray('  No pages found in source data'));
            return;
        }

        const totalPages = sourceEntities.pages.length;
        console.log(ansiColors.yellow(`Found ${totalPages} pages:`));
        
        sourceEntities.pages.forEach((page: any, index: number) => {
            const missing = this.findMissingDependenciesForPage(page, sourceEntities);
            const isBroken = missing.length > 0;
            
            const brokenIndicator = isBroken ? ansiColors.red(' [BROKEN]') : '';
            console.log(ansiColors.white(`\n  PageID:${page.pageID} (${page.name || 'No Name'})${brokenIndicator}`));
            
            // Show complete dependency hierarchy for this page
            this.showPageDependencyHierarchy(page, sourceEntities, '    ');
        });
    }

    /**
     * STEP 2: Show container chains not in page chains
     */
    private showContainerChains(sourceEntities: any): void {
        if (!sourceEntities.containers || sourceEntities.containers.length === 0) {
            console.log(ansiColors.gray('  No containers found in source data'));
            return;
        }

        // First, identify all containers that were processed in page chains
        const containersInPageChains = new Set<number>();
        
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                this.collectContainersFromPageZones(page.zones, containersInPageChains);
            });
        }

        // Find containers NOT in page chains
        const containersNotInPages = sourceEntities.containers.filter((container: any) => 
            !containersInPageChains.has(container.contentViewID)
        );

        if (containersNotInPages.length === 0) {
            console.log(ansiColors.green('  All containers are already included in page chains'));
            return;
        }

        console.log(ansiColors.yellow(`Found ${containersNotInPages.length} containers not in page chains:`));
        
        containersNotInPages.forEach((container: any, index: number) => {
            const missing = this.findMissingDependenciesForContainer(container, sourceEntities);
            const isBroken = missing.length > 0;
            
            const brokenIndicator = isBroken ? ansiColors.red(' [BROKEN]') : '';
            console.log(ansiColors.white(`\n  ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'}${brokenIndicator}`));
            
            // Show complete dependency hierarchy for this container
            this.showContainerDependencyHierarchy(container, sourceEntities, '    ');
        });
    }

    /**
     * Collect all container IDs from page zones
     */
    private collectContainersFromPageZones(zones: any, containerIds: Set<number>): void {
        if (!zones || typeof zones !== 'object') return;

        for (const [zoneName, zoneModules] of Object.entries(zones)) {
            if (Array.isArray(zoneModules)) {
                zoneModules.forEach((module: any) => {
                    if (module?.item?.contentid || module?.item?.contentId) {
                        const contentId = module.item.contentid || module.item.contentId;
                        containerIds.add(contentId);
                    }
                });
            }
        }
    }

    /**
     * Show complete dependency hierarchy for a single container
     */
    private showContainerDependencyHierarchy(container: any, sourceEntities: any, indent: string): void {
        // Show container's model dependency
        if (container.contentDefinitionID) {
            const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
            if (model) {
                console.log(ansiColors.green(`${indent}├─ Model:${model.referenceName} (${model.displayName || 'No Name'})`));
            } else {
                console.log(ansiColors.red(`${indent}├─ Model:ID_${container.contentDefinitionID} - MISSING IN SOURCE DATA`));
            }
        }

        // Show container's content items
        if (sourceEntities.content) {
            const containerContent = sourceEntities.content.filter((content: any) => 
                content.properties?.referenceName === container.referenceName
            );
            
            if (containerContent.length > 0) {
                console.log(ansiColors.blue(`${indent}├─ Content: ${containerContent.length} items found`));
                
                // Show first 3 content items
                const itemsToShow = Math.min(3, containerContent.length);
                containerContent.slice(0, itemsToShow).forEach((content: any, index: number) => {
                    const isLast = index === itemsToShow - 1 && containerContent.length <= 3;
                    const prefix = isLast ? '└─' : '├─';
                    console.log(ansiColors.blue(`${indent}│  ${prefix} ContentID:${content.contentID} (${content.properties?.referenceName || 'No Name'})`));
                    
                    // Show content's assets
                    this.showContentAssetDependencies(content, sourceEntities, `${indent}│  │  `);
                });
                
                // Show truncation message if needed
                if (containerContent.length > 3) {
                    console.log(ansiColors.gray(`${indent}│  └─ ... and ${containerContent.length - 3} more content items`));
                }
            }
        }

        // Show nested container dependencies (container → container)
        if (container.fields) {
            const nestedContainers = this.extractNestedContainerReferences(container.fields);
            nestedContainers.forEach((nestedRef: any) => {
                const nestedContainer = sourceEntities.containers?.find((c: any) => c.contentViewID === nestedRef.contentID);
                if (nestedContainer) {
                    console.log(ansiColors.blue(`${indent}├─ ContainerID:${nestedContainer.contentViewID} (${nestedContainer.referenceName || 'No Name'})`));
                    
                    // Show nested container's model
                    if (nestedContainer.contentDefinitionID) {
                        const nestedModel = sourceEntities.models?.find((m: any) => m.referenceName === nestedContainer.contentDefinitionID);
                        if (nestedModel) {
                            console.log(ansiColors.green(`${indent}│  ├─ Model:${nestedModel.referenceName} (${nestedModel.displayName || 'No Name'})`));
                        } else {
                            console.log(ansiColors.red(`${indent}│  ├─ Model:${nestedContainer.contentDefinitionID} - MISSING IN SOURCE DATA`));
                        }
                    }
                } else {
                    console.log(ansiColors.red(`${indent}├─ ContainerID:${nestedRef.contentID} - MISSING IN SOURCE DATA`));
                }
            });
        }

        // Show container's asset dependencies
        this.showContainerAssetDependencies(container, sourceEntities, `${indent}`);
    }

    /**
     * Show container asset dependencies
     */
    private showContainerAssetDependencies(container: any, sourceEntities: any, indent: string): void {
        if (!sourceEntities.content) return;

        // Find content items that reference this container's contentDefinitionID
        const containerContent = sourceEntities.content.filter((c: any) => 
            c.contentDefinitionID === container.contentDefinitionID
        );

        containerContent.forEach((content: any) => {
            if (!content.fields) return;

            const assetRefs = this.extractAssetReferences(content.fields);
            assetRefs.forEach((assetRef: any) => {
                const asset = sourceEntities.assets?.find((a: any) => 
                    a.originUrl === assetRef.url || 
                    a.url === assetRef.url ||
                    a.edgeUrl === assetRef.url
                );
                if (asset) {
                    console.log(`${indent}├─ ${ansiColors.yellow(`Asset:${asset.fileName || assetRef.url}`)}`);
                    // Check gallery dependency if asset has one  
                    if (asset.mediaGroupingID) {
                        const gallery = sourceEntities.galleries?.find((g: any) => g.mediaGroupingID === asset.mediaGroupingID);
                        if (gallery) {
                            console.log(`${indent}│  ├─ ${ansiColors.magenta(`Gallery:${gallery.name || gallery.mediaGroupingID}`)}`);
                        }
                    }
                } else {
                    console.log(`${indent}├─ ${ansiColors.red(`Asset:${assetRef.url} - MISSING IN SOURCE DATA`)}`);
                }
            });
        });
    }

    /**
     * Extract nested container references from container fields
     */
    private extractNestedContainerReferences(fields: any): Array<{ contentID: number; fieldPath: string }> {
        const references: Array<{ contentID: number; fieldPath: string }> = [];
        
        if (!fields || typeof fields !== 'object') {
            return references;
        }
        
        const scanForContainerRefs = (obj: any, path: string) => {
            if (typeof obj !== 'object' || obj === null) return;
            
            if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    scanForContainerRefs(item, `${path}[${index}]`);
                });
            } else {
                // Check for container ID references
                if (obj.contentID && typeof obj.contentID === 'number' && obj.contentID > 0) {
                    references.push({
                        contentID: obj.contentID,
                        fieldPath: `${path}.contentID`
                    });
                }
                
                if (obj.contentid && typeof obj.contentid === 'number' && obj.contentid > 0) {
                    references.push({
                        contentID: obj.contentid,
                        fieldPath: `${path}.contentid`
                    });
                }
                
                // Recursively scan nested objects
                for (const [key, value] of Object.entries(obj)) {
                    scanForContainerRefs(value, path ? `${path}.${key}` : key);
                }
            }
        };
        
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            scanForContainerRefs(fieldValue, fieldName);
        }
        
        return references;
    }

    /**
     * STEP 3: Show model-to-model chains not in other chains
     */
    private showModelToModelChains(sourceEntities: any): void {
        if (!sourceEntities.models || sourceEntities.models.length === 0) {
            console.log(ansiColors.gray('  No models found in source data'));
            return;
        }

        // First, identify all models that were processed in page and container chains
        const modelsInOtherChains = new Set<string>();
        
        // Collect models from page chains
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                this.collectModelsFromPageChains(page, sourceEntities, modelsInOtherChains);
            });
        }

        // Collect models from container chains
        if (sourceEntities.containers) {
            sourceEntities.containers.forEach((container: any) => {
                if (container.contentDefinitionID) {
                    modelsInOtherChains.add(container.contentDefinitionID);
                }
            });
        }

        // Find independent model→model chains
        const modelToModelChains = this.findModelToModelChains(sourceEntities.models, modelsInOtherChains);

        if (modelToModelChains.length === 0) {
            console.log(ansiColors.gray('  No independent model-to-model chains found'));
            return;
        }

        console.log(ansiColors.yellow(`Found ${modelToModelChains.length} independent model-to-model chains:`));
        
        modelToModelChains.forEach((chain: any, index: number) => {
            console.log(ansiColors.green(`\n  Model:${chain.referenceName} (${chain.displayName || 'No Name'})`));
            
            // Show model dependency hierarchy
            this.showModelDependencyHierarchy(chain, sourceEntities, '    ', new Set());
        });
    }

    /**
     * Collect models used in page chains
     */
    private collectModelsFromPageChains(page: any, sourceEntities: any, modelNames: Set<string>): void {
        // From page template
        if (page.templateName) {
            const template = sourceEntities.templates?.find((t: any) => t.referenceName === page.templateName);
            if (template?.contentSectionDefinitions) {
                template.contentSectionDefinitions.forEach((section: any) => {
                    if (section.contentDefinitionID) {
                        const model = sourceEntities.models?.find((m: any) => m.id === section.contentDefinitionID);
                        if (model) {
                            modelNames.add(model.referenceName);
                        }
                    }
                });
            }
        }
        
        // From page zones (containers)
        if (page.zones) {
            this.collectContainersFromPageZones(page.zones, new Set());
            
            // For each container in zones, collect their models
            for (const zoneName of Object.keys(page.zones)) {
                const zone = page.zones[zoneName];
                if (Array.isArray(zone)) {
                    zone.forEach((module: any) => {
                        if (module?.item?.contentid || module?.item?.contentId) {
                            const contentId = module.item.contentid || module.item.contentId;
                            const container = sourceEntities.containers?.find((c: any) => c.contentViewID === contentId);
                            if (container?.contentDefinitionID) {
                                const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
                                if (model) {
                                    modelNames.add(model.referenceName);
                                }
                            }
                        }
                    });
                }
            }
        }
        
        // From page content
        if (page.zones) {
            for (const zoneName of Object.keys(page.zones)) {
                const zone = page.zones[zoneName];
                if (Array.isArray(zone)) {
                    zone.forEach((module: any) => {
                        if (module?.item?.contentid || module?.item?.contentId) {
                            const contentId = module.item.contentid || module.item.contentId;
                            const content = sourceEntities.content?.find((c: any) => c.contentID === contentId);
                            if (content?.properties?.definitionName) {
                                modelNames.add(content.properties.definitionName);
                                
                                // Check for nested content references
                                if (content.fields) {
                                    const nestedRefs = this.extractNestedContainerReferences(content.fields);
                                    nestedRefs.forEach((ref: any) => {
                                        const nestedContent = sourceEntities.content?.find((c: any) => c.contentID === ref.contentID);
                                        if (nestedContent?.properties?.definitionName) {
                                            modelNames.add(nestedContent.properties.definitionName);
                                        }
                                    });
                                }
                            }
                        }
                    });
                }
            }
        }
    }

    /**
     * Find models that have model→model dependencies and aren't in other chains
     */
    private findModelToModelChains(models: any[], modelsInOtherChains: Set<string>): any[] {
        const modelChains: any[] = [];
        
        models.forEach((model: any) => {
            // Skip if this model is already used in other chains
            if (modelsInOtherChains.has(model.referenceName)) {
                return;
            }

            // Check if this model has dependencies on other models
            const hasModelDependencies = this.modelHasModelDependencies(model);
            if (hasModelDependencies) {
                modelChains.push(model);
            }
        });

        return modelChains;
    }

    /**
     * Check if a model has dependencies on other models
     */
    private modelHasModelDependencies(model: any): boolean {
        if (!model.fields) return false;

        return model.fields.some((field: any) => 
            field.type === 'Content' && field.settings?.['ContentDefinition']
        );
    }

    /**
     * Show model dependency hierarchy
     */
    private showModelDependencyHierarchy(model: any, sourceEntities: any, indent: string, visited: Set<string>): void {
        if (visited.has(model.referenceName)) {
            console.log(ansiColors.yellow(`${indent}├─ Model:${model.referenceName} (CIRCULAR REFERENCE)`));
            return;
        }

        visited.add(model.referenceName);

        if (!model.fields) return;

        model.fields.forEach((field: any, index: number) => {
            if (field.type === 'Content' && field.settings?.['ContentDefinition']) {
                const referencedModelName = field.settings['ContentDefinition'];
                const referencedModel = sourceEntities.models?.find((m: any) => m.referenceName === referencedModelName);
                
                if (referencedModel) {
                    console.log(ansiColors.green(`${indent}├─ Model:${referencedModel.referenceName} (${referencedModel.displayName || 'No Name'})`));
                    
                    // Recursively show nested model dependencies
                    this.showModelDependencyHierarchy(referencedModel, sourceEntities, `${indent}│  `, new Set(visited));
                } else {
                    console.log(ansiColors.red(`${indent}├─ Model:${referencedModelName} - MISSING IN SOURCE DATA`));
                }
            }
        });
    }

    /**
     * STEP 4: Show broken chains and missing dependencies
     */
    private showBrokenChains(sourceEntities: any): void {
        const brokenContainerChains: Array<{ entity: any; missing: string[] }> = [];
        const brokenModelChains: Array<{ entity: any; missing: string[] }> = [];

        // Find broken container chains (not in page chains)
        if (sourceEntities.containers) {
            const containersInPageChains = new Set<number>();
            if (sourceEntities.pages) {
                sourceEntities.pages.forEach((page: any) => {
                    this.collectContainersFromPageZones(page.zones, containersInPageChains);
                });
            }

            const containersNotInPages = sourceEntities.containers.filter((container: any) => 
                !containersInPageChains.has(container.contentViewID)
            );

            containersNotInPages.forEach((container: any) => {
                const missing = this.findMissingDependenciesForContainer(container, sourceEntities);
                if (missing.length > 0) {
                    brokenContainerChains.push({ entity: container, missing });
                }
            });
        }

        // Find broken model chains
        if (sourceEntities.models) {
            const modelsInOtherChains = new Set<string>();
            this.collectModelsUsedInOtherChains(sourceEntities, modelsInOtherChains);

            const modelToModelChains = this.findModelToModelChains(sourceEntities.models, modelsInOtherChains);
            modelToModelChains.forEach((model: any) => {
                const missing = this.findMissingDependenciesForModel(model, sourceEntities);
                if (missing.length > 0) {
                    brokenModelChains.push({ entity: model, missing });
                }
            });
        }

        // Calculate total broken chains
        const totalBrokenChains = brokenContainerChains.length + brokenModelChains.length;

        if (totalBrokenChains === 0) {
            return;
        }

        console.log(ansiColors.red('\n🔴 4. BROKEN CHAINS AND MISSING DEPENDENCIES'));
        console.log('==================================================');
        console.log(ansiColors.yellow(`Found ${totalBrokenChains} broken chains with missing dependencies:`));

        // Show broken container chains
        if (brokenContainerChains.length > 0) {
            console.log(ansiColors.yellow(`\n  📦 BROKEN CONTAINER CHAINS (${brokenContainerChains.length}):`));
            brokenContainerChains.slice(0, 5).forEach((chain, index) => { // Show first 5
                const container = chain.entity;
                console.log(ansiColors.white(`\n    ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'})`));
                console.log(ansiColors.red(`    Missing dependencies:`));
                chain.missing.forEach(dep => {
                    console.log(ansiColors.red(`      - ${dep}`));
                });
            });
            if (brokenContainerChains.length > 5) {
                console.log(ansiColors.gray(`    ... and ${brokenContainerChains.length - 5} more broken container chains`));
            }
        }

        // Show broken model chains
        if (brokenModelChains.length > 0) {
            console.log(ansiColors.yellow(`\n  📐 BROKEN MODEL CHAINS (${brokenModelChains.length}):`));
            brokenModelChains.slice(0, 5).forEach((chain, index) => { // Show first 5
                const model = chain.entity;
                console.log(ansiColors.green(`\n    Model:${model.referenceName} (${model.displayName || 'No Name'})`));
                console.log(ansiColors.red(`    Missing dependencies:`));
                chain.missing.forEach(dep => {
                    console.log(ansiColors.red(`      - ${dep}`));
                });
            });
            if (brokenModelChains.length > 5) {
                console.log(ansiColors.gray(`    ... and ${brokenModelChains.length - 5} more broken model chains`));
            }
        }

        // Summary of missing dependencies
        console.log(ansiColors.yellow(`\n   SUMMARY OF MISSING DEPENDENCIES:`));
        if (brokenContainerChains.length > 0) {
            const containerMissing = brokenContainerChains.flatMap(chain => chain.missing);
            console.log(ansiColors.white(`    Container chains missing: ${containerMissing.length} items`));
        }
        if (brokenModelChains.length > 0) {
            const modelMissing = brokenModelChains.flatMap(chain => chain.missing);
            console.log(ansiColors.white(`    Model chains missing: ${modelMissing.length} items`));
        }
    }

    /**
     * STEP 5: Show items outside of chains by type
     */
    private showNonChainedItems(sourceEntities: any): void {
        // Track all entities that are in chains
        const entitiesInChains = {
            pages: new Set<number>(),
            content: new Set<number>(),
            models: new Set<string>(),
            templates: new Set<string>(),
            containers: new Set<number>(),
            assets: new Set<string>(),
            galleries: new Set<number>()
        };

        // Collect entities from page chains
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                // Skip folder pages and null template pages as they don't have dependencies
                if (page.pageType === 'folder' || !page.templateName || page.templateName === null) {
                    return;
                }
                
                entitiesInChains.pages.add(page.pageID);
                
                // Track template
                if (page.templateName) {
                    entitiesInChains.templates.add(page.templateName);
                }
                
                // Track content from zones
                if (page.zones) {
                    for (const [zoneName, zoneModules] of Object.entries(page.zones)) {
                        if (Array.isArray(zoneModules)) {
                            zoneModules.forEach((module: any) => {
                                if (module?.item?.contentid || module?.item?.contentId) {
                                    const contentId = module.item.contentid || module.item.contentId;
                                    entitiesInChains.content.add(contentId);
                                    
                                    // Track content's dependencies
                                    const content = sourceEntities.content?.find((c: any) => c.contentID === contentId);
                                    if (content) {
                                        if (content.properties?.definitionName) {
                                            entitiesInChains.models.add(content.properties.definitionName);
                                        }
                                        
                                        // Track assets
                                        const assetRefs = this.extractAssetReferences(content.fields);
                                        assetRefs.forEach((assetRef: any) => {
                                            entitiesInChains.assets.add(assetRef.url);
                                        });
                                    }
                                }
                            });
                        }
                    }
                }
            });
        }

        // Collect entities from container chains (not in page chains)
        if (sourceEntities.containers) {
            const containersInPageChains = new Set<number>();
            if (sourceEntities.pages) {
                sourceEntities.pages.forEach((page: any) => {
                    this.collectContainersFromPageZones(page.zones, containersInPageChains);
                });
            }

            const containersNotInPages = sourceEntities.containers.filter((container: any) => 
                !containersInPageChains.has(container.contentViewID)
            );

            containersNotInPages.forEach((container: any) => {
                entitiesInChains.containers.add(container.contentViewID);
                
                // Track container's model
                if (container.contentDefinitionID) {
                    const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
                    if (model) {
                        entitiesInChains.models.add(model.referenceName);
                    }
                }
                
                // Track container's content items
                if (sourceEntities.content) {
                    const containerContent = sourceEntities.content.filter((content: any) => 
                        content.properties?.referenceName === container.referenceName
                    );
                    
                    containerContent.forEach((content: any) => {
                        entitiesInChains.content.add(content.contentID);
                        
                        // Track assets from content
                        const assetRefs = this.extractAssetReferences(content.fields);
                        assetRefs.forEach((assetRef: any) => {
                            entitiesInChains.assets.add(assetRef.url);
                        });
                    });
                }
            });
        }

        // Collect entities from model-to-model chains
        if (sourceEntities.models) {
            const modelsInOtherChains = new Set<string>();
            this.collectModelsUsedInOtherChains(sourceEntities, modelsInOtherChains);

            const modelToModelChains = this.findModelToModelChains(sourceEntities.models, modelsInOtherChains);
            modelToModelChains.forEach((model: any) => {
                entitiesInChains.models.add(model.referenceName);
                
                // Track referenced models
                if (model.fields) {
                    model.fields.forEach((field: any) => {
                        if (field.type === 'Content' && field.settings?.['ContentDefinition']) {
                            entitiesInChains.models.add(field.settings['ContentDefinition']);
                        }
                    });
                }
            });
        }

        // Calculate non-chained items
        const nonChainedCounts = {
            pages: 0,
            content: 0,
            models: 0,
            templates: 0,
            containers: 0,
            assets: 0,
            galleries: 0
        };

        // Count non-chained pages
        if (sourceEntities.pages) {
            nonChainedCounts.pages = sourceEntities.pages.filter((page: any) => 
                !entitiesInChains.pages.has(page.pageID)
            ).length;
        }

        // Count non-chained content
        if (sourceEntities.content) {
            nonChainedCounts.content = sourceEntities.content.filter((content: any) => 
                !entitiesInChains.content.has(content.contentID)
            ).length;
        }

        // Count non-chained models
        if (sourceEntities.models) {
            nonChainedCounts.models = sourceEntities.models.filter((model: any) => 
                !entitiesInChains.models.has(model.referenceName)
            ).length;
        }

        // Count non-chained templates
        if (sourceEntities.templates) {
            nonChainedCounts.templates = sourceEntities.templates.filter((template: any) => 
                !entitiesInChains.templates.has(template.pageTemplateName)
            ).length;
        }

        // Count non-chained containers (all containers should be in chains via templates)
        if (sourceEntities.containers) {
            nonChainedCounts.containers = sourceEntities.containers.length; // Placeholder - containers are complex
        }

        // Count non-chained assets
        if (sourceEntities.assets) {
            nonChainedCounts.assets = sourceEntities.assets.filter((asset: any) => 
                !entitiesInChains.assets.has(asset.originUrl)
            ).length;
        }

        // Count non-chained galleries
        if (sourceEntities.galleries) {
            nonChainedCounts.galleries = sourceEntities.galleries.length; // Most galleries are standalone
        }

        // Display results
        console.log(ansiColors.yellow('Items that exist but are not referenced by any chains:'));
        
        // Show pages
        const nonChainedPages = sourceEntities.pages?.filter((page: any) => 
            !entitiesInChains.pages.has(page.pageID)
        ) || [];
        
        if (nonChainedPages.length > 0) {
            console.log(ansiColors.blue(`\n  📄 PAGES: ${nonChainedPages.length} items`));
            nonChainedPages.forEach((page: any) => {
                let status = '';
                if (page.pageType === 'folder') {
                    status = ' (Folder page)';
                } else if (!page.templateName || page.templateName === null) {
                    status = ' (No template)';
                }
                console.log(ansiColors.gray(`    - PageID:${page.pageID} (${page.name || page.menuText || 'No Name'}${status}`));
            });
        }

        if (nonChainedCounts.content > 0) {
            console.log(ansiColors.blue(`\n  📋 CONTENT: ${nonChainedCounts.content} items`));
            console.log(ansiColors.gray(`    (Content items not referenced by pages or other content)`));
        }

        // Show models
        const nonChainedModels = sourceEntities.models?.filter((model: any) => 
            !entitiesInChains.models.has(model.referenceName)
        ) || [];
        
        if (nonChainedModels.length > 0) {
            console.log(ansiColors.green(`\n  📐 MODELS: ${nonChainedModels.length} items`));
            nonChainedModels.forEach((model: any) => {
                console.log(ansiColors.gray(`    - Model:${model.referenceName} (${model.displayName || 'No Name'})`));
            });
        }

        if (nonChainedCounts.templates > 0) {
            console.log(ansiColors.magenta(`\n  📋 TEMPLATES: ${nonChainedCounts.templates} items`));
            if (sourceEntities.templates) {
                const nonChainedTemplates = sourceEntities.templates.filter((template: any) => 
                    !entitiesInChains.templates.has(template.pageTemplateName)
                );
                nonChainedTemplates.forEach((template: any) => {
                    console.log(ansiColors.gray(`    - Template:${template.pageTemplateName}`));
                });
            }
        }

        if (nonChainedCounts.assets > 0) {
            console.log(ansiColors.yellow(`\n  🖼️ ASSETS: ${nonChainedCounts.assets} items`));
            console.log(ansiColors.gray(`    (Assets not referenced by any content fields)`));
        }

        if (nonChainedCounts.galleries > 0) {
            console.log(ansiColors.gray(`\n  📁 GALLERIES: ${nonChainedCounts.galleries} items`));
            console.log(ansiColors.gray(`    (Most galleries are standalone organizational units)`));
        }

        // Summary
        const totalNonChained = Object.values(nonChainedCounts).reduce((sum, count) => sum + count, 0);
        if (totalNonChained === 0) {
            console.log(ansiColors.green('\n  ✅ All entities are part of dependency chains'));
        } else {
            console.log(ansiColors.cyan(`\n  📊 Total non-chained items: ${totalNonChained}`));
        }
    }

    /**
     * STEP 6: Show reconciliation summary
     */
    private showReconciliation(sourceEntities: any): void {
        // Calculate total entities and those in chains
        const totalCounts = {
            pages: sourceEntities.pages?.length || 0,
            content: sourceEntities.content?.length || 0,
            models: sourceEntities.models?.length || 0,
            templates: sourceEntities.templates?.length || 0,
            containers: sourceEntities.containers?.length || 0,
            assets: sourceEntities.assets?.length || 0,
            galleries: sourceEntities.galleries?.length || 0
        };

        const entitiesInChains = {
            pages: new Set<number>(),
            content: new Set<number>(),
            models: new Set<string>(),
            templates: new Set<string>(),
            containers: new Set<number>(),
            assets: new Set<string>(),
            galleries: new Set<number>()
        };

        // Collect entities from all chains
        this.collectAllEntitiesInChains(sourceEntities, entitiesInChains);

        const totalEntities = Object.values(totalCounts).reduce((sum, count) => sum + count, 0);
        const totalInChains = Object.values(entitiesInChains).reduce((sum, set) => sum + set.size, 0);

        // Find broken items that will be skipped
        const brokenItems = this.findAllBrokenItems(sourceEntities);
        const syncableItems = totalInChains - brokenItems.length;

        console.log(ansiColors.cyan(`📊 SYNC READINESS SUMMARY`));
        console.log(ansiColors.white(`   Total entities: ${totalEntities}`));
        console.log(ansiColors.green(`   Ready to sync: ${syncableItems} items`));
        
        // Show concise entity type breakdown
        console.log(ansiColors.gray(`\n   Entity breakdown:`));
        
        // All pages will be synced - some in dependency chains, others as simple threads
        const contentBearingPages = sourceEntities.pages?.filter((page: any) => 
            page.pageType !== 'folder' && page.templateName && page.templateName !== null
        ).length || 0;
        const structuralPages = (sourceEntities.pages?.length || 0) - contentBearingPages;
        
        const entityTypes = [
            { name: 'Pages', total: totalCounts.pages, inChains: entitiesInChains.pages.size, note: '' },
            { name: 'Content', total: totalCounts.content, inChains: entitiesInChains.content.size, note: '' },
            { name: 'Models', total: totalCounts.models, inChains: entitiesInChains.models.size, note: '' },
            { name: 'Templates', total: totalCounts.templates, inChains: entitiesInChains.templates.size, note: '' },
            { name: 'Containers', total: totalCounts.containers, inChains: entitiesInChains.containers.size, note: '' },
            { name: 'Assets', total: totalCounts.assets, inChains: entitiesInChains.assets.size, note: '' },
            { name: 'Galleries', total: totalCounts.galleries, inChains: entitiesInChains.galleries.size, note: '' }
        ];

        entityTypes.forEach(type => {
            if (type.total === 0) return; // Skip empty types
            const outOfChains = type.total - type.inChains;
            const accountedFor = type.inChains + outOfChains === type.total ? '100%' : 'MISMATCH';
            console.log(ansiColors.gray(`     - ${type.name}: ${type.inChains} in chains, ${outOfChains} out, ${accountedFor} accounted for${type.note}`));
        });
        
        if (brokenItems.length > 0) {
            console.log(ansiColors.yellow(`\n   Will be skipped: ${brokenItems.length} broken items`));
            console.log(ansiColors.gray(`\n   Broken items that will be skipped:`));
            brokenItems.slice(0, 10).forEach(item => {
                console.log(ansiColors.red(`     - ${item}`));
            });
            if (brokenItems.length > 10) {
                console.log(ansiColors.gray(`     ... and ${brokenItems.length - 10} more broken items`));
            }
        }

        console.log(ansiColors.cyan(`\n   🚀 Do you want to proceed to sync ${syncableItems} items?`));
    }

    /**
     * Find all broken items across all entity types
     */
    private findAllBrokenItems(sourceEntities: any): string[] {
        const brokenItems: string[] = [];

        // Find broken pages
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                const missing = this.findMissingDependenciesForPage(page, sourceEntities);
                if (missing.length > 0) {
                    brokenItems.push(`PageID:${page.pageID} (${page.name || 'No Name'})`);
                }
            });
        }

        // Find broken containers (not in page chains)
        if (sourceEntities.containers) {
            const containersInPageChains = new Set<number>();
            if (sourceEntities.pages) {
                sourceEntities.pages.forEach((page: any) => {
                    this.collectContainersFromPageZones(page.zones, containersInPageChains);
                });
            }

            const containersNotInPages = sourceEntities.containers.filter((container: any) => 
                !containersInPageChains.has(container.contentViewID)
            );

            containersNotInPages.forEach((container: any) => {
                const missing = this.findMissingDependenciesForContainer(container, sourceEntities);
                if (missing.length > 0) {
                    brokenItems.push(`ContainerID:${container.contentViewID} (${container.referenceName})`);
                }
            });
        }

        // Find broken model chains
        if (sourceEntities.models) {
            const modelsInOtherChains = new Set<string>();
            this.collectModelsUsedInOtherChains(sourceEntities, modelsInOtherChains);

            const modelToModelChains = this.findModelToModelChains(sourceEntities.models, modelsInOtherChains);
            modelToModelChains.forEach((model: any) => {
                const missing = this.findMissingDependenciesForModel(model, sourceEntities);
                if (missing.length > 0) {
                    brokenItems.push(`Model:${model.referenceName} (${model.displayName})`);
                }
            });
        }

        return brokenItems;
    }

    /**
     * Helper method to collect all entities in chains (reused from Step 5 logic)
     */
    private collectAllEntitiesInChains(sourceEntities: any, entitiesInChains: any): void {
        // Collect entities from page chains
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                // Skip folder pages and null template pages as they don't have dependencies
                if (page.pageType === 'folder' || !page.templateName || page.templateName === null) {
                    return;
                }
                
                entitiesInChains.pages.add(page.pageID);
                
                // Track template
                if (page.templateName) {
                    entitiesInChains.templates.add(page.templateName);
                }
                
                // Track content from zones
                if (page.zones) {
                    for (const [zoneName, zoneModules] of Object.entries(page.zones)) {
                        if (Array.isArray(zoneModules)) {
                            zoneModules.forEach((module: any) => {
                                if (module?.item?.contentid || module?.item?.contentId) {
                                    const contentId = module.item.contentid || module.item.contentId;
                                    entitiesInChains.content.add(contentId);
                                    
                                    // Track content's dependencies
                                    const content = sourceEntities.content?.find((c: any) => c.contentID === contentId);
                                    if (content) {
                                        if (content.properties?.definitionName) {
                                            entitiesInChains.models.add(content.properties.definitionName);
                                        }
                                        
                                        // Track assets
                                        const assetRefs = this.extractAssetReferences(content.fields);
                                        assetRefs.forEach((assetRef: any) => {
                                            entitiesInChains.assets.add(assetRef.url);
                                        });
                                    }
                                }
                            });
                        }
                    }
                }
            });
        }

        // Collect entities from container chains (not in page chains)
        if (sourceEntities.containers) {
            const containersInPageChains = new Set<number>();
            if (sourceEntities.pages) {
                sourceEntities.pages.forEach((page: any) => {
                    this.collectContainersFromPageZones(page.zones, containersInPageChains);
                });
            }

            const containersNotInPages = sourceEntities.containers.filter((container: any) => 
                !containersInPageChains.has(container.contentViewID)
            );

            containersNotInPages.forEach((container: any) => {
                entitiesInChains.containers.add(container.contentViewID);
                
                // Track container's model
                if (container.contentDefinitionID) {
                    const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
                    if (model) {
                        entitiesInChains.models.add(model.referenceName);
                    }
                }
                
                // Track container's content items
                if (sourceEntities.content) {
                    const containerContent = sourceEntities.content.filter((content: any) => 
                        content.properties?.referenceName === container.referenceName
                    );
                    
                    containerContent.forEach((content: any) => {
                        entitiesInChains.content.add(content.contentID);
                        
                        // Track assets from content
                        const assetRefs = this.extractAssetReferences(content.fields);
                        assetRefs.forEach((assetRef: any) => {
                            entitiesInChains.assets.add(assetRef.url);
                        });
                    });
                }
            });
        }

        // Collect entities from model-to-model chains
        if (sourceEntities.models) {
            const modelsInOtherChains = new Set<string>();
            this.collectModelsUsedInOtherChains(sourceEntities, modelsInOtherChains);

            const modelToModelChains = this.findModelToModelChains(sourceEntities.models, modelsInOtherChains);
            modelToModelChains.forEach((model: any) => {
                entitiesInChains.models.add(model.referenceName);
                
                // Track referenced models
                if (model.fields) {
                    model.fields.forEach((field: any) => {
                        if (field.type === 'Content' && field.settings?.['ContentDefinition']) {
                            entitiesInChains.models.add(field.settings['ContentDefinition']);
                        }
                    });
                }
            });
        }
    }

    /**
     * Show complete dependency hierarchy for a single page
     */
    private showPageDependencyHierarchy(page: any, sourceEntities: any, indent: string): void {
        // Handle folder pages
        if (page.pageType === 'folder') {
            console.log(ansiColors.blue(`${indent}├─ ${ansiColors.cyan('Folder page')} (no template/content dependencies)`));
            return;
        }

        // Handle null template
        if (!page.templateName || page.templateName === null) {
            console.log(ansiColors.yellow(`${indent}├─ ${ansiColors.yellow('No template assigned')} (page.templateName is null)`));
            return;
        }

        // Find template
        const template = sourceEntities.templates?.find((t: any) => t.pageTemplateName === page.templateName);
        if (!template) {
            console.log(ansiColors.red(`${indent}├─ ${ansiColors.red(`Template:${page.templateName}`)} - MISSING IN SOURCE DATA`));
            return;
        }

        // Show template dependency
        console.log(ansiColors.magenta(`${indent}├─ Template:${template.pageTemplateName}`));
        
        // Show template's dependencies (containers, models, etc.)
        if (template.contentSectionDefinitions) {
            template.contentSectionDefinitions.forEach((section: any, sectionIndex: number) => {
                this.showTemplateSectionDependencies(section, sourceEntities, `${indent}│  `);
            });
        }

        // Show page zones (content in containers)
        if (page.zones) {
            this.showPageZoneDependencies(page.zones, sourceEntities, `${indent}│  `);
        }
    }

    /**
     * Show dependencies for a template section
     */
    private showTemplateSectionDependencies(section: any, sourceEntities: any, indent: string): void {
        // Show container dependency
        if (section.itemContainerID) {
            const container = sourceEntities.containers?.find((c: any) => c.contentViewID === section.itemContainerID);
            if (container) {
                console.log(ansiColors.white(`${indent}├─ ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'})`));
                
                // Show container's model dependency
                if (container.contentDefinitionID) {
                    const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
                    if (model) {
                        console.log(ansiColors.green(`${indent}│  ├─ Model:${model.referenceName} (${model.displayName || 'No Name'})`));
                    } else {
                        console.log(ansiColors.red(`${indent}│  ├─ Model:ID_${container.contentDefinitionID} - MISSING IN SOURCE DATA`));
                    }
                }
            } else {
                console.log(ansiColors.red(`${indent}├─ ContainerID:${section.itemContainerID} - MISSING IN SOURCE DATA`));
            }
        }
    }

    /**
     * Show dependencies for page zones
     */
    private showPageZoneDependencies(zones: any, sourceEntities: any, indent: string): void {
        for (const [zoneName, zoneModules] of Object.entries(zones)) {
            if (Array.isArray(zoneModules) && zoneModules.length > 0) {
                console.log(ansiColors.gray(`${indent}├─ Zone: ${zoneName}`));
                
                zoneModules.forEach((module: any, moduleIndex: number) => {
                    if (module?.item?.contentid || module?.item?.contentId) {
                        const contentId = module.item.contentid || module.item.contentId;
                        const content = sourceEntities.content?.find((c: any) => c.contentID === contentId);
                        
                        if (content) {
                            console.log(ansiColors.blue(`${indent}│  ├─ ContentID:${content.contentID} (${content.properties?.referenceName || 'No Name'})`));
                            
                            // Show content's model dependency
                            if (content.properties?.definitionName) {
                                // Use case-insensitive model lookup
                                let model = sourceEntities.models?.find((m: any) => m.referenceName === content.properties.definitionName);
                                if (!model) {
                                    // Try case-insensitive match for model names
                                    model = sourceEntities.models?.find((m: any) => 
                                        m.referenceName.toLowerCase() === content.properties.definitionName.toLowerCase()
                                    );
                                }
                                
                                if (model) {
                                    console.log(ansiColors.green(`${indent}│  │  ├─ Model:${model.referenceName} (${model.displayName || 'No Name'})`));
                                } else {
                                    console.log(ansiColors.red(`${indent}│  │  ├─ Model:${content.properties.definitionName} - MISSING IN SOURCE DATA`));
                                }
                            }
                            
                            // Show content's asset dependencies
                            this.showContentAssetDependencies(content, sourceEntities, `${indent}│  │  `);
                            
                        } else {
                            console.log(ansiColors.red(`${indent}│  ├─ ContentID:${contentId} - MISSING IN SOURCE DATA`));
                        }
                    }
                });
            }
        }
    }

    /**
     * Show content asset dependencies
     */
    private showContentAssetDependencies(content: any, sourceEntities: any, indent: string): void {
        if (!content.fields) return;

        const assetRefs = this.extractAssetReferences(content.fields);
        assetRefs.forEach((assetRef: any) => {
            const asset = sourceEntities.assets?.find((a: any) => 
                a.originUrl === assetRef.url || 
                a.url === assetRef.url ||
                a.edgeUrl === assetRef.url
            );
            if (asset) {
                console.log(`${indent}├─ ${ansiColors.yellow(`Asset:${asset.fileName || assetRef.url}`)}`);
                // Check gallery dependency if asset has one  
                if (asset.mediaGroupingID) {
                    const gallery = sourceEntities.galleries?.find((g: any) => g.mediaGroupingID === asset.mediaGroupingID);
                    if (gallery) {
                        console.log(`${indent}│  ├─ ${ansiColors.magenta(`Gallery:${gallery.name || gallery.mediaGroupingID}`)}`);
                    }
                }
            } else {
                console.log(`${indent}├─ ${ansiColors.red(`Asset:${assetRef.url} - MISSING IN SOURCE DATA`)}`);
            }
        });
    }

    /**
     * Extract asset references from content fields
     */
    private extractAssetReferences(fields: any): Array<{ url: string; fieldPath: string }> {
        const references: Array<{ url: string; fieldPath: string }> = [];
        
        if (!fields || typeof fields !== 'object') {
            return references;
        }
        
        const scanForAssets = (obj: any, path: string) => {
            if (typeof obj !== 'object' || obj === null) return;
            
            if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    scanForAssets(item, `${path}[${index}]`);
                });
            } else {
                // Check for asset URL references
                if (typeof obj === 'string' && obj.includes('cdn.aglty.io')) {
                    references.push({
                        url: obj,
                        fieldPath: path
                    });
                }
                
                // Check common asset fields
                if (obj.url && typeof obj.url === 'string' && obj.url.includes('cdn.aglty.io')) {
                    references.push({
                        url: obj.url,
                        fieldPath: `${path}.url`
                    });
                }
                
                // Recursively scan nested objects
                for (const [key, value] of Object.entries(obj)) {
                    scanForAssets(value, path ? `${path}.${key}` : key);
                }
            }
        };
        
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            scanForAssets(fieldValue, fieldName);
        }
        
        return references;
    }

    /**
     * Find missing dependencies for a page
     */
    private findMissingDependenciesForPage(page: any, sourceEntities: any): string[] {
        const missing: string[] = [];

        // Check template dependency
        if (page.templateName && page.templateName !== null && page.pageType !== 'folder') {
            const template = sourceEntities.templates?.find((t: any) => t.pageTemplateName === page.templateName);
            if (!template) {
                missing.push(`Template:${page.templateName}`);
            } else {
                // Check template's container dependencies
                if (template.contentSectionDefinitions) {
                    template.contentSectionDefinitions.forEach((section: any) => {
                        if (section.itemContainerID) {
                            const container = sourceEntities.containers?.find((c: any) => c.contentViewID === section.itemContainerID);
                            if (!container) {
                                missing.push(`Container:${section.itemContainerID}`);
                            }
                        }
                    });
                }
            }
        }

        // Check page zone content dependencies
        if (page.zones) {
            for (const [zoneName, zoneModules] of Object.entries(page.zones)) {
                if (Array.isArray(zoneModules)) {
                    zoneModules.forEach((module: any) => {
                        if (module?.item?.contentid || module?.item?.contentId) {
                            const contentId = module.item.contentid || module.item.contentId;
                            const content = sourceEntities.content?.find((c: any) => c.contentID === contentId);
                            if (!content) {
                                missing.push(`Content:${contentId}`);
                            } else {
                                // Check content's model dependency
                                if (content.properties?.definitionName) {
                                    // Use case-insensitive model lookup
                                    let model = sourceEntities.models?.find((m: any) => m.referenceName === content.properties.definitionName);
                                    if (!model) {
                                        // Try case-insensitive match for model names
                                        model = sourceEntities.models?.find((m: any) => 
                                            m.referenceName.toLowerCase() === content.properties.definitionName.toLowerCase()
                                        );
                                    }
                                    
                                    if (!model) {
                                        missing.push(`Model:${content.properties.definitionName}`);
                                    }
                                }
                                
                                // Check content's asset dependencies
                                const contentMissing = this.findMissingAssetsForContent(content, sourceEntities);
                                missing.push(...contentMissing);
                            }
                        }
                    });
                }
            }
        }

        return missing;
    }

    /**
     * Find missing dependencies for a content item
     */
    private findMissingDependenciesForContent(content: any, sourceEntities: any): string[] {
        const missing: string[] = [];

        // Check model dependency
        if (content.properties?.definitionName) {
            // Use case-insensitive model lookup
            let model = sourceEntities.models?.find((m: any) => m.referenceName === content.properties.definitionName);
            if (!model) {
                // Try case-insensitive match for model names
                model = sourceEntities.models?.find((m: any) => 
                    m.referenceName.toLowerCase() === content.properties.definitionName.toLowerCase()
                );
            }
            
            if (!model) {
                missing.push(`Model:${content.properties.definitionName}`);
            }
        }

        // Check nested content dependencies
        if (content.fields) {
            const nestedContent = this.extractNestedContainerReferences(content.fields);
            nestedContent.forEach((nestedRef: any) => {
                const nestedContentItem = sourceEntities.content?.find((c: any) => c.contentID === nestedRef.contentID);
                if (!nestedContentItem) {
                    missing.push(`Content:${nestedRef.contentID}`);
                }
            });
        }

        // Check asset dependencies
        const assetMissing = this.findMissingAssetsForContent(content, sourceEntities);
        missing.push(...assetMissing);

        return missing;
    }

    /**
     * Find missing dependencies for a model
     */
    private findMissingDependenciesForModel(model: any, sourceEntities: any): string[] {
        const missing: string[] = [];

        if (!model.fields) return missing;

        model.fields.forEach((field: any) => {
            if (field.type === 'Content' && field.settings?.['ContentDefinition']) {
                const referencedModelName = field.settings['ContentDefinition'];
                const referencedModel = sourceEntities.models?.find((m: any) => m.referenceName === referencedModelName);
                if (!referencedModel) {
                    missing.push(`Model:${referencedModelName}`);
                }
            }
        });

        return missing;
    }

    /**
     * Find missing assets for content
     */
    private findMissingAssetsForContent(content: any, sourceEntities: any): string[] {
        const missing: string[] = [];

        if (!content.fields) return missing;

        const assetRefs = this.extractAssetReferences(content.fields);
        assetRefs.forEach((assetRef: any) => {
            const asset = sourceEntities.assets?.find((a: any) => 
                a.originUrl === assetRef.url || 
                a.url === assetRef.url || 
                a.edgeUrl === assetRef.url
            );
            if (!asset) {
                missing.push(`Asset:${assetRef.url}`);
            } else {
                // Check gallery dependency if asset has one
                if (asset.mediaGroupingID) {
                    const gallery = sourceEntities.galleries?.find((g: any) => g.mediaGroupingID === asset.mediaGroupingID);
                    if (!gallery) {
                        missing.push(`Gallery:${asset.mediaGroupingID}`);
                    }
                }
            }
        });

        return missing;
    }

    /**
     * Collect models used in other chains (helper for broken chain analysis)
     */
    private collectModelsUsedInOtherChains(sourceEntities: any, modelsInOtherChains: Set<string>): void {
        // Collect models from page chains
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                this.collectModelsFromPageChains(page, sourceEntities, modelsInOtherChains);
            });
        }

        // Collect models from content chains
        if (sourceEntities.content) {
            sourceEntities.content.forEach((content: any) => {
                if (content.properties?.definitionName) {
                    modelsInOtherChains.add(content.properties.definitionName);
                }
            });
        }
    }

    /**
     * Find missing dependencies for a container
     */
    private findMissingDependenciesForContainer(container: any, sourceEntities: any): string[] {
        const missing: string[] = [];

        // Check container's model dependency
        if (container.contentDefinitionID) {
            const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
            if (!model) {
                missing.push(`Model:ID_${container.contentDefinitionID}`);
            }
        }

        // Check nested container dependencies
        if (container.fields) {
            const nestedContainers = this.extractNestedContainerReferences(container.fields);
            nestedContainers.forEach((nestedRef: any) => {
                const nestedContainer = sourceEntities.containers?.find((c: any) => c.contentViewID === nestedRef.contentID);
                if (!nestedContainer) {
                    missing.push(`ContainerID:${nestedRef.contentID}`);
                }
            });
        }

        // Check asset dependencies
        missing.push(...this.findMissingAssetsForContent(container, sourceEntities));

        return missing;
    }
}