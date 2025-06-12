/**
 * Comprehensive Analysis Runner Service
 * 
 * Main orchestrator that replaces the showComprehensiveAnalysis() method.
 * Coordinates all 6 analysis steps using the step coordinator.
 * Now includes global model duplication tracking and shows circular model chains first.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext 
} from '../../../types/syncAnalysis';
import { AnalysisStepCoordinator } from './analysis-step-coordinator';
import { PageChainAnalyzer } from './page-chain-analyzer';
import { ContainerChainAnalyzer } from './container-chain-analyzer';
import { ModelChainAnalyzer } from './model-chain-analyzer';
import { BrokenChainDetector } from './broken-chain-detector';
import { NonChainedItemsAnalyzer } from './non-chained-items-analyzer';
import { ReconciliationReporter } from './reconciliation-reporter';
import { AssetValidationAnalyzer, AssetValidationResult } from './asset-validation-analyzer';
import { TargetInstanceDiscovery, SyncPlan } from './target-instance-discovery';
import { ReferenceMapper } from '../../reference-mapper';
import { UniversalReferenceExtractor } from './universal-reference-extractor';
import { StateValidator } from './state-validator';
import { LinkTypeDetector } from './link-type-detector';

/**
 * Global model tracking to prevent duplicates across all chain displays
 */
export interface ModelTracker {
    displayedModels: Set<string>;
    isModelDisplayed(modelName: string): boolean;
    markModelDisplayed(modelName: string): void;
    reset(): void;
}

export class GlobalModelTracker implements ModelTracker {
    displayedModels: Set<string> = new Set();

    isModelDisplayed(modelName: string): boolean {
        return this.displayedModels.has(modelName);
    }

    markModelDisplayed(modelName: string): void {
        this.displayedModels.add(modelName);
    }

    reset(): void {
        this.displayedModels.clear();
    }
}

export class ComprehensiveAnalysisRunner {
    private context?: SyncAnalysisContext;
    private coordinator: AnalysisStepCoordinator;
    private modelTracker: ModelTracker;
    private assetValidator: AssetValidationAnalyzer;
    private reconciliationReporter: ReconciliationReporter;
    private targetDiscovery?: TargetInstanceDiscovery;
    private referenceMapper?: ReferenceMapper;
    private syncPlan?: SyncPlan;
    private sourceData?: SourceEntities;
    private universalReferenceExtractor: UniversalReferenceExtractor;
    private stateValidator: StateValidator;
    private linkTypeDetector: LinkTypeDetector;

    constructor() {
        this.coordinator = new AnalysisStepCoordinator();
        this.modelTracker = new GlobalModelTracker();
        this.assetValidator = new AssetValidationAnalyzer();
        this.reconciliationReporter = new ReconciliationReporter();
        this.universalReferenceExtractor = new UniversalReferenceExtractor();
        this.stateValidator = new StateValidator();
        this.linkTypeDetector = new LinkTypeDetector();
        this.setupAnalysisSteps();
    }

    /**
     * Initialize with analysis context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.coordinator.initialize(context);
    }

    /**
     * Setup all 7 analysis steps in the coordinator
     */
    private setupAnalysisSteps(): void {
        // Step 0: Asset Validation (FIRST - validates assets before analysis)
        this.coordinator.registerService('asset-validation', this.assetValidator);
        
        // Step 1: Model-to-Model Chains (shows circular dependencies)
        this.coordinator.registerService('model-chains', new ModelChainAnalyzer());
        
        // Step 2: Page Chains (with hierarchical display)
        this.coordinator.registerService('page-chains', new PageChainAnalyzer());
        
        // Step 3: Container Chains  
        this.coordinator.registerService('container-chains', new ContainerChainAnalyzer());
        

        
        // Step 4: Broken Chains (only shows if there are broken items)
        this.coordinator.registerService('broken-chains', new BrokenChainDetector());
        
        // Step 5: Non-Chained Items
        this.coordinator.registerService('non-chained-items', new NonChainedItemsAnalyzer());
        
        // Step 6: Reconciliation Summary (connected to asset validator)
        this.reconciliationReporter.setAssetValidator(this.assetValidator);
        this.coordinator.registerService('reconciliation', this.reconciliationReporter);
    }

    /**
     * Initialize target instance discovery for analysis-first mapping
     */
    async initializeTargetDiscovery(targetGuid: string, options: any): Promise<void> {
        if (targetGuid === 'test') {
            console.log(ansiColors.cyan('🧪 Test mode: Skipping target instance discovery initialization'));
            return;
        }

        this.targetDiscovery = new TargetInstanceDiscovery(targetGuid);
        await this.targetDiscovery.initialize(options);
        
        // Initialize reference mapper
        const sourceGuid = this.context?.sourceGuid || 'unknown';
        this.referenceMapper = new ReferenceMapper(sourceGuid, targetGuid, this.context?.rootPath || 'agility-files', this.context?.legacyFolders || false);
    }

    /**
     * Run the complete 7-step comprehensive analysis with optional target discovery
     * ENHANCED: Now includes target instance discovery and mapping pre-population
     */
    async runComprehensiveAnalysis(sourceEntities: SourceEntities): Promise<SyncPlan | void> {
        // Store source data for mapped retrieval later
        this.sourceData = sourceEntities;

        // Reset model tracker for this analysis run
        this.modelTracker.reset();

        // Step -1: Target Instance Discovery (OPTIONAL - only if target discovery initialized)
        if (this.targetDiscovery && this.referenceMapper) {
            console.log(ansiColors.magenta('\n🎯 TARGET INSTANCE DISCOVERY & MAPPING'));
            console.log('==================================================');
            
            try {
                await this.targetDiscovery.discoverAllEntities();
                this.syncPlan = this.targetDiscovery.populateReferenceMapper(sourceEntities, this.referenceMapper);
                
                console.log(ansiColors.green('\n📋 SYNC PLAN GENERATED:'));
                console.log(ansiColors.green(`  ✅ Will Skip: ${this.syncPlan.willSkip} entities (already exist)`));
                console.log(ansiColors.green(`  🆕 Will Create: ${this.syncPlan.willCreate} entities (new)`));
                console.log(ansiColors.green(`  📝 Will Update: ${this.syncPlan.willUpdate} entities (modified)`));
                console.log(ansiColors.green(`  ⏱️ Estimated Time: ${this.syncPlan.estimatedTimeMinutes.toFixed(1)} minutes`));
                console.log(ansiColors.green(`  🎯 Success Probability: ${this.syncPlan.successProbability.toFixed(1)}%`));
                
                // Show breakdown by entity type
                console.log(ansiColors.cyan('\n📊 ENTITY BREAKDOWN:'));
                for (const [entityType, breakdown] of Object.entries(this.syncPlan.entityBreakdown)) {
                    if (breakdown.total > 0) {
                        console.log(ansiColors.cyan(`  ${entityType}: ${breakdown.skip} skip, ${breakdown.update} update, ${breakdown.create} create`));
                    }
                }

                // Save mappings to disk after successful discovery
                console.log(ansiColors.blue('\n💾 Saving reference mappings to disk...'));
                await this.referenceMapper.saveAllMappings();
                
            } catch (error: any) {
                console.error(ansiColors.red(`❌ Target discovery failed: ${error.message}`));
                console.log(ansiColors.yellow('📊 Continuing with source-only analysis...'));
            }
        }

        // Asset validation (internal only - no console output)

        // Step 1: Model-to-Model Chains (establishes model baseline)
        console.log(ansiColors.blue('\n📐 1. CIRCULAR MODEL CHAINS (BASELINE)'));
        console.log('==================================================');
        this.executeStepWithModelTracking('model-chains', sourceEntities);

        // Step 2: Page Chains (with duplicate model detection)
        console.log(ansiColors.blue('\n📄 2. ALL PAGE CHAINS'));
        console.log('==================================================');
        this.executeStepWithModelTracking('page-chains', sourceEntities);

        // Step 3: Container Chains (with duplicate model detection)
        console.log(ansiColors.blue('\n📦 3. ALL CONTAINER CHAINS'));
        console.log('==================================================');
        this.executeStepWithModelTracking('container-chains', sourceEntities);



        // Step 3.6: Enhanced Relationship Analysis (NEW - Task 23.10 - ALL missing relationship types)
        console.log(ansiColors.magenta('\n🔗 3.6. UNIVERSAL RELATIONSHIP ANALYSIS'));
        console.log('==================================================');
        this.runEnhancedRelationshipAnalysis(sourceEntities);

        // Step 4: Broken Chains (conditional display)
        const reconciliationReporter = new ReconciliationReporter();
        if (this.context) {
            reconciliationReporter.initialize(this.context);
        }
        const brokenItems = reconciliationReporter.findAllBrokenItems(sourceEntities);
        
        if (brokenItems.length > 0) {
            console.log(ansiColors.red('\n🔴 4. BROKEN CHAINS AND MISSING DEPENDENCIES'));
            console.log('==================================================');
            this.coordinator.executeStep('broken-chains', sourceEntities);
        }

        // Step 5: Non-Chained Items
        console.log(ansiColors.blue('\n📊 5. ITEMS OUTSIDE OF CHAINS'));
        console.log('==================================================');
        this.coordinator.executeStep('non-chained-items', sourceEntities);

        // Step 6: Reconciliation Summary
        console.log(ansiColors.cyan('\n🔍 6. RECONCILIATION SUMMARY'));
        console.log('==================================================');
        this.coordinator.executeStep('reconciliation', sourceEntities);

        // Return sync plan if generated
        return this.syncPlan;
    }

    /**
     * Get the generated sync plan (if target discovery was performed)
     */
    getSyncPlan(): SyncPlan | undefined {
        return this.syncPlan;
    }

    /**
     * Get the populated reference mapper (if target discovery was performed)
     */
    getReferenceMapper(): ReferenceMapper | undefined {
        return this.referenceMapper;
    }

    /**
     * Get the raw source data
     */
    getSourceData(): SourceEntities | undefined {
        return this.sourceData;
    }

    /**
     * Get source data with all references mapped to target IDs
     * This is what pushers should use - source data but with target IDs already resolved
     */
    getMappedSourceData(): SourceEntities | null {
        const referenceMapper = this.getReferenceMapper();
        const sourceData = this.getSourceData();
        
        if (!referenceMapper || !sourceData) {
            return null;
        }

        // Deep clone source data to avoid mutations
        const mappedData = JSON.parse(JSON.stringify(sourceData));

        // Transform each entity type with mapped references
        this.transformMappedEntities(mappedData.models, 'model', referenceMapper);
        this.transformMappedEntities(mappedData.containers, 'container', referenceMapper);
        this.transformMappedEntities(mappedData.content, 'content', referenceMapper);
        this.transformMappedEntities(mappedData.templates, 'template', referenceMapper);
        this.transformMappedEntities(mappedData.pages, 'page', referenceMapper);
        this.transformMappedEntities(mappedData.assets, 'asset', referenceMapper);
        this.transformMappedEntities(mappedData.galleries, 'gallery', referenceMapper);

        return mappedData;
    }

    /**
     * Transform entity array with mapped references
     */
    private transformMappedEntities(entities: any[], entityType: string, mapper: ReferenceMapper): void {
        if (!entities || !Array.isArray(entities)) return;

        for (const entity of entities) {
            this.transformEntityReferences(entity, mapper);
        }
    }

    /**
     * Recursively transform all references in an entity to use target IDs
     */
    private transformEntityReferences(obj: any, mapper: ReferenceMapper): void {
        if (!obj || typeof obj !== 'object') return;

        // Handle arrays
        if (Array.isArray(obj)) {
            for (const item of obj) {
                this.transformEntityReferences(item, mapper);
            }
            return;
        }

        // Transform known ID fields
        const idFields = [
            'contentID', 'containerID', 'pageID', 'mediaID', 'galleryID',
            'definitionID', 'pageTemplateID', 'templateID', 'modelID'
        ];

        for (const field of idFields) {
            if (obj[field] && typeof obj[field] === 'number') {
                const entityType = this.getEntityTypeFromField(field);
                const mappedId = mapper.getMappedId(entityType as any, obj[field]);
                if (mappedId) {
                    obj[field] = mappedId;
                }
            }
        }

        // Recursively process nested objects
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'object') {
                this.transformEntityReferences(obj[key], mapper);
            }
        }
    }

    /**
     * Map field names to entity types for ID transformation
     */
    private getEntityTypeFromField(field: string): string {
        const mapping: { [key: string]: string } = {
            'contentID': 'content',
            'containerID': 'container',
            'pageID': 'page',
            'mediaID': 'asset',
            'galleryID': 'gallery',
            'definitionID': 'model',
            'pageTemplateID': 'template',
            'templateID': 'template',
            'modelID': 'model'
        };
        return mapping[field] || 'unknown';
    }

    /**
     * Get analysis results with full mapping context for debug/verification
     */
    getAnalysisWithMappingDetails(): {
        sourceData: SourceEntities | null,
        mappedData: SourceEntities | null,
        referenceMapper: ReferenceMapper | undefined,
        syncPlan: SyncPlan | undefined,
        mappingStats: any
    } {
        const referenceMapper = this.getReferenceMapper();
        
        return {
            sourceData: this.getSourceData() || null,
            mappedData: this.getMappedSourceData(),
            referenceMapper,
            syncPlan: this.getSyncPlan(),
            mappingStats: referenceMapper?.getDetailedStats() || null
        };
    }

    /**
     * Run enhanced relationship analysis using UniversalReferenceExtractor
     * Integrates seamlessly with the proven 6-step analysis framework
     */
    private runEnhancedRelationshipAnalysis(sourceEntities: SourceEntities): void {
        console.log(ansiColors.cyan('🔍 Extracting ALL relationship types from entities...'));
        
        // Extract all relationships using our enhanced extractor
        const allReferences = this.universalReferenceExtractor.extractAllEntityReferences(sourceEntities);
        
        // Apply state-based filtering
        const stateFilterResults = {
            content: this.stateValidator.filterSyncableEntities(sourceEntities.content || [], 'content', sourceEntities),
            containers: this.stateValidator.filterSyncableEntities(sourceEntities.containers || [], 'container', sourceEntities),
            models: this.stateValidator.filterSyncableEntities(sourceEntities.models || [], 'model', sourceEntities),
            assets: this.stateValidator.filterSyncableEntities(sourceEntities.assets || [], 'asset', sourceEntities),
            galleries: this.stateValidator.filterSyncableEntities(sourceEntities.galleries || [], 'gallery', sourceEntities),
            templates: this.stateValidator.filterSyncableEntities(sourceEntities.templates || [], 'template', sourceEntities),
            pages: this.stateValidator.filterSyncableEntities(sourceEntities.pages || [], 'page', sourceEntities)
        };
        
        // Group references by type for analysis
        const referencesByType = this.groupReferencesByType(allReferences);
        
        // Display relationship analysis
        console.log(ansiColors.green(`✅ Extracted ${allReferences.length} total relationships across all entity types`));
        
        // Show relationship type breakdown
        console.log(ansiColors.cyan('\n📊 RELATIONSHIP TYPE BREAKDOWN:'));
        Object.entries(referencesByType).forEach(([type, count]) => {
            if (count > 0) {
                console.log(ansiColors.cyan(`  ${type}: ${count} references`));
            }
        });
        
        // State-based filtering applied internally (results hidden to reduce confusion)

        // Show problematic pages in a dedicated section (like broken references)
        const problematicPages = stateFilterResults.pages?.problematic || [];
        if (problematicPages.length > 0) {
            console.log(ansiColors.red(`\n⚠️  Found ${problematicPages.length} problematic pages in enhanced analysis`));
            problematicPages.forEach((page: any) => {
                const validation = this.stateValidator.validateEntityCompletely(page, 'page', sourceEntities);
                const reason = validation.reasons.length > 0 ? validation.reasons[0] : 'Unknown reason';
                const pageType = page.pageType === 'folder' ? 'Folder Page' : 'Regular Page';
                const pageName = page.name || 'No Name';
                const pageId = page.pageID || page.id || 'Unknown ID';
                console.log(ansiColors.red(`  ↳ page:${pageId} → ${pageName} (${reason}) - ${pageType}`));
            });
        }
        
        // Enhanced relationship integrity check
        const brokenReferences = this.findBrokenReferencesEnhanced(allReferences, sourceEntities);
        if (brokenReferences.length > 0) {
            console.log(ansiColors.red(`\n⚠️  Found ${brokenReferences.length} broken references in enhanced analysis`));
            brokenReferences.forEach(broken => {
                console.log(ansiColors.red(`  ↳ ${broken.sourceType}:${broken.sourceId} → ${broken.targetType}:${broken.targetId} (${broken.fieldPath})`));
            });
        } else {
            console.log(ansiColors.green('\n✅ All relationships validated - zero broken references detected'));
        }
        
        // Enhanced analysis complete (summary removed for cleaner output)
    }
    
    /**
     * Group references by relationship type for analysis display
     */
    private groupReferencesByType(references: any[]): Record<string, number> {
        const grouped: Record<string, number> = {};
        references.forEach(ref => {
            const key = `${ref.sourceType}-to-${ref.targetType}`;
            grouped[key] = (grouped[key] || 0) + 1;
        });
        return grouped;
    }
    
    /**
     * Find broken references using enhanced relationship detection
     * ENHANCED: Now filters out field configuration strings using LinkTypeDetector
     */
    private findBrokenReferencesEnhanced(allReferences: any[], sourceEntities: SourceEntities): any[] {
        const brokenReferences: any[] = [];
        
        allReferences.forEach(ref => {
            // CRITICAL FIX: Skip field configuration strings that are not actual content references
            if (ref.sourceType === 'model' && ref.targetType === 'content') {
                // Find the source model to check if this is a field configuration string
                const sourceModel = sourceEntities.models?.find((m: any) => 
                    m.id === ref.sourceId || m.referenceName === ref.sourceId
                );
                
                if (sourceModel && this.linkTypeDetector.isFieldConfigurationString(ref.targetId, sourceModel)) {
                    // This is a field configuration string (like "footerLogos_ValueField"), not a content reference
                    // Skip it - it should not be treated as a broken chain
                    return;
                }
            }
            
            const orphanCheck = this.stateValidator.isReferenceOrphan(ref.targetType, ref.targetId, sourceEntities);
            if (orphanCheck.isOrphan) {
                brokenReferences.push({
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
        
        return brokenReferences;
    }

    /**
     * Execute a step with model tracking context
     */
    private executeStepWithModelTracking(stepName: string, sourceEntities: SourceEntities): void {
        // Add model tracker to context if not already present
        const enhancedContext = {
            ...this.context,
            modelTracker: this.modelTracker
        };
        
        // Update the coordinator's context and reinitialize all services
        const originalContext = this.context;
        this.coordinator.updateContext(enhancedContext);
        
        // Execute the step
        this.coordinator.executeStep(stepName, sourceEntities);
        
        // Restore original context if needed
        if (originalContext) {
            this.coordinator.updateContext(originalContext);
        }
    }
} 