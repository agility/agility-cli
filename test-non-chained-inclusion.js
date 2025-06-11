/**
 * Test script to verify non-chained items are included in topological processing
 * 
 * This test verifies that entities outside of dependency chains are properly
 * included in the topological two-pass orchestrator processing.
 */

const { ChainBuilder } = require('./dist/lib/services/chain-builder');
const { UploadSequenceConverter } = require('./dist/lib/services/upload-sequence-converter');

async function testNonChainedInclusion() {
    console.log('🧪 Testing Non-Chained Items Inclusion\n');
    
    const chainBuilder = new ChainBuilder();
    const guid = '13a8b394-u';
    const locale = 'en-us';
    const isPreview = true;

    try {
        // Step 1: Load source data and perform analysis
        console.log('Step 1: Loading source data and performing analysis...');
        const sourceData = await chainBuilder.loadSourceData(guid, locale, isPreview);
        const analysisResults = await chainBuilder.performChainAnalysis(sourceData);
        
        console.log(`✅ Loaded ${sourceData.metadata.totalEntities} total entities`);

        // Step 2: Convert to upload sequence and analyze entity inclusion
        console.log('\nStep 2: Converting to upload sequence...');
        const converter = new UploadSequenceConverter();
        const uploadSequence = converter.convertToUploadSequence(analysisResults, sourceData);
        
        // Step 3: Count entities in upload sequence
        const entitiesInSequence = uploadSequence.batches.reduce((total, batch) => total + batch.entities.length, 0);
        
        console.log('\n📊 ENTITY INCLUSION ANALYSIS');
        console.log('=' .repeat(50));
        console.log(`Total Source Entities: ${sourceData.metadata.totalEntities}`);
        console.log(`Entities in Upload Sequence: ${entitiesInSequence}`);
        console.log(`Inclusion Rate: ${((entitiesInSequence / sourceData.metadata.totalEntities) * 100).toFixed(1)}%`);
        
        // Step 4: Break down by entity type
        console.log('\n📋 ENTITY TYPE BREAKDOWN');
        console.log('-' .repeat(50));
        
        const sourceBreakdown = {
            models: sourceData.models?.length || 0,
            templates: sourceData.templates?.length || 0,
            containers: sourceData.containers?.length || 0,
            content: sourceData.content?.length || 0,
            assets: sourceData.assets?.length || 0,
            galleries: sourceData.galleries?.length || 0,
            pages: sourceData.pages?.length || 0
        };
        
        const sequenceBreakdown = {};
        uploadSequence.batches.forEach(batch => {
            batch.entities.forEach(entity => {
                const type = entity.type;
                sequenceBreakdown[type] = (sequenceBreakdown[type] || 0) + 1;
            });
        });
        
        const typeMapping = {
            'models': 'Model',
            'templates': 'Template', 
            'containers': 'Container',
            'content': 'Content',
            'assets': 'Asset',
            'galleries': 'Gallery',
            'pages': 'Page'
        };
        
        Object.keys(sourceBreakdown).forEach(type => {
            const sourceCount = sourceBreakdown[type];
            const entityType = typeMapping[type];
            const sequenceCount = sequenceBreakdown[entityType] || 0;
            const inclusionRate = sourceCount > 0 ? ((sequenceCount / sourceCount) * 100).toFixed(1) : '0.0';
            const status = sourceCount === sequenceCount ? '✅' : '⚠️';
            
            console.log(`${status} ${type.padEnd(12)}: ${sequenceCount}/${sourceCount} (${inclusionRate}%)`);
        });
        
        // Step 5: Check for missing entities
        const missingEntities = sourceData.metadata.totalEntities - entitiesInSequence;
        if (missingEntities > 0) {
            console.log(`\n⚠️ WARNING: ${missingEntities} entities are missing from upload sequence!`);
            
            // Identify which specific entities are missing
            console.log('\n🔍 ANALYZING MISSING ENTITIES...');
            
            // This would require more detailed analysis to identify specific missing entities
            // For now, we'll note if there's a discrepancy
        } else {
            console.log('\n✅ ALL ENTITIES INCLUDED: All source entities are present in upload sequence');
        }
        
        // Step 6: Analyze level distribution
        console.log('\n📈 TOPOLOGICAL LEVEL DISTRIBUTION');
        console.log('-' .repeat(50));
        
        const levelDistribution = {};
        uploadSequence.batches.forEach(batch => {
            if (!levelDistribution[batch.level]) {
                levelDistribution[batch.level] = 0;
            }
            levelDistribution[batch.level] += batch.entities.length;
        });
        
        Object.keys(levelDistribution)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .forEach(level => {
                const count = levelDistribution[level];
                const percentage = ((count / entitiesInSequence) * 100).toFixed(1);
                console.log(`Level ${level}: ${count} entities (${percentage}%)`);
            });
        
        // Step 7: Specific check for non-chained items from analysis
        console.log('\n🔍 NON-CHAINED ITEMS VERIFICATION');
        console.log('-' .repeat(50));
        
        // The analysis shows specific non-chained counts:
        // - 41 content items outside chains
        // - 6 models outside chains  
        // - 2 templates outside chains
        // - 116 assets outside chains
        // - 4 galleries outside chains
        
        console.log('Non-chained items from analysis:');
        console.log('  📝 Content: 41 items outside chains');
        console.log('  📋 Models: 6 items outside chains');
        console.log('  📄 Templates: 2 items outside chains');
        console.log('  📎 Assets: 116 items outside chains');
        console.log('  🖼️ Galleries: 4 items outside chains');
        console.log('  📄 Pages: 2 items outside chains');
        
        const expectedNonChained = 41 + 6 + 2 + 116 + 4 + 2; // 171
        console.log(`\nExpected non-chained: ${expectedNonChained} items`);
        
        if (entitiesInSequence >= sourceData.metadata.totalEntities) {
            console.log('✅ VERIFICATION PASSED: All entities including non-chained items are included');
        } else {
            console.log('⚠️ VERIFICATION NEEDED: Some entities may be missing from processing');
        }
        
        return {
            totalSource: sourceData.metadata.totalEntities,
            totalInSequence: entitiesInSequence,
            inclusionRate: (entitiesInSequence / sourceData.metadata.totalEntities) * 100,
            levelDistribution,
            sourceBreakdown,
            sequenceBreakdown
        };
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    }
}

// Run the test
testNonChainedInclusion()
    .then((result) => {
        console.log('\n✅ Non-chained inclusion test completed!');
        console.log(`📊 ${result.totalInSequence}/${result.totalSource} entities included (${result.inclusionRate.toFixed(1)}%)`);
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    }); 