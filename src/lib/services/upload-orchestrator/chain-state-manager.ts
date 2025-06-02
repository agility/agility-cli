/**
 * Chain State Management System
 * 
 * Sophisticated visualization with collapsible chain progress
 * Replaces console logging with state-based display updates
 * 
 * Task 21.8.2: Chain State Management System Design
 */

import * as blessed from 'blessed';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface ChainItem {
    id: string;
    type: 'page' | 'template' | 'container' | 'model' | 'content' | 'asset' | 'gallery';
    name: string;
    level: number;
    dependencies: ChainItem[];
    status: 'pending' | 'active' | 'completed' | 'error';
    uploadTime?: number;
    error?: string;
    parentChainId?: string;
}

export interface ChainState {
    id: string;
    title: string;
    status: 'pending' | 'active' | 'completed' | 'error';
    currentItem?: string;  // Currently processing item within chain
    progress: number;      // 0-100% completion
    dependencies: ChainItem[];
    collapsed: boolean;
    startTime?: number;
    completionTime?: number;
    threadId?: number;     // Which thread is processing this chain
    error?: string;        // Error message if status is 'error'
}

export interface ThreadState {
    id: number;
    status: 'idle' | 'active' | 'completed' | 'error';
    currentChain?: string;
    processedChains: string[];
    errorCount: number;
}

export class ChainStateManager {
    private activeChains: Map<string, ChainState> = new Map();
    private completedChains: Map<string, ChainState> = new Map();
    private pendingChains: ChainState[] = [];
    private threadStates: Map<number, ThreadState> = new Map();
    private maxThreads: number;
    private screen: blessed.Widgets.Screen;
    private chainDisplays: Map<number, blessed.Widgets.Box> = new Map(); // Column displays per thread
    private statsDisplay: blessed.Widgets.Box;
    private headerDisplay: blessed.Widgets.Box;
    private refreshInterval: NodeJS.Timeout | null = null;

    constructor(maxThreads: number = 4) {
        this.maxThreads = maxThreads;
        this.initializeThreads();
        this.initializeUI();
    }

    /**
     * Initialize thread states
     */
    private initializeThreads(): void {
        for (let i = 1; i <= this.maxThreads; i++) {
            this.threadStates.set(i, {
                id: i,
                status: 'idle',
                processedChains: [],
                errorCount: 0
            });
        }
    }

    /**
     * Initialize sophisticated multi-column UI
     */
    private initializeUI(): void {
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Agility Chain State Upload Orchestrator',
            fullUnicode: true
        });

        // Header with configurable thread count
        this.headerDisplay = blessed.box({
            parent: this.screen,
            top: 0,
            left: 0,
            width: '100%',
            height: 3,
            content: this.buildHeaderContent(),
            border: { type: 'line' },
            style: { fg: 'white', border: { fg: 'cyan' } },
            tags: true
        });

        // Calculate column width for threads
        const columnWidth = Math.floor(85 / this.maxThreads);
        
        // Create chain display columns for each thread
        for (let i = 1; i <= this.maxThreads; i++) {
            const leftPosition = (i - 1) * columnWidth;
            
            const chainDisplay = blessed.box({
                parent: this.screen,
                top: 3,
                left: `${leftPosition}%`,
                width: `${columnWidth}%`,
                height: '#{/height} - 6',
                content: '',
                border: { type: 'line' },
                style: { 
                    fg: 'white', 
                    border: { fg: this.getThreadColor(i) } 
                },
                label: `🧵 THREAD ${i}`,
                tags: true,
                scrollable: true,
                alwaysScroll: true,
                scrollbar: { style: { bg: this.getThreadColor(i) } }
            });

            this.chainDisplays.set(i, chainDisplay);
        }

        // Stats display (right side)
        this.statsDisplay = blessed.box({
            parent: this.screen,
            top: 3,
            left: '85%',
            width: '15%',
            height: '#{/height} - 6',
            content: '',
            border: { type: 'line' },
            style: { fg: 'white', border: { fg: 'green' } },
            label: '📊 STATS',
            tags: true
        });

        // Footer with controls
        const footer = blessed.box({
            parent: this.screen,
            bottom: 0,
            left: 0,
            width: '100%',
            height: 3,
            content: '{center}ESC/Q: Exit | SPACE: Pause/Resume | ↑/↓: Expand/Collapse Active Chain | Colors: {gray-bg} Pending {/gray-bg} {yellow-bg} Active {/yellow-bg} {green-bg} Complete {/green-bg} {red-bg} Error {/red-bg}{/center}',
            border: { type: 'line' },
            style: { fg: 'white', border: { fg: 'magenta' } },
            tags: true
        });

        // Handle keyboard inputs
        this.screen.key(['escape', 'q', 'C-c'], () => {
            this.cleanup();
            process.exit(0);
        });

        this.screen.key(['space'], () => {
            this.togglePause();
        });

        this.screen.key(['up'], () => {
            this.expandActiveChains();
        });

        this.screen.key(['down'], () => {
            this.collapseActiveChains();
        });

        this.screen.render();
    }

    /**
     * Load chains from source data and initialize state
     */
    async loadChainsFromSourceData(guid: string): Promise<void> {
        try {
            const basePath = join(process.env.HOME || '', 'agility-files', guid, 'en-us', 'preview');
            
            // Load data using proven analysis system approach
            const pages = this.loadJsonFiles(join(basePath, 'sitemap'));
            const templates = this.loadJsonFiles(join(basePath, 'templates'));
            const containers = this.loadJsonFiles(join(basePath, 'containers'));
            const models = this.loadJsonFiles(join(basePath, 'models'));
            const content = this.loadJsonFiles(join(basePath, 'content'));
            const assets = this.loadJsonFiles(join(basePath, 'assets'));

            // Build chain states (start with subset for demo)
            const chainsToProcess = this.buildChainStates({
                pages: pages.slice(0, 6), // First 6 pages for demo
                templates,
                containers,
                models,
                content,
                assets
            });

            this.pendingChains = chainsToProcess;
            this.updateDisplay();

        } catch (error) {
            console.error('Error loading chains:', error);
            throw error;
        }
    }

    /**
     * Build chain states from source data
     */
    private buildChainStates(sourceData: any): ChainState[] {
        const chainStates: ChainState[] = [];

        for (const page of sourceData.pages) {
            const dependencies = this.buildPageDependencies(page, sourceData);
            
            const chainState: ChainState = {
                id: `page-${page.pageID || page.id}`,
                title: `Page: ${page.name || page.title || 'Unnamed'}`,
                status: 'pending',
                progress: 0,
                dependencies: dependencies,
                collapsed: true, // Start collapsed
            };

            chainStates.push(chainState);
        }

        // Sort by dependency depth (deepest first)
        return chainStates.sort((a, b) => 
            this.getMaxDepth(b.dependencies) - this.getMaxDepth(a.dependencies)
        );
    }

    /**
     * Start processing chains with configurable threading
     */
    async startProcessing(): Promise<void> {
        // Start refresh interval for real-time updates
        this.refreshInterval = setInterval(() => {
            this.updateDisplay();
        }, 100); // 10fps updates for smooth visualization

        // Process chains with thread coordination
        while (this.pendingChains.length > 0 || this.activeChains.size > 0) {
            // Assign pending chains to available threads
            this.assignChainsToThreads();
            
            // Process active chains
            await this.processActiveChains();
            
            // Small delay to prevent spinning
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Complete processing
        this.completeProcessing();
    }

    /**
     * Assign pending chains to available threads
     */
    private assignChainsToThreads(): void {
        const availableThreads = Array.from(this.threadStates.values())
            .filter(thread => thread.status === 'idle')
            .slice(0, Math.min(this.maxThreads, this.pendingChains.length));

        for (const thread of availableThreads) {
            if (this.pendingChains.length === 0) break;

            const chain = this.pendingChains.shift()!;
            chain.status = 'active';
            chain.threadId = thread.id;
            chain.startTime = Date.now();
            chain.collapsed = false; // Expand when active

            this.activeChains.set(chain.id, chain);
            
            thread.status = 'active';
            thread.currentChain = chain.id;
        }
    }

    /**
     * Process all active chains
     */
    private async processActiveChains(): Promise<void> {
        const processingPromises: Promise<void>[] = [];

        for (const [chainId, chain] of Array.from(this.activeChains.entries())) {
            processingPromises.push(this.processChain(chain));
        }

        await Promise.all(processingPromises);
    }

    /**
     * Process individual chain
     */
    private async processChain(chain: ChainState): Promise<void> {
        try {
            // Simulate processing individual items in the chain
            const totalItems = this.getFlatItemCount(chain.dependencies);
            let processedItems = 0;

            for (const item of this.flattenDependencies(chain.dependencies)) {
                if (item.status === 'pending') {
                    item.status = 'active';
                    chain.currentItem = item.name;
                    
                    // Simulate upload time (mock for now)
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 200));
                    
                    // Simulate success/failure (95% success rate)
                    if (Math.random() < 0.95) {
                        item.status = 'completed';
                        item.uploadTime = Date.now();
                    } else {
                        item.status = 'error';
                        item.error = 'Upload failed';
                        chain.status = 'error';
                    }
                    
                    processedItems++;
                    chain.progress = Math.round((processedItems / totalItems) * 100);
                }
            }

            // Chain completed
            if (chain.status !== 'error') {
                chain.status = 'completed';
                chain.completionTime = Date.now();
                chain.collapsed = true; // Collapse when complete
            }

            // Move to completed and update thread
            this.activeChains.delete(chain.id);
            this.completedChains.set(chain.id, chain);
            
            const thread = this.threadStates.get(chain.threadId!);
            if (thread) {
                thread.status = 'idle';
                thread.processedChains.push(chain.id);
                thread.currentChain = undefined;
                if (chain.status === 'error') {
                    thread.errorCount++;
                }
            }

        } catch (error) {
            chain.status = 'error';
            chain.error = (error as Error).message;
        }
    }

    /**
     * Update the visual display with current state
     */
    private updateDisplay(): void {
        // Update each thread column
        for (let threadId = 1; threadId <= this.maxThreads; threadId++) {
            this.updateThreadDisplay(threadId);
        }

        // Update stats
        this.updateStatsDisplay();

        // Update header
        this.updateHeaderDisplay();

        this.screen.render();
    }

    /**
     * Update individual thread display
     */
    private updateThreadDisplay(threadId: number): void {
        const display = this.chainDisplays.get(threadId);
        const thread = this.threadStates.get(threadId);
        if (!display || !thread) return;

        let content = '';

        // Show active chain if any
        if (thread.currentChain) {
            const activeChain = this.activeChains.get(thread.currentChain);
            if (activeChain) {
                content += this.renderActiveChain(activeChain);
            }
        }

        // Show recently completed chains (collapsed)
        const recentCompleted = thread.processedChains
            .slice(-3) // Last 3 completed
            .map(chainId => this.completedChains.get(chainId))
            .filter(Boolean);

        for (const completedChain of recentCompleted) {
            content += this.renderCompletedChain(completedChain!);
        }

        // If thread is idle, show status
        if (thread.status === 'idle' && !content) {
            content = '\n\n{center}{gray-fg}Thread Idle{/gray-fg}{/center}\n{center}{gray-fg}Waiting for chains...{/gray-fg}{/center}';
        }

        display.setContent(content);
    }

    /**
     * Render active chain with expanded details
     */
    private renderActiveChain(chain: ChainState): string {
        let content = `\n{${this.getStatusColor(chain.status)}-fg}● ${chain.title}{/${this.getStatusColor(chain.status)}-fg}\n`;
        content += `{gray-fg}Progress: ${chain.progress}%{/gray-fg}\n`;
        
        if (chain.currentItem) {
            content += `{yellow-fg}⚡ ${chain.currentItem}{/yellow-fg}\n`;
        }

        if (!chain.collapsed) {
            content += this.renderDependencyTree(chain.dependencies, 1);
        }

        content += '\n';
        return content;
    }

    /**
     * Render completed chain (collapsed)
     */
    private renderCompletedChain(chain: ChainState): string {
        const duration = chain.completionTime && chain.startTime 
            ? `${((chain.completionTime - chain.startTime) / 1000).toFixed(1)}s`
            : '';
        
        return `{${this.getStatusColor(chain.status)}-fg}✓ ${chain.title}{/${this.getStatusColor(chain.status)}-fg} {gray-fg}${duration}{/gray-fg}\n`;
    }

    /**
     * Render dependency tree for expanded chains
     */
    private renderDependencyTree(dependencies: ChainItem[], level: number): string {
        let content = '';
        const indent = '  '.repeat(level);

        for (const item of dependencies) {
            const icon = this.getItemIcon(item.type);
            const statusIcon = this.getStatusIcon(item.status);
            const color = this.getStatusColor(item.status);
            
            content += `${indent}{${color}-fg}${statusIcon} ${icon} ${item.name}{/${color}-fg}\n`;
            
            if (item.dependencies && item.dependencies.length > 0) {
                content += this.renderDependencyTree(item.dependencies, level + 1);
            }
        }

        return content;
    }

    /**
     * Update stats display
     */
    private updateStatsDisplay(): void {
        const totalChains = this.pendingChains.length + this.activeChains.size + this.completedChains.size;
        const completed = this.completedChains.size;
        const active = this.activeChains.size;
        const pending = this.pendingChains.length;
        const errors = Array.from(this.completedChains.values()).filter(c => c.status === 'error').length;

        const content = `
Total Chains: {white-fg}${totalChains}{/white-fg}

{green-fg}✓ Completed: ${completed}{/green-fg}
{yellow-fg}⚡ Active: ${active}{/yellow-fg}
{gray-fg}⏳ Pending: ${pending}{/gray-fg}
${errors > 0 ? `{red-fg}✗ Errors: ${errors}{/red-fg}` : ''}

Threads: {cyan-fg}${this.maxThreads}{/cyan-fg}
`;

        this.statsDisplay.setContent(content);
    }

    /**
     * Update header display
     */
    private updateHeaderDisplay(): void {
        this.headerDisplay.setContent(this.buildHeaderContent());
    }

    private buildHeaderContent(): string {
        return `{center}{bold}🔗 CHAIN STATE UPLOAD ORCHESTRATOR{/bold}{/center}\n{center}Threads: ${this.maxThreads} | State-based visualization with collapsible chains{/center}`;
    }

    // Utility methods
    private loadJsonFiles(directory: string): any[] {
        // Same implementation as chain visualizer
        try {
            const files: any[] = [];
            const fs = require('fs');
            const path = require('path');
            
            if (!fs.existsSync(directory)) return files;
            
            const items = fs.readdirSync(directory);
            for (const item of items) {
                const fullPath = path.join(directory, item);
                const stat = fs.statSync(fullPath);
                
                if (stat.isFile() && item.endsWith('.json')) {
                    const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    files.push(content);
                } else if (stat.isDirectory()) {
                    files.push(...this.loadJsonFiles(fullPath));
                }
            }
            return files;
        } catch (error) {
            return [];
        }
    }

    private buildPageDependencies(page: any, sourceData: any): ChainItem[] {
        // Simplified dependency building for demo
        const dependencies: ChainItem[] = [];
        
        // Find template
        const template = sourceData.templates.find((t: any) => 
            t.pageTemplateId === page.pageTemplateId || t.id === page.templateId
        );
        
        if (template) {
            dependencies.push({
                id: `template-${template.pageTemplateId || template.id}`,
                type: 'template',
                name: template.pageTemplateName || template.name,
                level: 1,
                dependencies: [],
                status: 'pending'
            });
        }

        return dependencies;
    }

    private getMaxDepth(dependencies: ChainItem[]): number {
        if (dependencies.length === 0) return 0;
        return 1 + Math.max(...dependencies.map(dep => this.getMaxDepth(dep.dependencies)));
    }

    private getFlatItemCount(dependencies: ChainItem[]): number {
        return dependencies.length + dependencies.reduce((sum, dep) => 
            sum + this.getFlatItemCount(dep.dependencies), 0
        );
    }

    private flattenDependencies(dependencies: ChainItem[]): ChainItem[] {
        const flat: ChainItem[] = [];
        for (const dep of dependencies) {
            flat.push(dep);
            flat.push(...this.flattenDependencies(dep.dependencies));
        }
        return flat;
    }

    private getThreadColor(threadId: number): string {
        const colors = ['blue', 'green', 'yellow', 'magenta', 'cyan'];
        return colors[(threadId - 1) % colors.length];
    }

    private getStatusColor(status: string): string {
        switch (status) {
            case 'pending': return 'gray';
            case 'active': return 'yellow';
            case 'completed': return 'green';
            case 'error': return 'red';
            default: return 'white';
        }
    }

    private getStatusIcon(status: string): string {
        switch (status) {
            case 'pending': return '○';
            case 'active': return '⚡';
            case 'completed': return '✓';
            case 'error': return '✗';
            default: return '○';
        }
    }

    private getItemIcon(type: string): string {
        switch (type) {
            case 'page': return '📄';
            case 'template': return '🏗️';
            case 'container': return '📦';
            case 'model': return '📋';
            case 'content': return '📝';
            case 'asset': return '📎';
            case 'gallery': return '🖼️';
            default: return '📄';
        }
    }

    private togglePause(): void {
        // Implementation for pause/resume functionality
    }

    private expandActiveChains(): void {
        for (const chain of Array.from(this.activeChains.values())) {
            chain.collapsed = false;
        }
    }

    private collapseActiveChains(): void {
        for (const chain of Array.from(this.activeChains.values())) {
            chain.collapsed = true;
        }
    }

    private completeProcessing(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        // Show completion summary
        this.showCompletionSummary();
    }

    private showCompletionSummary(): void {
        const totalChains = this.completedChains.size;
        const errors = Array.from(this.completedChains.values()).filter(c => c.status === 'error').length;
        const successRate = totalChains > 0 ? ((totalChains - errors) / totalChains * 100).toFixed(1) : '0';

        const summaryContent = `
{center}{bold}🎉 UPLOAD COMPLETE{/bold}{/center}

{center}Total Chains: {white-fg}${totalChains}{/white-fg}{/center}
{center}Success Rate: {green-fg}${successRate}%{/green-fg}{/center}
${errors > 0 ? `{center}Errors: {red-fg}${errors}{/red-fg}{/center}` : ''}

{center}{gray-fg}Press any key to exit...{/gray-fg}{/center}
`;

        const summaryBox = blessed.box({
            parent: this.screen,
            top: 'center',
            left: 'center',
            width: 50,
            height: 10,
            content: summaryContent,
            border: { type: 'line' },
            style: { fg: 'white', border: { fg: 'green' } },
            tags: true
        });

        this.screen.render();
        
        this.screen.onceKey(['escape', 'enter', 'space', 'q'], () => {
            this.cleanup();
            process.exit(0);
        });
    }

    cleanup(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        if (this.screen && !this.screen.destroyed) {
            this.screen.destroy();
        }
    }
} 