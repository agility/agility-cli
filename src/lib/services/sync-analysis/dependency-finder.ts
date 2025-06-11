/**
 * Dependency Finder Service
 * 
 * Handles finding missing dependencies for various entity types.
 * Used for validation and broken chain detection in sync analysis.
 */

import { 
    SourceEntities, 
    SyncAnalysisContext,
    DependencyValidationService,
    DependencyValidationResult
} from '../../../types/syncAnalysis';
import { AssetReferenceExtractor } from './asset-reference-extractor';
import { ContainerReferenceExtractor } from './container-reference-extractor';

export class DependencyFinder implements DependencyValidationService {
    private context?: SyncAnalysisContext;
    private assetExtractor: AssetReferenceExtractor;
    private containerExtractor: ContainerReferenceExtractor;

    constructor() {
        this.assetExtractor = new AssetReferenceExtractor();
        this.containerExtractor = new ContainerReferenceExtractor();
    }

    /**
     * Initialize the service with context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.assetExtractor.initialize(context);
        this.containerExtractor.initialize(context);
    }

    /**
     * Validate dependencies for a given entity
     */
    validateDependencies(entity: any, sourceEntities: SourceEntities): DependencyValidationResult {
        let missing: string[] = [];

        // Determine entity type and validate accordingly
        if (entity.pageID !== undefined) {
            missing = this.findMissingDependenciesForPage(entity, sourceEntities);
        } else if (entity.contentID !== undefined) {
            missing = this.findMissingDependenciesForContent(entity, sourceEntities);
        } else if (entity.contentViewID !== undefined) {
            missing = this.findMissingDependenciesForContainer(entity, sourceEntities);
        } else if (entity.referenceName !== undefined && entity.fields !== undefined) {
            missing = this.findMissingDependenciesForModel(entity, sourceEntities);
        }

        return {
            missing,
            isBroken: missing.length > 0
        };
    }

    /**
     * Find missing dependencies for a page
     */
    findMissingDependenciesForPage(page: any, sourceEntities: SourceEntities): string[] {
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
                                const contentMissing = this.assetExtractor.findMissingAssetsForContent(content, sourceEntities);
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
    findMissingDependenciesForContent(content: any, sourceEntities: SourceEntities): string[] {
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
            const nestedContent = this.containerExtractor.extractNestedContainerReferences(content.fields);
            nestedContent.forEach((nestedRef: any) => {
                const nestedContentItem = sourceEntities.content?.find((c: any) => c.contentID === nestedRef.contentID);
                if (!nestedContentItem) {
                    missing.push(`Content:${nestedRef.contentID}`);
                }
            });
        }

        // Check asset dependencies
        const assetMissing = this.assetExtractor.findMissingAssetsForContent(content, sourceEntities);
        missing.push(...assetMissing);

        return missing;
    }

    /**
     * Find missing dependencies for a model
     */
    findMissingDependenciesForModel(model: any, sourceEntities: SourceEntities): string[] {
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
     * Find missing dependencies for a container
     */
    findMissingDependenciesForContainer(container: any, sourceEntities: SourceEntities): string[] {
        const missing: string[] = [];

        // Check container's model dependency
        if (container.contentDefinitionID) {
            // Look for model using the new structured-era field name (definitionID)
            const model = sourceEntities.models?.find((m: any) => m.definitionID === container.contentDefinitionID);
            if (!model) {
                missing.push(`Model:ID_${container.contentDefinitionID}`);
            }
        }

        // Check nested container dependencies
        if (container.fields) {
            const nestedContainers = this.containerExtractor.extractNestedContainerReferences(container.fields);
            nestedContainers.forEach((nestedRef: any) => {
                const nestedContainer = sourceEntities.containers?.find((c: any) => c.contentViewID === nestedRef.contentID);
                if (!nestedContainer) {
                    missing.push(`ContainerID:${nestedRef.contentID}`);
                }
            });
        }

        // Check asset dependencies
        const assetMissing = this.assetExtractor.findMissingAssetsForContent(container, sourceEntities);
        missing.push(...assetMissing);

        return missing;
    }

    /**
     * Find all broken items across all entity types
     */
    findAllBrokenItems(sourceEntities: SourceEntities): string[] {
        const brokenItems: string[] = [];

        // Check pages
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                const missing = this.findMissingDependenciesForPage(page, sourceEntities);
                if (missing.length > 0) {
                    brokenItems.push(`PageID:${page.pageID} (${page.name || 'No Name'}) - Missing: ${missing.join(', ')}`);
                }
            });
        }

        // Check content
        if (sourceEntities.content) {
            sourceEntities.content.forEach((content: any) => {
                const missing = this.findMissingDependenciesForContent(content, sourceEntities);
                if (missing.length > 0) {
                    brokenItems.push(`ContentID:${content.contentID} (${content.properties?.referenceName || 'No Name'}) - Missing: ${missing.join(', ')}`);
                }
            });
        }

        // Check containers
        if (sourceEntities.containers) {
            sourceEntities.containers.forEach((container: any) => {
                const missing = this.findMissingDependenciesForContainer(container, sourceEntities);
                if (missing.length > 0) {
                    brokenItems.push(`ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'}) - Missing: ${missing.join(', ')}`);
                }
            });
        }

        // Check models
        if (sourceEntities.models) {
            sourceEntities.models.forEach((model: any) => {
                const missing = this.findMissingDependenciesForModel(model, sourceEntities);
                if (missing.length > 0) {
                    brokenItems.push(`Model:${model.referenceName} (${model.displayName || 'No Name'}) - Missing: ${missing.join(', ')}`);
                }
            });
        }

        return brokenItems;
    }
} 