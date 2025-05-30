import ansiColors from 'ansi-colors';
import { 
    EntityKey, 
    EntityType,
    UniversalDependencyGraph,
    DependencyCycle,
    RelationshipType,
    ResolutionStrategy,
    parseEntityKey,
    createEntityKey
} from './dependency-analyzer';
import { RelationshipLink } from './two-pass-orchestrator';

/**
 * Simplified Cycle Resolver
 * 
 * Focused on core cycle detection and resolution patterns while avoiding
 * complex TypeScript compilation issues with map iteration and interface mismatches.
 */
export class CycleResolver {
    private debug: boolean = false;

    constructor(debug: boolean = false) {
        this.debug = debug;
    }

    /**
     * Enhanced cycle detection with detailed analysis
     */
    detectAndAnalyzeCycles(graph: UniversalDependencyGraph): EnhancedCycleAnalysis {
        console.log(ansiColors.cyan('[Cycle Resolver] Starting enhanced cycle detection...'));

        const analysis: EnhancedCycleAnalysis = {
            simpleCycles: [],
            complexCycles: [],
            crossEntityCycles: [],
            cycleClusters: [],
            breakingStrategies: new Map(),
            resolutionComplexity: 'low',
            recommendedBreakOrder: []
        };

        // Run enhanced DFS cycle detection
        const detectedCycles = this.enhancedCycleDetection(graph);
        
        // Classify cycles by complexity
        this.classifyCycles(detectedCycles, analysis);
        
        // Analyze cycle clusters (interconnected cycles)
        analysis.cycleClusters = this.findCycleClusters(detectedCycles);
        
        // Generate breaking strategies for each cycle
        this.generateBreakingStrategies(detectedCycles, analysis, graph);
        
        // Determine overall resolution complexity
        analysis.resolutionComplexity = this.assessResolutionComplexity(analysis);
        
        // Generate optimal break order
        analysis.recommendedBreakOrder = this.generateOptimalBreakOrder(analysis);
        
        this.reportCycleAnalysis(analysis);
        
        return analysis;
    }

    /**
     * Execute cycle resolution with various strategies
     */
    async resolveCycles(
        cycles: DependencyCycle[],
        graph: UniversalDependencyGraph,
        strategy: CycleResolutionStrategy = 'conservative'
    ): Promise<CycleResolutionResult> {
        
        console.log(ansiColors.yellow(`[Cycle Resolver] Resolving ${cycles.length} cycles using ${strategy} strategy...`));

        const result: CycleResolutionResult = {
            resolvedCycles: [],
            unresolvedCycles: [],
            breakPoints: [],
            modifiedRelationships: [],
            strategyEffectiveness: 0
        };

        for (const cycle of cycles) {
            try {
                const cycleResult = await this.resolveSingleCycle(cycle, graph, strategy);
                
                if (cycleResult.success) {
                    result.resolvedCycles.push(cycle);
                    result.breakPoints.push(...cycleResult.breakPoints);
                    result.modifiedRelationships.push(...cycleResult.modifiedRelationships);
                    
                    this.log('info', `Resolved cycle: ${cycle.entities.join(' → ')}`);
                } else {
                    result.unresolvedCycles.push(cycle);
                    this.log('warn', `Failed to resolve cycle: ${cycle.entities.join(' → ')}`);
                }
            } catch (error) {
                result.unresolvedCycles.push(cycle);
                this.log('error', `Error resolving cycle: ${(error as Error).message}`);
            }
        }

        // Calculate strategy effectiveness
        result.strategyEffectiveness = result.resolvedCycles.length / cycles.length;
        
        console.log(ansiColors.green(`[Cycle Resolver] Resolution complete: ${result.resolvedCycles.length}/${cycles.length} cycles resolved`));
        
        return result;
    }

    /**
     * Enhanced DFS cycle detection with path tracking - Fixed iteration
     */
    private enhancedCycleDetection(graph: UniversalDependencyGraph): EnhancedCycle[] {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const cycles: EnhancedCycle[] = [];
        const pathMap = new Map<string, string[]>(); // Track paths to each node
        
        const dfs = (entityKey: string, path: string[]): void => {
            visited.add(entityKey);
            recursionStack.add(entityKey);
            pathMap.set(entityKey, [...path, entityKey]);
            
            const node = graph.entities.get(entityKey as EntityKey);
            if (!node) return;
            
            for (const dependencyKey of node.dependencies) {
                if (!visited.has(dependencyKey)) {
                    dfs(dependencyKey, [...path, entityKey]);
                } else if (recursionStack.has(dependencyKey)) {
                    // Cycle detected - create enhanced cycle object
                    const currentPath = pathMap.get(entityKey) || [];
                    const cycleStart = currentPath.indexOf(dependencyKey);
                    const cycleEntities = currentPath.slice(cycleStart);
                    cycleEntities.push(dependencyKey);
                    
                    const enhancedCycle = this.createEnhancedCycle(
                        cycleEntities as EntityKey[], 
                        graph
                    );
                    cycles.push(enhancedCycle);
                }
            }
            
            recursionStack.delete(entityKey);
        };
        
        // Process all entities - Fixed iteration pattern
        const entityKeys = Array.from(graph.entities.keys());
        for (const entityKey of entityKeys) {
            if (!visited.has(entityKey)) {
                dfs(entityKey, []);
            }
        }
        
        return cycles;
    }

    /**
     * Create enhanced cycle object with detailed analysis
     */
    private createEnhancedCycle(entities: EntityKey[], graph: UniversalDependencyGraph): EnhancedCycle {
        const relationships: RelationshipType[] = [];
        const breakablePoints: EntityKey[] = [];
        const criticalPath: boolean[] = [];
        
        // Analyze each step in the cycle
        for (let i = 0; i < entities.length - 1; i++) {
            const relationship = graph.relationships.find(r => 
                r.from === entities[i] && r.to === entities[i + 1]
            );
            
            if (relationship) {
                relationships.push(relationship.relationship);
                
                // Determine if this step is breakable
                const isBreakable = this.isRelationshipBreakable(relationship.relationship);
                if (isBreakable) {
                    breakablePoints.push(entities[i]);
                }
                
                // Determine if this step is critical
                const isCritical = this.isRelationshipCritical(relationship.relationship);
                criticalPath.push(isCritical);
            }
        }
        
        // Calculate cycle metrics
        const entityTypes = entities.map(e => parseEntityKey(e).type);
        const hasMultipleTypes = new Set(entityTypes).size > 1;
        const criticalSteps = criticalPath.filter(Boolean).length;
        
        return {
            entities,
            relationships,
            cycleLength: entities.length - 1,
            severity: hasMultipleTypes ? 'cross_entity' : (entities.length > 3 ? 'complex' : 'simple'),
            isBreakable: breakablePoints.length > 0,
            breakPoints: breakablePoints,
            criticalPath,
            breakablePaths: this.findBreakablePaths(entities, relationships),
            cyclePriority: this.calculateCyclePriority(entities, relationships, criticalSteps),
            resolutionStrategies: this.suggestResolutionStrategies(entities, relationships, breakablePoints)
        };
    }

    /**
     * Classify cycles by complexity and type
     */
    private classifyCycles(cycles: EnhancedCycle[], analysis: EnhancedCycleAnalysis): void {
        cycles.forEach(cycle => {
            switch (cycle.severity) {
                case 'simple':
                    analysis.simpleCycles.push(cycle);
                    break;
                case 'complex':
                    analysis.complexCycles.push(cycle);
                    break;
                case 'cross_entity':
                    analysis.crossEntityCycles.push(cycle);
                    break;
            }
        });
    }

    /**
     * Find clusters of interconnected cycles
     */
    private findCycleClusters(cycles: EnhancedCycle[]): CycleCluster[] {
        const clusters: CycleCluster[] = [];
        const processed = new Set<number>();
        
        cycles.forEach((cycle, index) => {
            if (processed.has(index)) return;
            
            const cluster: CycleCluster = {
                cycles: [cycle],
                sharedEntities: new Set(cycle.entities),
                clusterComplexity: cycle.cyclePriority,
                breakingRecommendation: 'sequential'
            };
            
            // Find connected cycles
            cycles.forEach((otherCycle, otherIndex) => {
                if (otherIndex === index || processed.has(otherIndex)) return;
                
                const hasSharedEntities = otherCycle.entities.some(entity => 
                    cluster.sharedEntities.has(entity)
                );
                
                if (hasSharedEntities) {
                    cluster.cycles.push(otherCycle);
                    otherCycle.entities.forEach(entity => cluster.sharedEntities.add(entity));
                    cluster.clusterComplexity += otherCycle.cyclePriority;
                    processed.add(otherIndex);
                }
            });
            
            // Determine cluster breaking strategy
            if (cluster.cycles.length > 1) {
                cluster.breakingRecommendation = cluster.clusterComplexity > 10 ? 'parallel' : 'sequential';
            }
            
            clusters.push(cluster);
            processed.add(index);
        });
        
        return clusters;
    }

    /**
     * Generate breaking strategies for cycles
     */
    private generateBreakingStrategies(
        cycles: EnhancedCycle[], 
        analysis: EnhancedCycleAnalysis,
        graph: UniversalDependencyGraph
    ): void {
        
        cycles.forEach(cycle => {
            const strategies: CycleBreakingStrategy[] = [];
            
            // Strategy 1: Break at weakest link
            const weakestPoint = this.findWeakestBreakPoint(cycle);
            if (weakestPoint) {
                strategies.push({
                    type: 'weak_link',
                    breakPoint: weakestPoint,
                    confidence: 0.8,
                    description: `Break cycle at ${weakestPoint} (weakest dependency)`,
                    implementationComplexity: 'low'
                });
            }
            
            // Strategy 2: Defer optional relationships
            const optionalBreakPoints = this.findOptionalBreakPoints(cycle);
            optionalBreakPoints.forEach(point => {
                strategies.push({
                    type: 'defer_optional',
                    breakPoint: point,
                    confidence: 0.9,
                    description: `Defer optional relationship at ${point}`,
                    implementationComplexity: 'low'
                });
            });
            
            // Strategy 3: Stub creation for circular references
            if (cycle.severity === 'cross_entity') {
                strategies.push({
                    type: 'stub_creation',
                    breakPoint: cycle.entities[0],
                    confidence: 0.7,
                    description: `Create stub entities for circular references`,
                    implementationComplexity: 'medium'
                });
            }
            
            // Sort strategies by confidence and complexity
            strategies.sort((a, b) => {
                const complexityScore = { low: 1, medium: 2, high: 3 };
                return (b.confidence * 2 - complexityScore[b.implementationComplexity]) - 
                       (a.confidence * 2 - complexityScore[a.implementationComplexity]);
            });
            
            const cycleKey = cycle.entities.join('→');
            analysis.breakingStrategies.set(cycleKey, strategies);
        });
    }

    /**
     * Resolve a single cycle using specified strategy
     */
    private async resolveSingleCycle(
        cycle: DependencyCycle,
        graph: UniversalDependencyGraph,
        strategy: CycleResolutionStrategy
    ): Promise<SingleCycleResolution> {
        
        switch (strategy) {
            case 'conservative':
                return this.resolveConservatively(cycle, graph);
                
            case 'aggressive':
                return this.resolveAggressively(cycle, graph);
                
            case 'minimal_impact':
                return this.resolveMinimalImpact(cycle, graph);
                
            case 'performance_optimized':
                return this.resolvePerformanceOptimized(cycle, graph);
                
            default:
                throw new Error(`Unknown resolution strategy: ${strategy}`);
        }
    }

    /**
     * Conservative resolution: only break obviously safe relationships
     */
    private resolveConservatively(cycle: DependencyCycle, graph: UniversalDependencyGraph): SingleCycleResolution {
        const result: SingleCycleResolution = {
            success: false,
            breakPoints: [],
            modifiedRelationships: [],
            strategyUsed: 'conservative'
        };

        // Only break relationships that are clearly optional
        const safeBreakPoints = cycle.breakPoints.filter(point => {
            const { type } = parseEntityKey(point);
            // Content-to-content relationships are generally safe to defer
            return type === 'content';
        });

        if (safeBreakPoints.length > 0) {
            result.success = true;
            result.breakPoints = [safeBreakPoints[0]];
            
            // Create proper RelationshipLink for deferred linking
            const breakRelationship = graph.relationships.find(rel => 
                rel.from === safeBreakPoints[0] || rel.to === safeBreakPoints[0]
            );
            
            if (breakRelationship) {
                result.modifiedRelationships.push({
                    sourceKey: breakRelationship.from,
                    targetKey: breakRelationship.to,
                    relationship: breakRelationship.relationship,
                    fieldPath: breakRelationship.fieldPath,
                    resolutionStrategy: ResolutionStrategy.DEFERRED_LINK
                });
            }
        }

        return result;
    }

    /**
     * Aggressive resolution: break cycles with multiple strategies
     */
    private resolveAggressively(cycle: DependencyCycle, graph: UniversalDependencyGraph): SingleCycleResolution {
        const result: SingleCycleResolution = {
            success: true, // Aggressive approach assumes success
            breakPoints: cycle.breakPoints,
            modifiedRelationships: [],
            strategyUsed: 'aggressive'
        };

        // Break all available break points
        cycle.breakPoints.forEach(breakPoint => {
            const relationships = graph.relationships.filter(rel => 
                rel.from === breakPoint || rel.to === breakPoint
            );
            
            relationships.forEach(rel => {
                result.modifiedRelationships.push({
                    sourceKey: rel.from,
                    targetKey: rel.to,
                    relationship: rel.relationship,
                    fieldPath: rel.fieldPath,
                    resolutionStrategy: ResolutionStrategy.BREAK_CYCLE
                });
            });
        });

        return result;
    }

    /**
     * Minimal impact resolution: break fewest relationships
     */
    private resolveMinimalImpact(cycle: DependencyCycle, graph: UniversalDependencyGraph): SingleCycleResolution {
        const result: SingleCycleResolution = {
            success: false,
            breakPoints: [],
            modifiedRelationships: [],
            strategyUsed: 'minimal_impact'
        };

        if (cycle.breakPoints.length > 0) {
            result.success = true;
            result.breakPoints = [cycle.breakPoints[0]]; // Break only one relationship
            
            const breakRelationship = graph.relationships.find(rel => 
                rel.from === cycle.breakPoints[0] || rel.to === cycle.breakPoints[0]
            );
            
            if (breakRelationship) {
                result.modifiedRelationships.push({
                    sourceKey: breakRelationship.from,
                    targetKey: breakRelationship.to,
                    relationship: breakRelationship.relationship,
                    fieldPath: breakRelationship.fieldPath,
                    resolutionStrategy: ResolutionStrategy.CIRCULAR_STUB
                });
            }
        }

        return result;
    }

    /**
     * Performance optimized resolution: prioritize processing speed
     */
    private resolvePerformanceOptimized(cycle: DependencyCycle, graph: UniversalDependencyGraph): SingleCycleResolution {
        const result: SingleCycleResolution = {
            success: false,
            breakPoints: [],
            modifiedRelationships: [],
            strategyUsed: 'performance_optimized'
        };

        // Break at points that minimize API calls
        const efficientBreakPoints = cycle.breakPoints.filter(point => {
            const { type } = parseEntityKey(point);
            // Assets and galleries have simpler update patterns
            return type === 'asset' || type === 'gallery';
        });

        if (efficientBreakPoints.length > 0) {
            result.success = true;
            result.breakPoints = efficientBreakPoints;
        } else if (cycle.breakPoints.length > 0) {
            result.success = true;
            result.breakPoints = [cycle.breakPoints[0]];
        }

        return result;
    }

    // Helper methods for cycle analysis
    private isRelationshipBreakable(relationshipType: RelationshipType): boolean {
        const breakableTypes = [
            RelationshipType.CONTENT_TO_CONTENT,
            RelationshipType.ASSET_TO_CONTENT,
            RelationshipType.CONTENT_TO_PAGE
        ];
        return breakableTypes.includes(relationshipType);
    }

    private isRelationshipCritical(relationshipType: RelationshipType): boolean {
        const criticalTypes = [
            RelationshipType.MODEL_TO_CONTAINER,
            RelationshipType.MODEL_TO_TEMPLATE,
            RelationshipType.TEMPLATE_TO_PAGE
        ];
        return criticalTypes.includes(relationshipType);
    }

    private findBreakablePaths(entities: EntityKey[], relationships: RelationshipType[]): Array<{ start: EntityKey; end: EntityKey; cost: number }> {
        const paths: Array<{ start: EntityKey; end: EntityKey; cost: number }> = [];
        
        for (let i = 0; i < relationships.length; i++) {
            if (this.isRelationshipBreakable(relationships[i])) {
                paths.push({
                    start: entities[i],
                    end: entities[i + 1],
                    cost: this.calculateBreakingCost(relationships[i])
                });
            }
        }
        
        return paths.sort((a, b) => a.cost - b.cost);
    }

    private calculateBreakingCost(relationshipType: RelationshipType): number {
        const costs = {
            [RelationshipType.CONTENT_TO_CONTENT]: 1,
            [RelationshipType.ASSET_TO_CONTENT]: 2,
            [RelationshipType.CONTENT_TO_PAGE]: 3,
            [RelationshipType.MODEL_TO_MODEL]: 5,
        };
        return costs[relationshipType] || 4;
    }

    private calculateCyclePriority(entities: EntityKey[], relationships: RelationshipType[], criticalSteps: number): number {
        let priority = entities.length; // Base priority on cycle length
        priority += criticalSteps * 2; // Critical relationships increase priority
        priority += relationships.filter(r => this.isRelationshipCritical(r)).length * 3;
        return priority;
    }

    private suggestResolutionStrategies(entities: EntityKey[], relationships: RelationshipType[], breakPoints: EntityKey[]): string[] {
        const strategies: string[] = [];
        
        if (breakPoints.length > 0) {
            strategies.push('Break at optional dependency points');
        }
        
        if (relationships.some(r => this.isRelationshipBreakable(r))) {
            strategies.push('Defer non-critical relationships');
        }
        
        if (entities.some(e => parseEntityKey(e).type === 'content')) {
            strategies.push('Use stub creation for content items');
        }
        
        return strategies;
    }

    private findWeakestBreakPoint(cycle: EnhancedCycle): EntityKey | null {
        const breakablePaths = cycle.breakablePaths;
        return breakablePaths.length > 0 ? breakablePaths[0].start : null;
    }

    private findOptionalBreakPoints(cycle: EnhancedCycle): EntityKey[] {
        return cycle.breakPoints.filter(point => {
            const { type } = parseEntityKey(point);
            return type === 'content' || type === 'asset';
        });
    }

    private assessResolutionComplexity(analysis: EnhancedCycleAnalysis): 'low' | 'medium' | 'high' {
        const totalCycles = analysis.simpleCycles.length + analysis.complexCycles.length + analysis.crossEntityCycles.length;
        
        if (totalCycles === 0) return 'low';
        if (analysis.crossEntityCycles.length > 3 || analysis.cycleClusters.length > 2) return 'high';
        if (analysis.complexCycles.length > 5) return 'medium';
        
        return 'low';
    }

    private generateOptimalBreakOrder(analysis: EnhancedCycleAnalysis): EntityKey[] {
        const allCycles = [...analysis.simpleCycles, ...analysis.complexCycles, ...analysis.crossEntityCycles];
        
        // Sort cycles by priority (lowest first for easier resolution)
        allCycles.sort((a, b) => a.cyclePriority - b.cyclePriority);
        
        // Return break points in optimal order
        return allCycles.flatMap(cycle => cycle.breakPoints.slice(0, 1)); // Take first break point from each cycle
    }

    private reportCycleAnalysis(analysis: EnhancedCycleAnalysis): void {
        const totalCycles = analysis.simpleCycles.length + analysis.complexCycles.length + analysis.crossEntityCycles.length;
        
        console.log(ansiColors.yellow(`[Cycle Resolver] Analysis Results:`));
        console.log(ansiColors.cyan(`  📊 Total Cycles: ${totalCycles}`));
        console.log(ansiColors.green(`    - Simple: ${analysis.simpleCycles.length}`));
        console.log(ansiColors.yellow(`    - Complex: ${analysis.complexCycles.length}`));
        console.log(ansiColors.red(`    - Cross-Entity: ${analysis.crossEntityCycles.length}`));
        console.log(ansiColors.cyan(`  🔗 Cycle Clusters: ${analysis.cycleClusters.length}`));
        console.log(ansiColors.cyan(`  🎯 Resolution Complexity: ${analysis.resolutionComplexity}`));
        console.log(ansiColors.cyan(`  ⚡ Recommended Break Points: ${analysis.recommendedBreakOrder.length}`));
    }

    private log(level: 'info' | 'warn' | 'error', message: string): void {
        if (!this.debug && level === 'info') return;
        
        const color = level === 'error' ? ansiColors.red : 
                     level === 'warn' ? ansiColors.yellow : 
                     ansiColors.cyan;
        
        console.log(color(`[Cycle Resolver] ${message}`));
    }
}

// Enhanced type definitions
export interface EnhancedCycle extends DependencyCycle {
    criticalPath: boolean[];
    breakablePaths: Array<{ start: EntityKey; end: EntityKey; cost: number }>;
    cyclePriority: number;
    resolutionStrategies: string[];
}

export interface EnhancedCycleAnalysis {
    simpleCycles: EnhancedCycle[];
    complexCycles: EnhancedCycle[];
    crossEntityCycles: EnhancedCycle[];
    cycleClusters: CycleCluster[];
    breakingStrategies: Map<string, CycleBreakingStrategy[]>;
    resolutionComplexity: 'low' | 'medium' | 'high';
    recommendedBreakOrder: EntityKey[];
}

export interface CycleCluster {
    cycles: EnhancedCycle[];
    sharedEntities: Set<EntityKey>;
    clusterComplexity: number;
    breakingRecommendation: 'sequential' | 'parallel';
}

export interface CycleBreakingStrategy {
    type: 'weak_link' | 'defer_optional' | 'stub_creation' | 'relationship_inversion';
    breakPoint: EntityKey;
    confidence: number;
    description: string;
    implementationComplexity: 'low' | 'medium' | 'high';
}

export interface CycleResolutionResult {
    resolvedCycles: DependencyCycle[];
    unresolvedCycles: DependencyCycle[];
    breakPoints: EntityKey[];
    modifiedRelationships: RelationshipLink[];
    strategyEffectiveness: number;
}

export interface SingleCycleResolution {
    success: boolean;
    breakPoints: EntityKey[];
    modifiedRelationships: RelationshipLink[];
    strategyUsed: CycleResolutionStrategy;
}

export type CycleResolutionStrategy = 'conservative' | 'aggressive' | 'minimal_impact' | 'performance_optimized'; 