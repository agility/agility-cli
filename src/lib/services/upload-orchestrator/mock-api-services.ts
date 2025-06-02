/**
 * Mock API Services - Realistic Upload Simulation
 * 
 * Simulates Management SDK API calls with realistic timing, error rates, and batch responses
 * Based on validated strategy documents from Phase 19-20
 */

import {
    MockApiResponse,
    MockBatchResponse,
    SuccessfulUpload,
    FailedUpload,
    MockApiDelays,
    SourceEntities
} from './types';

export class MockApiServices {
    private delays: MockApiDelays;
    private errorRates: Map<string, number> = new Map();
    private networkLatency: number = 75; // Base network latency in ms
    private consecutiveFailures: Map<string, number> = new Map();
    private totalApiCalls: number = 0;

    constructor(delays: MockApiDelays) {
        this.delays = delays;
        this.initializeErrorRates();
    }

    /**
     * Initialize realistic error rates for different entity types
     */
    private initializeErrorRates(): void {
        this.errorRates.set('models', 0.02);      // 2% error rate - models are usually stable
        this.errorRates.set('templates', 0.03);   // 3% error rate - templates can have validation issues
        this.errorRates.set('containers', 0.04);  // 4% error rate - containers depend on models
        this.errorRates.set('content', 0.05);     // 5% error rate - content can have reference issues
        this.errorRates.set('assets', 0.08);      // 8% error rate - assets can have file issues
        this.errorRates.set('pages', 0.06);       // 6% error rate - pages have complex dependencies
        this.errorRates.set('galleries', 0.04);   // 4% error rate - galleries are simpler
    }

    /**
     * Mock saveModel API call
     */
    async saveModel(model: any): Promise<MockApiResponse<number>> {
        const entityType = 'models';
        const processingTime = this.calculateProcessingTime(entityType, 1);
        
        await this.simulateNetworkDelay(processingTime);
        
        const shouldFail = this.shouldSimulateFailure(entityType);
        this.totalApiCalls++;

        if (shouldFail) {
            return {
                success: false,
                error: this.generateRealisticError(entityType, model.id),
                processingTime
            };
        }

        const targetId = this.generateMockId('model', model.id);
        return {
            success: true,
            data: targetId,
            processingTime
        };
    }

    /**
     * Mock saveTemplate API call
     */
    async saveTemplate(template: any): Promise<MockApiResponse<number>> {
        const entityType = 'templates';
        const processingTime = this.calculateProcessingTime(entityType, 1);
        
        await this.simulateNetworkDelay(processingTime);
        
        const shouldFail = this.shouldSimulateFailure(entityType);
        this.totalApiCalls++;

        if (shouldFail) {
            return {
                success: false,
                error: this.generateRealisticError(entityType, template.id),
                processingTime
            };
        }

        const targetId = this.generateMockId('template', template.id);
        return {
            success: true,
            data: targetId,
            processingTime
        };
    }

    /**
     * Mock saveContainer API call
     */
    async saveContainer(container: any): Promise<MockApiResponse<number>> {
        const entityType = 'containers';
        const processingTime = this.calculateProcessingTime(entityType, 1);
        
        await this.simulateNetworkDelay(processingTime);
        
        const shouldFail = this.shouldSimulateFailure(entityType);
        this.totalApiCalls++;

        if (shouldFail) {
            return {
                success: false,
                error: this.generateRealisticError(entityType, container.id),
                processingTime
            };
        }

        const targetId = this.generateMockId('container', container.id);
        return {
            success: true,
            data: targetId,
            processingTime
        };
    }

    /**
     * Mock saveContentItems batch API call
     */
    async saveContentItems(contentItems: any[]): Promise<MockBatchResponse> {
        const entityType = 'content';
        const batchSize = contentItems.length;
        const processingTime = this.calculateProcessingTime(entityType, batchSize);
        
        await this.simulateNetworkDelay(processingTime);
        
        const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const successful: SuccessfulUpload[] = [];
        const failed: FailedUpload[] = [];

        // Simulate realistic batch processing with some failures
        for (const item of contentItems) {
            const shouldFail = this.shouldSimulateFailure(entityType);
            
            if (shouldFail) {
                failed.push({
                    sourceId: item.contentID,
                    entityType,
                    error: this.generateRealisticError(entityType, item.contentID),
                    timestamp: Date.now(),
                    retryAttempt: 0
                });
            } else {
                const targetId = this.generateMockId('content', item.contentID);
                successful.push({
                    sourceId: item.contentID,
                    targetId,
                    entityType,
                    timestamp: Date.now()
                });
            }
        }

        this.totalApiCalls++;

        return {
            batchId,
            entityType,
            successful,
            failed,
            processingTime
        };
    }

    /**
     * Mock asset upload batch API call
     */
    async uploadAssets(assets: any[], galleryId?: number): Promise<MockBatchResponse> {
        const entityType = 'assets';
        const batchSize = assets.length;
        const processingTime = this.calculateProcessingTime(entityType, batchSize);
        
        await this.simulateNetworkDelay(processingTime);
        
        const batchId = `asset_batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const successful: SuccessfulUpload[] = [];
        const failed: FailedUpload[] = [];

        // Assets have higher processing time and higher failure rates
        for (const asset of assets) {
            const shouldFail = this.shouldSimulateFailure(entityType);
            
            if (shouldFail) {
                failed.push({
                    sourceId: asset.mediaID,
                    entityType,
                    error: this.generateRealisticAssetError(asset),
                    timestamp: Date.now(),
                    retryAttempt: 0
                });
            } else {
                const targetId = this.generateMockId('asset', asset.mediaID);
                successful.push({
                    sourceId: asset.mediaID,
                    targetId,
                    entityType,
                    timestamp: Date.now()
                });
            }
        }

        this.totalApiCalls++;

        return {
            batchId,
            entityType,
            successful,
            failed,
            processingTime
        };
    }

    /**
     * Mock savePage API call
     */
    async savePage(page: any): Promise<MockApiResponse<number>> {
        const entityType = 'pages';
        const processingTime = this.calculateProcessingTime(entityType, 1);
        
        await this.simulateNetworkDelay(processingTime);
        
        const shouldFail = this.shouldSimulateFailure(entityType);
        this.totalApiCalls++;

        if (shouldFail) {
            return {
                success: false,
                error: this.generateRealisticError(entityType, page.pageID),
                processingTime
            };
        }

        const targetId = this.generateMockId('page', page.pageID);
        return {
            success: true,
            data: targetId,
            processingTime
        };
    }

    /**
     * Mock saveGallery API call
     */
    async saveGallery(gallery: any): Promise<MockApiResponse<number>> {
        const entityType = 'galleries';
        const processingTime = this.calculateProcessingTime(entityType, 1);
        
        await this.simulateNetworkDelay(processingTime);
        
        const shouldFail = this.shouldSimulateFailure(entityType);
        this.totalApiCalls++;

        if (shouldFail) {
            return {
                success: false,
                error: this.generateRealisticError(entityType, gallery.id),
                processingTime
            };
        }

        const targetId = this.generateMockId('gallery', gallery.id);
        return {
            success: true,
            data: targetId,
            processingTime
        };
    }

    /**
     * Calculate realistic processing time based on entity type and count
     */
    private calculateProcessingTime(entityType: string, count: number): number {
        const baseDelay = this.delays[entityType as keyof MockApiDelays] || 200;
        const batchMultiplier = Math.log(count + 1); // Diminishing returns for larger batches
        const networkJitter = Math.random() * 50; // 0-50ms random jitter
        
        return Math.floor(baseDelay * batchMultiplier + this.networkLatency + networkJitter);
    }

    /**
     * Simulate network delay
     */
    private async simulateNetworkDelay(delayMs: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, delayMs));
    }

    /**
     * Determine if a failure should be simulated
     */
    private shouldSimulateFailure(entityType: string): boolean {
        const baseErrorRate = this.errorRates.get(entityType) || 0.05;
        
        // Increase error rate if there have been consecutive failures (simulate server stress)
        const consecutiveFailures = this.consecutiveFailures.get(entityType) || 0;
        const adjustedErrorRate = baseErrorRate + (consecutiveFailures * 0.01);
        
        const shouldFail = Math.random() < adjustedErrorRate;
        
        if (shouldFail) {
            this.consecutiveFailures.set(entityType, consecutiveFailures + 1);
        } else {
            this.consecutiveFailures.set(entityType, 0);
        }
        
        return shouldFail;
    }

    /**
     * Generate realistic error messages
     */
    private generateRealisticError(entityType: string, entityId: number): string {
        const errorTemplates = {
            models: [
                `Model validation failed: Field 'title' is required`,
                `Model schema validation error: Invalid field type`,
                `Duplicate model reference name detected`,
                `Model dependency not found in target instance`
            ],
            templates: [
                `Template compilation failed: Invalid zone configuration`,
                `Template dependency missing: Referenced model not found`,
                `Template validation error: Circular reference detected`,
                `Template zone configuration is malformed`
            ],
            containers: [
                `Container validation failed: Content definition not found`,
                `Container dependency error: Referenced model not available`,
                `Container field mapping failed: Type mismatch`,
                `Container configuration validation error`
            ],
            content: [
                `Content validation failed: Required field missing`,
                `Content reference error: Referenced content not found`,
                `Content asset reference invalid: Asset not available`,
                `Content exceeds maximum field length`,
                `Content contains invalid reference ID`
            ],
            assets: [
                `Asset upload failed: File size exceeds limit`,
                `Asset validation error: Unsupported file type`,
                `Asset processing failed: Corrupt file data`,
                `Asset storage error: Insufficient space`,
                `Asset thumbnail generation failed`
            ],
            pages: [
                `Page validation failed: Template not found`,
                `Page zone content invalid: Referenced content not available`,
                `Page hierarchy error: Parent page not found`,
                `Page URL conflict: Slug already exists`,
                `Page template zone mismatch`
            ],
            galleries: [
                `Gallery validation failed: Asset reference not found`,
                `Gallery processing error: Asset not available`,
                `Gallery configuration invalid: Malformed settings`,
                `Gallery asset limit exceeded`
            ]
        };

        const templates = errorTemplates[entityType as keyof typeof errorTemplates] || ['Unknown error occurred'];
        const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
        
        return `${randomTemplate} (Entity ID: ${entityId})`;
    }

    /**
     * Generate realistic asset-specific errors
     */
    private generateRealisticAssetError(asset: any): string {
        const assetErrors = [
            `File upload failed: ${asset.fileName} - Connection timeout`,
            `Asset validation failed: ${asset.fileName} - Invalid file format`,
            `Storage quota exceeded while uploading: ${asset.fileName}`,
            `Asset processing failed: ${asset.fileName} - Corrupt file data`,
            `File size limit exceeded: ${asset.fileName} (${asset.fileSize || 'unknown'} bytes)`,
            `Network error during upload: ${asset.fileName} - Retry recommended`,
            `Asset thumbnail generation failed: ${asset.fileName}`,
            `File name contains invalid characters: ${asset.fileName}`,
            `Duplicate asset detected: ${asset.fileName} already exists`,
            `Asset metadata extraction failed: ${asset.fileName}`
        ];

        return assetErrors[Math.floor(Math.random() * assetErrors.length)];
    }

    /**
     * Generate mock target IDs
     */
    private generateMockId(entityType: string, sourceId: number): number {
        // Generate deterministic but realistic target IDs
        const baseOffset = {
            'model': 50000,
            'template': 60000,
            'container': 70000,
            'content': 10000,
            'asset': 20000,
            'page': 30000,
            'gallery': 40000
        };

        const offset = baseOffset[entityType as keyof typeof baseOffset] || 90000;
        return offset + sourceId;
    }

    /**
     * Get API call statistics
     */
    getApiStats(): {
        totalCalls: number;
        averageLatency: number;
        errorRateByType: Map<string, number>;
        consecutiveFailures: Map<string, number>;
    } {
        return {
            totalCalls: this.totalApiCalls,
            averageLatency: this.networkLatency,
            errorRateByType: new Map(this.errorRates),
            consecutiveFailures: new Map(this.consecutiveFailures)
        };
    }

    /**
     * Simulate server stress (increase error rates)
     */
    simulateServerStress(multiplier: number = 2): void {
        for (const [entityType, rate] of Array.from(this.errorRates.entries())) {
            this.errorRates.set(entityType, Math.min(rate * multiplier, 0.5)); // Cap at 50%
        }
        this.networkLatency *= multiplier;
        console.log(`🔥 Simulating server stress: Error rates increased by ${multiplier}x`);
    }

    /**
     * Reset to normal operation
     */
    resetToNormalOperation(): void {
        this.initializeErrorRates();
        this.networkLatency = 75;
        this.consecutiveFailures.clear();
        console.log(`✅ Server operation reset to normal`);
    }

    /**
     * Simulate network issues
     */
    simulateNetworkIssues(latencyMultiplier: number = 5): void {
        this.networkLatency *= latencyMultiplier;
        console.log(`🌐 Simulating network issues: Latency increased to ${this.networkLatency}ms`);
    }

    /**
     * Set custom error rate for testing
     */
    setErrorRate(entityType: string, rate: number): void {
        this.errorRates.set(entityType, Math.max(0, Math.min(rate, 1)));
        console.log(`⚠️ Set ${entityType} error rate to ${(rate * 100).toFixed(1)}%`);
    }

    /**
     * Reset all statistics
     */
    resetStats(): void {
        this.totalApiCalls = 0;
        this.consecutiveFailures.clear();
        this.initializeErrorRates();
        this.networkLatency = 75;
    }
} 