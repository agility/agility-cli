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
                    brokenContainerChains.push({ entity: container, missing });
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
                    brokenModelChains.push({ entity: model, missing });
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
} 