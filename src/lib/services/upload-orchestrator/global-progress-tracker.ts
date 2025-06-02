/**
 * Global Progress Tracker - Real-Time Console Visualizer
 * 
 * Multi-threaded progress coordination with blessed-based dashboard
 * Based on validated parallel execution plan from Phase 19-20
 */

import {
    GlobalProgressState,
    ThreadProgress,
    SubTaskProgress,
    ThreadStatus,
    ThroughputStats,
    VisualizationConfig,
    EntityType
} from './types';
import { BlessedProgressDashboard } from './blessed-progress-dashboard';

export class GlobalProgressTracker {
    private state: GlobalProgressState;
    private config: VisualizationConfig;
    private dashboard: BlessedProgressDashboard | null = null;
    private lastUpdateTime: number = 0;
    private entityCounts: Map<EntityType, number> = new Map();
    private startTime: number = Date.now();

    constructor(totalItems: number, config: VisualizationConfig) {
        this.config = config;
        this.state = {
            threads: new Map(),
            overallProgress: 0,
            totalItems,
            completedItems: 0,
            failedItems: 0,
            estimatedTimeRemaining: 0,
            startTime: Date.now(),
            currentPhase: 'Initializing',
            throughputStats: {
                itemsPerSecond: 0,
                batchesPerMinute: 0,
                successRate: 0,
                errorRate: 0,
                averageBatchSize: 0
            }
        };

        // Initialize blessed dashboard if real-time updates enabled
        if (config.enableRealTimeUpdates) {
            this.dashboard = new BlessedProgressDashboard(config);
            this.dashboard.start(totalItems);
        }
    }

    /**
     * Register a thread for progress tracking
     */
    registerThread(threadId: string, totalItems: number, subTasks: string[]): void {
        this.state.threads.set(threadId, {
            threadId,
            status: 'waiting',
            totalItems,
            completedItems: 0,
            progress: 0,
            subTasks: new Map(subTasks.map(task => [task, { 
                taskName: task,
                completed: 0, 
                total: 0, 
                progress: 0,
                status: 'waiting',
                errors: 0
            }])),
            startTime: null,
            estimatedCompletion: null,
            errors: [],
            currentOperation: 'Waiting for dependencies...'
        });

        if (this.dashboard) {
            this.dashboard.logThreadActivity(threadId, `Thread registered with ${totalItems} items`);
        }
    }

    /**
     * Update thread status
     */
    updateThreadStatus(threadId: string, status: ThreadStatus, operation?: string): void {
        const thread = this.state.threads.get(threadId);
        if (thread) {
            thread.status = status;
            if (operation) {
                thread.currentOperation = operation;
            }
            if (status === 'running' && !thread.startTime) {
                thread.startTime = Date.now();
            }
            this.calculateOverallProgress();
            
            if (this.dashboard) {
                this.dashboard.updateThreadProgress(threadId, thread);
                this.dashboard.logThreadActivity(threadId, operation || `Status changed to ${status}`);
            }
        }
    }

    /**
     * Update sub-task progress within a thread
     */
    updateSubProgress(threadId: string, subTaskId: string, completed: number, total: number, currentBatch?: string): void {
        const thread = this.state.threads.get(threadId);
        if (thread && thread.subTasks.has(subTaskId)) {
            const subTask = thread.subTasks.get(subTaskId)!;
            subTask.completed = completed;
            subTask.total = total;
            subTask.progress = total > 0 ? (completed / total) * 100 : 0;
            subTask.status = completed === total ? 'complete' : 'running';
            if (currentBatch) {
                subTask.currentBatch = currentBatch;
            }
            
            // Update thread overall progress
            this.calculateThreadProgress(thread);
            this.calculateThroughputStats();

            if (this.dashboard) {
                this.dashboard.updateThreadProgress(threadId, thread);
                
                // Update pipeline visualization based on key gates
                this.updatePipelineVisualization();
                
                // Update stats
                this.dashboard.updateStats(this.state.throughputStats, this.state.completedItems, this.state.failedItems);
            }
        }
    }

    /**
     * Add error to thread tracking
     */
    addThreadError(threadId: string, operation: string, error: string, entityId?: number, retryAttempt?: number): void {
        const thread = this.state.threads.get(threadId);
        if (thread) {
            thread.errors.push({
                timestamp: Date.now(),
                operation,
                error,
                entityId,
                retryAttempt
            });
            this.state.failedItems++;

            if (this.dashboard) {
                this.dashboard.logThreadActivity(threadId, `ERROR: ${error}`);
            }
        }
    }

    /**
     * Update entity count for a specific type
     */
    updateEntityCount(entityType: EntityType, count: number): void {
        this.entityCounts.set(entityType, count);
    }

    /**
     * Set current phase
     */
    setCurrentPhase(phase: string): void {
        this.state.currentPhase = phase;
    }

    /**
     * Calculate overall thread progress based on sub-tasks
     */
    private calculateThreadProgress(thread: ThreadProgress): void {
        const subTaskProgresses = Array.from(thread.subTasks.values());
        if (subTaskProgresses.length === 0) {
            thread.progress = 0;
            return;
        }

        // Weight progress by sub-task totals
        let weightedProgress = 0;
        let totalWeight = 0;

        for (const subTask of subTaskProgresses) {
            const weight = subTask.total || 1;
            weightedProgress += subTask.progress * weight;
            totalWeight += weight;
        }

        thread.progress = totalWeight > 0 ? weightedProgress / totalWeight : 0;
        thread.completedItems = Math.floor((thread.progress / 100) * thread.totalItems);
        
        // Calculate estimated completion
        if (thread.startTime && thread.progress > 5) { // Only estimate after 5% completion
            const elapsed = Date.now() - thread.startTime;
            const rate = thread.progress / elapsed;
            const remaining = (100 - thread.progress) / rate;
            thread.estimatedCompletion = Date.now() + remaining;
        }
    }

    /**
     * Calculate overall progress across all threads
     */
    private calculateOverallProgress(): void {
        const threads = Array.from(this.state.threads.values());
        if (threads.length === 0) {
            this.state.overallProgress = 0;
            return;
        }

        // Weight thread progress by their total items
        let weightedProgress = 0;
        let totalWeight = 0;
        let totalCompleted = 0;

        for (const thread of threads) {
            const weight = thread.totalItems;
            weightedProgress += thread.progress * weight;
            totalWeight += weight;
            totalCompleted += thread.completedItems;
        }

        this.state.overallProgress = totalWeight > 0 ? weightedProgress / totalWeight : 0;
        this.state.completedItems = totalCompleted;
        this.state.estimatedTimeRemaining = this.calculateTimeRemaining();
    }

    /**
     * Calculate throughput statistics
     */
    private calculateThroughputStats(): void {
        const elapsed = Date.now() - this.state.startTime;
        const elapsedSeconds = elapsed / 1000;
        const elapsedMinutes = elapsedSeconds / 60;

        if (elapsedSeconds > 0) {
            this.state.throughputStats.itemsPerSecond = this.state.completedItems / elapsedSeconds;
        }

        // Calculate success rate
        const totalProcessed = this.state.completedItems + this.state.failedItems;
        if (totalProcessed > 0) {
            this.state.throughputStats.successRate = (this.state.completedItems / totalProcessed) * 100;
            this.state.throughputStats.errorRate = (this.state.failedItems / totalProcessed) * 100;
        }

        // Count total batches processed
        let totalBatches = 0;
        for (const thread of Array.from(this.state.threads.values())) {
            for (const subTask of Array.from(thread.subTasks.values())) {
                if (subTask.currentBatch) {
                    totalBatches++;
                }
            }
        }

        if (elapsedMinutes > 0) {
            this.state.throughputStats.batchesPerMinute = totalBatches / elapsedMinutes;
        }
    }

    /**
     * Calculate estimated time remaining
     */
    private calculateTimeRemaining(): number {
        if (this.state.overallProgress <= 0) return 0;
        
        const elapsed = Date.now() - this.state.startTime;
        const rate = this.state.overallProgress / elapsed;
        const remainingProgress = 100 - this.state.overallProgress;
        
        return remainingProgress / rate;
    }

    /**
     * Update pipeline visualization
     */
    private updatePipelineVisualization(): void {
        if (!this.dashboard) return;

        // Check key dependency gates
        const independentThread = this.state.threads.get('independent-entities');
        const contentThread = this.state.threads.get('batched-content');
        const complexThread = this.state.threads.get('complex-entities');

        const gate1Complete = independentThread && 
            (independentThread.status === 'complete' || independentThread.progress > 90);
        const gate2Complete = contentThread && 
            (contentThread.status === 'complete' || contentThread.progress > 90);
        const gate3Complete = complexThread && 
            (complexThread.status === 'complete' || complexThread.progress > 90);

        this.dashboard.updatePipeline(!!gate1Complete, !!gate2Complete, !!gate3Complete);
    }

    /**
     * Get current progress state (for external access)
     */
    getProgressState(): GlobalProgressState {
        return { ...this.state };
    }

    /**
     * Get thread progress (for external access)
     */
    getThreadProgress(threadId: string): ThreadProgress | undefined {
        return this.state.threads.get(threadId);
    }

    /**
     * Manual render call (for non-real-time mode)
     */
    render(): void {
        // For backward compatibility - with blessed dashboard this is handled automatically
        if (!this.dashboard) {
            console.log('Progress tracking active (non-visual mode)');
        }
    }

    /**
     * Clean up progress tracking
     */
    cleanup(): void {
        if (this.dashboard) {
            this.dashboard.cleanup();
            this.dashboard = null;
        }
    }

    /**
     * Final summary when upload completes
     */
    renderFinalSummary(): void {
        const totalTime = Date.now() - this.state.startTime;
        
        if (this.dashboard) {
            this.dashboard.showFinalSummary(this.state.completedItems, this.state.failedItems, totalTime);
        } else {
            // Fallback console summary
            console.log(`\n🎉 UPLOAD ORCHESTRATOR - FINAL SUMMARY`);
            console.log(`═══════════════════════════════════════════════════════════════════`);
            console.log(`✅ Successfully Uploaded: ${this.state.completedItems.toLocaleString()} entities`);
            console.log(`❌ Failed: ${this.state.failedItems.toLocaleString()} entities`);
            console.log(`⏱️  Total Time: ${this.formatTime(totalTime)}`);
            console.log(`⚡ Average Throughput: ${(this.state.completedItems / (totalTime / 1000)).toFixed(1)} items/second`);
            console.log(`📊 Success Rate: ${this.state.throughputStats.successRate.toFixed(1)}%`);
            console.log(`\n🚀 Upload orchestration complete!`);
        }
    }

    /**
     * Format time duration
     */
    private formatTime(ms: number): string {
        if (ms <= 0) return '0s';
        
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }
} 