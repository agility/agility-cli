/**
 * Reconciliation Reporter Service
 * 
 * Provides sync readiness reporting including entity counts, chain analysis,
 * and broken items that will be skipped during sync operations.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext, 
    ChainAnalysisService,
    EntitiesInChains
} from './types';
import { ContainerReferenceExtractor } from './container-reference-extractor';
import { DependencyFinder } from './dependency-finder';
import { NonChainedItemsAnalyzer } from './non-chained-items-analyzer';
import { ModelChainAnalyzer } from './model-chain-analyzer';

export class ReconciliationReporter implements ChainAnalysisService {
    private context?: SyncAnalysisContext;
    private containerExtractor: ContainerReferenceExtractor;
    private dependencyFinder: DependencyFinder;
    private nonChainedAnalyzer: NonChainedItemsAnalyzer;
    private modelAnalyzer: ModelChainAnalyzer;

    constructor() {
        this.containerExtractor = new ContainerReferenceExtractor();
        this.dependencyFinder = new DependencyFinder();
        this.nonChainedAnalyzer = new NonChainedItemsAnalyzer();
        this.modelAnalyzer = new ModelChainAnalyzer();
    }

    /**
     * Initialize with analysis context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
        this.containerExtractor.initialize(context);
        this.dependencyFinder.initialize(context);
        this.nonChainedAnalyzer.initialize(context);
        this.modelAnalyzer.initialize(context);
    }

    /**
     * Analyze and display the chains for this service's domain (ChainAnalysisService interface)
     */
    analyzeChains(sourceEntities: SourceEntities): void {
        this.showReconciliation(sourceEntities);
    }

    /**
     * Show reconciliation summary - final sync readiness report
     */
    showReconciliation(sourceEntities: SourceEntities): void {
        // Calculate total entities and those in chains
        const totalCounts = {
            pages: sourceEntities.pages?.length || 0,
            content: sourceEntities.content?.length || 0,
            models: sourceEntities.models?.length || 0,
            templates: sourceEntities.templates?.length || 0,
            containers: sourceEntities.containers?.length || 0,
            assets: sourceEntities.assets?.length || 0,
            galleries: sourceEntities.galleries?.length || 0
        };

        const entitiesInChains: EntitiesInChains = {
            pages: new Set<number>(),
            content: new Set<number>(),
            models: new Set<string>(),
            templates: new Set<string>(),
            containers: new Set<number>(),
            assets: new Set<string>(),
            galleries: new Set<number>()
        };

        // Collect entities from all chains
        this.nonChainedAnalyzer.collectAllEntitiesInChains(sourceEntities, entitiesInChains);

        const totalEntities = Object.values(totalCounts).reduce((sum, count) => sum + count, 0);
        const totalInChains = Object.values(entitiesInChains).reduce((sum, set) => sum + set.size, 0);

        // Find broken items that will be skipped
        const brokenItems = this.findAllBrokenItems(sourceEntities);
        
        // 🐛 CRITICAL FIX: Syncable items should be ALL entities minus broken ones
        // Previously was: totalInChains - brokenItems.length (only counted in-chain entities)
        // Corrected to: totalEntities - brokenItems.length (counts ALL entities)
        const syncableItems = totalEntities - brokenItems.length;

        console.log(ansiColors.cyan(`📊 SYNC READINESS SUMMARY`));
        console.log(ansiColors.white(`   Total entities: ${totalEntities}`));
        console.log(ansiColors.green(`   Ready to sync: ${syncableItems} items`));
        
        // Show concise entity type breakdown
        console.log(ansiColors.gray(`\n   Entity breakdown:`));
        
        // All pages will be synced - some in dependency chains, others as simple threads
        const contentBearingPages = sourceEntities.pages?.filter((page: any) => 
            page.pageType !== 'folder' && page.templateName && page.templateName !== null
        ).length || 0;
        const structuralPages = (sourceEntities.pages?.length || 0) - contentBearingPages;
        
        const entityTypes = [
            { name: 'Pages', total: totalCounts.pages, inChains: entitiesInChains.pages.size, note: '' },
            { name: 'Content', total: totalCounts.content, inChains: entitiesInChains.content.size, note: '' },
            { name: 'Models', total: totalCounts.models, inChains: entitiesInChains.models.size, note: '' },
            { name: 'Templates', total: totalCounts.templates, inChains: entitiesInChains.templates.size, note: '' },
            { name: 'Containers', total: totalCounts.containers, inChains: entitiesInChains.containers.size, note: '' },
            { name: 'Assets', total: totalCounts.assets, inChains: entitiesInChains.assets.size, note: '' },
            { name: 'Galleries', total: totalCounts.galleries, inChains: entitiesInChains.galleries.size, note: '' }
        ];

        entityTypes.forEach(type => {
            if (type.total === 0) return; // Skip empty types
            const outOfChains = type.total - type.inChains;
            const accountedFor = type.inChains + outOfChains === type.total ? '100%' : 'MISMATCH';
            console.log(ansiColors.gray(`     - ${type.name}: ${type.inChains} in chains, ${outOfChains} out, ${accountedFor} accounted for${type.note}`));
        });
        
        if (brokenItems.length > 0) {
            console.log(ansiColors.yellow(`\n   Will be skipped: ${brokenItems.length} broken items`));
            console.log(ansiColors.gray(`\n   Broken items that will be skipped:`));
            brokenItems.slice(0, 10).forEach(item => {
                console.log(ansiColors.red(`     - ${item}`));
            });
            if (brokenItems.length > 10) {
                console.log(ansiColors.gray(`     ... and ${brokenItems.length - 10} more broken items`));
            }
        }

        console.log(ansiColors.cyan(`\n   🚀 Do you want to proceed to sync ${syncableItems} items?`));
    }

    /**
     * Find all broken items across all entity types
     */
    findAllBrokenItems(sourceEntities: SourceEntities): string[] {
        const brokenItems: string[] = [];

        // Find broken pages
        if (sourceEntities.pages) {
            sourceEntities.pages.forEach((page: any) => {
                const missing = this.dependencyFinder.findMissingDependenciesForPage(page, sourceEntities);
                if (missing.length > 0) {
                    brokenItems.push(`PageID:${page.pageID} (${page.name || 'No Name'})`);
                }
            });
        }

        // Find broken containers (not in page chains)
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
                    brokenItems.push(`ContainerID:${container.contentViewID} (${container.referenceName})`);
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
                    brokenItems.push(`Model:${model.referenceName} (${model.displayName})`);
                }
            });
        }

        return brokenItems;
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