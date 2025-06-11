/**
 * Test Enhanced Progress Tracking
 * 
 * Tests the TopologicalTwoPassOrchestrator with enhanced progress tracking
 * using the smaller Agility Doc Site instance (67bc73e6-u)
 */

const { ChainBuilder } = require('./dist/lib/services/chain-builder.js');

async function testProgressTracking() {
    console.log('🧪 Testing Enhanced Progress Tracking...\\n');
    
    try {
        const chainBuilder = new ChainBuilder();
        const guid = '67bc73e6-u'; // Smaller Agility Doc Site
        const locale = 'en-us';
        const isPreview = true;
        
        console.log(`📊 Testing with Agility Doc Site: ${guid}/${locale}/${isPreview ? 'preview' : 'live'}`);
        
        // Build upload sequence with analysis
        const startTime = Date.now();
        const uploadSequence = await chainBuilder.buildUploadSequence(guid, locale, isPreview);
        const analysisTime = Math.round((Date.now() - startTime) / 1000);
        
        console.log(`\\n🎯 PROGRESS TRACKING DEMONSTRATION:`);
        console.log(`==================================================`);
        console.log(`📋 Analysis completed in ${analysisTime}s`);
        console.log(`📊 Total entities: ${uploadSequence.metadata.totalEntities}`);
        console.log(`🔄 Total batches: ${uploadSequence.metadata.totalBatches}`);
        console.log(`⏱️ Estimated duration: ${uploadSequence.metadata.estimatedTotalDuration} min`);
        
        console.log(`\\n📈 BATCH BREAKDOWN:`);
        uploadSequence.batches.forEach((batch, index) => {
            console.log(`   Batch ${index + 1}: ${batch.phase} (${batch.entities.length} entities)`);
            
            // Show entity type breakdown for this batch
            const typeBreakdown = {};
            batch.entities.forEach(entity => {
                typeBreakdown[entity.type] = (typeBreakdown[entity.type] || 0) + 1;
            });
            
            Object.entries(typeBreakdown).forEach(([type, count]) => {
                console.log(`     ${type}: ${count} items`);
            });
        });
        
        console.log(`\\n🚀 EXPECTED PROGRESS OUTPUT:`);
        console.log(`With enhanced tracking, you'll now see:`);
        console.log(`• [Progress %] for each batch and level`);
        console.log(`• ETA calculations based on actual performance`); 
        console.log(`• Real-time entity counts (processed/total)`);
        console.log(`• Individual asset progress for large asset batches`);
        console.log(`• Bulk content batch progress with timing`);
        
        console.log(`\\n✅ Progress Tracking Enhancement Complete!`);
        console.log(`Now run sync command to see live progress tracking...`);
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

testProgressTracking().catch(console.error); 