import { UniversalReferenceExtractor } from './universal-reference-extractor';
import { StateValidator } from './state-validator';
import { EntityReference, SourceEntities } from './types';

/**
 * Universal Chain Builder
 * 
 * Builds complete dependency chains for ALL entity types using UniversalReferenceExtractor
 * Extends the "page chains" concept to cover all relationships: 
 * Content→Content, Content→Asset, Content→Gallery, Model→Model, Asset→Gallery
 */
export class UniversalChainBuilder {
    private referenceExtractor: UniversalReferenceExtractor;
    private stateValidator: StateValidator;
    
    constructor() {
        this.referenceExtractor = new UniversalReferenceExtractor();
        this.stateValidator = new StateValidator();
    }
    
    /**
     * Build complete dependency chains for ALL entity types
     */
    public buildUniversalChains(sourceEntities: SourceEntities): UniversalChainAnalysis {
        console.log('🔗 Building Universal Dependency Chains...');
        
        // Extract all references from all entities
        const allReferences = this.referenceExtractor.extractAllEntityReferences(sourceEntities);
        
        // Build chains by type
        const pageChains = this.buildPageChains(sourceEntities, allReferences);
        const contentToContentChains = this.buildContentToContentChains(sourceEntities, allReferences);
        const assetToGalleryChains = this.buildAssetToGalleryChains(sourceEntities, allReferences);
        const modelToModelChains = this.buildModelToModelChains(sourceEntities, allReferences);
        const containerChains = this.buildContainerChains(sourceEntities, allReferences);
        
        // Find broken chains and orphan references
        const brokenChains = this.findBrokenChains(allReferences, sourceEntities);
        const orphanReferences = this.findOrphanReferences(allReferences, sourceEntities);
        
        // Apply state-based filtering
        const stateFilteredResults = this.applyStateFiltering(sourceEntities);
        
        // Calculate comprehensive reconciliation
        const reconciliation = this.calculateUniversalReconciliation(
            sourceEntities, 
            brokenChains, 
            stateFilteredResults
        );
        
        return {
            pageChains,
            contentToContentChains,
            assetToGalleryChains,
            modelToModelChains,
            containerChains,
            brokenChains,
            orphanReferences,
            stateFiltering: stateFilteredResults,
            reconciliation,
            totalReferences: allReferences.length,
            referencesByType: this.groupReferencesByType(allReferences)
        };
    }
    
    /**
     * Build traditional page chains: Page → Template → Container → Model → Content → Asset/Gallery
     */
    private buildPageChains(sourceEntities: SourceEntities, allReferences: EntityReference[]): PageChain[] {
        const pageChains: PageChain[] = [];
        
        sourceEntities.pages?.forEach(page => {
            const pageRefs = allReferences.filter(ref => 
                ref.sourceType === 'page' && ref.sourceId === page.pageID
            );
            
            const chain: PageChain = {
                pageID: page.pageID,
                pageName: page.name,
                templateName: page.templateName || page.pageTemplateName,
                containers: [],
                totalContentItems: 0,
                totalAssets: 0,
                totalGalleries: 0,
                isComplete: true,
                brokenReferences: []
            };
            
            // Find template
            const templateRef = pageRefs.find(ref => ref.targetType === 'template');
            if (templateRef) {
                const template = sourceEntities.templates?.find(t => 
                    t.pageTemplateName === templateRef.targetId || t.pageTemplateID === templateRef.targetId
                );
                
                if (template) {
                    // Find containers referenced by template
                    const templateRefs = allReferences.filter(ref =>
                        ref.sourceType === 'template' && ref.sourceId === template.pageTemplateID
                    );
                    
                    templateRefs.forEach(tRef => {
                        if (tRef.targetType === 'container') {
                            const container = sourceEntities.containers?.find(c =>
                                c.referenceName === tRef.targetId || c.contentViewID === tRef.targetId
                            );
                            
                            if (container) {
                                const containerSubChain = this.buildContainerSubChain(container, sourceEntities, allReferences);
                                const containerChain: ContainerChain = {
                                    containerID: container.contentViewID,
                                    containerName: container.referenceName,
                                    modelName: this.findModelNameForContainer(container, sourceEntities),
                                    contentItems: containerSubChain.contentItems,
                                    totalAssets: containerSubChain.totalAssets,
                                    totalGalleries: containerSubChain.totalGalleries,
                                    isComplete: containerSubChain.isComplete,
                                    brokenReferences: containerSubChain.brokenReferences
                                };
                                chain.containers.push(containerChain);
                                chain.totalContentItems += containerChain.contentItems.length;
                                chain.totalAssets += containerChain.totalAssets;
                                chain.totalGalleries += containerChain.totalGalleries;
                            } else {
                                chain.brokenReferences.push(`Container not found: ${tRef.targetId}`);
                                chain.isComplete = false;
                            }
                        }
                    });
                } else {
                    chain.brokenReferences.push(`Template not found: ${templateRef.targetId}`);
                    chain.isComplete = false;
                }
            }
            
            // Add content directly referenced by page zones
            const pageContentRefs = pageRefs.filter(ref => ref.targetType === 'content');
            pageContentRefs.forEach(pcRef => {
                const content = sourceEntities.content?.find(c => c.contentID === pcRef.targetId);
                if (content) {
                    // Check if this content is already in a container chain
                    const alreadyIncluded = chain.containers.some(cc => 
                        cc.contentItems.some(ci => ci.contentID === content.contentID)
                    );
                    
                    if (!alreadyIncluded) {
                        // Create a direct content reference
                        const directContentChain = this.buildContentSubChain(content, sourceEntities, allReferences);
                        chain.containers.push({
                            containerID: -1,
                            containerName: 'Direct Page Reference',
                            modelName: content.properties?.definitionName || 'Unknown',
                            contentItems: [directContentChain],
                            totalAssets: directContentChain.totalAssets,
                            totalGalleries: directContentChain.totalGalleries,
                            isComplete: directContentChain.isComplete,
                            brokenReferences: directContentChain.brokenReferences
                        });
                    }
                }
            });
            
            pageChains.push(chain);
        });
        
        return pageChains;
    }
    
    /**
     * Build Content→Content dependency chains
     */
    private buildContentToContentChains(sourceEntities: SourceEntities, allReferences: EntityReference[]): ContentToContentChain[] {
        const chains: ContentToContentChain[] = [];
        const processedContent = new Set<number>();
        
        // Find content items that reference other content
        const contentToContentRefs = allReferences.filter(ref => 
            ref.sourceType === 'content' && ref.targetType === 'content'
        );
        
        contentToContentRefs.forEach(ref => {
            if (!processedContent.has(ref.sourceId as number)) {
                const chain = this.buildContentToContentChain(ref.sourceId as number, sourceEntities, allReferences, processedContent);
                if (chain) {
                    chains.push(chain);
                }
            }
        });
        
        return chains;
    }
    
    /**
     * Build Asset→Gallery dependency chains
     */
    private buildAssetToGalleryChains(sourceEntities: SourceEntities, allReferences: EntityReference[]): AssetToGalleryChain[] {
        const chains: AssetToGalleryChain[] = [];
        
        // Group assets by gallery
        const assetsByGallery = new Map<string | number, any[]>();
        
        const assetToGalleryRefs = allReferences.filter(ref => 
            ref.sourceType === 'asset' && ref.targetType === 'gallery'
        );
        
        assetToGalleryRefs.forEach(ref => {
            const asset = sourceEntities.assets?.find(a => a.mediaID === ref.sourceId);
            if (asset) {
                const galleryKey = ref.targetId;
                if (!assetsByGallery.has(galleryKey)) {
                    assetsByGallery.set(galleryKey, []);
                }
                assetsByGallery.get(galleryKey)!.push(asset);
            }
        });
        
        // Create chains for each gallery
        assetsByGallery.forEach((assets, galleryKey) => {
            const gallery = sourceEntities.galleries?.find(g => 
                g.mediaGroupingID === galleryKey || g.name === galleryKey
            );
            
            chains.push({
                galleryID: gallery?.mediaGroupingID || galleryKey,
                galleryName: gallery?.name || 'Unknown Gallery',
                assets: assets,
                totalAssets: assets.length,
                isComplete: !!gallery,
                brokenReferences: gallery ? [] : [`Gallery not found: ${galleryKey}`]
            });
        });
        
        return chains;
    }
    
    /**
     * Build Model→Model dependency chains
     */
    private buildModelToModelChains(sourceEntities: SourceEntities, allReferences: EntityReference[]): ModelToModelChain[] {
        const chains: ModelToModelChain[] = [];
        const processedModels = new Set<string | number>();
        
        const modelToModelRefs = allReferences.filter(ref => 
            ref.sourceType === 'model' && ref.targetType === 'model'
        );
        
        modelToModelRefs.forEach(ref => {
            if (!processedModels.has(ref.sourceId)) {
                const chain = this.buildModelToModelChain(ref.sourceId, sourceEntities, allReferences, processedModels);
                if (chain) {
                    chains.push(chain);
                }
            }
        });
        
        return chains;
    }
    
    /**
     * Build Container chains (extends existing logic)
     */
    private buildContainerChains(sourceEntities: SourceEntities, allReferences: EntityReference[]): ContainerChain[] {
        const chains: ContainerChain[] = [];
        
        sourceEntities.containers?.forEach(container => {
            const containerChain = this.buildContainerSubChain(container, sourceEntities, allReferences);
            chains.push({
                containerID: container.contentViewID,
                containerName: container.referenceName,
                modelName: this.findModelNameForContainer(container, sourceEntities),
                contentItems: containerChain.contentItems,
                totalAssets: containerChain.totalAssets,
                totalGalleries: containerChain.totalGalleries,
                isComplete: containerChain.isComplete,
                brokenReferences: containerChain.brokenReferences
            });
        });
        
        return chains;
    }
    
    /**
     * Helper: Build container sub-chain
     */
    private buildContainerSubChain(container: any, sourceEntities: SourceEntities, allReferences: EntityReference[]) {
        const contentItems = sourceEntities.content?.filter(c => 
            c.properties?.referenceName === container.referenceName
        ) || [];
        
        const contentSubChains = contentItems.map(content => 
            this.buildContentSubChain(content, sourceEntities, allReferences)
        );
        
        return {
            contentItems: contentSubChains,
            totalAssets: contentSubChains.reduce((sum, c) => sum + c.totalAssets, 0),
            totalGalleries: contentSubChains.reduce((sum, c) => sum + c.totalGalleries, 0),
            isComplete: contentSubChains.every(c => c.isComplete),
            brokenReferences: contentSubChains.flatMap(c => c.brokenReferences)
        };
    }
    
    /**
     * Helper: Build content sub-chain
     */
    private buildContentSubChain(content: any, sourceEntities: SourceEntities, allReferences: EntityReference[]) {
        const contentRefs = allReferences.filter(ref => 
            ref.sourceType === 'content' && ref.sourceId === content.contentID
        );
        
        const assetRefs = contentRefs.filter(ref => ref.targetType === 'asset');
        const galleryRefs = contentRefs.filter(ref => ref.targetType === 'gallery');
        const nestedContentRefs = contentRefs.filter(ref => ref.targetType === 'content');
        
        const brokenReferences: string[] = [];
        
        // Validate asset references
        assetRefs.forEach(ref => {
            const assetExists = sourceEntities.assets?.find(a => 
                a.mediaID === ref.targetId || 
                a.originUrl === ref.targetId ||
                a.url === ref.targetId ||
                a.edgeUrl === ref.targetId
            );
            if (!assetExists) {
                brokenReferences.push(`Asset not found: ${ref.targetId}`);
            }
        });
        
        // Validate gallery references
        galleryRefs.forEach(ref => {
            const galleryExists = sourceEntities.galleries?.find(g => 
                g.mediaGroupingID === ref.targetId || g.name === ref.targetId
            );
            if (!galleryExists) {
                brokenReferences.push(`Gallery not found: ${ref.targetId}`);
            }
        });
        
        // Validate nested content references
        nestedContentRefs.forEach(ref => {
            const contentExists = sourceEntities.content?.find(c => c.contentID === ref.targetId);
            if (!contentExists) {
                brokenReferences.push(`Content not found: ${ref.targetId}`);
            }
        });
        
        return {
            contentID: content.contentID,
            contentName: content.properties?.referenceName || 'Unknown',
            totalAssets: assetRefs.length,
            totalGalleries: galleryRefs.length,
            nestedContentCount: nestedContentRefs.length,
            isComplete: brokenReferences.length === 0,
            brokenReferences
        };
    }
    
    /**
     * Enhanced: Build Content→Content chain with deep recursion for LinkedContentDropdown patterns
     */
    private buildContentToContentChain(
        contentId: number, 
        sourceEntities: SourceEntities, 
        allReferences: EntityReference[],
        processedContent: Set<number>,
        depth = 0
    ): ContentToContentChain | null {
        // Increased depth limit for complex content dependency chains
        if (processedContent.has(contentId) || depth > 20) return null; // Allow deeper recursion
        
        processedContent.add(contentId);
        
        const content = sourceEntities.content?.find(c => c.contentID === contentId);
        if (!content) return null;
        
        // Enhanced: Find ALL content→content relationship types
        const contentRefs = allReferences.filter(ref => 
            ref.sourceType === 'content' && ref.sourceId === contentId && ref.targetType === 'content'
        );
        
        const nestedChains: ContentToContentChain[] = [];
        const brokenReferences: string[] = [];
        const relationshipTypes: string[] = [];
        
        // Group by relationship type for better visibility
        const refsByType = new Map<string, EntityReference[]>();
        contentRefs.forEach(ref => {
            const relType = ref.relationshipType || 'unknown';
            if (!refsByType.has(relType)) {
                refsByType.set(relType, []);
            }
            refsByType.get(relType)!.push(ref);
            relationshipTypes.push(relType);
        });
        
        contentRefs.forEach(ref => {
            const nestedContent = sourceEntities.content?.find(c => c.contentID === ref.targetId);
            if (nestedContent) {
                const nestedChain = this.buildContentToContentChain(
                    ref.targetId as number, 
                    sourceEntities, 
                    allReferences, 
                    processedContent, 
                    depth + 1
                );
                if (nestedChain) {
                    nestedChains.push(nestedChain);
                }
            } else {
                brokenReferences.push(`Content not found: ${ref.targetId} (${ref.relationshipType})`);
            }
        });
        
        return {
            contentID: content.contentID,
            contentName: content.properties?.referenceName || 'Unknown',
            nestedContent: nestedChains,
            totalNested: nestedChains.length,
            depth,
            relationshipTypes: Array.from(new Set(relationshipTypes)), // Unique relationship types
            isComplete: brokenReferences.length === 0,
            brokenReferences
        };
    }
    
    /**
     * Helper: Build Model→Model chain recursively
     */
    private buildModelToModelChain(
        modelId: string | number,
        sourceEntities: SourceEntities,
        allReferences: EntityReference[],
        processedModels: Set<string | number>,
        depth = 0
    ): ModelToModelChain | null {
        if (processedModels.has(modelId) || depth > 10) return null;
        
        processedModels.add(modelId);
        
        const model = sourceEntities.models?.find(m => m.id === modelId || m.referenceName === modelId);
        if (!model) return null;
        
        const modelRefs = allReferences.filter(ref =>
            ref.sourceType === 'model' && ref.sourceId === modelId && ref.targetType === 'model'
        );
        
        const nestedChains: ModelToModelChain[] = [];
        const brokenReferences: string[] = [];
        
        modelRefs.forEach(ref => {
            const nestedModel = sourceEntities.models?.find(m => 
                m.id === ref.targetId || m.referenceName === ref.targetId
            );
            if (nestedModel) {
                const nestedChain = this.buildModelToModelChain(
                    ref.targetId,
                    sourceEntities,
                    allReferences,
                    processedModels,
                    depth + 1
                );
                if (nestedChain) {
                    nestedChains.push(nestedChain);
                }
            } else {
                brokenReferences.push(`Model not found: ${ref.targetId}`);
            }
        });
        
        return {
            modelID: model.id,
            modelName: model.referenceName,
            displayName: model.displayName,
            nestedModels: nestedChains,
            totalNested: nestedChains.length,
            depth,
            isComplete: brokenReferences.length === 0,
            brokenReferences
        };
    }
    
    /**
     * Find broken chains across all relationship types
     */
    private findBrokenChains(allReferences: EntityReference[], sourceEntities: SourceEntities): BrokenChain[] {
        const brokenChains: BrokenChain[] = [];
        
        allReferences.forEach(ref => {
            const orphanCheck = this.stateValidator.isReferenceOrphan(ref.targetType, ref.targetId, sourceEntities);
            if (orphanCheck.isOrphan) {
                brokenChains.push({
                    sourceType: ref.sourceType,
                    sourceId: ref.sourceId,
                    targetType: ref.targetType,
                    targetId: ref.targetId,
                    fieldPath: ref.fieldPath,
                    relationshipType: ref.relationshipType,
                    reason: orphanCheck.reason || 'Unknown reason'
                });
            }
        });
        
        return brokenChains;
    }
    
    /**
     * Find orphan references (entities that don't exist in source data)
     */
    private findOrphanReferences(allReferences: EntityReference[], sourceEntities: SourceEntities): OrphanReference[] {
        return this.findBrokenChains(allReferences, sourceEntities).map(broken => ({
            reference: broken,
            impact: this.calculateOrphanImpact(broken, allReferences)
        }));
    }
    
    /**
     * Apply state-based filtering to all entities
     */
    private applyStateFiltering(sourceEntities: SourceEntities): StateFilteringResults {
        const results: StateFilteringResults = {
            content: this.stateValidator.filterSyncableEntities(sourceEntities.content || [], 'content', sourceEntities),
            containers: this.stateValidator.filterSyncableEntities(sourceEntities.containers || [], 'container', sourceEntities),
            models: this.stateValidator.filterSyncableEntities(sourceEntities.models || [], 'model', sourceEntities),
            assets: this.stateValidator.filterSyncableEntities(sourceEntities.assets || [], 'asset', sourceEntities),
            galleries: this.stateValidator.filterSyncableEntities(sourceEntities.galleries || [], 'gallery', sourceEntities),
            templates: this.stateValidator.filterSyncableEntities(sourceEntities.templates || [], 'template', sourceEntities),
            pages: this.stateValidator.filterSyncableEntities(sourceEntities.pages || [], 'page', sourceEntities)
        };
        
        return results;
    }
    
    /**
     * Calculate comprehensive reconciliation across all entity types
     */
    private calculateUniversalReconciliation(
        sourceEntities: SourceEntities, 
        brokenChains: BrokenChain[],
        stateFiltering: StateFilteringResults
    ): UniversalReconciliation {
        const totalEntities = 
            (sourceEntities.content?.length || 0) +
            (sourceEntities.containers?.length || 0) +
            (sourceEntities.models?.length || 0) +
            (sourceEntities.assets?.length || 0) +
            (sourceEntities.galleries?.length || 0) +
            (sourceEntities.templates?.length || 0) +
            (sourceEntities.pages?.length || 0);
            
        const syncableEntities = 
            stateFiltering.content.stats.syncable +
            stateFiltering.containers.stats.syncable +
            stateFiltering.models.stats.syncable +
            stateFiltering.assets.stats.syncable +
            stateFiltering.galleries.stats.syncable +
            stateFiltering.templates.stats.syncable +
            stateFiltering.pages.stats.syncable;
            
        const problematicEntities = totalEntities - syncableEntities;
        const brokenReferences = brokenChains.length;
        
        return {
            totalEntities,
            syncableEntities,
            problematicEntities,
            brokenReferences,
            syncReadyPercentage: totalEntities > 0 ? (syncableEntities / totalEntities) * 100 : 0,
            byEntityType: {
                content: stateFiltering.content.stats,
                containers: stateFiltering.containers.stats,
                models: stateFiltering.models.stats,
                assets: stateFiltering.assets.stats,
                galleries: stateFiltering.galleries.stats,
                templates: stateFiltering.templates.stats,
                pages: stateFiltering.pages.stats
            }
        };
    }
    
    /**
     * Helper functions
     */
    private groupReferencesByType(references: EntityReference[]): Record<string, number> {
        const grouped: Record<string, number> = {};
        references.forEach(ref => {
            const key = `${ref.sourceType}-to-${ref.targetType}`;
            grouped[key] = (grouped[key] || 0) + 1;
        });
        return grouped;
    }
    
    private findModelNameForContainer(container: any, sourceEntities: SourceEntities): string {
        const model = sourceEntities.models?.find(m => m.id === container.contentDefinitionID);
        return model?.referenceName || 'Unknown Model';
    }
    
    private calculateOrphanImpact(broken: BrokenChain, allReferences: EntityReference[]): number {
        return allReferences.filter(ref => 
            ref.targetType === broken.targetType && ref.targetId === broken.targetId
        ).length;
    }

    /**
     * NEW: Universal Deep Recursive Chain Explorer
     * Traverses ALL relationship types across entity boundaries
     */
    public buildDeepUniversalChains(sourceEntities: SourceEntities): DeepUniversalChainAnalysis {
        const allReferences = this.referenceExtractor.extractAllEntityReferences(sourceEntities);
        
        // Build comprehensive cross-entity dependency graph
        const universalGraph = this.buildUniversalDependencyGraph(allReferences, sourceEntities);
        
        // Find all root entities (entities not referenced by others)
        const rootEntities = this.findRootEntities(allReferences, sourceEntities);
        
        // Build deep chains starting from each root
        const deepChains = this.buildDeepChainsFromRoots(rootEntities, universalGraph, sourceEntities);
        
        // Find circular dependencies
        const circularDependencies = this.findCircularDependencies(universalGraph, sourceEntities);
        
        // Calculate comprehensive metrics
        const metrics = this.calculateDeepChainMetrics(deepChains, circularDependencies, allReferences);
        
        return {
            deepChains,
            circularDependencies,
            universalGraph,
            rootEntities,
            metrics,
            totalReferences: allReferences.length,
            crossEntityRelationships: this.analyzeCrossEntityRelationships(allReferences)
        };
    }
    
    /**
     * Build universal dependency graph across ALL entity types
     */
    private buildUniversalDependencyGraph(
        allReferences: EntityReference[], 
        sourceEntities: SourceEntities
    ): UniversalDependencyGraph {
        const graph: UniversalDependencyGraph = {
            nodes: new Map(),
            edges: new Map(),
            entityTypes: new Set()
        };
        
        // Add all entities as nodes
        this.addEntitiesToGraph(sourceEntities, graph);
        
        // Add all references as edges
        allReferences.forEach(ref => {
            const sourceKey = `${ref.sourceType}:${ref.sourceId}`;
            const targetKey = `${ref.targetType}:${ref.targetId}`;
            
            if (!graph.edges.has(sourceKey)) {
                graph.edges.set(sourceKey, []);
            }
            
            graph.edges.get(sourceKey)!.push({
                target: targetKey,
                relationshipType: ref.relationshipType,
                fieldPath: ref.fieldPath,
                reference: ref
            });
        });
        
        return graph;
    }
    
    /**
     * Add all entities to the dependency graph
     */
    private addEntitiesToGraph(sourceEntities: SourceEntities, graph: UniversalDependencyGraph): void {
        // Add content entities
        sourceEntities.content?.forEach(content => {
            const key = `content:${content.contentID}`;
            graph.nodes.set(key, {
                entityType: 'content',
                entityId: content.contentID,
                entityName: content.properties?.referenceName || 'Unknown',
                entity: content
            });
            graph.entityTypes.add('content');
        });
        
        // Add container entities
        sourceEntities.containers?.forEach(container => {
            const key = `container:${container.contentViewID}`;
            graph.nodes.set(key, {
                entityType: 'container',
                entityId: container.contentViewID,
                entityName: container.referenceName || 'Unknown',
                entity: container
            });
            graph.entityTypes.add('container');
        });
        
        // Add model entities
        sourceEntities.models?.forEach(model => {
            const key = `model:${model.referenceName}`;
            graph.nodes.set(key, {
                entityType: 'model',
                entityId: model.referenceName,
                entityName: model.displayName || model.referenceName,
                entity: model
            });
            graph.entityTypes.add('model');
        });
        
        // Add page entities
        sourceEntities.pages?.forEach(page => {
            const key = `page:${page.pageID}`;
            graph.nodes.set(key, {
                entityType: 'page',
                entityId: page.pageID,
                entityName: page.name || 'Unknown',
                entity: page
            });
            graph.entityTypes.add('page');
        });
        
        // Add template entities
        sourceEntities.templates?.forEach(template => {
            const key = `template:${template.pageTemplateName}`;
            graph.nodes.set(key, {
                entityType: 'template',
                entityId: template.pageTemplateName,
                entityName: template.pageTemplateName,
                entity: template
            });
            graph.entityTypes.add('template');
        });
        
        // Add asset entities
        sourceEntities.assets?.forEach(asset => {
            const key = `asset:${asset.mediaID}`;
            graph.nodes.set(key, {
                entityType: 'asset',
                entityId: asset.mediaID,
                entityName: asset.fileName || 'Unknown',
                entity: asset
            });
            graph.entityTypes.add('asset');
        });
        
        // Add gallery entities
        sourceEntities.galleries?.forEach(gallery => {
            const key = `gallery:${gallery.mediaGroupingID}`;
            graph.nodes.set(key, {
                entityType: 'gallery',
                entityId: gallery.mediaGroupingID,
                entityName: gallery.name || 'Unknown',
                entity: gallery
            });
            graph.entityTypes.add('gallery');
        });
    }
    
    /**
     * Find root entities (not referenced by others)
     */
    private findRootEntities(allReferences: EntityReference[], sourceEntities: SourceEntities): UniversalEntity[] {
        const referencedEntities = new Set<string>();
        
        // Track all entities that are referenced by others
        allReferences.forEach(ref => {
            referencedEntities.add(`${ref.targetType}:${ref.targetId}`);
        });
        
        const rootEntities: UniversalEntity[] = [];
        
        // Find entities that are NOT referenced by others
        sourceEntities.pages?.forEach(page => {
            const key = `page:${page.pageID}`;
            if (!referencedEntities.has(key)) {
                rootEntities.push({
                    entityType: 'page',
                    entityId: page.pageID,
                    entityName: page.name || 'Unknown',
                    entity: page
                });
            }
        });
        
        // Templates that aren't referenced by pages
        sourceEntities.templates?.forEach(template => {
            const key = `template:${template.pageTemplateName}`;
            if (!referencedEntities.has(key)) {
                rootEntities.push({
                    entityType: 'template',
                    entityId: template.pageTemplateName,
                    entityName: template.pageTemplateName,
                    entity: template
                });
            }
        });
        
        // Standalone containers
        sourceEntities.containers?.forEach(container => {
            const key = `container:${container.contentViewID}`;
            if (!referencedEntities.has(key)) {
                rootEntities.push({
                    entityType: 'container',
                    entityId: container.contentViewID,
                    entityName: container.referenceName || 'Unknown',
                    entity: container
                });
            }
        });
        
        return rootEntities;
    }
    
    /**
     * Build deep chains from root entities with unlimited recursion depth
     */
    private buildDeepChainsFromRoots(
        rootEntities: UniversalEntity[],
        graph: UniversalDependencyGraph,
        sourceEntities: SourceEntities
    ): DeepUniversalChain[] {
        const deepChains: DeepUniversalChain[] = [];
        
        rootEntities.forEach(root => {
            const visited = new Set<string>();
            const chain = this.buildDeepChainRecursive(root, graph, visited, 0, sourceEntities);
            if (chain) {
                deepChains.push(chain);
            }
        });
        
        return deepChains;
    }
    
    /**
     * Recursive deep chain building with cross-entity traversal
     */
    private buildDeepChainRecursive(
        entity: UniversalEntity,
        graph: UniversalDependencyGraph,
        visited: Set<string>,
        depth: number,
        sourceEntities: SourceEntities
    ): DeepUniversalChain | null {
        const entityKey = `${entity.entityType}:${entity.entityId}`;
        
        // Prevent infinite loops but allow deep recursion
        if (visited.has(entityKey) || depth > 50) return null;
        
        visited.add(entityKey);
        
        const dependencies: DeepUniversalChain[] = [];
        const edges = graph.edges.get(entityKey) || [];
        
        edges.forEach(edge => {
            const targetNode = graph.nodes.get(edge.target);
            if (targetNode) {
                const nestedChain = this.buildDeepChainRecursive(
                    targetNode,
                    graph,
                    new Set(visited), // New visited set for each branch
                    depth + 1,
                    sourceEntities
                );
                if (nestedChain) {
                    dependencies.push(nestedChain);
                }
            }
        });
        
        return {
            entity,
            dependencies,
            depth,
            totalDependencies: dependencies.length,
            relationshipTypes: edges.map(e => e.relationshipType),
            isLeaf: dependencies.length === 0
        };
    }
    
    /**
     * Find circular dependencies in the universal graph
     */
    private findCircularDependencies(
        graph: UniversalDependencyGraph,
        sourceEntities: SourceEntities
    ): CircularDependency[] {
        const circularDeps: CircularDependency[] = [];
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        
        graph.nodes.forEach((node, nodeKey) => {
            if (!visited.has(nodeKey)) {
                const cycle = this.detectCycleFromNode(nodeKey, graph, visited, recursionStack, []);
                if (cycle.length > 0) {
                    circularDeps.push({
                        cycle,
                        cycleLength: cycle.length,
                        entityTypes: cycle.map(c => c.split(':')[0])
                    });
                }
            }
        });
        
        return circularDeps;
    }
    
    /**
     * Detect cycles using DFS
     */
    private detectCycleFromNode(
        nodeKey: string,
        graph: UniversalDependencyGraph,
        visited: Set<string>,
        recursionStack: Set<string>,
        path: string[]
    ): string[] {
        visited.add(nodeKey);
        recursionStack.add(nodeKey);
        path.push(nodeKey);
        
        const edges = graph.edges.get(nodeKey) || [];
        
        for (const edge of edges) {
            if (!visited.has(edge.target)) {
                const cycle = this.detectCycleFromNode(edge.target, graph, visited, recursionStack, [...path]);
                if (cycle.length > 0) return cycle;
            } else if (recursionStack.has(edge.target)) {
                // Found a cycle
                const cycleStart = path.indexOf(edge.target);
                return path.slice(cycleStart).concat([edge.target]);
            }
        }
        
        recursionStack.delete(nodeKey);
        return [];
    }
    
    /**
     * Calculate comprehensive metrics for deep chains
     */
    private calculateDeepChainMetrics(
        deepChains: DeepUniversalChain[],
        circularDependencies: CircularDependency[],
        allReferences: EntityReference[]
    ): DeepChainMetrics {
        const maxDepth = Math.max(...deepChains.map(c => this.getMaxDepth(c)), 0);
        const totalNodes = deepChains.reduce((sum, c) => sum + this.countNodes(c), 0);
        const crossEntityRefs = allReferences.filter(ref => ref.sourceType !== ref.targetType);
        
        return {
            totalChains: deepChains.length,
            maxDepth,
            totalNodes,
            circularDependencyCount: circularDependencies.length,
            crossEntityRelationshipCount: crossEntityRefs.length,
            averageChainDepth: deepChains.length > 0 ? totalNodes / deepChains.length : 0
        };
    }
    
    /**
     * Analyze cross-entity relationships
     */
    private analyzeCrossEntityRelationships(allReferences: EntityReference[]): CrossEntityAnalysis {
        const crossEntityRefs = allReferences.filter(ref => ref.sourceType !== ref.targetType);
        const relationshipMatrix: Record<string, Record<string, number>> = {};
        
        crossEntityRefs.forEach(ref => {
            const source = ref.sourceType;
            const target = ref.targetType;
            
            if (!relationshipMatrix[source]) {
                relationshipMatrix[source] = {};
            }
            
            relationshipMatrix[source][target] = (relationshipMatrix[source][target] || 0) + 1;
        });
        
        return {
            totalCrossEntityRelationships: crossEntityRefs.length,
            relationshipMatrix,
            mostCommonCrossEntityRelationship: this.findMostCommonRelationship(crossEntityRefs)
        };
    }
    
    // Helper methods
    private getMaxDepth(chain: DeepUniversalChain): number {
        if (chain.dependencies.length === 0) return chain.depth;
        return Math.max(chain.depth, ...chain.dependencies.map(d => this.getMaxDepth(d)));
    }
    
    private countNodes(chain: DeepUniversalChain): number {
        return 1 + chain.dependencies.reduce((sum, d) => sum + this.countNodes(d), 0);
    }
    
    private findMostCommonRelationship(refs: EntityReference[]): string {
        const counts: Record<string, number> = {};
        refs.forEach(ref => {
            const key = `${ref.sourceType}→${ref.targetType}`;
            counts[key] = (counts[key] || 0) + 1;
        });
        
        return Object.entries(counts).reduce((max, [key, count]) => 
            count > (counts[max] || 0) ? key : max, ''
        );
    }
}

// Type definitions for Universal Chain Analysis
export interface UniversalChainAnalysis {
    pageChains: PageChain[];
    contentToContentChains: ContentToContentChain[];
    assetToGalleryChains: AssetToGalleryChain[];
    modelToModelChains: ModelToModelChain[];
    containerChains: ContainerChain[];
    brokenChains: BrokenChain[];
    orphanReferences: OrphanReference[];
    stateFiltering: StateFilteringResults;
    reconciliation: UniversalReconciliation;
    totalReferences: number;
    referencesByType: Record<string, number>;
}

export interface PageChain {
    pageID: number;
    pageName: string;
    templateName?: string;
    containers: ContainerChain[];
    totalContentItems: number;
    totalAssets: number;
    totalGalleries: number;
    isComplete: boolean;
    brokenReferences: string[];
}

export interface ContainerChain {
    containerID: number;
    containerName: string;
    modelName: string;
    contentItems: any[];
    totalAssets: number;
    totalGalleries: number;
    isComplete: boolean;
    brokenReferences: string[];
}

export interface ContentToContentChain {
    contentID: number;
    contentName: string;
    nestedContent: ContentToContentChain[];
    totalNested: number;
    depth: number;
    relationshipTypes: string[];
    isComplete: boolean;
    brokenReferences: string[];
}

export interface AssetToGalleryChain {
    galleryID: string | number;
    galleryName: string;
    assets: any[];
    totalAssets: number;
    isComplete: boolean;
    brokenReferences: string[];
}

export interface ModelToModelChain {
    modelID: string | number;
    modelName: string;
    displayName: string;
    nestedModels: ModelToModelChain[];
    totalNested: number;
    depth: number;
    isComplete: boolean;
    brokenReferences: string[];
}

export interface BrokenChain {
    sourceType: string;
    sourceId: string | number;
    targetType: string;
    targetId: string | number;
    fieldPath: string;
    relationshipType: string;
    reason: string;
}

export interface OrphanReference {
    reference: BrokenChain;
    impact: number;
}

export interface StateFilteringResults {
    content: { syncable: any[]; problematic: any[]; stats: { total: number; syncable: number; problematic: number; }};
    containers: { syncable: any[]; problematic: any[]; stats: { total: number; syncable: number; problematic: number; }};
    models: { syncable: any[]; problematic: any[]; stats: { total: number; syncable: number; problematic: number; }};
    assets: { syncable: any[]; problematic: any[]; stats: { total: number; syncable: number; problematic: number; }};
    galleries: { syncable: any[]; problematic: any[]; stats: { total: number; syncable: number; problematic: number; }};
    templates: { syncable: any[]; problematic: any[]; stats: { total: number; syncable: number; problematic: number; }};
    pages: { syncable: any[]; problematic: any[]; stats: { total: number; syncable: number; problematic: number; }};
}

export interface UniversalReconciliation {
    totalEntities: number;
    syncableEntities: number;
    problematicEntities: number;
    brokenReferences: number;
    syncReadyPercentage: number;
    byEntityType: Record<string, { total: number; syncable: number; problematic: number; }>;
}

export interface DeepUniversalChainAnalysis {
    deepChains: DeepUniversalChain[];
    circularDependencies: CircularDependency[];
    universalGraph: UniversalDependencyGraph;
    rootEntities: UniversalEntity[];
    metrics: DeepChainMetrics;
    totalReferences: number;
    crossEntityRelationships: CrossEntityAnalysis;
}

export interface DeepUniversalChain {
    entity: UniversalEntity;
    dependencies: DeepUniversalChain[];
    depth: number;
    totalDependencies: number;
    relationshipTypes: string[];
    isLeaf: boolean;
}

export interface CircularDependency {
    cycle: string[];
    cycleLength: number;
    entityTypes: string[];
}

export interface DeepChainMetrics {
    totalChains: number;
    maxDepth: number;
    totalNodes: number;
    circularDependencyCount: number;
    crossEntityRelationshipCount: number;
    averageChainDepth: number;
}

export interface CrossEntityAnalysis {
    totalCrossEntityRelationships: number;
    relationshipMatrix: Record<string, Record<string, number>>;
    mostCommonCrossEntityRelationship: string;
}

export interface UniversalDependencyGraph {
    nodes: Map<string, UniversalEntity>;
    edges: Map<string, GraphEdge[]>;
    entityTypes: Set<string>;
}

export interface UniversalEntity {
    entityType: string;
    entityId: string | number;
    entityName: string;
    entity: any;
}

export interface GraphEdge {
    target: string;
    relationshipType: string;
    fieldPath: string;
    reference: EntityReference;
}