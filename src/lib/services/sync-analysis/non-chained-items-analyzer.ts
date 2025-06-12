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
    EntityCounts,
    EntitiesInChains
} from '../../../types/syncAnalysis';
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

        // Display results
        console.log(ansiColors.yellow('Items that exist but are not referenced by any chains:'));
        
        // Show pages (excluding folder pages)
        const nonChainedPages = sourceEntities.pages?.filter((page: any) => 
            !entitiesInChains.pages.has(page.pageID) && page.pageType !== 'folder'
        ) || [];
        
        if (nonChainedPages.length > 0) {
            console.log(ansiColors.blue(`\n  📄 PAGES: ${nonChainedPages.length} items`));
            nonChainedPages.forEach((page: any) => {
                let status = '';
                if (!page.templateName || page.templateName === null) {
                    status = ' (No template)';
                }
                console.log(ansiColors.gray(`    - PageID:${page.pageID} (${page.name || page.menuText || 'No Name'}${status})`));
            });
        }

        // Show content items individually
        const nonChainedContent = sourceEntities.content?.filter((content: any) => 
            !entitiesInChains.content.has(content.contentID)
        ) || [];
        
        if (nonChainedContent.length > 0) {
            console.log(ansiColors.blue(`\n  📋 CONTENT: ${nonChainedContent.length} items`));
            nonChainedContent.forEach((content: any) => {
                const contentName = content.properties?.referenceName || 'No Name';
                console.log(ansiColors.gray(`    - ContentID:${content.contentID} (${contentName})`));
            });
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

        // Show templates
        const nonChainedTemplates = sourceEntities.templates?.filter((template: any) => 
            !entitiesInChains.templates.has(template.pageTemplateName)
        ) || [];
        
        if (nonChainedTemplates.length > 0) {
            console.log(ansiColors.magenta(`\n  📋 TEMPLATES: ${nonChainedTemplates.length} items`));
            nonChainedTemplates.forEach((template: any) => {
                console.log(ansiColors.gray(`    - Template:${template.pageTemplateName}`));
            });
        }

        // Show containers outside of chains
        const nonChainedContainers = sourceEntities.containers?.filter((container: any) => 
            !entitiesInChains.containers.has(container.contentViewID)
        ) || [];
        
        if (nonChainedContainers.length > 0) {
            console.log(ansiColors.white(`\n  📦 CONTAINERS: ${nonChainedContainers.length} items`));
            nonChainedContainers.forEach((container: any) => {
                const modelInfo = container.contentDefinitionID ? ` - Model ID: ${container.contentDefinitionID}` : ' - No Model';
                console.log(ansiColors.gray(`    - ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'}${modelInfo})`));
            });
        }

        // Debug output for relationship mapping issues
        if (this.context?.debug && nonChainedContent.length > 0) {
    
            
            // Show some sample non-chained content with their referenceName
            console.log(ansiColors.gray(`    Sample non-chained content items:`));
            nonChainedContent.slice(0, 10).forEach((content: any) => {
                const refName = content.properties?.referenceName || 'NO_REFERENCE_NAME';
                const modelName = content.properties?.definitionName || 'NO_MODEL';
                console.log(ansiColors.gray(`      - ContentID:${content.contentID} refName:"${refName}" model:"${modelName}"`));
            });
            
            // Show what containers we found
            console.log(ansiColors.gray(`    Referenced containers (${entitiesInChains.containers.size} total):`));
            Array.from(entitiesInChains.containers).forEach(containerId => {
                const container = sourceEntities.containers?.find(c => c.contentViewID === containerId);
                if (container) {
                    console.log(ansiColors.gray(`      - ContainerID:${containerId} refName:"${container.referenceName}"`));
                }
            });
            
            // Check for specific i18 relationship issues
            const i18Content = nonChainedContent.filter(c => 
                c.properties?.referenceName?.toLowerCase().includes('i18') ||
                c.properties?.definitionName?.toLowerCase().includes('i18')
            );
            if (i18Content.length > 0) {
                console.log(ansiColors.yellow(`    🌐 Found ${i18Content.length} i18-related content items that aren't matched to containers:`));
                i18Content.slice(0, 5).forEach((content: any) => {
                    const refName = content.properties?.referenceName;
                    console.log(ansiColors.yellow(`      - ContentID:${content.contentID} refName:"${refName}"`));
                    
                    // Try to find potential container matches
                    const possibleContainers = sourceEntities.containers?.filter(c => 
                        c.referenceName && refName && 
                        (c.referenceName.toLowerCase().includes(refName.toLowerCase()) ||
                         refName.toLowerCase().includes(c.referenceName.toLowerCase()))
                    );
                    if (possibleContainers && possibleContainers.length > 0) {
                        console.log(ansiColors.yellow(`        Possible container matches: ${possibleContainers.map(c => `${c.referenceName}(${c.contentViewID})`).join(', ')}`));
                    }
                });
            }
        }

        // Show assets not referenced by content
        const nonChainedAssets = sourceEntities.assets?.filter((asset: any) => 
            !entitiesInChains.assets.has(asset.originUrl)
        ) || [];
        
        if (nonChainedAssets.length > 0) {
            console.log(ansiColors.yellow(`\n  🖼️  ASSETS: ${nonChainedAssets.length} items`));
            console.log(ansiColors.gray(`    (Assets not referenced by any content fields)`));
            // Show first 10 assets to avoid overwhelming output
            const assetsToShow = Math.min(10, nonChainedAssets.length);
            nonChainedAssets.slice(0, assetsToShow).forEach((asset: any) => {
                const fileName = asset.fileName || asset.originUrl || 'Unknown';
                console.log(ansiColors.gray(`    - Asset: ${fileName}`));
            });
            if (nonChainedAssets.length > 10) {
                console.log(ansiColors.gray(`    ... and ${nonChainedAssets.length - 10} more assets`));
            }
        }

        // Show all galleries individually
        if (sourceEntities.galleries && sourceEntities.galleries.length > 0) {
            console.log(ansiColors.gray(`\n  📁 GALLERIES: ${sourceEntities.galleries.length} items`));
            sourceEntities.galleries.forEach((gallery: any) => {
                const galleryName = gallery.name || gallery.mediaGroupingID || 'No Name';
                console.log(ansiColors.gray(`    - Gallery: ${galleryName} (ID: ${gallery.mediaGroupingID})`));
            });
        }

        // Summary
        const totalNonChained = nonChainedPages.length + nonChainedContent.length + nonChainedModels.length + 
                               nonChainedTemplates.length + nonChainedContainers.length + nonChainedAssets.length + 
                               (sourceEntities.galleries?.length || 0);
        
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
        // First, collect all containers that are actually referenced (from pages AND templates)
        const referencedContainers = new Set<number>();
        
        // Collect containers from page zones
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                this.containerExtractor.collectContainersFromPageZones(page.zones, referencedContainers);
            });
        }
        
        // Collect containers from templates
        if (sourceEntities.templates) {
            sourceEntities.templates.forEach((template: any) => {
                if (template.contentSectionDefinitions) {
                    template.contentSectionDefinitions.forEach((section: any) => {
                        if (section.itemContainerID) {
                            referencedContainers.add(section.itemContainerID);
                        }
                    });
                }
            });
        }

        // CRITICAL FIX: Also include containers that have content items with matching referenceNames
        // This fixes the i18 container issue where ContainerID:72 has thousands of content items
        // but isn't directly referenced by pages or templates
        if (sourceEntities.containers && sourceEntities.content) {
            sourceEntities.containers.forEach((container: any) => {
                if (container.referenceName) {
                    // Check if any content items reference this container
                    const hasMatchingContent = sourceEntities.content.some((content: any) => 
                        content.properties?.referenceName && 
                        content.properties.referenceName.toLowerCase() === container.referenceName.toLowerCase()
                    );
                    
                    if (hasMatchingContent) {
                        referencedContainers.add(container.contentViewID);
                        

                    }
                }
            });
        }

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
                    
                    // Track containers from template
                    const template = sourceEntities.templates?.find((t: any) => t.pageTemplateName === page.templateName);
                    if (template?.contentSectionDefinitions) {
                        template.contentSectionDefinitions.forEach((section: any) => {
                            if (section.itemContainerID) {
                                entitiesInChains.containers.add(section.itemContainerID);
                            }
                        });
                    }
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
                                        
                                        // Track the container this content belongs to
                                        if (content.properties?.referenceName) {
                                            const container = sourceEntities.containers?.find((c: any) => 
                                                c.referenceName && c.referenceName.toLowerCase() === content.properties.referenceName.toLowerCase()
                                            );
                                            if (container) {
                                                entitiesInChains.containers.add(container.contentViewID);
                                            }
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

        // Collect all content that belongs to referenced containers
        if (sourceEntities.containers && sourceEntities.content) {
            sourceEntities.containers.forEach((container: any) => {
                if (referencedContainers.has(container.contentViewID)) {
                    // This container is referenced, so track it and its content
                    entitiesInChains.containers.add(container.contentViewID);
                    
                    // Track container's model
                    if (container.contentDefinitionID) {
                        const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
                        if (model) {
                            entitiesInChains.models.add(model.referenceName);
                        }
                    }
                    
                    // Track ALL content that belongs to this container (via referenceName)
                    const containerContent = sourceEntities.content.filter((content: any) => 
                        content.properties?.referenceName && container.referenceName &&
                        content.properties.referenceName.toLowerCase() === container.referenceName.toLowerCase()
                    );
                    

                    
                    containerContent.forEach((content: any) => {
                        entitiesInChains.content.add(content.contentID);
                        
                        // Track content's model
                        if (content.properties?.definitionName) {
                            entitiesInChains.models.add(content.properties.definitionName);
                        }
                        
                        // Track assets from content
                        const assetRefs = this.assetExtractor.extractAssetReferences(content.fields);
                        assetRefs.forEach((assetRef: any) => {
                            entitiesInChains.assets.add(assetRef.url);
                        });
                    });
                }
            });
        }

        // CRITICAL FIX: Also include containers that have valid models (Container → Model chains)
        // These containers might not have content or be used in pages, but they still form dependency chains
        if (sourceEntities.containers) {
            sourceEntities.containers.forEach((container: any) => {
                // If container has a valid model, it forms a dependency chain (Container → Model)
                if (container.contentDefinitionID) {
                    const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
                    if (model) {
                        // This container has a valid model, so it's part of a chain
                        entitiesInChains.containers.add(container.contentViewID);
                        entitiesInChains.models.add(model.referenceName);
                        

                    }
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