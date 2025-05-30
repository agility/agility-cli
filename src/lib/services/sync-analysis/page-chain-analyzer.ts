/**
 * Page Chain Analyzer Service
 * 
 * Handles analysis and display of page dependency chains with HIERARCHICAL INTEGRATION.
 * This service replaces the flat page display with proper parent-child hierarchy.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext, 
    ChainAnalysisService 
} from './types';
import { AssetReferenceExtractor } from './asset-reference-extractor';
import { DependencyFinder } from './dependency-finder';
import { PageChainDisplay } from '../dependency-analyzer/page-chain-display';

export class PageChainAnalyzer implements ChainAnalysisService {
    private context?: SyncAnalysisContext;
    private assetExtractor: AssetReferenceExtractor;
    private dependencyFinder: DependencyFinder;
    private hierarchicalDisplay?: PageChainDisplay;

    constructor() {
        this.assetExtractor = new AssetReferenceExtractor();
        this.dependencyFinder = new DependencyFinder();
    }

    /**
     * Initialize the service with context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.assetExtractor.initialize(context);
        this.dependencyFinder.initialize(context);
        
        // Initialize hierarchical display
        this.hierarchicalDisplay = new PageChainDisplay(
            context.rootPath,
            context.sourceGuid,
            context.locale,
            context.isPreview,
            context.debug
        );
    }

    /**
     * Analyze and display page chains with HIERARCHICAL STRUCTURE
     * 🎯 HIERARCHICAL INTEGRATION: Uses Phase 17 functionality immediately
     */
    analyzeChains(sourceEntities: SourceEntities): void {
        this.showAllPageChains(sourceEntities);
    }

    /**
     * Show all page chains with hierarchical structure (PageID:17 under PageID:16)
     * 🎯 INTEGRATION: Replaces flat display with hierarchical version
     */
    showAllPageChains(sourceEntities: SourceEntities): void {
        if (!sourceEntities.pages || sourceEntities.pages.length === 0) {
            console.log(ansiColors.gray('  No pages found in source data'));
            return;
        }

        if (!this.hierarchicalDisplay) {
            console.log(ansiColors.red('  ❌ Hierarchical display not initialized'));
            return;
        }

        // 🎯 HIERARCHICAL INTEGRATION: Use Phase 17 hierarchical display
        this.hierarchicalDisplay.showAllPageChains(sourceEntities);
    }

    /**
     * Show dependencies for a template section
     */
    showTemplateSectionDependencies(section: any, sourceEntities: SourceEntities, indent: string): void {
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
    showPageZoneDependencies(zones: any, sourceEntities: SourceEntities, indent: string): void {
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
                            this.assetExtractor.showContentAssetDependencies(content, sourceEntities, `${indent}│  │  `);
                            
                        } else {
                            console.log(ansiColors.red(`${indent}│  ├─ ContentID:${contentId} - MISSING IN SOURCE DATA`));
                        }
                    }
                });
            }
        }
    }

    /**
     * Get missing dependencies for a page (delegates to dependency finder)
     */
    findMissingDependenciesForPage(page: any, sourceEntities: SourceEntities): string[] {
        return this.dependencyFinder.findMissingDependenciesForPage(page, sourceEntities);
    }
} 