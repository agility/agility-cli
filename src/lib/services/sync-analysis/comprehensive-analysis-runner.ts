/**
 * Comprehensive Analysis Runner Service
 * 
 * Main orchestrator that replaces the showComprehensiveAnalysis() method.
 * Coordinates all 6 analysis steps using the step coordinator.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext 
} from './types';
import { AnalysisStepCoordinator } from './analysis-step-coordinator';
import { PageChainAnalyzer } from './page-chain-analyzer';
import { ContainerChainAnalyzer } from './container-chain-analyzer';
import { ModelChainAnalyzer } from './model-chain-analyzer';
import { BrokenChainDetector } from './broken-chain-detector';
import { NonChainedItemsAnalyzer } from './non-chained-items-analyzer';
import { ReconciliationReporter } from './reconciliation-reporter';

export class ComprehensiveAnalysisRunner {
    private context?: SyncAnalysisContext;
    private coordinator: AnalysisStepCoordinator;

    constructor() {
        this.coordinator = new AnalysisStepCoordinator();
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
     * Setup all 6 analysis steps in the coordinator
     */
    private setupAnalysisSteps(): void {
        // Step 1: Page Chains (with hierarchical display)
        this.coordinator.registerService('page-chains', new PageChainAnalyzer());
        
        // Step 2: Container Chains  
        this.coordinator.registerService('container-chains', new ContainerChainAnalyzer());
        
        // Step 3: Model-to-Model Chains
        this.coordinator.registerService('model-chains', new ModelChainAnalyzer());
        
        // Step 4: Broken Chains (only shows if there are broken items)
        this.coordinator.registerService('broken-chains', new BrokenChainDetector());
        
        // Step 5: Non-Chained Items
        this.coordinator.registerService('non-chained-items', new NonChainedItemsAnalyzer());
        
        // Step 6: Reconciliation Summary
        this.coordinator.registerService('reconciliation', new ReconciliationReporter());
    }

    /**
     * Run the complete 6-step comprehensive analysis
     */
    runComprehensiveAnalysis(sourceEntities: SourceEntities): void {
        console.log(ansiColors.cyan('\n📊 6-STEP DEPENDENCY CHAIN ANALYSIS'));
        console.log('==================================================');

        // Step 1: Page Chains
        console.log(ansiColors.blue('\n📄 1. ALL PAGE CHAINS'));
        console.log('==================================================');
        this.coordinator.executeStep('page-chains', sourceEntities);

        // Step 2: Container Chains
        console.log(ansiColors.blue('\n📦 2. ALL CONTAINER CHAINS'));
        console.log('==================================================');
        this.coordinator.executeStep('container-chains', sourceEntities);

        // Step 3: Model-to-Model Chains
        console.log(ansiColors.blue('\n📐 3. ALL MODEL-TO-MODEL CHAINS'));
        console.log('==================================================');
        this.coordinator.executeStep('model-chains', sourceEntities);

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
    }

    /**
     * Get the step coordinator for advanced usage
     */
    getCoordinator(): AnalysisStepCoordinator {
        return this.coordinator;
    }

    /**
     * Run a specific step by name
     */
    runStep(stepName: string, sourceEntities: SourceEntities): void {
        if (!this.coordinator.hasStep(stepName)) {
            console.error(ansiColors.red(`Error: Unknown analysis step "${stepName}"`));
            console.log(ansiColors.gray('Available steps: ' + this.coordinator.getRegisteredSteps().join(', ')));
            return;
        }

        this.coordinator.executeStep(stepName, sourceEntities);
    }

    /**
     * Run multiple specific steps
     */
    runSteps(stepNames: string[], sourceEntities: SourceEntities): void {
        this.coordinator.executeSteps(stepNames, sourceEntities);
    }
} 