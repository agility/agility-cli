/**
 * Container Reference Extractor Service
 * 
 * Handles extraction of container references from content fields and page zones.
 * Used for analyzing container dependencies in the sync analysis.
 */

import { 
    SourceEntities, 
    SyncAnalysisContext,
    ContainerReference,
    ReferenceExtractionService
} from '../../../types/syncAnalysis';

export interface NestedContainerChain {
    sourceContainer: any;
    contentItems: Array<{
        content: any;
        referencedContainers: ContainerReference[];
    }>;
    depth: number;
    path: string[];
}

export class ContainerReferenceExtractor implements ReferenceExtractionService {
    private context?: SyncAnalysisContext;

    /**
     * Initialize the service with context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
    }

    /**
     * Extract container references from content fields
     */
    extractReferences(fields: any): ContainerReference[] {
        return this.extractNestedContainerReferences(fields);
    }

    /**
     * Extract nested container references from container fields
     */
    extractNestedContainerReferences(fields: any): ContainerReference[] {
        const references: ContainerReference[] = [];
        
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
                
                // Check for container reference name patterns
                if (obj.referenceName && typeof obj.referenceName === 'string') {
                    // Store reference name for container lookup
                    references.push({
                        contentID: -1, // Use -1 to indicate this is a reference name lookup
                        fieldPath: `${path}.referenceName`,
                        referenceName: obj.referenceName
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
     * NEW: Build complete container→content→container chains
     */
    buildNestedContainerChains(sourceEntities: SourceEntities, maxDepth: number = 3): NestedContainerChain[] {
        const chains: NestedContainerChain[] = [];
        
        if (!sourceEntities.containers || !sourceEntities.content) {
            return chains;
        }

        // Analyze each container for nested dependencies
        sourceEntities.containers.forEach((container: any) => {
            const chain = this.analyzeContainerChain(container, sourceEntities, 0, maxDepth, [container.contentViewID]);
            if (chain && chain.contentItems.length > 0) {
                chains.push(chain);
            }
        });

        return chains;
    }

    /**
     * NEW: Analyze a single container's dependency chain
     */
    private analyzeContainerChain(
        container: any, 
        sourceEntities: SourceEntities, 
        currentDepth: number, 
        maxDepth: number,
        visitedContainers: number[]
    ): NestedContainerChain | null {
        
        if (currentDepth >= maxDepth) {
            return null;
        }

        // Find content items that belong to this container
        const containerContent = sourceEntities.content?.filter((content: any) => {
            // Match by reference name (most common pattern)
            if (content.properties?.referenceName && container.referenceName) {
                return content.properties.referenceName.toLowerCase() === container.referenceName.toLowerCase();
            }
            
            // Match by container ID in content properties
            if (content.containerID === container.contentViewID) {
                return true;
            }
            
            return false;
        }) || [];

        const contentItemsWithRefs: Array<{
            content: any;
            referencedContainers: ContainerReference[];
        }> = [];

        // Analyze each content item for container references
        containerContent.forEach((content: any) => {
            if (content.fields) {
                const containerRefs = this.extractNestedContainerReferences(content.fields);
                
                // Filter out self-references and already visited containers
                const validRefs = containerRefs.filter(ref => {
                    if (ref.contentID === container.contentViewID) return false; // Self-reference
                    if (ref.contentID > 0 && visitedContainers.includes(ref.contentID)) return false; // Circular reference
                    return true;
                });

                if (validRefs.length > 0) {
                    contentItemsWithRefs.push({
                        content,
                        referencedContainers: validRefs
                    });
                }
            }
        });

        if (contentItemsWithRefs.length === 0) {
            return null;
        }

        return {
            sourceContainer: container,
            contentItems: contentItemsWithRefs,
            depth: currentDepth,
            path: visitedContainers.map(id => `Container:${id}`)
        };
    }

    /**
     * NEW: Find all content items that reference other containers
     */
    findContentToContainerReferences(sourceEntities: SourceEntities): Array<{
        content: any;
        referencedContainers: Array<{
            containerRef: ContainerReference;
            targetContainer?: any;
        }>;
    }> {
        const contentToContainerRefs: Array<{
            content: any;
            referencedContainers: Array<{
                containerRef: ContainerReference;
                targetContainer?: any;
            }>;
        }> = [];

        if (!sourceEntities.content || !sourceEntities.containers) {
            return contentToContainerRefs;
        }

        sourceEntities.content.forEach((content: any) => {
            if (!content.fields) return;

            const containerRefs = this.extractNestedContainerReferences(content.fields);
            
            if (containerRefs.length > 0) {
                const referencedContainers = containerRefs.map(ref => {
                    let targetContainer: any = undefined;
                    
                    if (ref.contentID > 0) {
                        // Look up by container ID
                        targetContainer = sourceEntities.containers?.find((c: any) => 
                            c.contentViewID === ref.contentID
                        );
                    } else if (ref.referenceName) {
                        // Look up by reference name
                        targetContainer = sourceEntities.containers?.find((c: any) => 
                            c.referenceName && c.referenceName.toLowerCase() === ref.referenceName.toLowerCase()
                        );
                    }

                    return {
                        containerRef: ref,
                        targetContainer
                    };
                });

                contentToContainerRefs.push({
                    content,
                    referencedContainers
                });
            }
        });

        return contentToContainerRefs;
    }

    /**
     * NEW: Categorize containers by their role in nested chains
     */
    categorizeContainersByRole(sourceEntities: SourceEntities): {
        listContainers: any[];      // Containers that hold lists of items
        itemContainers: any[];      // Containers for individual items within lists
        standaloneContainers: any[]; // Containers not part of nested chains
        nestedChainRoots: any[];    // Containers that start nested chains
    } {
        const categorization = {
            listContainers: [] as any[],
            itemContainers: [] as any[],
            standaloneContainers: [] as any[],
            nestedChainRoots: [] as any[]
        };

        if (!sourceEntities.containers) {
            return categorization;
        }

        // Find containers with naming patterns that suggest LIST vs ITEM roles
        sourceEntities.containers.forEach((container: any) => {
            const refName = container.referenceName || '';
            
            // Detect naming patterns
            const hasHashSuffix = /[A-Z0-9]{6,8}$/.test(refName); // Pattern like "ABC123DEF"
            const hasUnderscoreHierarchy = refName.includes('_');
            
            if (hasHashSuffix && hasUnderscoreHierarchy) {
                // This looks like an ITEM container (hash suffix suggests individual item)
                categorization.itemContainers.push(container);
            } else if (hasUnderscoreHierarchy) {
                // This looks like a potential LIST container (hierarchy but no hash)
                categorization.listContainers.push(container);
            } else {
                // Standalone container
                categorization.standaloneContainers.push(container);
            }
        });

        // Find containers that start nested chains
        const contentToContainerRefs = this.findContentToContainerReferences(sourceEntities);
        const containersWithNestedRefs = new Set<number>();
        
        contentToContainerRefs.forEach(({ content, referencedContainers }) => {
            // Find which container this content belongs to
            const parentContainer = sourceEntities.containers?.find((c: any) => {
                if (content.properties?.referenceName && c.referenceName) {
                    return content.properties.referenceName.toLowerCase() === c.referenceName.toLowerCase();
                }
                return false;
            });
            
            if (parentContainer && referencedContainers.length > 0) {
                containersWithNestedRefs.add(parentContainer.contentViewID);
            }
        });

        categorization.nestedChainRoots = sourceEntities.containers.filter((c: any) => 
            containersWithNestedRefs.has(c.contentViewID)
        );

        return categorization;
    }

    /**
     * Collect container IDs from page zones
     */
    collectContainersFromPageZones(zones: any, containerIds: Set<number>): void {
        if (!zones || typeof zones !== 'object') return;

        for (const [zoneName, zoneModules] of Object.entries(zones)) {
            if (Array.isArray(zoneModules)) {
                zoneModules.forEach((module: any) => {
                    // Handle direct container references
                    if (module?.itemContainerID) {
                        containerIds.add(module.itemContainerID);
                    }
                    
                    // Handle module instances that reference containers indirectly
                    if (module?.item?.contentid || module?.item?.contentId) {
                        const contentId = module.item.contentid || module.item.contentId;
                        // Note: This collects content IDs for now, but we should resolve to container IDs
                        // The actual container lookup happens in showPageZoneDependencies
                        containerIds.add(contentId);
                    }
                });
            }
        }
    }

    /**
     * Collect container IDs from page zones - FIXED VERSION 🚨
     * This properly maps MODULE NAMES to container IDs
     */
    collectContainerIdsFromPageZones(zones: any, sourceEntities: SourceEntities, containerIds: Set<number>): void {
        if (!zones || typeof zones !== 'object') return;

        for (const [zoneName, zoneModules] of Object.entries(zones)) {
            if (Array.isArray(zoneModules)) {
                zoneModules.forEach((module: any) => {
                    // 🚨 NEW: Handle module name mapping (e.g., "PromoBanner" → "home_PromoBanner")
                    if (module?.module) {
                        const moduleName = module.module;
                        
                        // Find containers whose reference name contains the module name
                        const matchingContainers = sourceEntities.containers?.filter((c: any) => 
                            c.referenceName && (
                                c.referenceName.toLowerCase().includes(moduleName.toLowerCase()) ||
                                c.referenceName.toLowerCase() === moduleName.toLowerCase()
                            )
                        );
                        
                        if (matchingContainers && matchingContainers.length > 0) {
                            matchingContainers.forEach((container: any) => {
                                containerIds.add(container.contentViewID);
                            });
                        }
                    }
                    
                    // Handle direct container references (existing logic)
                    if (module?.itemContainerID) {
                        containerIds.add(module.itemContainerID);
                    }
                    
                    // Handle module instances that reference containers indirectly (existing logic)
                    if (module?.item?.contentid || module?.item?.contentId) {
                        const contentId = module.item.contentid || module.item.contentId;
                        const content = sourceEntities.content?.find((c: any) => c.contentID === contentId);
                        
                        if (content && content.properties?.referenceName) {
                            // Find the container this content belongs to
                            const container = sourceEntities.containers?.find((c: any) => 
                                c.referenceName && c.referenceName.toLowerCase() === content.properties.referenceName.toLowerCase()
                            );
                            
                            if (container) {
                                containerIds.add(container.contentViewID);
                            }
                        }
                    }
                });
            }
        }
    }
} 