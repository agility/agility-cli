/**
 * Non-Chained Items Analyzer Service
 * 
 * Identifies and displays entities that exist but are not referenced by any dependency chains.
 * Shows pages, content, models, templates, assets, and galleries that are outside chains.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext, 
    ChainAnalysisService,
    EntitiesInChains 
} from './types';
import { ContainerReferenceExtractor } from './container-reference-extractor';
import { AssetReferenceExtractor } from './asset-reference-extractor';
import { ModelChainAnalyzer } from './model-chain-analyzer';

export class NonChainedItemsAnalyzer implements ChainAnalysisService {
    private context?: SyncAnalysisContext;
    private containerExtractor: ContainerReferenceExtractor;
    private assetExtractor: AssetReferenceExtractor;
    private modelAnalyzer: ModelChainAnalyzer;

    constructor() {
        this.containerExtractor = new ContainerReferenceExtractor();
        this.assetExtractor = new AssetReferenceExtractor();
        this.modelAnalyzer = new ModelChainAnalyzer();
    }

    /**
     * Initialize with analysis context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.containerExtractor.initialize(context);
        this.assetExtractor.initialize(context);
        this.modelAnalyzer.initialize(context);
    }

    /**
     * Analyze and display the chains for this service's domain (ChainAnalysisService interface)
     */
    analyzeChains(sourceEntities: SourceEntities): void {
        this.showNonChainedItems(sourceEntities);
    }

    /**
     * Show items that exist but are not referenced by any chains
     */
    showNonChainedItems(sourceEntities: SourceEntities): void {
        // Track all entities that are in chains
        const entitiesInChains: EntitiesInChains = {
            pages: new Set<number>(),
            content: new Set<number>(),
            models: new Set<string>(),
            templates: new Set<string>(),
            containers: new Set<number>(),
            assets: new Set<string>(),
            galleries: new Set<number>()
        };

        // Collect all entities that are in chains
        this.collectAllEntitiesInChains(sourceEntities, entitiesInChains);

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
     * Collect all entities that are in dependency chains
     */
    collectAllEntitiesInChains(sourceEntities: SourceEntities, entitiesInChains: EntitiesInChains): void {
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
                                        const assetRefs = this.assetExtractor.extractAssetReferences(content.fields);
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
                    this.containerExtractor.collectContainersFromPageZones(page.zones, containersInPageChains);
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
                        const assetRefs = this.assetExtractor.extractAssetReferences(content.fields);
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

            const modelToModelChains = this.modelAnalyzer.findModelToModelChains(sourceEntities.models, modelsInOtherChains);
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
     * Collect models used in other chains (delegated to model analyzer)
     */
    private collectModelsUsedInOtherChains(sourceEntities: SourceEntities, modelsInOtherChains: Set<string>): void {
        // Collect models from page chains
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                this.modelAnalyzer.collectModelsFromPageChains(page, sourceEntities, modelsInOtherChains);
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
    }
} 