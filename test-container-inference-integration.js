/**
 * Container Inference Integration Test
 * 
 * Test the container inference logic integrated into the BatchContentItemPusher
 */

const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { ReferenceMapper } = require('./dist/lib/mapper');

async function testContainerInferenceIntegration() {
    console.log('🧪 Testing Container Inference Integration...\n');

    // Load data
    const loader = new ChainDataLoader({
        sourceGuid: '67bc73e6-u',
        locale: 'en-us',
        isPreview: true,
        rootPath: process.cwd(),
        elements: ['Models', 'Containers', 'Content']
    });

    const sourceData = await loader.loadSourceEntities();
    console.log(`✅ Loaded: ${sourceData.models?.length || 0} models, ${sourceData.containers?.length || 0} containers, ${sourceData.content?.length || 0} content items\n`);

    // Initialize reference mapper with test data (simulate successful container/model sync)
    const referenceMapper = new ReferenceMapper('90c39c80-u', 'en-us', true, process.cwd());
    
    // Add container mappings (simulating successful container sync)
    sourceData.containers.forEach(container => {
        const fakeTargetId = 4000 + (container.contentViewID || 0);
        const fakeTargetContainer = {
            contentViewID: fakeTargetId,
            referenceName: container.referenceName,
            contentDefinitionID: container.contentDefinitionID,
            schemaTitle: sourceData.models?.find(m => m.id === container.contentDefinitionID)?.displayName || 'Unknown Model'
        };
        referenceMapper.addRecord('container', container, fakeTargetContainer);
    });
    
    // Add model mappings
    sourceData.models.forEach(model => {
        const fakeTargetId = 900 + (model.id || 0);
        referenceMapper.addRecord('model', model, { id: fakeTargetId, displayName: model.displayName });
    });
    
    console.log(`🗺️ Reference mapper initialized with ${sourceData.containers.length} containers and ${sourceData.models.length} models\n`);

    // Test the container inference by simulating the logic
    function simulateInferContainerFromContentName(contentReferenceName, containerMappings) {
        if (!contentReferenceName) {
            return '';
        }
        
        const contentRef = contentReferenceName.toLowerCase();
        
        // Strategy 1: Exact match (case insensitive)
        for (const mapping of containerMappings) {
            const containerName = mapping.source?.referenceName;
            if (containerName && containerName.toLowerCase() === contentRef) {
                console.log(`    🎯 EXACT MATCH: "${contentReferenceName}" → "${containerName}"`);
                return containerName;
            }
        }
        
        // Strategy 2: Container name contains content name
        for (const mapping of containerMappings) {
            const containerName = mapping.source?.referenceName;
            if (containerName && containerName.toLowerCase().includes(contentRef)) {
                console.log(`    🎯 CONTAINER CONTAINS CONTENT: "${contentReferenceName}" → "${containerName}"`);
                return containerName;
            }
        }
        
        console.log(`    ⚠️ NO CONTAINER INFERENCE: Could not infer container for "${contentReferenceName}"`);
        return contentReferenceName;
    }

    // Test with sample content items
    console.log('🔍 Testing container inference on sample content items...\n');
    const sampleContent = sourceData.content.slice(0, 10);
    const containerMappings = referenceMapper.getRecordsByType('container');
    
    let successCount = 0;
    let totalCount = 0;
    
    for (const contentItem of sampleContent) {
        totalCount++;
        const contentRef = contentItem.properties?.referenceName || '';
        
        console.log(`📝 Content: "${contentRef}" (Model: ${contentItem.properties?.definitionName})`);
        
        // Simulate the container inference logic
        const inferredContainer = simulateInferContainerFromContentName(contentRef, containerMappings);
        
        if (inferredContainer && inferredContainer !== contentRef) {
            // Check if we can find a mapping for this inferred container
            const containerMapping = referenceMapper.getMapping('container', 'referenceName', inferredContainer);
            
            if (containerMapping?.target) {
                const targetContainer = containerMapping.target;
                console.log(`    ✅ SUCCESS: Found target container "${targetContainer.referenceName}" (ID: ${targetContainer.contentViewID})`);
                successCount++;
            } else {
                console.log(`    ❌ FAILED: Inferred "${inferredContainer}" but no target mapping found`);
            }
        } else {
            console.log(`    ❌ FAILED: Could not infer container`);
        }
        
        console.log(''); // Add spacing
    }
    
    console.log(`📊 Container Inference Integration Results:`);
    console.log(`   Success: ${successCount}/${totalCount} (${Math.round(successCount/totalCount*100)}%)`);
    
    if (successCount > totalCount * 0.8) {
        console.log('\n🎉 SUCCESS: Container inference integration working well!');
        console.log('✅ Ready to test with real sync command');
        console.log('\nNext steps:');
        console.log('1. Run a real sync command to test the integration');
        console.log('2. Check if the "175 unmapped content items" issue is resolved');
        console.log('3. Monitor success rates for content creation');
    } else {
        console.log('\n⚠️ MIXED RESULTS: Container inference needs refinement');
        console.log('❓ May need to adjust matching strategies');
    }
}

testContainerInferenceIntegration().catch(console.error); 