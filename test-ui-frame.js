/**
 * Simple UI Frame Test - Basic 2-Column Interface Demo
 * 
 * Tests the minimal blessed UI frame with 4 threads
 * Left column: Thread status, Right column: Console logs
 */

const { SimpleUIFrame } = require('./dist/lib/services/upload-orchestrator/simple-ui-frame');

/**
 * Run the simple UI frame test
 */
async function runUIFrameTest() {
    console.log(`\n🖼️  AGILITY SIMPLE UI FRAME TEST`);
    console.log(`═══════════════════════════════════════════════════════════════════`);
    console.log(`🎯 Features: Basic 2-column blessed interface framework`);
    console.log(`📊 Layout: Left column = Thread status, Right column = Console logs`);
    console.log(`🚀 Pattern: Copied from proven push functionality blessed UI`);

    try {
        console.log(`\n🔧 Initializing simple UI frame...`);
        const uiFrame = new SimpleUIFrame();

        console.log(`\n📱 Demo Features:`);
        console.log(`   • 2-column blessed grid layout (13x12)`);
        console.log(`   • Console log redirection to right column`);
        console.log(`   • Thread status display in left column`);
        console.log(`   • Exit handlers (ESC, q, Ctrl+C)`);
        console.log(`   • Clean scaffolding for future upload logic`);

        console.log(`\n🎬 Starting UI frame in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Clear console before UI takes over
        console.clear();

        // Initialize the blessed UI
        uiFrame.initializeUI();

        // Run the test demo
        await uiFrame.testUIFrame();

    } catch (error) {
        console.error(`\n❌ UI frame test failed:`, error);
        console.log(`\n🔍 This may be because:`);
        console.log(`   • TypeScript files need compilation: npm run build`);
        console.log(`   • Missing blessed dependencies`);
        
        console.log(`\n💡 To fix:`);
        console.log(`   1. Run: npm run build`);
        console.log(`   2. Install blessed: npm install blessed blessed-contrib`);
        console.log(`   3. Run test: node test-ui-frame.js`);
    }
}

/**
 * Handle graceful shutdown
 */
process.on('SIGINT', () => {
    console.log(`\n\n⏹️  UI frame test stopped by user`);
    console.log(`👋 Thank you for testing the simple UI framework!`);
    process.exit(0);
});

// Run the test
if (require.main === module) {
    runUIFrameTest().catch(error => {
        console.error('UI frame test error:', error);
        process.exit(1);
    });
}

module.exports = {
    runUIFrameTest
}; 