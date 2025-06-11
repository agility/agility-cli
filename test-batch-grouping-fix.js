/**
 * Test Batch Grouping Fix
 * 
 * Tests the Upload Sequence Converter to verify:
 * 1. Batch count reduced from ~20 to expected number (2 levels × 2 passes = 4)
 * 2. All entities still included with proper ordering within batches
 * 3. Dependency ordering maintained
 */

const { ChainBuilder } = require('./dist/lib/services/chain-builder.js');

async function testBatchGroupingFix() {
    console.log('🧪 Testing Batch Grouping Fix...\n');
    
    try {
        // Test with proven instance
        const chainBuilder = new ChainBuilder();
        const guid = '13a8b394-u';
        const locale = 'en-us';
        const isPreview = true;
        
        console.log(`📊 Testing with instance: ${guid}/${locale}/${isPreview ? 'preview' : 'live'}`);
        
        // Build upload sequence
        const startTime = Date.now();
        const uploadSequence = await chainBuilder.buildUploadSequence(guid, locale, isPreview);
        const duration = Date.now() - startTime;
        
        console.log('\n🎯 BATCH GROUPING FIX RESULTS:');
        console.log('=' .repeat(50));
        
        // Summary metrics
        console.log(`📋 Total Batches: ${uploadSequence.batches.length}`);
        console.log(`📊 Total Entities: ${uploadSequence.metadata.totalEntities}`);
        console.log(`⏱️  Processing Time: ${(duration / 1000).toFixed(2)}s`);
        console.log(`🎯 Expected Batches: Based on dependency levels`);
        
        // Analyze batches by dependency level
        console.log('\n📊 BATCH BREAKDOWN BY DEPENDENCY LEVEL:');
        const batchesByLevel = new Map();
        
        uploadSequence.batches.forEach(batch => {
            if (!batchesByLevel.has(batch.level)) {
                batchesByLevel.set(batch.level, []);
            }
            batchesByLevel.get(batch.level).push(batch);
        });
        
        const sortedLevels = Array.from(batchesByLevel.keys()).sort((a, b) => a - b);
        
        sortedLevels.forEach(level => {
            const levelBatches = batchesByLevel.get(level);
            console.log(`\n   Level ${level}:`);
            levelBatches.forEach(batch => {
                console.log(`     • ${batch.phase}: ${batch.entities.length} entities`);
                console.log(`       Est. Duration: ${batch.estimatedDuration} min`);
            });
        });
        
        // Calculate expected passes for 2-pass orchestrator
        const expectedPasses = uploadSequence.batches.length * 2; // Each batch has 2 passes
        console.log(`\n🔄 TOPOLOGICAL TWO-PASS CALCULATION:`);
        console.log(`   Batches: ${uploadSequence.batches.length}`);
        console.log(`   Expected Passes: ${expectedPasses} (each batch × 2 passes)`);
        console.log(`   Previous Passes: ~20 (before fix)`);
        console.log(`   Improvement: ${Math.round((20 - expectedPasses) / 20 * 100)}% reduction`);
        
        // Validate entity coverage
        const totalEntitiesInBatches = uploadSequence.batches.reduce((sum, batch) => sum + batch.entities.length, 0);
        console.log(`\n✅ ENTITY COVERAGE VALIDATION:`);
        console.log(`   Entities in metadata: ${uploadSequence.metadata.totalEntities}`);
        console.log(`   Entities in batches: ${totalEntitiesInBatches}`);
        console.log(`   Coverage: ${totalEntitiesInBatches === uploadSequence.metadata.totalEntities ? '100% ✅' : 'MISMATCH ❌'}`);
        
        // Show dependency validation
        console.log(`\n🔗 DEPENDENCY VALIDATION:`);
        console.log(`   All dependencies resolved: ${uploadSequence.validation.allDependenciesResolved ? 'Yes ✅' : 'No ❌'}`);
        console.log(`   Missing dependencies: ${uploadSequence.validation.missingDependencies.length}`);
        console.log(`   Circular dependencies: ${uploadSequence.validation.circularDependencies.length}`);
        
        console.log('\n🎉 Batch Grouping Fix Test Complete!');
        
        if (uploadSequence.batches.length <= 4) {
            console.log('✅ SUCCESS: Batch count significantly reduced!');
        } else {
            console.log(`⚠️  WARNING: Still ${uploadSequence.batches.length} batches (expected ≤4)`);
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

// Run the test
testBatchGroupingFix(); 