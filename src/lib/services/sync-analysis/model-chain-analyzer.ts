/**
 * Model Chain Analyzer Service
 * 
 * Handles analysis and display of model-to-model dependency chains.
 * Shows independent model chains not used in page or container chains.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext, 
    ChainAnalysisService 
} from './types';
import { ContainerReferenceExtractor } from './container-reference-extractor';

export class ModelChainAnalyzer implements ChainAnalysisService {
    private context?: SyncAnalysisContext;
    private containerExtractor: ContainerReferenceExtractor;

    constructor() {
        this.containerExtractor = new ContainerReferenceExtractor();
    }

    /**
     * Initialize with analysis context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.containerExtractor.initialize(context);
    }

    /**
     * Analyze and display the chains for this service's domain (ChainAnalysisService interface)
     */
    analyzeChains(sourceEntities: SourceEntities): void {
        this.showModelToModelChains(sourceEntities);
    }

    /**
     * Show independent model-to-model chains
     */
    showModelToModelChains(sourceEntities: SourceEntities): void {
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
    collectModelsFromPageChains(page: any, sourceEntities: SourceEntities, modelNames: Set<string>): void {
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
            this.containerExtractor.collectContainersFromPageZones(page.zones, new Set());
            
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
                                    const nestedRefs = this.containerExtractor.extractNestedContainerReferences(content.fields);
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
    findModelToModelChains(models: any[], modelsInOtherChains: Set<string>): any[] {
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
    modelHasModelDependencies(model: any): boolean {
        if (!model.fields) return false;

        return model.fields.some((field: any) => 
            field.type === 'Content' && field.settings?.['ContentDefinition']
        );
    }

    /**
     * Show model dependency hierarchy
     */
    showModelDependencyHierarchy(model: any, sourceEntities: SourceEntities, indent: string, visited: Set<string>): void {
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
} 