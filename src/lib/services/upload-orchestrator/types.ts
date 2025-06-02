/**
 * Upload Orchestrator - Shared Type Definitions
 * 
 * Foundational types for multi-threaded upload system with dependency management
 * Based on validated strategy documents from Phase 19-20
 */

// ================== Core Configuration Types ==================

export interface UploadOrchestratorConfig {
    threads: ThreadConfiguration[];
    batchSizes: BatchSizeConfig;
    concurrency: ConcurrencyConfig;
    timing: TimingConfig;
    visualization: VisualizationConfig;
}

export interface ThreadConfiguration {
    threadId: string;
    threadType: 'independent' | 'dependency' | 'complex';
    priority: number;
    dependsOn: string[];
    entities: string[];
    estimatedDuration: number;
}

export interface BatchSizeConfig {
    models: number;           // Sequential only
    templates: number;        // Sequential only  
    containers: number;       // Sequential only
    assets: number;          // Batch upload
    content: number;         // Dependency-level batching
    pages: number;           // Chain traversal
    galleries: number;       // Chain traversal
}

export interface ConcurrencyConfig {
    maxConcurrentBatches: number;
    maxConcurrentThreads: number;
    retryAttempts: number;
    retryDelayMs: number;
}

export interface TimingConfig {
    progressUpdateIntervalMs: number;
    mockApiDelays: MockApiDelays;
}

export interface MockApiDelays {
    models: number;          // Base delay per model (ms)
    templates: number;       // Base delay per template (ms)
    containers: number;      // Base delay per container (ms)
    assets: number;          // Base delay per asset (ms)
    content: number;         // Base delay per content item (ms)
    pages: number;           // Base delay per page (ms)
    galleries: number;       // Base delay per gallery (ms)
}

export interface VisualizationConfig {
    enableRealTimeUpdates: boolean;
    progressBarWidth: number;
    showDetailedSubTasks: boolean;
    refreshIntervalMs: number;
}

// ================== Thread Management Types ==================

export type ThreadStatus = 'waiting' | 'running' | 'complete' | 'error' | 'blocked';

export interface ThreadProgress {
    threadId: string;
    status: ThreadStatus;
    totalItems: number;
    completedItems: number;
    progress: number; // 0-100
    subTasks: Map<string, SubTaskProgress>;
    startTime: number | null;
    estimatedCompletion: number | null;
    errors: ThreadError[];
    currentOperation?: string;
}

export interface SubTaskProgress {
    taskName: string;
    completed: number;
    total: number;
    progress: number; // 0-100
    status: ThreadStatus;
    errors: number;
    currentBatch?: string;
}

export interface ThreadError {
    timestamp: number;
    operation: string;
    error: string;
    entityId?: number;
    retryAttempt?: number;
}

export interface ThreadResult {
    threadId: string;
    status: ThreadStatus;
    successful: UploadResult[];
    failed: UploadResult[];
    totalTime: number;
    subResults: Map<string, SubThreadResult>;
    errors: ThreadError[];
}

export interface SubThreadResult {
    taskName: string;
    uploaded: UploadResult[];
    failed: UploadResult[];
    totalTime: number;
    batchCount: number;
    retryCount: number;
}

export interface UploadResult {
    sourceId: number;
    targetId?: number;
    entityType: string;
    operation: string;
    timestamp: number;
    error?: string;
    retryAttempt?: number;
}

// ================== Dependency Gate Types ==================

export interface DependencyGate {
    gateName: string;
    isOpen: boolean;
    waitingThreads: string[];
    openedAt?: number;
    requiredBy: string[];
    conditions: GateCondition[];
}

export interface GateCondition {
    type: 'entity-count' | 'task-complete' | 'success-rate';
    target: string;
    threshold: number;
    currentValue: number;
    isMet: boolean;
}

export interface GateStatus {
    name: string;
    isOpen: boolean;
    waitingThreadCount: number;
    openedAt?: number;
    requiredBy: string[];
    conditions: GateCondition[];
}

// ================== ID Mapping Types ==================

export interface IdMapping {
    entityType: string;
    sourceId: number;
    targetId: number;
    timestamp: number;
    threadId: string;
}

export interface AssetMapping {
    sourceUrl: string;
    targetUrl: string;
    fileName: string;
    timestamp: number;
}

export interface IdMappingStats {
    totalMappings: number;
    mappingsByType: Map<string, number>;
    mappingsByThread: Map<string, number>;
    latestMappingTime: number;
}

// ================== Batch Processing Types ==================

export interface BatchUploadConfig {
    maxBatchSize: number;
    maxConcurrentBatches: number;
    retryAttempts: number;
    retryDelayMs: number;
    entityType: string;
}

export interface BatchUploadResult {
    batchId: string;
    entityType: string;
    successful: SuccessfulUpload[];
    failed: FailedUpload[];
    retryCount: number;
    totalTime: number;
    threadId: string;
}

export interface SuccessfulUpload {
    sourceId: number;
    targetId: number;
    entityType: string;
    timestamp: number;
}

export interface FailedUpload {
    sourceId: number;
    entityType: string;
    error: string;
    timestamp: number;
    retryAttempt: number;
}

// ================== Content Dependency Types ==================

export interface ContentDependency {
    sourceContentId: number;
    referencedContentIds: number[];
    referencedAssetUrls: string[];
    referencedGalleryIds: number[];
    dependencyLevel: number;
    canProcess: boolean;
}

export interface DependencyLevel {
    level: number;
    contentItems: ContentDependency[];
    totalItems: number;
    readyToProcess: boolean;
    blockedBy: string[];
}

// ================== Asset Strategy Types ==================

export interface AssetBatchStrategy {
    independentAssets: any[]; // AssetItem[] - using any for now to avoid import issues
    galleryGroups: Map<number, any[]>;
    totalBatches: number;
    estimatedTime: number;
}

export interface AssetUploadResult {
    uploadedAssets: UploadedAsset[];
    failedAssets: FailedAsset[];
    totalUploaded: number;
    totalFailed: number;
    totalTime: number;
}

export interface UploadedAsset {
    sourceId: number;
    targetId: number;
    fileName: string;
    url: string;
    galleryId?: number;
    fileSize?: number;
}

export interface FailedAsset {
    sourceId: number;
    fileName: string;
    error: string;
    fileSize?: number;
}

// ================== Page Chain Types ==================

export interface PageChain {
    chainId: string;
    pages: any[]; // PageItem[] - using any for now
    dependencies: string[];
    totalDepth: number;
    isProcessable: boolean;
    blockedBy: string[];
}

export interface PageChainResult {
    chainId: string;
    uploaded: UploadResult[];
    failed: UploadResult[];
    totalTime: number;
    pagesProcessed: number;
}

// ================== Progress Tracking Types ==================

export interface GlobalProgressState {
    threads: Map<string, ThreadProgress>;
    overallProgress: number;
    totalItems: number;
    completedItems: number;
    failedItems: number;
    estimatedTimeRemaining: number;
    startTime: number;
    currentPhase: string;
    throughputStats: ThroughputStats;
}

export interface ThroughputStats {
    itemsPerSecond: number;
    batchesPerMinute: number;
    successRate: number;
    errorRate: number;
    averageBatchSize: number;
}

// ================== Mock API Types ==================

export interface MockApiResponse<T> {
    success: boolean;
    data?: T;
    batchId?: string;
    targetIds?: number[];
    error?: string;
    processingTime: number;
    retryAfter?: number;
}

export interface MockBatchResponse {
    batchId: string;
    entityType: string;
    successful: SuccessfulUpload[];
    failed: FailedUpload[];
    processingTime: number;
}

// ================== Error Handling Types ==================

export interface OrchestratorError {
    errorId: string;
    threadId: string;
    operation: string;
    entityType: string;
    entityId?: number;
    error: string;
    timestamp: number;
    isRecoverable: boolean;
    retryCount: number;
    context: Record<string, any>;
}

export interface ErrorRecoveryStrategy {
    errorType: string;
    maxRetries: number;
    backoffMultiplier: number;
    shouldIsolateFailure: boolean;
    fallbackStrategy?: string;
}

// ================== Source Entity Types (simplified) ==================

export interface SourceEntities {
    models?: any[];
    templates?: any[];
    containers?: any[];
    content?: any[];
    assets?: any[];
    pages?: any[];
    galleries?: any[];
}

// ================== Utility Types ==================

export type EntityType = 'models' | 'templates' | 'containers' | 'content' | 'assets' | 'pages' | 'galleries';

export interface EntityStats {
    type: EntityType;
    total: number;
    uploaded: number;
    failed: number;
    progress: number;
    averageTime: number;
}

export interface OrchestratorStats {
    totalEntities: number;
    entitiesByType: Map<EntityType, EntityStats>;
    totalBatches: number;
    completedBatches: number;
    totalThreads: number;
    activeThreads: number;
    overallSuccessRate: number;
    totalTime: number;
    throughput: ThroughputStats;
} 