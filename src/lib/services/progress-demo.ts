/**
 * Enhanced Progress Tracking Demo
 * 
 * This demonstrates how to use the enhanced store interface progress tracking
 * for real-time updates in BlessedUI or other interfaces.
 */

const storeInterfaceFileSystem = require("./store-interface-filesystem");

interface ProgressStats {
    totalItems: number;
    itemsByType: { [itemType: string]: number };
    elapsedTime: number;
    itemsPerSecond: number;
    recentActivity: Array<{ itemType: string, itemID: string | number, timestamp: number }>;
}

/**
 * Example: Setting up progress tracking for BlessedUI
 */
export function setupBlessedUIProgress(updateProgressBar: (type: string, count: number, total: number) => void) {
    // Initialize progress tracking
    storeInterfaceFileSystem.initializeProgress();
    
    // Set up the progress callback
    storeInterfaceFileSystem.setProgressCallback((stats: ProgressStats) => {
        // Update individual progress bars by item type
        Object.entries(stats.itemsByType).forEach(([itemType, count]) => {
            updateProgressBar(itemType, count, stats.totalItems);
        });
        
        // You can also update a master progress bar
        updateProgressBar('total', stats.totalItems, 0);
        
        // Log performance metrics
        if (stats.totalItems % 50 === 0) { // Log every 50 items
            console.log(`Progress: ${stats.totalItems} items (${stats.itemsPerSecond.toFixed(1)}/sec)`);
        }
    });
}

/**
 * Example: Getting real-time progress data
 */
export function getProgressSnapshot(): ProgressStats {
    return storeInterfaceFileSystem.getCurrentProgress();
}

/**
 * Example: Custom progress handler for different UI types
 */
export function setupCustomProgressHandler(handler: (stats: ProgressStats) => void) {
    storeInterfaceFileSystem.setProgressCallback(handler);
}

/**
 * Example: Setting up progress bars by expected item types
 */
export function setupProgressBarsByType(expectedTypes: string[]) {
    const progressBars: { [type: string]: any } = {};
    
    // Initialize progress bars for expected types
    expectedTypes.forEach(type => {
        progressBars[type] = {
            count: 0,
            lastUpdate: Date.now()
        };
    });
    
    // Set up callback to update bars
    storeInterfaceFileSystem.setProgressCallback((stats: ProgressStats) => {
        Object.entries(stats.itemsByType).forEach(([itemType, count]) => {
            if (progressBars[itemType]) {
                progressBars[itemType].count = count;
                progressBars[itemType].lastUpdate = Date.now();
            }
        });
        
        // Log breakdown
        const breakdown = Object.entries(stats.itemsByType)
            .map(([type, count]) => `${type}: ${count}`)
            .join(', ');
        
        console.log(`Sync Progress - ${breakdown} (${stats.itemsPerSecond.toFixed(1)}/sec)`);
    });
    
    return progressBars;
}

/**
 * Example: Getting final statistics after sync completion
 */
export function getFinalSyncStatistics() {
    const finalStats = storeInterfaceFileSystem.getAndClearSavedItemStats();
    
    return {
        totalItems: finalStats.summary.totalItems,
        itemsByType: finalStats.itemsByType,
        elapsedTime: finalStats.summary.elapsedTime,
        averageItemsPerSecond: finalStats.summary.itemsPerSecond,
        allItems: finalStats.items // Array of all saved items with timestamps
    };
}

/**
 * Common item types you might expect from Agility Sync SDK
 */
export const EXPECTED_ITEM_TYPES = [
    'item',         // Content items
    'list',         // Content lists (containers)
    'page',         // Pages
    'sitemap',      // Sitemap entries
    'nestedsitemap', // Nested sitemap entries
    'state',        // Sync state
    'urlredirections' // URL redirections
];

/**
 * Example usage for your Pull service BlessedUI:
 * 
 * ```typescript
 * import { setupBlessedUIProgress, EXPECTED_ITEM_TYPES } from './progress-demo';
 * 
 * // In your Pull service, before calling syncClient.runSync():
 * setupBlessedUIProgress((type, count, total) => {
 *     const stepIndex = pullSteps.indexOf('Content');
 *     if (stepIndex >= 0) {
 *         const percentage = Math.min(95, (total * 2)); // Estimate progress
 *         updateProgress(stepIndex, 'progress', percentage);
 *         
 *         if (type === 'total') {
 *             console.log(`Syncing: ${count} total items processed`);
 *         }
 *     }
 * });
 * ```
 */ 