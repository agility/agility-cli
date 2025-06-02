/**
 * Blessed Upload Orchestrator Demo - Advanced Terminal UI Test
 * 
 * Demonstrates the new blessed-based dashboard with static thread panels,
 * color-coded progress, and pipeline visualization
 */

// Import the upload orchestrator (will need TypeScript compilation)
const { ParallelExecutionManager } = require('./dist/lib/services/upload-orchestrator/parallel-execution-manager');

/**
 * Generate realistic mock data for testing
 */
function generateMockSourceEntities(scale = 'small') {
    const scales = {
        small: { models: 5, templates: 8, containers: 12, content: 75, assets: 40, pages: 15, galleries: 3 },
        medium: { models: 15, templates: 20, containers: 30, content: 400, assets: 150, pages: 60, galleries: 8 },
        large: { models: 40, templates: 50, containers: 80, content: 1200, assets: 600, pages: 200, galleries: 20 }
    };

    const counts = scales[scale] || scales.small;

    console.log(`🎬 Generating ${scale.toUpperCase()} scale data for blessed demo:`);
    console.log(`   📋 Models: ${counts.models} | 🏗️ Templates: ${counts.templates} | 📦 Containers: ${counts.containers}`);
    console.log(`   📝 Content: ${counts.content} | 📎 Assets: ${counts.assets} | 📄 Pages: ${counts.pages} | 🖼️ Galleries: ${counts.galleries}`);

    return {
        models: generateMockModels(counts.models),
        templates: generateMockTemplates(counts.templates),
        containers: generateMockContainers(counts.containers),
        content: generateMockContent(counts.content),
        assets: generateMockAssets(counts.assets, counts.galleries),
        pages: generateMockPages(counts.pages),
        galleries: generateMockGalleries(counts.galleries)
    };
}

function generateMockModels(count) {
    const models = [];
    for (let i = 1; i <= count; i++) {
        models.push({
            id: i,
            referenceName: `Model_${i}`,
            displayName: `Content Model ${i}`,
            description: `Model for blessed demo testing`
        });
    }
    return models;
}

function generateMockTemplates(count) {
    const templates = [];
    for (let i = 1; i <= count; i++) {
        templates.push({
            id: i,
            pageTemplateName: `Template_${i}`,
            templateName: `Page Template ${i}`,
            description: `Template for blessed demo testing`
        });
    }
    return templates;
}

function generateMockContainers(count) {
    const containers = [];
    for (let i = 1; i <= count; i++) {
        containers.push({
            id: i,
            referenceName: `Container_${i}`,
            friendlyName: `Container ${i}`,
            description: `Container for blessed demo testing`
        });
    }
    return containers;
}

function generateMockContent(count) {
    const content = [];
    for (let i = 1; i <= count; i++) {
        content.push({
            contentID: i,
            title: `Content Item ${i}`,
            fields: {
                title: `Content Title ${i}`,
                content: `Demo content for blessed dashboard testing`,
                slug: `content-${i}`
            }
        });
    }
    return content;
}

function generateMockAssets(count, galleryCount) {
    const assets = [];
    const assetsPerGallery = Math.floor(count * 0.25 / galleryCount); // 25% in galleries
    
    for (let i = 1; i <= count; i++) {
        const isInGallery = i <= (galleryCount * assetsPerGallery);
        const galleryId = isInGallery ? Math.ceil(i / assetsPerGallery) : null;
        
        assets.push({
            mediaID: i,
            fileName: `blessed_demo_asset_${i}.jpg`,
            fileSize: Math.floor(Math.random() * 1000000) + 50000,
            mediaGroupingID: galleryId,
            url: `https://cdn.aglty.io/blessed-demo/asset_${i}.jpg`,
            description: `Asset for blessed demo testing`
        });
    }
    return assets;
}

function generateMockPages(count) {
    const pages = [];
    for (let i = 1; i <= count; i++) {
        pages.push({
            pageID: i,
            title: `Demo Page ${i}`,
            name: `blessed-demo-page-${i}`,
            path: `/blessed-demo/page-${i}`,
            templateID: Math.floor(Math.random() * 20) + 1,
            parentPageID: i > 10 ? Math.floor(Math.random() * 10) + 1 : null
        });
    }
    return pages;
}

function generateMockGalleries(count) {
    const galleries = [];
    for (let i = 1; i <= count; i++) {
        galleries.push({
            id: i,
            galleryName: `Blessed Demo Gallery ${i}`,
            description: `Gallery for blessed dashboard testing`,
            assetCount: Math.floor(Math.random() * 15) + 5
        });
    }
    return galleries;
}

/**
 * Create blessed-optimized configuration
 */
function createBlessedConfiguration() {
    return {
        threads: [
            {
                threadId: 'independent-entities',
                threadType: 'independent',
                priority: 1,
                dependsOn: [],
                entities: ['models', 'templates', 'containers', 'assets'],
                estimatedDuration: 20000
            },
            {
                threadId: 'batched-content',
                threadType: 'dependency',
                priority: 2,
                dependsOn: ['models-complete', 'templates-complete', 'containers-complete'],
                entities: ['content'],
                estimatedDuration: 45000
            },
            {
                threadId: 'complex-entities',
                threadType: 'complex',
                priority: 3,
                dependsOn: ['content-complete', 'independent-assets-complete'],
                entities: ['pages', 'galleries'],
                estimatedDuration: 30000
            }
        ],
        batchSizes: {
            models: 1,       // Sequential processing
            templates: 1,    // Sequential processing
            containers: 1,   // Sequential processing
            assets: 8,       // Batch upload - 8 assets per batch
            content: 15,     // Batch upload - 15 content items per batch
            pages: 1,        // Sequential chain traversal
            galleries: 1     // Sequential chain traversal
        },
        concurrency: {
            maxConcurrentBatches: 3,
            maxConcurrentThreads: 3,
            retryAttempts: 2,
            retryDelayMs: 800
        },
        timing: {
            progressUpdateIntervalMs: 1500,
            mockApiDelays: {
                models: 120,      // 120ms per model
                templates: 160,   // 160ms per template
                containers: 140,  // 140ms per container
                assets: 600,      // 600ms per asset batch
                content: 250,     // 250ms per content batch
                pages: 200,       // 200ms per page
                galleries: 180    // 180ms per gallery
            }
        },
        visualization: {
            enableRealTimeUpdates: true,
            progressBarWidth: 30,
            showDetailedSubTasks: true,
            refreshIntervalMs: 1000 // Smooth blessed updates
        }
    };
}

/**
 * Run the blessed dashboard demo
 */
async function runBlessedDemo() {
    console.log(`\n🎨 BLESSED UPLOAD ORCHESTRATOR DASHBOARD DEMO`);
    console.log(`═══════════════════════════════════════════════════════════════════`);
    console.log(`🎯 Features: Static thread panels, color-coded progress, pipeline visualization`);
    console.log(`📊 Interface: Advanced terminal UI with blessed + blessed-contrib`);
    console.log(`🚀 Foundation: Validated analysis system with 100% entity reconciliation`);

    // Get demo scale from command line
    const scale = process.argv[2] || 'small';
    const validScales = ['small', 'medium', 'large'];
    
    if (!validScales.includes(scale)) {
        console.log(`\n❌ Invalid scale: ${scale}`);
        console.log(`✅ Valid scales: ${validScales.join(', ')}`);
        console.log(`\nUsage: node test-blessed-orchestrator.js [scale]`);
        console.log(`Example: node test-blessed-orchestrator.js medium`);
        return;
    }

    try {
        // Generate mock data
        const sourceEntities = generateMockSourceEntities(scale);
        const config = createBlessedConfiguration();

        console.log(`\n🔧 Initializing blessed dashboard...`);
        const orchestrator = new ParallelExecutionManager(config);

        console.log(`\n📱 Demo Features:`);
        console.log(`   • Static thread panels with color-coded borders`);
        console.log(`   • Real-time progress gauges and activity logs`);
        console.log(`   • Pipeline visualization with dependency gates`);
        console.log(`   • Performance metrics and throughput tracking`);
        console.log(`   • No screen clearing - stable interface`);

        console.log(`\n🎬 Starting blessed dashboard in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Clear console one final time before blessed takes over
        console.clear();

        const startTime = Date.now();
        const result = await orchestrator.executeUpload(sourceEntities);

        // Blessed dashboard will handle final summary display
        // Process will exit when user presses a key in the summary modal

    } catch (error) {
        console.error(`\n❌ Blessed demo failed:`, error);
        console.log(`\n🔍 This may be because the TypeScript files need compilation.`);
        console.log(`   Run: npm run build`);
        console.log(`   Then: node test-blessed-orchestrator.js ${scale}`);
        
        console.log(`\n💡 If blessed is not working properly:`);
        console.log(`   • Ensure terminal supports Unicode and colors`);
        console.log(`   • Try: LANG=en_US.utf8 TERM=xterm-256color node test-blessed-orchestrator.js ${scale}`);
        console.log(`   • Verify terminal size is at least 120x30`);
    }
}

/**
 * Handle graceful shutdown
 */
process.on('SIGINT', () => {
    console.log(`\n\n⏹️  Blessed dashboard demo stopped by user`);
    console.log(`👋 Thank you for testing the advanced terminal UI!`);
    process.exit(0);
});

// Handle terminal size
process.on('SIGWINCH', () => {
    // Blessed handles this automatically
});

// Run the demo
if (require.main === module) {
    runBlessedDemo().catch(error => {
        console.error('Blessed demo error:', error);
        process.exit(1);
    });
}

module.exports = {
    generateMockSourceEntities,
    createBlessedConfiguration,
    runBlessedDemo
}; 