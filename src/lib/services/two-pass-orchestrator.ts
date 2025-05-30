import * as mgmtApi from '@agility/management-sdk';
import ansiColors from 'ansi-colors';
import { 
    DependencyAnalyzer, 
    UniversalDependencyGraph, 
    EntityKey, 
    EntityNode, 
    EntityType, 
    parseEntityKey,
    createEntityKey,
    RelationshipType,
    ResolutionStrategy 
} from './dependency-analyzer';

// Result interfaces for each pass
export interface Pass1Result {
    createdEntities: Map<EntityKey, EntityStub>;
    failedEntities: Map<EntityKey, CreationError>;
    circularEntities: Set<EntityKey>;
    deferredRelationships: RelationshipLink[];
    entityIdMappings: Map<EntityKey, number | string>; // Source entity key → Target ID
}

export interface Pass2Result {
    linkedRelationships: RelationshipLink[];
    failedRelationships: RelationshipLink[];
    resolvedCircularReferences: EntityKey[];
    unresolvedDependencies: DependencyError[];
    finalMappings: Map<EntityKey, number | string>;
}

export interface EntityStub {
    entityKey: EntityKey;
    targetId: number | string;
    stubData: any; // Minimal data needed for creation
    isStub: boolean;
    createdAt: Date;
}

export interface RelationshipLink {
    sourceKey: EntityKey;
    targetKey: EntityKey;
    relationship: RelationshipType;
    fieldPath: string;
    resolutionStrategy: ResolutionStrategy;
    sourceTargetId?: number | string;
    targetTargetId?: number | string;
    linkData?: any; // Data needed for linking
}

export interface CreationError {
    entityKey: EntityKey;
    error: Error;
    attempt: number;
    dependencies: EntityKey[];
    canRetry: boolean;
}

export interface DependencyError {
    relationshipLink: RelationshipLink;
    error: Error;
    missingDependencies: EntityKey[];
    resolutionSuggestion: string;
}

// Interface for entity factories
export interface EntityFactory {
    createStub(entity: any, targetId?: number | string): Promise<any>;
    createFull(entity: any, dependencyMappings: Map<EntityKey, number | string>): Promise<any>;
    updateWithRelationships(targetId: number | string, relationships: RelationshipLink[], mappings: Map<EntityKey, number | string>): Promise<any>;
}

/**
 * Two-Pass Orchestrator
 * 
 * Coordinates the 2-pass approach to entity creation:
 * - Pass 1: Create minimal viable entities (stubs) to generate target IDs
 * - Pass 2: Link relationships using target IDs from Pass 1
 */
export class TwoPassOrchestrator {
    private dependencyAnalyzer: DependencyAnalyzer;
    private factories: Map<EntityType, EntityFactory>;
    private debug: boolean = false;

    constructor(debug: boolean = false) {
        this.dependencyAnalyzer = new DependencyAnalyzer(debug);
        this.factories = new Map();
        this.debug = debug;
    }

    /**
     * Register entity factories for each type
     */
    registerFactory(entityType: EntityType, factory: EntityFactory): void {
        this.factories.set(entityType, factory);
    }

    /**
     * Main orchestration method: Execute 2-pass dependency-driven migration
     */
    async execute2PassMigration(
        sourceEntities: {
            galleries?: mgmtApi.assetGalleries[];
            assets?: mgmtApi.Media[];
            models?: mgmtApi.Model[];
            containers?: mgmtApi.Container[];
            content?: mgmtApi.ContentItem[];
            templates?: mgmtApi.PageModel[];
            pages?: mgmtApi.PageItem[];
        },
        targetApiClient: mgmtApi.ApiClient,
        options: {
            onlyUsedAssets?: boolean;
            assetAnalysisDepth?: 'shallow' | 'deep';
            enableParallelProcessing?: boolean;
            maxRetries?: number;
        } = {}
    ): Promise<{
        pass1Result: Pass1Result;
        pass2Result: Pass2Result;
        dependencyGraph: UniversalDependencyGraph;
        totalProcessingTime: number;
    }> {
        
        const startTime = Date.now();
        // console.log(ansiColors.cyan('[2-Pass Orchestrator] Starting 2-pass dependency-driven migration...'));

        try {
            // Phase 1: Dependency Analysis & Graph Building
            // console.log(ansiColors.yellow('[2-Pass Orchestrator] Phase 1: Dependency Analysis'));
            const dependencyGraph = await this.dependencyAnalyzer.analyzeDependencies(sourceEntities, options);

            // Phase 2: Pass 1 - Entity Creation
            // console.log(ansiColors.yellow('[2-Pass Orchestrator] Phase 2: Pass 1 - Entity Creation'));
            const pass1Result = await this.executePass1(dependencyGraph, targetApiClient, options);

            // Phase 3: Pass 2 - Relationship Linking  
            // console.log(ansiColors.yellow('[2-Pass Orchestrator] Phase 3: Pass 2 - Relationship Linking'));
            const pass2Result = await this.executePass2(dependencyGraph, pass1Result, targetApiClient, options);

            const totalProcessingTime = Date.now() - startTime;
            
            return {
                pass1Result,
                pass2Result,
                dependencyGraph,
                totalProcessingTime
            };
        } catch (error) {
            throw new Error(`Error during migration: ${(error as Error).message}`);
        }
    }

    /**
     * Pass 1: Create entities in dependency order, creating stubs for circular references
     */
    private async executePass1(
        graph: UniversalDependencyGraph,
        apiClient: mgmtApi.ApiClient,
        options: any
    ): Promise<Pass1Result> {
        
        const result: Pass1Result = {
            createdEntities: new Map(),
            failedEntities: new Map(),
            circularEntities: new Set(),
            deferredRelationships: [],
            entityIdMappings: new Map()
        };

        // Group entities by cycles vs non-cycles
        const circularEntities = new Set<EntityKey>();
        graph.cycles.forEach(cycle => {
            cycle.entities.forEach(entityKey => circularEntities.add(entityKey));
        });

        // Process non-circular entities first
        const nonCircularEntities = graph.processingOrder.filter(key => !circularEntities.has(key));

        for (const entityKey of nonCircularEntities) {
            await this.createSingleEntity(entityKey, graph, result, apiClient, false);
        }

        // Process circular entities as stubs
        const circularEntityList = Array.from(circularEntities);

        for (const entityKey of circularEntityList) {
            await this.createSingleEntity(entityKey, graph, result, apiClient, true);
            result.circularEntities.add(entityKey);
        }

        // Collect deferred relationships for Pass 2
        result.deferredRelationships = this.extractDeferredRelationships(graph, result);

        // Only log in debug mode since we're not actually creating entities yet
        if (this.debug && (result.createdEntities.size > 0 || result.failedEntities.size > 0)) {
            console.log(ansiColors.green(`[Pass 1] Complete: ${result.createdEntities.size} created, ${result.failedEntities.size} failed`));
        }
        
        return result;
    }

    /**
     * Pass 2: Link relationships using target IDs from Pass 1
     */
    private async executePass2(
        graph: UniversalDependencyGraph,
        pass1Result: Pass1Result,
        apiClient: mgmtApi.ApiClient,
        options: any
    ): Promise<Pass2Result> {
        
        const result: Pass2Result = {
            linkedRelationships: [],
            failedRelationships: [],
            resolvedCircularReferences: [],
            unresolvedDependencies: [],
            finalMappings: new Map(pass1Result.entityIdMappings)
        };

        // Only log if there are actual relationships to link
        if (this.debug && pass1Result.deferredRelationships.length > 0) {
            console.log(ansiColors.green(`[Pass 2] Linking ${pass1Result.deferredRelationships.length} relationships...`));
        }

        // First, update circular entities with full data
        for (const circularEntityKey of Array.from(pass1Result.circularEntities)) {
            await this.updateCircularEntity(circularEntityKey, graph, pass1Result, apiClient);
            result.resolvedCircularReferences.push(circularEntityKey);
        }

        // Then, link all deferred relationships
        for (const relationship of pass1Result.deferredRelationships) {
            try {
                await this.linkSingleRelationship(relationship, pass1Result.entityIdMappings, apiClient);
                result.linkedRelationships.push(relationship);
            } catch (error) {
                const depError: DependencyError = {
                    relationshipLink: relationship,
                    error: error as Error,
                    missingDependencies: this.findMissingDependencies(relationship, pass1Result.entityIdMappings),
                    resolutionSuggestion: this.suggestResolution(relationship, error as Error)
                };
                result.unresolvedDependencies.push(depError);
                result.failedRelationships.push(relationship);
            }
        }

        // Only log in debug mode and if there were actual operations
        if (this.debug && (result.linkedRelationships.length > 0 || result.failedRelationships.length > 0)) {
            console.log(ansiColors.green(`[Pass 2] Complete: ${result.linkedRelationships.length} linked, ${result.failedRelationships.length} failed`));
        }
        
        return result;
    }

    /**
     * Create a single entity (either stub or full)
     */
    private async createSingleEntity(
        entityKey: EntityKey,
        graph: UniversalDependencyGraph,
        result: Pass1Result,
        apiClient: mgmtApi.ApiClient,
        createAsStub: boolean
    ): Promise<void> {
        
        const entityNode = graph.entities.get(entityKey);
        if (!entityNode) {
            if (this.debug) {
                console.error(ansiColors.red(`[Pass 1] Entity not found in graph: ${entityKey}`));
            }
            return;
        }

        const factory = this.factories.get(entityNode.type);
        if (!factory) {
            // No factory registered - this is expected during testing/development
            // Skip logging to avoid console spam during testing phase
            return;
        }

        try {
            let targetId: number | string;
            
            if (createAsStub) {
                // Create minimal stub entity
                const stubResult = await factory.createStub(entityNode.sourceData);
                targetId = stubResult.id || stubResult.contentID || stubResult.pageID || stubResult.mediaID;
                
                result.createdEntities.set(entityKey, {
                    entityKey,
                    targetId,
                    stubData: stubResult,
                    isStub: true,
                    createdAt: new Date()
                });
                
                if (this.debug) {
                    console.log(ansiColors.cyan(`[Pass 1] Created stub ${entityKey} → ID: ${targetId}`));
                }
            } else {
                // Create full entity with available dependencies
                const availableMappings = this.getAvailableDependencyMappings(entityNode, result.entityIdMappings);
                const fullResult = await factory.createFull(entityNode.sourceData, availableMappings);
                targetId = fullResult.id || fullResult.contentID || fullResult.pageID || fullResult.mediaID;
                
                result.createdEntities.set(entityKey, {
                    entityKey,
                    targetId,
                    stubData: fullResult,
                    isStub: false,
                    createdAt: new Date()
                });
                
                if (this.debug) {
                    console.log(ansiColors.green(`[Pass 1] Created full ${entityKey} → ID: ${targetId}`));
                }
            }
            
            // Store the mapping
            result.entityIdMappings.set(entityKey, targetId);
            
        } catch (error) {
            if (this.debug) {
                console.error(ansiColors.red(`[Pass 1] Failed to create ${entityKey}: ${(error as Error).message}`));
            }
            
            result.failedEntities.set(entityKey, {
                entityKey,
                error: error as Error,
                attempt: 1,
                dependencies: entityNode.dependencies,
                canRetry: this.canRetryCreation(error as Error)
            });
        }
    }

    /**
     * Update a circular entity with full data
     */
    private async updateCircularEntity(
        entityKey: EntityKey,
        graph: UniversalDependencyGraph,
        pass1Result: Pass1Result,
        apiClient: mgmtApi.ApiClient
    ): Promise<void> {
        
        const entityNode = graph.entities.get(entityKey);
        const entityStub = pass1Result.createdEntities.get(entityKey);
        
        if (!entityNode || !entityStub) {
            if (this.debug) {
                console.error(ansiColors.red(`[Pass 2] Cannot update circular entity ${entityKey} - missing data`));
            }
            return;
        }

        const factory = this.factories.get(entityNode.type);
        if (!factory) {
            // No factory registered - skip logging to avoid console spam
            return;
        }

        try {
            // Get relationships for this entity
            const entityRelationships = pass1Result.deferredRelationships.filter(
                rel => rel.sourceKey === entityKey
            );
            
            // Update with full relationship data
            await factory.updateWithRelationships(
                entityStub.targetId,
                entityRelationships,
                pass1Result.entityIdMappings
            );
            
            if (this.debug) {
                console.log(ansiColors.green(`[Pass 2] Updated circular entity ${entityKey} with full data`));
            }
            
        } catch (error) {
            if (this.debug) {
                console.error(ansiColors.red(`[Pass 2] Failed to update circular entity ${entityKey}: ${(error as Error).message}`));
            }
        }
    }

    /**
     * Link a single relationship
     */
    private async linkSingleRelationship(
        relationship: RelationshipLink,
        mappings: Map<EntityKey, number | string>,
        apiClient: mgmtApi.ApiClient
    ): Promise<void> {
        
        const sourceTargetId = mappings.get(relationship.sourceKey);
        const targetTargetId = mappings.get(relationship.targetKey);
        
        if (!sourceTargetId || !targetTargetId) {
            throw new Error(`Missing target IDs for relationship ${relationship.sourceKey} → ${relationship.targetKey}`);
        }

        relationship.sourceTargetId = sourceTargetId;
        relationship.targetTargetId = targetTargetId;

        // The actual linking logic would depend on the specific relationship type
        // This is a placeholder for the relationship-specific linking code
        
        if (this.debug) {
            // Only log interesting/nested relationships, not obvious ones
            if (this.isInterestingRelationship(relationship)) {
                console.log(ansiColors.cyan(`[Pass 2] Linked relationship: ${relationship.sourceKey} → ${relationship.targetKey}`));
            }
        }
    }

    /**
     * Extract relationships that need to be deferred to Pass 2
     */
    private extractDeferredRelationships(
        graph: UniversalDependencyGraph,
        pass1Result: Pass1Result
    ): RelationshipLink[] {
        
        const deferredRelationships: RelationshipLink[] = [];
        
        for (const relationship of graph.relationships) {
            // Defer if both entities were created or one is circular
            const sourceCreated = pass1Result.createdEntities.has(relationship.from);
            const targetCreated = pass1Result.createdEntities.has(relationship.to);
            const sourceCircular = pass1Result.circularEntities.has(relationship.from);
            const targetCircular = pass1Result.circularEntities.has(relationship.to);
            
            if ((sourceCreated && targetCreated) || sourceCircular || targetCircular) {
                deferredRelationships.push({
                    sourceKey: relationship.from,
                    targetKey: relationship.to,
                    relationship: relationship.relationship,
                    fieldPath: relationship.fieldPath,
                    resolutionStrategy: relationship.resolutionStrategy
                });
            }
        }
        
        return deferredRelationships;
    }

    /**
     * Get available dependency mappings for an entity
     */
    private getAvailableDependencyMappings(
        entityNode: EntityNode,
        allMappings: Map<EntityKey, number | string>
    ): Map<EntityKey, number | string> {
        
        const availableMappings = new Map<EntityKey, number | string>();
        
        entityNode.dependencies.forEach(depKey => {
            const mapping = allMappings.get(depKey);
            if (mapping !== undefined) {
                availableMappings.set(depKey, mapping);
            }
        });
        
        return availableMappings;
    }

    /**
     * Find missing dependencies for a failed relationship
     */
    private findMissingDependencies(
        relationship: RelationshipLink,
        mappings: Map<EntityKey, number | string>
    ): EntityKey[] {
        
        const missing: EntityKey[] = [];
        
        if (!mappings.has(relationship.sourceKey)) {
            missing.push(relationship.sourceKey);
        }
        
        if (!mappings.has(relationship.targetKey)) {
            missing.push(relationship.targetKey);
        }
        
        return missing;
    }

    /**
     * Suggest resolution for a failed relationship
     */
    private suggestResolution(relationship: RelationshipLink, error: Error): string {
        if (error.message.includes('not found')) {
            return `Ensure both entities ${relationship.sourceKey} and ${relationship.targetKey} were created successfully`;
        }
        
        if (error.message.includes('circular')) {
            return `Consider breaking the circular dependency at ${relationship.fieldPath}`;
        }
        
        return `Review the relationship mapping for ${relationship.relationship}`;
    }

    /**
     * Determine if entity creation can be retried
     */
    private canRetryCreation(error: Error): boolean {
        // Don't retry validation errors or authentication issues
        if (error.message.includes('validation') || 
            error.message.includes('unauthorized') ||
            error.message.includes('forbidden')) {
            return false;
        }
        
        // Retry network issues, rate limits, temporary failures
        return true;
    }

    /**
     * Determine if a relationship is interesting/nested
     */
    private isInterestingRelationship(relationship: RelationshipLink): boolean {
        // Skip obvious/simple relationships
        const boringRelationships = [
            RelationshipType.MODEL_TO_CONTENT,  // content → model (obvious)
            RelationshipType.MODEL_TO_CONTAINER, // container → model (obvious)
            RelationshipType.MODEL_TO_TEMPLATE,  // template → model (obvious)
        ];
        
        // Only log interesting/nested relationships
        const interestingRelationships = [
            RelationshipType.CONTENT_TO_CONTENT,  // content → content (nested)
            RelationshipType.PAGE_TO_PAGE,        // page → page (hierarchy)
            RelationshipType.ASSET_TO_CONTENT,    // content → asset (media usage)
            RelationshipType.CONTENT_TO_PAGE,     // page → content (page content)
            RelationshipType.TEMPLATE_TO_PAGE,    // page → template (complex)
            RelationshipType.GALLERY_TO_ASSET,    // asset → gallery (grouping)
            RelationshipType.CONTAINER_TO_TEMPLATE, // template → container (complex)
            RelationshipType.CONTAINER_TO_CONTENT,  // content → container (complex)
        ];
        
        return interestingRelationships.includes(relationship.relationship);
    }
} 