/**
 * Test Chain State Management System
 * 
 * Demonstrates sophisticated visualization with collapsible chain progress
 * Task 21.8.2: Chain State Management System Design
 */

const { ChainStateManager } = require('./dist/lib/services/upload-orchestrator/chain-state-manager.js');

async function testChainStateManager() {
    console.log('🧪 Testing Chain State Management System...\n');

    // Test with different thread counts
    const threadCounts = [4, 5]; // Test both 4 and 5 threads
    const testGuid = '13a8b394-u'; // Proven instance with 6,064 entities

    for (const threadCount of threadCounts) {
        console.log(`🧵 Testing with ${threadCount} threads...`);
        
        try {
            // Initialize chain state manager
            const chainManager = new ChainStateManager(threadCount);
            
            console.log(`📊 Loading source data from instance: ${testGuid}`);
            
            // Load chains from real data
            await chainManager.loadChainsFromSourceData(testGuid);
            
            console.log('🚀 Starting chain processing...');
            
            // Start processing with sophisticated visualization
            await chainManager.startProcessing();
            
            console.log('✅ Chain processing completed successfully!\n');
            
        } catch (error) {
            console.error(`❌ Error with ${threadCount} threads:`, error.message);
            
            // Continue with next test
            continue;
        }
    }
}

async function testChainStateManagerCLI() {
    // Parse command line arguments for custom thread count
    const args = process.argv.slice(2);
    let threadCount = 4;
    let guid = '13a8b394-u';
    
    // Parse --uploadThreads=5 style arguments
    for (const arg of args) {
        if (arg.startsWith('--uploadThreads=')) {
            threadCount = parseInt(arg.split('=')[1]);
        }
        if (arg.startsWith('--guid=')) {
            guid = arg.split('=')[1];
        }
    }

    console.log(`🎯 Chain State Upload Orchestrator`);
    console.log(`   Threads: ${threadCount}`);
    console.log(`   Instance: ${guid}`);
    console.log(`   Mode: Sophisticated chain-state visualization\n`);

    try {
        const chainManager = new ChainStateManager(threadCount);
        
        console.log('📊 Loading source data...');
        await chainManager.loadChainsFromSourceData(guid);
        
        console.log('🚀 Starting sophisticated chain processing...');
        await chainManager.startProcessing();
        
    } catch (error) {
        console.error('❌ Chain processing failed:', error.message);
        process.exit(1);
    }
}

// Show usage help
function showUsage() {
    console.log(`
🔗 Chain State Management System Test

Usage:
  node test-chain-state-manager.js [options]

Options:
  --uploadThreads=N    Number of concurrent upload threads (default: 4)
  --guid=GUID         Instance GUID to test with (default: 13a8b394-u)

Examples:
  node test-chain-state-manager.js
  node test-chain-state-manager.js --uploadThreads=5
  node test-chain-state-manager.js --uploadThreads=3 --guid=67bc73e6-u

Features:
  ✅ Multi-column thread visualization (configurable)
  ✅ State-based display updates (replaces console logging)
  ✅ Collapsible chain progress with expand/collapse controls
  ✅ Real-time dependency tree visualization
  ✅ Interactive keyboard controls (ESC, SPACE, ↑/↓)
  ✅ Thread-specific color coding and progress tracking
  ✅ Completion summary with success rates

Keyboard Controls:
  ESC/Q: Exit
  SPACE: Pause/Resume processing
  ↑: Expand active chains
  ↓: Collapse active chains
`);
}

// Main execution
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showUsage();
} else {
    testChainStateManagerCLI().catch(error => {
        console.error('💥 Test failed:', error);
        process.exit(1);
    });
} 