// Real SDK Integration Test - Uses Actual Agility Management SDK
// This test makes REAL API calls to create entities in a target instance

console.log('🧪 Real SDK Integration Test - Actual Entity Creation');
console.log('=' .repeat(70));

const { TopologicalTwoPassOrchestrator } = require('./dist/lib/services/topological-two-pass-orchestrator');
const { CoreReferenceMapper } = require('./dist/lib/core-reference-mapper');
const { UploadSequenceConverter } = require('./dist/lib/services/upload-sequence-converter');

async function testRealSDKIntegration() {
    const targetGuid = process.argv[2] || 'test-target';
    const locale = 'en-us';
    
    if (targetGuid === 'test-target') {
        console.log('❌ Error: Please provide a real target instance GUID');
        console.log('Usage: node test-real-sdk-integration.js <TARGET_GUID>');
        console.log('Example: node test-real-sdk-integration.js e67929d5-u');
        process.exit(1);
    }

    console.log(`🎯 Target Instance: ${targetGuid}`);
    console.log(`🌍 Locale: ${locale}`);

    try {
        // Step 1: Create API configuration with real credentials
        const apiOptions = {
            token: process.env.AGILITY_API_KEY,
            baseUrl: 'https://mgmt.aglty.io',
            refresh_token: '',
            duration: 30,
            retryCount: 3
        };

        if (!apiOptions.token) {
            throw new Error('AGILITY_API_KEY environment variable not set');
        }

        console.log('\n🔑 API Configuration:');
        console.log(`   Token: ${apiOptions.token ? '***' + apiOptions.token.slice(-4) : 'NOT SET'}`);
        console.log(`   Base URL: ${apiOptions.baseUrl}`);

        // Step 2: Initialize real orchestrator components
        console.log('\n🎯 Initializing Real SDK Components...');
        
        const referenceMapper = new CoreReferenceMapper('test-source', targetGuid);
        const sequenceConverter = new UploadSequenceConverter();

        const orchestratorConfig = {
            apiOptions: apiOptions,
            targetGuid: targetGuid,
            locale: locale,
            referenceMapper: referenceMapper,
            onProgress: (level, pass, entityType, processed, total, status) => {
                const statusIcon = status === 'error' ? '❌' : '✅';
                const passDesc = pass === 1 ? 'Stub Creation' : 'Full Population';
                console.log(`    ${statusIcon} Level ${level} ${passDesc} - ${entityType}: ${processed}/${total}`);
            }
        };

        const orchestrator = new TopologicalTwoPassOrchestrator(orchestratorConfig);
        console.log('   ✅ TopologicalTwoPassOrchestrator initialized');

        // Step 3: Create test entity set (same as mock test but for real upload)
        const testEntities = createRealTestEntitySet();
        
        // Step 4: Convert to upload sequence
        const analysisResults = createAnalysisResults(testEntities);
        const uploadSequence = sequenceConverter.convertToUploadSequence(analysisResults, { entities: testEntities });
        
        console.log('\n📊 Upload Sequence Generated:');
        console.log(`   Total Batches: ${uploadSequence.batches.length}`);
        console.log(`   Total Entities: ${uploadSequence.metadata.totalEntities}`);

        // Step 5: Execute REAL 2-pass upload to target instance
        console.log('\n🚀 Executing REAL Two-Pass Upload to Target Instance...');
        console.log('⚠️  WARNING: This will create actual entities in the target instance!');
        
        const result = await orchestrator.executeTopologicalTwoPass(analysisResults, { entities: testEntities });

        // Step 6: Report real results
        console.log('\n📊 REAL SDK Integration Results:');
        console.log(`✅ Total Success: ${result.totalSuccess}`);
        console.log(`❌ Total Failures: ${result.totalFailures}`);
        console.log(`⏱️ Total Duration: ${(result.totalDuration / 1000).toFixed(2)}s`);
        console.log(`📈 Success Rate: ${((result.totalSuccess / (result.totalSuccess + result.totalFailures)) * 100).toFixed(1)}%`);

        if (result.status === 'success') {
            console.log('\n🎉 REAL SDK INTEGRATION TEST PASSED!');
            console.log('✅ Actual entities created in target instance');
            console.log('✅ Real API calls successful');
            console.log('✅ 2-Pass orchestration working with live SDK');
            
            // Step 7: Display created entity mappings
            console.log('\n📋 Created Entity Mappings:');
            const stats = referenceMapper.getStats();
            Object.entries(stats).forEach(([type, stat]) => {
                console.log(`   ${type}: ${stat.withTargets} entities created`);
            });
        } else {
            throw new Error(`Real SDK integration failed with ${result.totalFailures} failures`);
        }

    } catch (error) {
        console.error('\n❌ REAL SDK INTEGRATION TEST FAILED:', error.message);
        process.exit(1);
    }
}

function createRealTestEntitySet() {
    console.log('\n📋 Creating Real Test Entity Set for SDK Upload...');

    // Same entity structure as mock test but prepared for real upload
    const entities = {
        models: [
            {
                id: Date.now() + 1001, // Use timestamp to avoid conflicts
                referenceName: `TestArticle_${Date.now()}`,
                displayName: 'Test Article (Real SDK)',
                contentDefinitionTypeID: 0,
                fields: [
                    { name: 'title', type: 'Text', settings: {} },
                    { name: 'content', type: 'HTML', settings: {} },
                    { name: 'featuredImage', type: 'ImageAttachment', settings: {} }
                ]
            }
        ],
        galleries: [],  // Start simple for real test
        assets: [],     // Start simple for real test  
        content: [],    // Will be created after models exist
        containers: [], // Will be created after models exist
        templates: [],  // Start simple for real test
        pages: []       // Start simple for real test
    };

    console.log(`   ✅ Created ${entities.models.length} models for real upload`);
    console.log('   📝 Note: Starting with minimal set for initial real test');

    return entities;
}

function createAnalysisResults(entities) {
    // Create minimal analysis results for real upload
    const allEntities = [
        ...entities.models.map(m => ({ type: 'Model', id: m.id, data: m }))
    ];

    return {
        chainResults: [{
            chain: allEntities,
            type: 'model',
            startingEntity: entities.models[0],
            dependencies: [],
            success: true
        }],
        nonChainedItems: {
            models: [],
            content: [],
            assets: [],
            templates: [],
            pages: [],
            galleries: []
        },
        brokenChains: [],
        totalInChains: allEntities.length,
        totalNonChained: 0,
        reconciliation: {
            totalEntities: allEntities.length,
            entitiesInChains: allEntities.length,
            entitiesOutOfChains: 0,
            syncableEntities: allEntities.length
        }
    };
}

// Execute real SDK integration test
if (require.main === module) {
    testRealSDKIntegration()
        .then(() => {
            console.log('\n🎉 Real SDK integration test completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Real SDK integration test failed:', error);
            process.exit(1);
        });
}

module.exports = { testRealSDKIntegration }; 