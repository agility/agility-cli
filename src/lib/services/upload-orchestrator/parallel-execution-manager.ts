/**
 * Parallel Execution Manager - Main Upload Orchestrator
 * 
 * Coordinates multi-threaded upload with real-time visualization
 * Based on validated parallel execution plan from Phase 19-20
 */

import {
    UploadOrchestratorConfig,
    ThreadConfiguration,
    SourceEntities,
    ThreadResult,
    EntityType
} from './types';
import { GlobalProgressTracker } from './global-progress-tracker';
import { DependencyGateManager } from './dependency-gate-manager';
import { MockApiServices } from './mock-api-services';

export class ParallelExecutionManager {
    private config: UploadOrchestratorConfig;
    private progressTracker: GlobalProgressTracker;
    private gateManager: DependencyGateManager;
    private mockApi: MockApiServices;
    private isRunning: boolean = false;

    constructor(config: UploadOrchestratorConfig) {
        this.config = config;
        this.gateManager = new DependencyGateManager();
        this.mockApi = new MockApiServices(config.timing.mockApiDelays);
        
        // Will be initialized when we know total item count
        this.progressTracker = new GlobalProgressTracker(0, config.visualization);
    }

    /**
     * Execute the full multi-threaded upload orchestration
     */
    async executeUpload(sourceEntities: SourceEntities): Promise<{
        successful: number;
        failed: number;
        totalTime: number;
        threadResults: Map<string, ThreadResult>;
    }> {
        const startTime = Date.now();
        this.isRunning = true;

        // Calculate total entities and initialize progress tracker
        const totalEntities = this.calculateTotalEntities(sourceEntities);
        this.progressTracker = new GlobalProgressTracker(totalEntities, this.config.visualization);

        console.log(`\n🚀 STARTING PARALLEL UPLOAD ORCHESTRATOR`);
        console.log(`📊 Total Entities: ${totalEntities.toLocaleString()}`);
        console.log(`🧵 Threads: ${this.config.threads.length}`);
        console.log(`⚙️  Configuration: ${JSON.stringify(this.config.batchSizes, null, 2)}`);

        // Register threads and entity counts
        this.registerThreadsWithProgress(sourceEntities);
        this.registerEntityCounts(sourceEntities);

        // Start visualization
        this.progressTracker.setCurrentPhase('Thread Initialization');

        const threadResults = new Map<string, ThreadResult>();

        try {
            // Execute threads based on our 3-phase strategy
            console.log(`\n🎬 Launching upload threads...`);

            // Phase 1: Independent Entities (Thread 1)
            const thread1Promise = this.executeIndependentEntitiesThread(sourceEntities);

            // Phase 2: Dependency Content (Thread 2) - waits for models/templates/containers
            const thread2Promise = this.executeBatchedContentThread(sourceEntities);

            // Phase 3: Complex Entities (Thread 3) - waits for content/assets
            const thread3Promise = this.executeComplexEntitiesThread(sourceEntities);

            // Wait for all threads to complete
            const [thread1Result, thread2Result, thread3Result] = await Promise.all([
                thread1Promise,
                thread2Promise,
                thread3Promise
            ]);

            threadResults.set('independent-entities', thread1Result);
            threadResults.set('batched-content', thread2Result);
            threadResults.set('complex-entities', thread3Result);

            // Calculate final statistics
            const totalSuccessful = Array.from(threadResults.values()).reduce((sum, result) => sum + result.successful.length, 0);
            const totalFailed = Array.from(threadResults.values()).reduce((sum, result) => sum + result.failed.length, 0);
            const totalTime = Date.now() - startTime;

            // Show final summary
            this.progressTracker.renderFinalSummary();

            return {
                successful: totalSuccessful,
                failed: totalFailed,
                totalTime,
                threadResults
            };

        } catch (error) {
            console.error(`\n❌ Upload orchestration failed:`, error);
            throw error;
        } finally {
            this.isRunning = false;
            this.cleanup();
        }
    }

    /**
     * Thread 1: Independent Entity Upload
     */
    private async executeIndependentEntitiesThread(sourceEntities: SourceEntities): Promise<ThreadResult> {
        const threadId = 'independent-entities';
        const startTime = Date.now();

        this.progressTracker.updateThreadStatus(threadId, 'running', 'Uploading independent entities...');

        const result: ThreadResult = {
            threadId,
            status: 'running',
            successful: [],
            failed: [],
            totalTime: 0,
            subResults: new Map(),
            errors: []
        };

        try {
            // Upload models sequentially
            if (sourceEntities.models && sourceEntities.models.length > 0) {
                console.log(`\n📋 Thread 1: Uploading ${sourceEntities.models.length} models...`);
                const modelResults = await this.uploadModelsSequentially(sourceEntities.models, threadId);
                result.subResults.set('models', modelResults);
                result.successful.push(...modelResults.uploaded);
                result.failed.push(...modelResults.failed);
            }

            // Upload templates sequentially (after models)
            if (sourceEntities.templates && sourceEntities.templates.length > 0) {
                console.log(`\n🏗️ Thread 1: Uploading ${sourceEntities.templates.length} templates...`);
                const templateResults = await this.uploadTemplatesSequentially(sourceEntities.templates, threadId);
                result.subResults.set('templates', templateResults);
                result.successful.push(...templateResults.uploaded);
                result.failed.push(...templateResults.failed);
            }

            // Upload containers sequentially (after models)
            if (sourceEntities.containers && sourceEntities.containers.length > 0) {
                console.log(`\n📦 Thread 1: Uploading ${sourceEntities.containers.length} containers...`);
                const containerResults = await this.uploadContainersSequentially(sourceEntities.containers, threadId);
                result.subResults.set('containers', containerResults);
                result.successful.push(...containerResults.uploaded);
                result.failed.push(...containerResults.failed);
            }

            // Upload independent assets in batches
            const independentAssets = (sourceEntities.assets || []).filter(asset => !asset.mediaGroupingID);
            if (independentAssets.length > 0) {
                console.log(`\n📎 Thread 1: Uploading ${independentAssets.length} independent assets...`);
                const assetResults = await this.uploadIndependentAssets(independentAssets, threadId);
                result.subResults.set('assets', assetResults);
                result.successful.push(...assetResults.uploaded);
                result.failed.push(...assetResults.failed);
            }

            // Signal completion gates
            await this.gateManager.signalGate('models-complete', threadId);
            await this.gateManager.signalGate('templates-complete', threadId);
            await this.gateManager.signalGate('containers-complete', threadId);
            await this.gateManager.signalGate('independent-assets-complete', threadId);

            result.status = 'complete';
            this.progressTracker.updateThreadStatus(threadId, 'complete', 'All independent entities uploaded');

        } catch (error) {
            result.status = 'error';
            this.progressTracker.updateThreadStatus(threadId, 'error', `Error: ${error}`);
            this.progressTracker.addThreadError(threadId, 'thread-execution', error.toString());
        }

        result.totalTime = Date.now() - startTime;
        return result;
    }

    /**
     * Thread 2: Batched Content Upload
     */
    private async executeBatchedContentThread(sourceEntities: SourceEntities): Promise<ThreadResult> {
        const threadId = 'batched-content';
        const startTime = Date.now();

        this.progressTracker.updateThreadStatus(threadId, 'waiting', 'Waiting for dependencies...');

        const result: ThreadResult = {
            threadId,
            status: 'waiting',
            successful: [],
            failed: [],
            totalTime: 0,
            subResults: new Map(),
            errors: []
        };

        try {
            // Wait for dependencies
            console.log(`\n⏳ Thread 2: Waiting for models, templates, and containers...`);
            await this.gateManager.waitForGate('models-complete', threadId);
            await this.gateManager.waitForGate('templates-complete', threadId);
            await this.gateManager.waitForGate('containers-complete', threadId);

            this.progressTracker.updateThreadStatus(threadId, 'running', 'Uploading content in batches...');

            // Upload content in dependency-level batches
            if (sourceEntities.content && sourceEntities.content.length > 0) {
                console.log(`\n📝 Thread 2: Uploading ${sourceEntities.content.length} content items in batches...`);
                const contentResults = await this.uploadContentInBatches(sourceEntities.content, threadId);
                result.subResults.set('content', contentResults);
                result.successful.push(...contentResults.uploaded);
                result.failed.push(...contentResults.failed);
            }

            // Signal completion
            await this.gateManager.signalGate('content-complete', threadId);

            result.status = 'complete';
            this.progressTracker.updateThreadStatus(threadId, 'complete', 'All content uploaded');

        } catch (error) {
            result.status = 'error';
            this.progressTracker.updateThreadStatus(threadId, 'error', `Error: ${error}`);
            this.progressTracker.addThreadError(threadId, 'thread-execution', error.toString());
        }

        result.totalTime = Date.now() - startTime;
        return result;
    }

    /**
     * Thread 3: Complex Entity Chain Traversal
     */
    private async executeComplexEntitiesThread(sourceEntities: SourceEntities): Promise<ThreadResult> {
        const threadId = 'complex-entities';
        const startTime = Date.now();

        this.progressTracker.updateThreadStatus(threadId, 'waiting', 'Waiting for dependencies...');

        const result: ThreadResult = {
            threadId,
            status: 'waiting',
            successful: [],
            failed: [],
            totalTime: 0,
            subResults: new Map(),
            errors: []
        };

        try {
            // Wait for dependencies
            console.log(`\n⏳ Thread 3: Waiting for content and assets...`);
            await this.gateManager.waitForGate('content-complete', threadId);
            await this.gateManager.waitForGate('independent-assets-complete', threadId);

            this.progressTracker.updateThreadStatus(threadId, 'running', 'Processing complex entity chains...');

            // Upload gallery assets first
            const galleryAssets = (sourceEntities.assets || []).filter(asset => asset.mediaGroupingID);
            if (galleryAssets.length > 0) {
                console.log(`\n🖼️ Thread 3: Uploading ${galleryAssets.length} gallery assets...`);
                const galleryAssetResults = await this.uploadGalleryAssets(galleryAssets, threadId);
                result.subResults.set('gallery-assets', galleryAssetResults);
                result.successful.push(...galleryAssetResults.uploaded);
                result.failed.push(...galleryAssetResults.failed);
            }

            // Upload pages and galleries in parallel
            const pagePromise = sourceEntities.pages && sourceEntities.pages.length > 0 
                ? this.uploadPagesSequentially(sourceEntities.pages, threadId)
                : Promise.resolve({ uploaded: [], failed: [], totalTime: 0, batchCount: 0, retryCount: 0, taskName: 'pages' });

            const galleryPromise = sourceEntities.galleries && sourceEntities.galleries.length > 0
                ? this.uploadGalleriesSequentially(sourceEntities.galleries, threadId)
                : Promise.resolve({ uploaded: [], failed: [], totalTime: 0, batchCount: 0, retryCount: 0, taskName: 'galleries' });

            const [pageResults, galleryResults] = await Promise.all([pagePromise, galleryPromise]);

            result.subResults.set('pages', pageResults);
            result.subResults.set('galleries', galleryResults);
            result.successful.push(...pageResults.uploaded, ...galleryResults.uploaded);
            result.failed.push(...pageResults.failed, ...galleryResults.failed);

            // Signal final completion
            await this.gateManager.signalGate('all-entities-complete', threadId);

            result.status = 'complete';
            this.progressTracker.updateThreadStatus(threadId, 'complete', 'All complex entities uploaded');

        } catch (error) {
            result.status = 'error';
            this.progressTracker.updateThreadStatus(threadId, 'error', `Error: ${error}`);
            this.progressTracker.addThreadError(threadId, 'thread-execution', error.toString());
        }

        result.totalTime = Date.now() - startTime;
        return result;
    }

    /**
     * Upload models sequentially with progress tracking
     */
    private async uploadModelsSequentially(models: any[], threadId: string): Promise<{
        uploaded: any[];
        failed: any[];
        totalTime: number;
        batchCount: number;
        retryCount: number;
        taskName: string;
    }> {
        const startTime = Date.now();
        const uploaded: any[] = [];
        const failed: any[] = [];

        for (let i = 0; i < models.length; i++) {
            const model = models[i];

            try {
                const response = await this.mockApi.saveModel(model);
                
                if (response.success) {
                    uploaded.push({
                        sourceId: model.id,
                        targetId: response.data,
                        entityType: 'models',
                        operation: 'saveModel',
                        timestamp: Date.now()
                    });
                } else {
                    failed.push({
                        sourceId: model.id,
                        entityType: 'models',
                        operation: 'saveModel',
                        timestamp: Date.now(),
                        error: response.error
                    });
                }
            } catch (error) {
                failed.push({
                    sourceId: model.id,
                    entityType: 'models',
                    operation: 'saveModel',
                    timestamp: Date.now(),
                    error: error.toString()
                });
            }

            // Update progress
            this.progressTracker.updateSubProgress(threadId, 'models', i + 1, models.length);
        }

        return {
            uploaded,
            failed,
            totalTime: Date.now() - startTime,
            batchCount: models.length,
            retryCount: 0,
            taskName: 'models'
        };
    }

    /**
     * Upload templates sequentially with progress tracking
     */
    private async uploadTemplatesSequentially(templates: any[], threadId: string): Promise<{
        uploaded: any[];
        failed: any[];
        totalTime: number;
        batchCount: number;
        retryCount: number;
        taskName: string;
    }> {
        const startTime = Date.now();
        const uploaded: any[] = [];
        const failed: any[] = [];

        for (let i = 0; i < templates.length; i++) {
            const template = templates[i];

            try {
                const response = await this.mockApi.saveTemplate(template);
                
                if (response.success) {
                    uploaded.push({
                        sourceId: template.id,
                        targetId: response.data,
                        entityType: 'templates',
                        operation: 'saveTemplate',
                        timestamp: Date.now()
                    });
                } else {
                    failed.push({
                        sourceId: template.id,
                        entityType: 'templates',
                        operation: 'saveTemplate',
                        timestamp: Date.now(),
                        error: response.error
                    });
                }
            } catch (error) {
                failed.push({
                    sourceId: template.id,
                    entityType: 'templates',
                    operation: 'saveTemplate',
                    timestamp: Date.now(),
                    error: error.toString()
                });
            }

            // Update progress
            this.progressTracker.updateSubProgress(threadId, 'templates', i + 1, templates.length);
        }

        return {
            uploaded,
            failed,
            totalTime: Date.now() - startTime,
            batchCount: templates.length,
            retryCount: 0,
            taskName: 'templates'
        };
    }

    /**
     * Upload containers sequentially with progress tracking
     */
    private async uploadContainersSequentially(containers: any[], threadId: string): Promise<{
        uploaded: any[];
        failed: any[];
        totalTime: number;
        batchCount: number;
        retryCount: number;
        taskName: string;
    }> {
        const startTime = Date.now();
        const uploaded: any[] = [];
        const failed: any[] = [];

        for (let i = 0; i < containers.length; i++) {
            const container = containers[i];

            try {
                const response = await this.mockApi.saveContainer(container);
                
                if (response.success) {
                    uploaded.push({
                        sourceId: container.id,
                        targetId: response.data,
                        entityType: 'containers',
                        operation: 'saveContainer',
                        timestamp: Date.now()
                    });
                } else {
                    failed.push({
                        sourceId: container.id,
                        entityType: 'containers',
                        operation: 'saveContainer',
                        timestamp: Date.now(),
                        error: response.error
                    });
                }
            } catch (error) {
                failed.push({
                    sourceId: container.id,
                    entityType: 'containers',
                    operation: 'saveContainer',
                    timestamp: Date.now(),
                    error: error.toString()
                });
            }

            // Update progress
            this.progressTracker.updateSubProgress(threadId, 'containers', i + 1, containers.length);
        }

        return {
            uploaded,
            failed,
            totalTime: Date.now() - startTime,
            batchCount: containers.length,
            retryCount: 0,
            taskName: 'containers'
        };
    }

    /**
     * Upload independent assets in batches
     */
    private async uploadIndependentAssets(assets: any[], threadId: string): Promise<{
        uploaded: any[];
        failed: any[];
        totalTime: number;
        batchCount: number;
        retryCount: number;
        taskName: string;
    }> {
        const startTime = Date.now();
        const uploaded: any[] = [];
        const failed: any[] = [];
        const batchSize = this.config.batchSizes.assets;
        let batchCount = 0;

        // Process in batches
        for (let i = 0; i < assets.length; i += batchSize) {
            const batch = assets.slice(i, Math.min(i + batchSize, assets.length));
            batchCount++;

            try {
                const batchResponse = await this.mockApi.uploadAssets(batch);
                
                // Process batch results
                uploaded.push(...batchResponse.successful.map(success => ({
                    sourceId: success.sourceId,
                    targetId: success.targetId,
                    entityType: 'assets',
                    operation: 'uploadAssets',
                    timestamp: Date.now()
                })));

                failed.push(...batchResponse.failed.map(failure => ({
                    sourceId: failure.sourceId,
                    entityType: 'assets',
                    operation: 'uploadAssets',
                    timestamp: Date.now(),
                    error: failure.error
                })));

            } catch (error) {
                // Mark entire batch as failed
                failed.push(...batch.map(asset => ({
                    sourceId: asset.mediaID,
                    entityType: 'assets',
                    operation: 'uploadAssets',
                    timestamp: Date.now(),
                    error: error.toString()
                })));
            }

            // Update progress
            this.progressTracker.updateSubProgress(threadId, 'assets', Math.min(i + batchSize, assets.length), assets.length, `Batch ${batchCount}`);
        }

        return {
            uploaded,
            failed,
            totalTime: Date.now() - startTime,
            batchCount,
            retryCount: 0,
            taskName: 'assets'
        };
    }

    /**
     * Upload content in batches (simplified for demo)
     */
    private async uploadContentInBatches(content: any[], threadId: string): Promise<{
        uploaded: any[];
        failed: any[];
        totalTime: number;
        batchCount: number;
        retryCount: number;
        taskName: string;
    }> {
        const startTime = Date.now();
        const uploaded: any[] = [];
        const failed: any[] = [];
        const batchSize = this.config.batchSizes.content;
        let batchCount = 0;

        // Process in batches (simplified - in real implementation would use dependency levels)
        for (let i = 0; i < content.length; i += batchSize) {
            const batch = content.slice(i, Math.min(i + batchSize, content.length));
            batchCount++;

            try {
                const batchResponse = await this.mockApi.saveContentItems(batch);
                
                // Process batch results
                uploaded.push(...batchResponse.successful.map(success => ({
                    sourceId: success.sourceId,
                    targetId: success.targetId,
                    entityType: 'content',
                    operation: 'saveContentItems',
                    timestamp: Date.now()
                })));

                failed.push(...batchResponse.failed.map(failure => ({
                    sourceId: failure.sourceId,
                    entityType: 'content',
                    operation: 'saveContentItems',
                    timestamp: Date.now(),
                    error: failure.error
                })));

            } catch (error) {
                // Mark entire batch as failed
                failed.push(...batch.map(item => ({
                    sourceId: item.contentID,
                    entityType: 'content',
                    operation: 'saveContentItems',
                    timestamp: Date.now(),
                    error: error.toString()
                })));
            }

            // Update progress
            this.progressTracker.updateSubProgress(threadId, 'content', Math.min(i + batchSize, content.length), content.length, `Batch ${batchCount}`);
        }

        return {
            uploaded,
            failed,
            totalTime: Date.now() - startTime,
            batchCount,
            retryCount: 0,
            taskName: 'content'
        };
    }

    /**
     * Upload gallery assets in gallery-grouped batches
     */
    private async uploadGalleryAssets(assets: any[], threadId: string): Promise<{
        uploaded: any[];
        failed: any[];
        totalTime: number;
        batchCount: number;
        retryCount: number;
        taskName: string;
    }> {
        const startTime = Date.now();
        const uploaded: any[] = [];
        const failed: any[] = [];

        // Group by gallery
        const galleryGroups = new Map<number, any[]>();
        assets.forEach(asset => {
            if (!galleryGroups.has(asset.mediaGroupingID)) {
                galleryGroups.set(asset.mediaGroupingID, []);
            }
            galleryGroups.get(asset.mediaGroupingID)!.push(asset);
        });

        let processedAssets = 0;
        const batchCount = galleryGroups.size;

        for (const [galleryId, galleryAssets] of Array.from(galleryGroups.entries())) {
            try {
                const batchResponse = await this.mockApi.uploadAssets(galleryAssets, galleryId);
                
                uploaded.push(...batchResponse.successful.map(success => ({
                    sourceId: success.sourceId,
                    targetId: success.targetId,
                    entityType: 'assets',
                    operation: 'uploadAssets',
                    timestamp: Date.now()
                })));

                failed.push(...batchResponse.failed.map(failure => ({
                    sourceId: failure.sourceId,
                    entityType: 'assets',
                    operation: 'uploadAssets',
                    timestamp: Date.now(),
                    error: failure.error
                })));

            } catch (error) {
                failed.push(...galleryAssets.map(asset => ({
                    sourceId: asset.mediaID,
                    entityType: 'assets',
                    operation: 'uploadAssets',
                    timestamp: Date.now(),
                    error: error.toString()
                })));
            }

            processedAssets += galleryAssets.length;
            this.progressTracker.updateSubProgress(threadId, 'gallery-assets', processedAssets, assets.length, `Gallery ${galleryId}`);
        }

        return {
            uploaded,
            failed,
            totalTime: Date.now() - startTime,
            batchCount,
            retryCount: 0,
            taskName: 'gallery-assets'
        };
    }

    /**
     * Upload pages sequentially
     */
    private async uploadPagesSequentially(pages: any[], threadId: string): Promise<{
        uploaded: any[];
        failed: any[];
        totalTime: number;
        batchCount: number;
        retryCount: number;
        taskName: string;
    }> {
        const startTime = Date.now();
        const uploaded: any[] = [];
        const failed: any[] = [];

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];

            try {
                const response = await this.mockApi.savePage(page);
                
                if (response.success) {
                    uploaded.push({
                        sourceId: page.pageID,
                        targetId: response.data,
                        entityType: 'pages',
                        operation: 'savePage',
                        timestamp: Date.now()
                    });
                } else {
                    failed.push({
                        sourceId: page.pageID,
                        entityType: 'pages',
                        operation: 'savePage',
                        timestamp: Date.now(),
                        error: response.error
                    });
                }
            } catch (error) {
                failed.push({
                    sourceId: page.pageID,
                    entityType: 'pages',
                    operation: 'savePage',
                    timestamp: Date.now(),
                    error: error.toString()
                });
            }

            this.progressTracker.updateSubProgress(threadId, 'pages', i + 1, pages.length);
        }

        return {
            uploaded,
            failed,
            totalTime: Date.now() - startTime,
            batchCount: pages.length,
            retryCount: 0,
            taskName: 'pages'
        };
    }

    /**
     * Upload galleries sequentially
     */
    private async uploadGalleriesSequentially(galleries: any[], threadId: string): Promise<{
        uploaded: any[];
        failed: any[];
        totalTime: number;
        batchCount: number;
        retryCount: number;
        taskName: string;
    }> {
        const startTime = Date.now();
        const uploaded: any[] = [];
        const failed: any[] = [];

        for (let i = 0; i < galleries.length; i++) {
            const gallery = galleries[i];

            try {
                const response = await this.mockApi.saveGallery(gallery);
                
                if (response.success) {
                    uploaded.push({
                        sourceId: gallery.id,
                        targetId: response.data,
                        entityType: 'galleries',
                        operation: 'saveGallery',
                        timestamp: Date.now()
                    });
                } else {
                    failed.push({
                        sourceId: gallery.id,
                        entityType: 'galleries',
                        operation: 'saveGallery',
                        timestamp: Date.now(),
                        error: response.error
                    });
                }
            } catch (error) {
                failed.push({
                    sourceId: gallery.id,
                    entityType: 'galleries',
                    operation: 'saveGallery',
                    timestamp: Date.now(),
                    error: error.toString()
                });
            }

            this.progressTracker.updateSubProgress(threadId, 'galleries', i + 1, galleries.length);
        }

        return {
            uploaded,
            failed,
            totalTime: Date.now() - startTime,
            batchCount: galleries.length,
            retryCount: 0,
            taskName: 'galleries'
        };
    }

    /**
     * Calculate total entities for progress tracking
     */
    private calculateTotalEntities(sourceEntities: SourceEntities): number {
        return (
            (sourceEntities.models?.length || 0) +
            (sourceEntities.templates?.length || 0) +
            (sourceEntities.containers?.length || 0) +
            (sourceEntities.content?.length || 0) +
            (sourceEntities.assets?.length || 0) +
            (sourceEntities.pages?.length || 0) +
            (sourceEntities.galleries?.length || 0)
        );
    }

    /**
     * Register threads with progress tracker
     */
    private registerThreadsWithProgress(sourceEntities: SourceEntities): void {
        // Thread 1: Independent entities
        const thread1Items = (sourceEntities.models?.length || 0) + 
                           (sourceEntities.templates?.length || 0) + 
                           (sourceEntities.containers?.length || 0) + 
                           ((sourceEntities.assets || []).filter(a => !a.mediaGroupingID).length);
        this.progressTracker.registerThread('independent-entities', thread1Items, ['models', 'templates', 'containers', 'assets']);

        // Thread 2: Content
        const thread2Items = sourceEntities.content?.length || 0;
        this.progressTracker.registerThread('batched-content', thread2Items, ['content']);

        // Thread 3: Complex entities
        const thread3Items = (sourceEntities.pages?.length || 0) + 
                           (sourceEntities.galleries?.length || 0) + 
                           ((sourceEntities.assets || []).filter(a => a.mediaGroupingID).length);
        this.progressTracker.registerThread('complex-entities', thread3Items, ['pages', 'galleries', 'gallery-assets']);
    }

    /**
     * Register entity counts with progress tracker
     */
    private registerEntityCounts(sourceEntities: SourceEntities): void {
        if (sourceEntities.models) this.progressTracker.updateEntityCount('models', sourceEntities.models.length);
        if (sourceEntities.templates) this.progressTracker.updateEntityCount('templates', sourceEntities.templates.length);
        if (sourceEntities.containers) this.progressTracker.updateEntityCount('containers', sourceEntities.containers.length);
        if (sourceEntities.content) this.progressTracker.updateEntityCount('content', sourceEntities.content.length);
        if (sourceEntities.assets) this.progressTracker.updateEntityCount('assets', sourceEntities.assets.length);
        if (sourceEntities.pages) this.progressTracker.updateEntityCount('pages', sourceEntities.pages.length);
        if (sourceEntities.galleries) this.progressTracker.updateEntityCount('galleries', sourceEntities.galleries.length);
    }

    /**
     * Clean up resources
     */
    private cleanup(): void {
        this.progressTracker.cleanup();
        this.gateManager.cleanup();
    }

    /**
     * Check if orchestrator is running
     */
    isExecuting(): boolean {
        return this.isRunning;
    }

    /**
     * Get current progress state
     */
    getProgress() {
        return this.progressTracker.getProgressState();
    }
} 