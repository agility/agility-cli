/**
 * Chain Upload Visualizer Test - Simple Chain-Based Processing Demo
 * 
 * Uses real source data with dependency chain visualization
 * Shows color progression: gray → yellow (processing) → green (success) / red (failure)
 */

const { ChainUploadVisualizer } = require('./dist/lib/services/upload-orchestrator/chain-upload-visualizer');

/**
 * Run the chain upload visualizer demo
 */
async function runChainDemo() {
    console.log(`\n🔗 AGILITY CHAIN UPLOAD VISUALIZER DEMO`);
    console.log(`═══════════════════════════════════════════════════════════════════`);
    console.log(`🎯 Features: Dependency chain visualization with color progression`);
    console.log(`📊 Processing: 4 max concurrent, deepest dependencies first`);
    console.log(`🚀 Foundation: Uses proven analysis system with real customer data`);

    // Get GUID from command line or use default
    const guid = process.argv[2] || '13a8b394-u';
    const validGuids = ['13a8b394-u', '67bc73e6-u', 'e287280d-7513-459a-85cc-2b7c19f13ac8'];
    
    if (!validGuids.includes(guid)) {
        console.log(`\n❌ Invalid GUID: ${guid}`);
        console.log(`✅ Valid GUIDs (with proven 100% validation):`);
        console.log(`   • 13a8b394-u - 6,064 entities (moderate complexity)`);
        console.log(`   • 67bc73e6-u - 3,619 entities (Agility docs site)`);
        console.log(`   • e287280d-7513-459a-85cc-2b7c19f13ac8 - 14,481 entities (largest/most complex)`);
        console.log(`\nUsage: node test-chain-visualizer.js [guid]`);
        console.log(`Example: node test-chain-visualizer.js 67bc73e6-u`);
        return;
    }

    try {
        console.log(`\n🔧 Initializing chain visualizer for ${guid}...`);
        const visualizer = new ChainUploadVisualizer();

        console.log(`\n📱 Demo Features:`);
        console.log(`   • Dependency chains displayed like analysis output`);
        console.log(`   • Color progression: Gray → Yellow (processing) → Green (success) / Red (failure)`);
        console.log(`   • Real-time in-place updates showing upload progress`);
        console.log(`   • Deepest level processing first (correct dependency order)`);
        console.log(`   • Simple 4 concurrent upload limit`);

        console.log(`\n🎬 Starting chain visualizer in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Clear console before visualizer takes over
        console.clear();

        await visualizer.run(guid);

    } catch (error) {
        console.error(`\n❌ Chain visualizer demo failed:`, error);
        console.log(`\n🔍 This may be because:`);
        console.log(`   • TypeScript files need compilation: npm run build`);
        console.log(`   • Source data not available for ${guid}`);
        console.log(`   • Need to pull data first: node dist/index.js pull --guid ${guid} --locale en-us --channel website --verbose`);
        
        console.log(`\n💡 To fix:`);
        console.log(`   1. Run: npm run build`);
        console.log(`   2. Pull data: node dist/index.js pull --guid ${guid} --locale en-us --channel website --verbose`);
        console.log(`   3. Run demo: node test-chain-visualizer.js ${guid}`);
        
        console.log(`\n📁 Expected data structure:`);
        console.log(`   ~/agility-files/${guid}/en-us/preview/`);
        console.log(`   ├── sitemap/`);
        console.log(`   ├── templates/`);
        console.log(`   ├── containers/`);
        console.log(`   ├── models/`);
        console.log(`   ├── content/`);
        console.log(`   └── assets/`);
    }
}

/**
 * Handle graceful shutdown
 */
process.on('SIGINT', () => {
    console.log(`\n\n⏹️  Chain visualizer demo stopped by user`);
    console.log(`👋 Thank you for testing the simplified chain upload approach!`);
    process.exit(0);
});

// Run the demo
if (require.main === module) {
    runChainDemo().catch(error => {
        console.error('Chain demo error:', error);
        process.exit(1);
    });
}

module.exports = {
    runChainDemo
}; 