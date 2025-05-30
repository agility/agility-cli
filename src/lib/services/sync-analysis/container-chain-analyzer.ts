/**
 * Container Chain Analyzer Service
 * 
 * Handles analysis and display of container dependency chains.
 * Shows containers not in page chains and their dependencies.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext, 
    ChainAnalysisService 
} from './types';
import { AssetReferenceExtractor } from './asset-reference-extractor';
import { ContainerReferenceExtractor } from './container-reference-extractor';
import { DependencyFinder } from './dependency-finder';

export class ContainerChainAnalyzer implements ChainAnalysisService {
    private context?: SyncAnalysisContext;
    private assetExtractor: AssetReferenceExtractor;
    private containerExtractor: ContainerReferenceExtractor;
    private dependencyFinder: DependencyFinder;

    constructor() {
        this.assetExtractor = new AssetReferenceExtractor();
        this.containerExtractor = new ContainerReferenceExtractor();
        this.dependencyFinder = new DependencyFinder();
    }

    /**
     * Initialize with analysis context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.assetExtractor.initialize(context);
        this.containerExtractor.initialize(context);
        this.dependencyFinder.initialize(context);
    }

    /**
     * Analyze and display the chains for this service's domain (ChainAnalysisService interface)
     */
    analyzeChains(sourceEntities: SourceEntities): void {
        this.showContainerChains(sourceEntities);
    }

    /**
     * Show containers not in page chains with their dependencies
     */
    showContainerChains(sourceEntities: SourceEntities): void {
        if (!sourceEntities.containers || sourceEntities.containers.length === 0) {
            console.log(ansiColors.gray('  No containers found in source data'));
            return;
        }

        // First, identify all containers that were processed in page chains
        const containersInPageChains = new Set<number>();
        
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                this.containerExtractor.collectContainersFromPageZones(page.zones, containersInPageChains);
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
            const missing = this.dependencyFinder.findMissingDependenciesForContainer(container, sourceEntities);
            const isBroken = missing.length > 0;
            
            const brokenIndicator = isBroken ? ansiColors.red(' [BROKEN]') : '';
            console.log(ansiColors.white(`\n  ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'}${brokenIndicator}`));
            
            // Show complete dependency hierarchy for this container
            this.showContainerDependencyHierarchy(container, sourceEntities, '    ');
        });
    }

    /**
     * Show complete dependency hierarchy for a single container
     */
    showContainerDependencyHierarchy(container: any, sourceEntities: SourceEntities, indent: string): void {
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
            const nestedContainers = this.containerExtractor.extractNestedContainerReferences(container.fields);
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
    showContainerAssetDependencies(container: any, sourceEntities: SourceEntities, indent: string): void {
        if (!sourceEntities.content) return;

        // Find content items that reference this container's contentDefinitionID
        const containerContent = sourceEntities.content.filter((c: any) => 
            c.contentDefinitionID === container.contentDefinitionID
        );

        containerContent.forEach((content: any) => {
            if (!content.fields) return;

            const assetRefs = this.assetExtractor.extractAssetReferences(content.fields);
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
     * Show content asset dependencies (delegated to asset extractor)
     */
    private showContentAssetDependencies(content: any, sourceEntities: SourceEntities, indent: string): void {
        this.assetExtractor.showContentAssetDependencies(content, sourceEntities, indent);
    }
} 