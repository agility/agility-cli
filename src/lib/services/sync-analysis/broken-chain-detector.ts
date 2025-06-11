/**
 * Broken Chain Detector Service
 * 
 * Identifies and reports broken dependency chains with missing dependencies.
 * Shows containers and models that have broken dependency chains.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext, 
    ChainAnalysisService,
    BrokenChain
} from '../../../types/syncAnalysis';
import { 
    getContentStateInfo,
    getStateSyncImpact,
    CONTENT_STATES
} from './types';
import { ContainerReferenceExtractor } from './container-reference-extractor';
import { DependencyFinder } from './dependency-finder';
import { ModelChainAnalyzer } from './model-chain-analyzer';

export class BrokenChainDetector implements ChainAnalysisService {
    private context?: SyncAnalysisContext;
    private containerExtractor: ContainerReferenceExtractor;
    private dependencyFinder: DependencyFinder;
    private modelAnalyzer: ModelChainAnalyzer;

    constructor() {
        this.containerExtractor = new ContainerReferenceExtractor();
        this.dependencyFinder = new DependencyFinder();
        this.modelAnalyzer = new ModelChainAnalyzer();
    }

    /**
     * Initialize with analysis context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.containerExtractor.initialize(context);
        this.dependencyFinder.initialize(context);
        this.modelAnalyzer.initialize(context);
    }

    /**
     * Analyze and display the chains for this service's domain (ChainAnalysisService interface)
     */
    analyzeChains(sourceEntities: SourceEntities): void {
        this.showBrokenChains(sourceEntities);
    }

    /**
     * Show broken chains and missing dependencies
     */
    showBrokenChains(sourceEntities: SourceEntities): void {
        const brokenContainerChains: BrokenChain[] = [];
        const brokenModelChains: BrokenChain[] = [];

        // Find broken container chains (not in page chains)
        if (sourceEntities.containers) {
            const containersInPageChains = new Set<number>();
            if (sourceEntities.pages) {
                sourceEntities.pages.forEach((page: any) => {
                    this.containerExtractor.collectContainersFromPageZones(page.zones, containersInPageChains);
                });
            }

            const containersNotInPages = sourceEntities.containers.filter((container: any) => 
                !containersInPageChains.has(container.contentViewID)
            );

            containersNotInPages.forEach((container: any) => {
                const missing = this.dependencyFinder.findMissingDependenciesForContainer(container, sourceEntities);
                if (missing.length > 0) {
                    brokenContainerChains.push({ entity: container, missing, type: 'container' });
                }
            });
        }

        // Find broken model chains
        if (sourceEntities.models) {
            const modelsInOtherChains = new Set<string>();
            this.collectModelsUsedInOtherChains(sourceEntities, modelsInOtherChains);

            const modelToModelChains = this.modelAnalyzer.findModelToModelChains(sourceEntities.models, modelsInOtherChains);
            modelToModelChains.forEach((model: any) => {
                const missing = this.dependencyFinder.findMissingDependenciesForModel(model, sourceEntities);
                if (missing.length > 0) {
                    brokenModelChains.push({ entity: model, missing, type: 'model' });
                }
            });
        }

        // Calculate total broken chains
        const totalBrokenChains = brokenContainerChains.length + brokenModelChains.length;

        if (totalBrokenChains === 0) {
            return;
        }

        console.log(ansiColors.red('\n🔴 4. BROKEN CHAINS AND MISSING DEPENDENCIES'));
        console.log('==================================================');
        console.log(ansiColors.yellow(`Found ${totalBrokenChains} broken chains with missing dependencies:`));

        // Show broken container chains
        if (brokenContainerChains.length > 0) {
            console.log(ansiColors.yellow(`\n  📦 BROKEN CONTAINER CHAINS (${brokenContainerChains.length}):`));
            brokenContainerChains.slice(0, 5).forEach((chain, index) => { // Show first 5
                const container = chain.entity;
                console.log(ansiColors.white(`\n    ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'})`));
                console.log(ansiColors.red(`    Missing dependencies:`));
                chain.missing.forEach(dep => {
                    console.log(ansiColors.red(`      - ${dep}`));
                });
            });
            if (brokenContainerChains.length > 5) {
                console.log(ansiColors.gray(`    ... and ${brokenContainerChains.length - 5} more broken container chains`));
            }
        }

        // Show broken model chains
        if (brokenModelChains.length > 0) {
            console.log(ansiColors.yellow(`\n  📐 BROKEN MODEL CHAINS (${brokenModelChains.length}):`));
            brokenModelChains.slice(0, 5).forEach((chain, index) => { // Show first 5
                const model = chain.entity;
                console.log(ansiColors.green(`\n    Model:${model.referenceName} (${model.displayName || 'No Name'})`));
                console.log(ansiColors.red(`    Missing dependencies:`));
                chain.missing.forEach(dep => {
                    console.log(ansiColors.red(`      - ${dep}`));
                });
            });
            if (brokenModelChains.length > 5) {
                console.log(ansiColors.gray(`    ... and ${brokenModelChains.length - 5} more broken model chains`));
            }
        }

        // Summary of missing dependencies
        console.log(ansiColors.yellow(`\n   SUMMARY OF MISSING DEPENDENCIES:`));
        if (brokenContainerChains.length > 0) {
            const containerMissing = brokenContainerChains.flatMap(chain => chain.missing);
            console.log(ansiColors.white(`    Container chains missing: ${containerMissing.length} items`));
        }
        if (brokenModelChains.length > 0) {
            const modelMissing = brokenModelChains.flatMap(chain => chain.missing);
            console.log(ansiColors.white(`    Model chains missing: ${modelMissing.length} items`));
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

    displayBrokenChainAnalysis(results: { brokenItems: any[] }): void {
        console.log(`\n🔍 Step 4: Broken Chain Analysis`);
        console.log(`============================`);
        
        if (results.brokenItems.length === 0) {
            console.log(`✅ No broken chains detected - all entities have valid sources!`);
            return;
        }

        console.log(`❌ Found ${results.brokenItems.length} broken dependency chains:\n`);

        // Enhanced display with state analysis
        const stateAnalysis = new Map<number, { count: number; items: any[] }>();
        
        results.brokenItems.forEach(item => {
            console.log(`❌ ${item.type}: ${item.name}`);
            console.log(`   Missing: ${item.missing.join(', ')}`);
            
            // Enhanced content state analysis for broken content
            if (item.type.startsWith('Content') && item.entity?.properties?.state) {
                const state = item.entity.properties.state;
                const stateInfo = getContentStateInfo(state);
                const syncImpact = getStateSyncImpact(state);
                
                console.log(`   📊 Content State: ${stateInfo.formatted}`);
                console.log(`   📝 Description: ${stateInfo.description}`);
                console.log(`   🎯 Sync Impact: ${this.getSyncImpactLabel(syncImpact)}`);
                
                // Track state distribution
                if (!stateAnalysis.has(state)) {
                    stateAnalysis.set(state, { count: 0, items: [] });
                }
                stateAnalysis.get(state)!.count++;
                stateAnalysis.get(state)!.items.push(item);
                
                // Additional context for problematic states
                if (syncImpact === 'unsyncable') {
                    console.log(`   ⚠️  This content will be SKIPPED during sync (${stateInfo.label.toLowerCase()} content)`);
                } else if (syncImpact === 'problematic') {
                    console.log(`   ⚠️  This content may cause sync issues`);
                }
                
                // Show modification date for context
                if (item.entity.properties.modified) {
                    console.log(`   📅 Last Modified: ${item.entity.properties.modified}`);
                }
            }
            
            console.log('');
        });

        // Display state distribution analysis
        if (stateAnalysis.size > 0) {
            console.log(`\n📊 Broken Chain State Analysis:`);
            console.log(`==============================`);
            
            let totalUnsyncable = 0;
            let totalProblematic = 0;
            let totalNormal = 0;
            
            for (const [state, data] of Array.from(stateAnalysis.entries())) {
                const stateInfo = getContentStateInfo(state);
                const syncImpact = getStateSyncImpact(state);
                const percentage = ((data.count / results.brokenItems.length) * 100).toFixed(1);
                
                console.log(`   ${stateInfo.formatted}: ${data.count} items (${percentage}%)`);
                console.log(`     Impact: ${this.getSyncImpactLabel(syncImpact)}`);
                
                if (syncImpact === 'unsyncable') totalUnsyncable += data.count;
                else if (syncImpact === 'problematic') totalProblematic += data.count;
                else totalNormal += data.count;
            }
            
            console.log(`\n📈 Sync Impact Summary:`);
            console.log(`   🚫 Unsyncable (will be skipped): ${totalUnsyncable} items`);
            console.log(`   ⚠️  Problematic (may cause issues): ${totalProblematic} items`);
            console.log(`   ✅ Normal (should sync fine): ${totalNormal} items`);
            
            if (totalUnsyncable > 0) {
                console.log(`\n💡 Root Cause Analysis:`);
                console.log(`   • Deleted content (state 3): Content was deleted but references remain`);
                console.log(`   • Unpublished content (state 7): Content was unpublished but dependencies exist`);
                console.log(`   • This is typical in development/staging environments with content churn`);
                console.log(`   • Production sites usually have cleaner referential integrity`);
            }
        }

        console.log(`\n📋 Recommendation: ${results.brokenItems.length} entities will be skipped during sync due to missing dependencies`);
    }

    private getSyncImpactLabel(impact: 'normal' | 'problematic' | 'unsyncable' | 'pending'): string {
        switch (impact) {
            case 'normal': return '✅ Normal (will sync)';
            case 'problematic': return '⚠️  Problematic (may fail)';
            case 'unsyncable': return '🚫 Unsyncable (will be skipped)';
            case 'pending': return '⏳ Pending (workflow dependent)';
            default: return '❓ Unknown';
        }
    }
} 