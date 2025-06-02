/**
 * Chain Upload Visualizer - Simplified Dependency Chain Processing
 * 
 * Builds on proven analysis system with visual upload progression
 * Color states: Gray (pending) → Yellow (processing) → Green (success) / Red (failure)
 */

import * as blessed from 'blessed';
import { readFileSync } from 'fs';
import { join } from 'path';

// Import our proven analysis types and utilities
interface ChainItem {
    id: string;
    type: 'page' | 'template' | 'container' | 'model' | 'content' | 'asset' | 'gallery';
    name: string;
    level: number;
    dependencies: ChainItem[];
    status: 'pending' | 'processing' | 'success' | 'error';
    uploadTime?: number;
    error?: string;
}

interface ChainAnalysis {
    pageChains: ChainItem[];
    independentItems: ChainItem[];
    totalItems: number;
}

export class ChainUploadVisualizer {
    private screen: blessed.Widgets.Screen;
    private chainDisplay: blessed.Widgets.Box;
    private statsDisplay: blessed.Widgets.Box;
    private maxConcurrent: number = 4;
    private currentlyProcessing: Set<string> = new Set();
    private totalItems: number = 0;
    private completedItems: number = 0;
    private failedItems: number = 0;
    private startTime: number = Date.now();

    constructor() {
        this.initializeScreen();
    }

    /**
     * Initialize blessed screen with simple layout
     */
    private initializeScreen(): void {
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Agility Chain Upload Visualizer',
            fullUnicode: true
        });

        // Header
        const header = blessed.box({
            parent: this.screen,
            top: 0,
            left: 0,
            width: '100%',
            height: 3,
            content: '{center}{bold}🔗 AGILITY DEPENDENCY CHAIN UPLOAD VISUALIZER{/bold}{/center}\n{center}Simple chain-based processing with visual progression{/center}',
            border: { type: 'line' },
            style: { fg: 'white', border: { fg: 'cyan' } },
            tags: true
        });

        // Chain display (main area)
        this.chainDisplay = blessed.box({
            parent: this.screen,
            top: 3,
            left: 0,
            width: '75%',
            height: '#{/height} - 6',
            content: '',
            border: { type: 'line' },
            style: { fg: 'white', border: { fg: 'blue' } },
            label: '🔗 DEPENDENCY CHAINS',
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            scrollbar: { style: { bg: 'blue' } }
        });

        // Stats display
        this.statsDisplay = blessed.box({
            parent: this.screen,
            top: 3,
            left: '75%',
            width: '25%',
            height: '#{/height} - 6',
            content: '',
            border: { type: 'line' },
            style: { fg: 'white', border: { fg: 'green' } },
            label: '📊 PROGRESS',
            tags: true
        });

        // Footer
        const footer = blessed.box({
            parent: this.screen,
            bottom: 0,
            left: 0,
            width: '100%',
            height: 3,
            content: '{center}Press ESC or Ctrl+C to exit | Colors: {gray-bg} Pending {/gray-bg} {yellow-bg} Processing {/yellow-bg} {green-bg} Success {/green-bg} {red-bg} Error {/red-bg}{/center}',
            border: { type: 'line' },
            style: { fg: 'white', border: { fg: 'magenta' } },
            tags: true
        });

        // Handle exit
        this.screen.key(['escape', 'q', 'C-c'], () => {
            process.exit(0);
        });

        this.screen.render();
    }

    /**
     * Load source data from our proven analysis system
     */
    async loadSourceData(guid: string): Promise<ChainAnalysis> {
        try {
            // Use the same paths our analysis system uses
            const basePath = join(process.env.HOME || '', 'agility-files', guid, 'en-us', 'preview');
            
            // Load data using the same approach as our analysis
            const pages = this.loadJsonFiles(join(basePath, 'sitemap'));
            const templates = this.loadJsonFiles(join(basePath, 'templates'));
            const containers = this.loadJsonFiles(join(basePath, 'containers'));
            const models = this.loadJsonFiles(join(basePath, 'models'));
            const content = this.loadJsonFiles(join(basePath, 'content'));
            const assets = this.loadJsonFiles(join(basePath, 'assets'));

            console.log(`📊 Loaded: ${pages.length} pages, ${templates.length} templates, ${containers.length} containers, ${models.length} models, ${content.length} content, ${assets.length} assets`);

            // Build chains (simplified for demo)
            const chainAnalysis = this.buildSimpleChains({
                pages: pages.slice(0, 3), // Start with just 3 pages for demo
                templates,
                containers, 
                models,
                content,
                assets
            });

            this.totalItems = chainAnalysis.totalItems;
            return chainAnalysis;

        } catch (error) {
            console.error('Error loading source data:', error);
            throw error;
        }
    }

    /**
     * Load JSON files (same utility from analysis system)
     */
    private loadJsonFiles(directory: string): any[] {
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

    /**
     * Build simple dependency chains for visualization
     */
    private buildSimpleChains(sourceData: any): ChainAnalysis {
        const chains: ChainItem[] = [];
        let totalItems = 0;

        // Build page chains (simplified)
        for (const page of sourceData.pages) {
            const pageChain = this.buildPageChain(page, sourceData);
            if (pageChain) {
                chains.push(pageChain);
                totalItems += this.countChainItems(pageChain);
            }
        }

        // Add independent items
        const independentItems: ChainItem[] = [];
        
        // Independent models
        const usedModelIds = new Set(this.getAllUsedModelIds(chains));
        for (const model of sourceData.models) {
            if (!usedModelIds.has(model.id)) {
                independentItems.push({
                    id: `model-${model.id}`,
                    type: 'model',
                    name: model.displayName || model.referenceName,
                    level: 0,
                    dependencies: [],
                    status: 'pending'
                });
                totalItems++;
            }
        }

        return {
            pageChains: chains,
            independentItems,
            totalItems
        };
    }

    /**
     * Build a single page chain
     */
    private buildPageChain(page: any, sourceData: any): ChainItem | null {
        // Find template
        const template = sourceData.templates.find((t: any) => 
            t.id === page.templateID || t.pageTemplateName === page.templateName
        );

        if (!template) return null;

        const templateChain: ChainItem = {
            id: `template-${template.id}`,
            type: 'template',
            name: template.pageTemplateName || template.templateName,
            level: 1,
            dependencies: [],
            status: 'pending'
        };

        // Find containers for this template (simplified)
        const templateContainers = sourceData.containers.slice(0, 2); // Just first 2 for demo
        
        for (const container of templateContainers) {
            const containerChain = this.buildContainerChain(container, sourceData, 2);
            if (containerChain) {
                templateChain.dependencies.push(containerChain);
            }
        }

        return {
            id: `page-${page.pageID}`,
            type: 'page',
            name: page.title || page.name,
            level: 0,
            dependencies: [templateChain],
            status: 'pending'
        };
    }

    /**
     * Build container chain
     */
    private buildContainerChain(container: any, sourceData: any, level: number): ChainItem {
        const containerItem: ChainItem = {
            id: `container-${container.id}`,
            type: 'container',
            name: container.friendlyName || container.referenceName,
            level,
            dependencies: [],
            status: 'pending'
        };

        // Find model for this container (simplified)
        const model = sourceData.models.find((m: any) => 
            container.referenceName && m.referenceName && 
            container.referenceName.includes(m.referenceName.substring(0, 5))
        );

        if (model) {
            const modelChain = this.buildModelChain(model, sourceData, level + 1);
            containerItem.dependencies.push(modelChain);
        }

        return containerItem;
    }

    /**
     * Build model chain
     */
    private buildModelChain(model: any, sourceData: any, level: number): ChainItem {
        const modelItem: ChainItem = {
            id: `model-${model.id}`,
            type: 'model',
            name: model.displayName || model.referenceName,
            level,
            dependencies: [],
            status: 'pending'
        };

        // Add some content and assets (simplified)
        const relatedContent = sourceData.content.slice(0, 2); // Just first 2 for demo
        
        for (const content of relatedContent) {
            const contentItem: ChainItem = {
                id: `content-${content.contentID}`,
                type: 'content',
                name: content.title || `Content ${content.contentID}`,
                level: level + 1,
                dependencies: [],
                status: 'pending'
            };

            // Add an asset dependency
            const asset = sourceData.assets[Math.floor(Math.random() * Math.min(sourceData.assets.length, 3))];
            if (asset) {
                contentItem.dependencies.push({
                    id: `asset-${asset.mediaID}`,
                    type: 'asset',
                    name: asset.fileName || `Asset ${asset.mediaID}`,
                    level: level + 2,
                    dependencies: [],
                    status: 'pending'
                });
            }

            modelItem.dependencies.push(contentItem);
        }

        return modelItem;
    }

    /**
     * Utility methods
     */
    private countChainItems(chain: ChainItem): number {
        let count = 1;
        for (const dep of chain.dependencies) {
            count += this.countChainItems(dep);
        }
        return count;
    }

    private getAllUsedModelIds(chains: ChainItem[]): string[] {
        const ids: string[] = [];
        for (const chain of chains) {
            ids.push(...this.getModelIdsFromChain(chain));
        }
        return ids;
    }

    private getModelIdsFromChain(chain: ChainItem): string[] {
        const ids: string[] = [];
        if (chain.type === 'model') {
            ids.push(chain.id);
        }
        for (const dep of chain.dependencies) {
            ids.push(...this.getModelIdsFromChain(dep));
        }
        return ids;
    }

    /**
     * Display chains with current status colors
     */
    private displayChains(analysis: ChainAnalysis): void {
        let content = '';
        
        // Display page chains
        for (const chain of analysis.pageChains) {
            content += this.renderChain(chain, 0) + '\n';
        }

        // Display independent items
        if (analysis.independentItems.length > 0) {
            content += '\n{bold}📦 INDEPENDENT ITEMS:{/bold}\n';
            for (const item of analysis.independentItems) {
                content += this.renderChain(item, 0) + '\n';
            }
        }

        this.chainDisplay.setContent(content);
        this.updateStats();
        this.screen.render();
    }

    /**
     * Render a single chain with color coding
     */
    private renderChain(item: ChainItem, depth: number): string {
        const indent = '  '.repeat(depth);
        const icon = this.getItemIcon(item.type);
        const statusColor = this.getStatusColor(item.status);
        const statusIcon = this.getStatusIcon(item.status);
        
        let line = `${indent}${icon} ${item.name} ${statusIcon}`;
        if (statusColor) {
            line = `{${statusColor}}${line}{/${statusColor}}`;
        }

        let result = line;
        
        // Render dependencies
        for (const dep of item.dependencies) {
            result += '\n' + this.renderChain(dep, depth + 1);
        }
        
        return result;
    }

    /**
     * Get item icon by type
     */
    private getItemIcon(type: string): string {
        const icons = {
            'page': '📄',
            'template': '🏗️',
            'container': '📦',
            'model': '📋',
            'content': '📝',
            'asset': '📎',
            'gallery': '🖼️'
        };
        return icons[type] || '🔧';
    }

    /**
     * Get status color
     */
    private getStatusColor(status: string): string | null {
        const colors = {
            'pending': 'gray-fg',
            'processing': 'yellow-fg',
            'success': 'green-fg',
            'error': 'red-fg'
        };
        return colors[status] || null;
    }

    /**
     * Get status icon
     */
    private getStatusIcon(status: string): string {
        const icons = {
            'pending': '',
            'processing': '⏳',
            'success': '✅',
            'error': '❌'
        };
        return icons[status] || '';
    }

    /**
     * Update stats display
     */
    private updateStats(): void {
        const elapsed = Date.now() - this.startTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        const successRate = this.completedItems + this.failedItems > 0 ? 
            ((this.completedItems / (this.completedItems + this.failedItems)) * 100).toFixed(1) : '0.0';

        const throughput = elapsed > 0 ? ((this.completedItems / elapsed) * 1000).toFixed(1) : '0.0';

        const content = `
📊 {bold}PROGRESS{/bold}

Total Items: {bold}${this.totalItems}{/bold}
✅ Completed: {bold}{green-fg}${this.completedItems}{/green-fg}{/bold}
❌ Failed: {bold}{red-fg}${this.failedItems}{/red-fg}{/bold}
⏳ Processing: {bold}{yellow-fg}${this.currentlyProcessing.size}{/yellow-fg}{/bold}

⏱️  Runtime: {bold}${minutes}m ${seconds}s{/bold}
📈 Success Rate: {bold}${successRate}%{/bold}
⚡ Throughput: {bold}${throughput}/sec{/bold}

🎯 {bold}Concurrent Limit: ${this.maxConcurrent}{/bold}
`;

        this.statsDisplay.setContent(content);
    }

    /**
     * Process upload with chain visualization
     */
    async processUpload(analysis: ChainAnalysis): Promise<void> {
        // Display initial state
        this.displayChains(analysis);

        // Start processing (deepest first)
        const allItems = this.getAllItems(analysis);
        const sortedByDepth = allItems.sort((a, b) => b.level - a.level);

        for (const item of sortedByDepth) {
            // Wait if we're at concurrent limit
            while (this.currentlyProcessing.size >= this.maxConcurrent) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Start processing this item
            this.processItem(item, analysis);

            // Small delay between starting items
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Wait for all processing to complete
        while (this.currentlyProcessing.size > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Final display
        this.displayChains(analysis);
        this.showCompletionSummary();
    }

    /**
     * Get all items flattened
     */
    private getAllItems(analysis: ChainAnalysis): ChainItem[] {
        const items: ChainItem[] = [];
        
        for (const chain of analysis.pageChains) {
            items.push(...this.flattenChain(chain));
        }
        
        items.push(...analysis.independentItems);
        
        return items;
    }

    /**
     * Flatten a chain to get all items
     */
    private flattenChain(item: ChainItem): ChainItem[] {
        const items = [item];
        for (const dep of item.dependencies) {
            items.push(...this.flattenChain(dep));
        }
        return items;
    }

    /**
     * Process a single item (mock upload)
     */
    private async processItem(item: ChainItem, analysis: ChainAnalysis): Promise<void> {
        this.currentlyProcessing.add(item.id);
        item.status = 'processing';
        item.uploadTime = Date.now();
        
        this.displayChains(analysis);

        // Simulate upload time based on type
        const uploadTimes = {
            'asset': 800,
            'model': 300,
            'template': 400,
            'container': 200,
            'content': 500,
            'page': 600,
            'gallery': 700
        };

        const baseTime = uploadTimes[item.type] || 300;
        const uploadTime = baseTime + (Math.random() * 200);

        await new Promise(resolve => setTimeout(resolve, uploadTime));

        // Simulate occasional failures (5% chance)
        if (Math.random() < 0.05) {
            item.status = 'error';
            item.error = `Upload failed for ${item.name}`;
            this.failedItems++;
        } else {
            item.status = 'success';
            this.completedItems++;
        }

        this.currentlyProcessing.delete(item.id);
        this.displayChains(analysis);
    }

    /**
     * Show completion summary
     */
    private showCompletionSummary(): void {
        const totalTime = Date.now() - this.startTime;
        const minutes = Math.floor(totalTime / 60000);
        const seconds = Math.floor((totalTime % 60000) / 1000);
        
        const summaryBox = blessed.box({
            parent: this.screen,
            top: 'center',
            left: 'center',
            width: '60%',
            height: '50%',
            content: `
{center}{bold}🎉 CHAIN UPLOAD COMPLETE{/bold}{/center}

✅ Successfully Uploaded: {bold}{green-fg}${this.completedItems}{/green-fg}{/bold} items
❌ Failed: {bold}{red-fg}${this.failedItems}{/red-fg}{/bold} items

⏱️  Total Time: {bold}${minutes}m ${seconds}s{/bold}
📊 Success Rate: {bold}${((this.completedItems / (this.completedItems + this.failedItems)) * 100).toFixed(1)}%{/bold}

{center}Press any key to exit...{/center}`,
            border: { type: 'line' },
            style: {
                fg: 'white',
                bg: 'black',
                border: { fg: 'green' }
            },
            tags: true
        });

        summaryBox.focus();
        summaryBox.key(['enter', 'escape', 'space'], () => {
            process.exit(0);
        });

        this.screen.render();
    }

    /**
     * Run the chain upload demo
     */
    async run(guid: string): Promise<void> {
        try {
            console.log(`\n🔗 Loading source data for ${guid}...`);
            const analysis = await this.loadSourceData(guid);
            
            console.log(`📊 Analysis complete: ${analysis.totalItems} items in ${analysis.pageChains.length} chains`);
            console.log(`🚀 Starting chain upload with max ${this.maxConcurrent} concurrent...`);
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            await this.processUpload(analysis);
            
        } catch (error) {
            console.error('Chain upload failed:', error);
            console.log('\n🔍 Make sure you have pulled data first:');
            console.log(`   node dist/index.js pull --guid ${guid} --locale en-us --channel website --verbose`);
            process.exit(1);
        }
    }
} 