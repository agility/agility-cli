/**
 * ChainBuilder Service
 * 
 * Clean separation of concerns for chain-based operations:
 * 1. Data Loading - Load source entities from filesystem
 * 2. Analysis - Perform 6-step dependency chain analysis  
 * 3. Output Generation - Convert analysis to upload-ready format
 * 
 * Designed for integration with push.ts and other chain-aware operations.
 */

import ansiColors from 'ansi-colors';
import { ChainDataLoader, SourceEntities } from './chain-data-loader';
import { ComprehensiveAnalysisRunner, GlobalModelTracker } from './sync-analysis/comprehensive-analysis-runner';
import { UploadSequenceConverter, OptimizedUploadSequence } from './upload-sequence-converter';
import { SyncAnalysisContext } from '../../types/syncAnalysis';
import { fileOperations } from './fileOperations';
import path from 'path';

// Data structures for ChainBuilder
export interface SourceData extends SourceEntities {
    metadata: {
        sourceGuid: string;
        locale: string;
        isPreview: boolean;
        totalEntities: number;
        loadedAt: Date;
    };
}

export interface ChainAnalysisResults {
    modelChains: any[];
    pageChains: any[];
    containerChains: any[];
    nonChainedItems: {
        pages: any[];
        content: any[];
        models: any[];
        templates: any[];
        assets: any[];
        galleries: any[];
    };
    brokenChains: any[];
    reconciliation: {
        totalEntities: number;
        entitiesInChains: number;
        entitiesOutOfChains: number;
        syncableEntities: number;
    };
}

export interface UploadSequence {
    modelChains: any[];          // Process first (establish foundation)
    pageChains: any[];           // Process second (hierarchical order)
    standaloneContainers: any[]; // Process third
    nonChainedItems: {           // Process last
        assets: any[];
        galleries: any[];
        templates: any[];
        pages: any[];
        content: any[];
    };
    metadata: {
        totalEntities: number;
        processingOrder: string[];  // For debugging/logging
        estimatedDuration: number;  // For progress tracking
    };
}

export class ChainBuilder {
    private dataLoader?: ChainDataLoader;
    private analysisRunner: ComprehensiveAnalysisRunner;
    private sequenceConverter: UploadSequenceConverter;
    private modelTracker: GlobalModelTracker;
    private rootPath?: string; // Store rootPath for reuse in analysis

    constructor() {
        this.analysisRunner = new ComprehensiveAnalysisRunner();
        this.sequenceConverter = new UploadSequenceConverter();
        this.modelTracker = new GlobalModelTracker();
    }

    /**
     * 1. DATA LOADING: Load source data from filesystem
     */
    async loadSourceData(guid: string, locale: string, isPreview: boolean, rootPath?: string): Promise<SourceData> {
        console.log(ansiColors.cyan('🔄 Loading source data...'));
        
        // Use current working directory + agility-files if rootPath not provided
        const workingRootPath = rootPath || process.cwd();
        this.rootPath = workingRootPath; // Store for later use
        
        // Initialize data loader with enhanced fileOperations
        this.dataLoader = new ChainDataLoader({
            sourceGuid: guid,
            locale: locale,
            isPreview: isPreview,
            rootPath: workingRootPath,
            legacyFolders: false, // Default to false for chain-builder
            elements: ['Pages', 'Templates', 'Containers', 'Models', 'Content', 'Assets', 'Galleries']
        });

        // Validate source data structure exists
        if (!this.dataLoader.validateSourceDataStructure()) {
            throw new Error(`Source data not found for ${guid}/${locale}/${isPreview ? 'preview' : 'live'}`);
        }

        // Load entities using proven pattern
        const sourceEntities = await this.dataLoader.loadSourceEntities();
        
        // Calculate total entities
        const totalEntities = Object.values(sourceEntities).reduce((sum: number, arr: any) => 
            sum + (Array.isArray(arr) ? arr.length : 0), 0);

        // Return enhanced source data with metadata
        const sourceData: SourceData = {
            ...sourceEntities,
            metadata: {
                sourceGuid: guid,
                locale: locale,
                isPreview: isPreview,
                totalEntities: totalEntities,
                loadedAt: new Date()
            }
        };

        console.log(ansiColors.green(`✅ Loaded ${totalEntities} source entities`));
        return sourceData;
    }

    /**
     * 2. ANALYSIS: Perform 6-step dependency chain analysis
     */
    async performChainAnalysis(sourceData: SourceData): Promise<ChainAnalysisResults> {
        console.log(ansiColors.cyan('🔗 Performing chain analysis...'));

        // Create analysis context - use rootPath directly
        const context: SyncAnalysisContext = {
            sourceGuid: sourceData.metadata.sourceGuid,
            locale: sourceData.metadata.locale,
            isPreview: sourceData.metadata.isPreview,
            rootPath: this.rootPath || process.cwd(),
            legacyFolders: false, // Default to false for chain-builder
            debug: false,
            elements: ['Pages', 'Templates', 'Containers', 'Models', 'Content', 'Assets', 'Galleries'],
            modelTracker: this.modelTracker
        };

        // Initialize analysis runner with context
        this.analysisRunner.initialize(context);

        // Run comprehensive analysis (this will produce console output)
        this.analysisRunner.runComprehensiveAnalysis(sourceData);

        // For now, return basic structure - we'll enhance this as we build out the integration
        const analysisResults: ChainAnalysisResults = {
            modelChains: [], // Will be populated from analysis runner output
            pageChains: [],  // Will be populated from analysis runner output
            containerChains: [], // Will be populated from analysis runner output
            nonChainedItems: {
                pages: sourceData.pages || [],
                content: sourceData.content || [],
                models: sourceData.models || [],
                templates: sourceData.templates || [],
                assets: sourceData.assets || [],
                galleries: sourceData.galleries || []
            },
            brokenChains: [], // Will be populated from analysis runner output
            reconciliation: {
                totalEntities: sourceData.metadata.totalEntities,
                entitiesInChains: 0, // Will be calculated
                entitiesOutOfChains: 0, // Will be calculated
                syncableEntities: sourceData.metadata.totalEntities // For now, assume all are syncable
            }
        };

        console.log(ansiColors.green(`✅ Chain analysis completed`));
        return analysisResults;
    }

    /**
     * 3. STRUCTURED OUTPUT: Convert analysis to upload-ready format
     */
    generateUploadSequence(analysisResults: ChainAnalysisResults, sourceData: SourceData): OptimizedUploadSequence {
        console.log(ansiColors.cyan('📋 Generating optimized upload sequence...'));

        // Use the new UploadSequenceConverter for sophisticated dependency ordering
        const optimizedSequence = this.sequenceConverter.convertToUploadSequence(analysisResults, sourceData);
        
        // Print debug information if needed
        if (process.env.DEBUG_UPLOAD_SEQUENCE) {
            this.sequenceConverter.printUploadSequence(optimizedSequence);
        }

        console.log(ansiColors.green(`✅ Upload sequence optimized with ${optimizedSequence.metadata.totalBatches} batches`));
        console.log(ansiColors.blue(`📊 Total entities: ${optimizedSequence.metadata.totalEntities}, Est. duration: ${optimizedSequence.metadata.estimatedTotalDuration} min`));
        
        return optimizedSequence;
    }

    /**
     * 4. CONVENIENCE: One-shot method for push.ts integration
     */
    async buildUploadSequence(guid: string, locale: string, isPreview: boolean, rootPath?: string): Promise<OptimizedUploadSequence> {
        try {
            console.log(ansiColors.cyan(`\n🏗️  Building optimized upload sequence for ${guid}/${locale}/${isPreview ? 'preview' : 'live'}`));
            
            // Step 1: Load source data
            const sourceData = await this.loadSourceData(guid, locale, isPreview, rootPath);
            
            // Step 2: Perform analysis
            const analysisResults = await this.performChainAnalysis(sourceData);
            
            // Step 3: Generate optimized upload sequence
            const uploadSequence = this.generateUploadSequence(analysisResults, sourceData);
            
            console.log(ansiColors.green(`\n🎉 Optimized upload sequence ready!`));
            console.log(ansiColors.yellow(`⏱️  ${uploadSequence.metadata.totalBatches} batches, ${uploadSequence.metadata.estimatedTotalDuration} min total`));
            
            // Validate the sequence
            if (!uploadSequence.validation.allDependenciesResolved) {
                console.warn(ansiColors.yellow(`⚠️ ${uploadSequence.validation.missingDependencies.length} dependency issues found`));
            } else {
                console.log(ansiColors.green(`✅ All dependencies properly ordered`));
            }
            
            return uploadSequence;
            
        } catch (error) {
            console.error(ansiColors.red(`❌ Failed to build upload sequence: ${error.message}`));
            throw error;
        }
    }

    /**
     * Helper: Estimate processing time based on entity count
     */
    private estimateProcessingTime(entityCount: number): number {
        // Rough estimate: ~0.5 seconds per entity for upload operations
        const estimatedSeconds = entityCount * 0.5;
        return Math.ceil(estimatedSeconds / 60); // Return in minutes
    }

    /**
     * Helper: Reset model tracker for new analysis
     */
    resetModelTracking(): void {
        this.modelTracker.reset();
    }
}