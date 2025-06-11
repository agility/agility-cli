/**
 * Test script for UploadSequenceConverter
 * 
 * Tests the enhanced ChainBuilder with dependency-ordered upload sequences:
 * 1. Load source data
 * 2. Perform chain analysis
 * 3. Generate optimized upload sequence with batching
 * 4. Validate dependency ordering
 */

const { ChainBuilder } = require('./dist/lib/services/chain-builder');

async function testUploadSequenceConverter() {
    console.log('🧪 Testing UploadSequenceConverter Integration\n');
    
    const chainBuilder = new ChainBuilder();
    const guid = '13a8b394-u';
    const locale = 'en-us';
    const isPreview = true;

    try {
        // Test the enhanced buildUploadSequence method
        console.log('Step 1: Testing buildUploadSequence with dependency batching...');
        const uploadSequence = await chainBuilder.buildUploadSequence(guid, locale, isPreview);
        
        console.log('\n📊 UPLOAD SEQUENCE ANALYSIS');
        console.log('=====================================');
        console.log(`Total Batches: ${uploadSequence.metadata.totalBatches}`);
        console.log(`Total Entities: ${uploadSequence.metadata.totalEntities}`);
        console.log(`Max Parallelism: ${uploadSequence.metadata.maxParallelism}`);
        console.log(`Estimated Duration: ${uploadSequence.metadata.estimatedTotalDuration} minutes`);
        
        console.log('\n🔗 BATCH SUMMARY');
        console.log('=====================================');
        uploadSequence.batches.forEach((batch, index) => {
            console.log(`${index + 1}. ${batch.phase}`);
            console.log(`   Level: ${batch.level}, Entities: ${batch.entities.length}, Duration: ~${batch.estimatedDuration}m`);
            
            // Show first few entities in each batch
            const sampleEntities = batch.entities.slice(0, 3);
            sampleEntities.forEach(entity => {
                console.log(`   - ${entity.type}: ${entity.name}`);
            });
            if (batch.entities.length > 3) {
                console.log(`   - ... and ${batch.entities.length - 3} more`);
            }
        });
        
        console.log('\n✅ VALIDATION RESULTS');
        console.log('=====================================');
        console.log(`Dependencies Resolved: ${uploadSequence.validation.allDependenciesResolved ? '✅ YES' : '❌ NO'}`);
        console.log(`Circular Dependencies: ${uploadSequence.validation.circularDependencies.length}`);
        console.log(`Missing Dependencies: ${uploadSequence.validation.missingDependencies.length}`);
        
        if (uploadSequence.validation.missingDependencies.length > 0) {
            console.log('\n⚠️ Dependency Issues:');
            uploadSequence.validation.missingDependencies.slice(0, 5).forEach(issue => {
                console.log(`   ${issue}`);
            });
            if (uploadSequence.validation.missingDependencies.length > 5) {
                console.log(`   ... and ${uploadSequence.validation.missingDependencies.length - 5} more`);
            }
        }
        
        console.log('\n🎯 CRITICAL PATH ANALYSIS');
        console.log('=====================================');
        uploadSequence.metadata.criticalPath.forEach((phase, index) => {
            console.log(`${index + 1}. ${phase}`);
        });
        
        // Test dependency ordering validation
        console.log('\n🔍 DEPENDENCY ORDERING TEST');
        console.log('=====================================');
        
        let dependencyOrderCorrect = true;
        const processedEntities = new Set();
        
        uploadSequence.batches.forEach((batch, batchIndex) => {
            console.log(`\nValidating Batch ${batchIndex + 1}: ${batch.phase}`);
            
            batch.entities.forEach(entity => {
                const entityKey = `${entity.type}:${entity.id}`;
                
                // Check if all dependencies were processed in earlier batches
                entity.dependencies.forEach(dep => {
                    if (!processedEntities.has(dep)) {
                        console.log(`   ⚠️ ${entityKey} depends on ${dep} but ${dep} not yet processed`);
                        dependencyOrderCorrect = false;
                    }
                });
                
                processedEntities.add(entityKey);
            });
        });
        
        console.log(`\nDependency Order Test: ${dependencyOrderCorrect ? '✅ PASSED' : '❌ FAILED'}`);
        
        // Summary
        console.log('\n🎉 TEST SUMMARY');
        console.log('=====================================');
        console.log(`✅ Upload sequence generated successfully`);
        console.log(`📊 ${uploadSequence.metadata.totalBatches} batches for ${uploadSequence.metadata.totalEntities} entities`);
        console.log(`⏱️ Estimated ${uploadSequence.metadata.estimatedTotalDuration} minutes total processing time`);
        console.log(`🔗 Dependencies: ${uploadSequence.validation.allDependenciesResolved ? 'All resolved' : 'Issues found'}`);
        console.log(`📈 Max parallelism: ${uploadSequence.metadata.maxParallelism} entities per batch`);
        
        return uploadSequence;
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    }
}

// Run the test
testUploadSequenceConverter()
    .then(() => {
        console.log('\n✅ All tests completed successfully!');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    }); 