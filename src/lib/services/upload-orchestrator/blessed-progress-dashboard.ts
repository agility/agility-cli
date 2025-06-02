/**
 * Blessed Progress Dashboard - Advanced Terminal UI
 * 
 * Static dashboard with color-coded progress visualization for upload orchestrator
 * Uses blessed and blessed-contrib for advanced terminal interface
 */

import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import {
    GlobalProgressState,
    ThreadProgress,
    SubTaskProgress,
    ThreadStatus,
    ThroughputStats,
    VisualizationConfig,
    EntityType
} from './types';

export class BlessedProgressDashboard {
    private screen: blessed.Widgets.Screen;
    private grid: any;
    private widgets: Map<string, any> = new Map();
    private isInitialized: boolean = false;
    private updateInterval: NodeJS.Timeout | null = null;
    
    // Thread color scheme
    private threadColors = {
        'independent-entities': 'blue',
        'batched-content': 'green', 
        'complex-entities': 'yellow'
    };

    // Status colors
    private statusColors = {
        'waiting': 'gray',
        'running': 'cyan',
        'complete': 'green',
        'error': 'red',
        'blocked': 'magenta'
    };

    constructor(private config: VisualizationConfig) {
        this.initializeScreen();
        this.setupGrid();
        this.createWidgets();
    }

    /**
     * Initialize the blessed screen
     */
    private initializeScreen(): void {
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Agility Upload Orchestrator',
            fullUnicode: true,
            cursor: {
                artificial: true,
                shape: 'line',
                blink: true
            }
        });

        // Handle graceful exit
        this.screen.key(['escape', 'q', 'C-c'], () => {
            this.cleanup();
            process.exit(0);
        });

        // Handle screen resize
        this.screen.on('resize', () => {
            this.screen.render();
        });
    }

    /**
     * Setup the grid layout
     */
    private setupGrid(): void {
        this.grid = new contrib.grid({
            rows: 12,
            cols: 12,
            screen: this.screen
        });
    }

    /**
     * Create all dashboard widgets
     */
    private createWidgets(): void {
        // Header section (row 0-1)
        this.widgets.set('header', this.grid.set(0, 0, 2, 12, blessed.box, {
            content: '',
            border: { type: 'line' },
            style: {
                fg: 'white',
                border: { fg: 'blue' }
            },
            label: '🚀 AGILITY UPLOAD ORCHESTRATOR',
            tags: true
        }));

        // Thread 1: Independent Entities (row 2-4)
        this.widgets.set('thread1-box', this.grid.set(2, 0, 3, 4, blessed.box, {
            content: '',
            border: { type: 'line' },
            style: {
                fg: 'white',
                border: { fg: this.threadColors['independent-entities'] }
            },
            label: '{bold}THREAD 1: INDEPENDENT ENTITIES{/bold}',
            tags: true
        }));

        this.widgets.set('thread1-progress', this.grid.set(2, 4, 3, 4, contrib.gauge, {
            label: 'Progress',
            stroke: this.threadColors['independent-entities'],
            fill: 'white'
        }));

        this.widgets.set('thread1-log', this.grid.set(2, 8, 3, 4, contrib.log, {
            fg: this.threadColors['independent-entities'],
            selectedFg: this.threadColors['independent-entities'],
            label: 'Thread 1 Activity'
        }));

        // Thread 2: Batched Content (row 5-7)
        this.widgets.set('thread2-box', this.grid.set(5, 0, 3, 4, blessed.box, {
            content: '',
            border: { type: 'line' },
            style: {
                fg: 'white',
                border: { fg: this.threadColors['batched-content'] }
            },
            label: '{bold}THREAD 2: BATCHED CONTENT{/bold}',
            tags: true
        }));

        this.widgets.set('thread2-progress', this.grid.set(5, 4, 3, 4, contrib.gauge, {
            label: 'Progress',
            stroke: this.threadColors['batched-content'],
            fill: 'white'
        }));

        this.widgets.set('thread2-log', this.grid.set(5, 8, 3, 4, contrib.log, {
            fg: this.threadColors['batched-content'],
            selectedFg: this.threadColors['batched-content'],
            label: 'Thread 2 Activity'
        }));

        // Thread 3: Complex Entities (row 8-10)
        this.widgets.set('thread3-box', this.grid.set(8, 0, 3, 4, blessed.box, {
            content: '',
            border: { type: 'line' },
            style: {
                fg: 'white',
                border: { fg: this.threadColors['complex-entities'] }
            },
            label: '{bold}THREAD 3: COMPLEX ENTITIES{/bold}',
            tags: true
        }));

        this.widgets.set('thread3-progress', this.grid.set(8, 4, 3, 4, contrib.gauge, {
            label: 'Progress', 
            stroke: this.threadColors['complex-entities'],
            fill: 'white'
        }));

        this.widgets.set('thread3-log', this.grid.set(8, 8, 3, 4, contrib.log, {
            fg: this.threadColors['complex-entities'],
            selectedFg: this.threadColors['complex-entities'],
            label: 'Thread 3 Activity'
        }));

        // Overall stats and performance (row 11)
        this.widgets.set('stats', this.grid.set(11, 0, 1, 6, blessed.box, {
            content: '',
            border: { type: 'line' },
            style: {
                fg: 'white',
                border: { fg: 'cyan' }
            },
            label: '📊 PERFORMANCE METRICS',
            tags: true
        }));

        this.widgets.set('pipeline', this.grid.set(11, 6, 1, 6, blessed.box, {
            content: '',
            border: { type: 'line' },
            style: {
                fg: 'white',
                border: { fg: 'magenta' }
            },
            label: '🔗 PIPELINE STATUS',
            tags: true
        }));

        this.isInitialized = true;
    }

    /**
     * Start the dashboard with initial data
     */
    start(totalItems: number): void {
        if (!this.isInitialized) return;

        // Update header with initial info
        this.updateHeader(totalItems, 0, 0, 0);
        
        // Initialize progress gauges
        this.widgets.get('thread1-progress').setPercent(0);
        this.widgets.get('thread2-progress').setPercent(0);
        this.widgets.get('thread3-progress').setPercent(0);

        // Start update loop
        if (this.config.enableRealTimeUpdates) {
            this.updateInterval = setInterval(() => {
                this.screen.render();
            }, this.config.refreshIntervalMs);
        }

        // Initial render
        this.screen.render();
    }

    /**
     * Update header information
     */
    private updateHeader(totalItems: number, completed: number, failed: number, elapsed: number): void {
        const headerWidget = this.widgets.get('header');
        if (!headerWidget) return;

        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        const timeStr = `${minutes}m ${seconds}s`;

        const successRate = completed + failed > 0 ? ((completed / (completed + failed)) * 100).toFixed(1) : '0.0';

        const content = `
{center}📊 Total Entities: {bold}${totalItems.toLocaleString()}{/bold} | ✅ Completed: {bold}{green-fg}${completed.toLocaleString()}{/green-fg}{/bold} | ❌ Failed: {bold}{red-fg}${failed.toLocaleString()}{/red-fg}{/bold}{/center}
{center}⏱️  Runtime: {bold}${timeStr}{/bold} | 📈 Success Rate: {bold}${successRate}%{/bold} | 🎯 Phase: Upload Orchestration{/center}`;

        headerWidget.setContent(content);
    }

    /**
     * Update thread status and progress
     */
    updateThreadProgress(threadId: string, progress: ThreadProgress): void {
        if (!this.isInitialized) return;

        const threadNumber = this.getThreadNumber(threadId);
        if (!threadNumber) return;

        // Update progress gauge
        const progressWidget = this.widgets.get(`thread${threadNumber}-progress`);
        if (progressWidget) {
            progressWidget.setPercent(progress.progress);
        }

        // Update thread info box
        const boxWidget = this.widgets.get(`thread${threadNumber}-box`);
        if (boxWidget) {
            this.updateThreadBox(boxWidget, progress, threadId);
        }

        // Log thread activity
        const logWidget = this.widgets.get(`thread${threadNumber}-log`);
        if (logWidget && progress.currentOperation) {
            logWidget.log(`${this.formatTime(Date.now())}: ${progress.currentOperation}`);
        }
    }

    /**
     * Update thread information box
     */
    private updateThreadBox(boxWidget: any, progress: ThreadProgress, threadId: string): void {
        const statusColor = this.statusColors[progress.status] || 'white';
        const statusIcon = this.getStatusIcon(progress.status);
        
        let content = `\n${statusIcon} Status: {${statusColor}-fg}{bold}${progress.status.toUpperCase()}{/bold}{/${statusColor}-fg}\n`;
        content += `📦 Items: ${progress.completedItems}/${progress.totalItems}\n`;
        content += `📊 Progress: {bold}${progress.progress.toFixed(1)}%{/bold}\n`;
        
        if (progress.errors.length > 0) {
            content += `⚠️  Errors: {red-fg}${progress.errors.length}{/red-fg}\n`;
        }

        if (progress.estimatedCompletion) {
            const eta = this.formatTime(progress.estimatedCompletion - Date.now());
            content += `⏰ ETA: ${eta}\n`;
        }

        // Show sub-tasks
        content += `\n{bold}Sub-tasks:{/bold}\n`;
        for (const [taskName, task] of Array.from(progress.subTasks.entries())) {
            if (task.total > 0) {
                const taskIcon = this.getTaskIcon(taskName);
                const taskBar = this.createMiniProgressBar(task.progress, 15);
                content += `  ${taskIcon} ${taskName}: ${taskBar} ${task.completed}/${task.total}\n`;
            }
        }

        boxWidget.setContent(content);
    }

    /**
     * Update overall statistics
     */
    updateStats(stats: ThroughputStats, totalCompleted: number, totalFailed: number): void {
        const statsWidget = this.widgets.get('stats');
        if (!statsWidget) return;

        const content = `
⚡ Throughput: {bold}${stats.itemsPerSecond.toFixed(1)}{/bold} items/sec
📦 Batches: {bold}${stats.batchesPerMinute.toFixed(1)}{/bold} per minute  
✅ Success: {bold}{green-fg}${stats.successRate.toFixed(1)}%{/green-fg}{/bold}
❌ Error: {bold}{red-fg}${stats.errorRate.toFixed(1)}%{/red-fg}{/bold}`;

        statsWidget.setContent(content);
    }

    /**
     * Update pipeline visualization
     */
    updatePipeline(gate1: boolean, gate2: boolean, gate3: boolean): void {
        const pipelineWidget = this.widgets.get('pipeline');
        if (!pipelineWidget) return;

        const g1 = gate1 ? '{green-fg}●{/green-fg}' : '{gray-fg}○{/gray-fg}';
        const g2 = gate2 ? '{green-fg}●{/green-fg}' : '{gray-fg}○{/gray-fg}';
        const g3 = gate3 ? '{green-fg}●{/green-fg}' : '{gray-fg}○{/gray-fg}';

        const content = `
Models ${g1}━━┓
Templates ${g1}━━┫
Containers ${g1}━━┛   ${g2}━━┓
                        ┃    ${g3}━━━ Final
Content Batches ━━━━━━━━┛    ┃
Assets ━━━━━━━━━━━━━━━━━━━━━━━┛`;

        pipelineWidget.setContent(content);
    }

    /**
     * Log thread activity
     */
    logThreadActivity(threadId: string, message: string): void {
        const threadNumber = this.getThreadNumber(threadId);
        if (!threadNumber) return;

        const logWidget = this.widgets.get(`thread${threadNumber}-log`);
        if (logWidget) {
            logWidget.log(`${this.formatTime(Date.now())}: ${message}`);
        }
    }

    /**
     * Show final completion summary
     */
    showFinalSummary(successful: number, failed: number, totalTime: number): void {
        // Create summary modal
        const summaryBox = blessed.box({
            parent: this.screen,
            top: 'center',
            left: 'center',
            width: '60%',
            height: '50%',
            content: '',
            border: { type: 'line' },
            style: {
                fg: 'white',
                bg: 'black',
                border: { fg: 'green' }
            },
            label: '{bold}🎉 UPLOAD COMPLETE{/bold}',
            tags: true
        });

        const avgThroughput = successful / (totalTime / 1000);
        const successRate = ((successful / (successful + failed)) * 100).toFixed(1);

        const content = `
{center}{bold}FINAL RESULTS{/bold}{/center}

✅ Successfully Uploaded: {bold}{green-fg}${successful.toLocaleString()}{/green-fg}{/bold} entities
❌ Failed: {bold}{red-fg}${failed.toLocaleString()}{/red-fg}{/bold} entities

⏱️  Total Time: {bold}${this.formatTime(totalTime)}{/bold}
⚡ Average Throughput: {bold}${avgThroughput.toFixed(1)}{/bold} items/second
📊 Success Rate: {bold}${successRate}%{/bold}

{center}🚀 Upload orchestration complete!{/center}
{center}Press any key to exit...{/center}`;

        summaryBox.setContent(content);
        summaryBox.focus();

        summaryBox.key(['enter', 'escape', 'space'], () => {
            this.cleanup();
            process.exit(0);
        });

        this.screen.render();
    }

    /**
     * Utility methods
     */
    private getThreadNumber(threadId: string): string | null {
        const mapping: Record<string, string> = {
            'independent-entities': '1',
            'batched-content': '2', 
            'complex-entities': '3'
        };
        return mapping[threadId] || null;
    }

    private getStatusIcon(status: ThreadStatus): string {
        const icons = {
            'waiting': '⏸️',
            'running': '⏳',
            'complete': '✅',
            'error': '❌',
            'blocked': '🚫'
        };
        return icons[status] || '❓';
    }

    private getTaskIcon(taskName: string): string {
        const icons: Record<string, string> = {
            'models': '📋',
            'templates': '🏗️',
            'containers': '📦',
            'assets': '📎',
            'content': '📝',
            'pages': '📄',
            'galleries': '🖼️',
            'gallery-assets': '🖼️'
        };
        return icons[taskName] || '🔧';
    }

    private createMiniProgressBar(percent: number, width: number): string {
        const filled = Math.floor((percent / 100) * width);
        const empty = width - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

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

    /**
     * Clean up and destroy screen
     */
    cleanup(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        if (this.screen && !this.screen.destroyed) {
            this.screen.destroy();
        }
    }
} 