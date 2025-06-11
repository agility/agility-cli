/**
 * Container Inference Test
 * 
 * Test script to implement and validate container inference logic
 */

const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { ReferenceMapper } = require('./dist/lib/mapper');

function inferContainerForContent(contentItem, containers) {
    const contentRef = contentItem.properties?.referenceName?.toLowerCase() || '';
    
    // Strategy 1: Exact match (case insensitive)
    let match = containers.find(c => 
        c.referenceName.toLowerCase() === contentRef
    );
    
    if (match) {
        return { container: match, confidence: 'exact', strategy: 'exact-match' };
    }
    
    // Strategy 2: Content name is contained in container name
    match = containers.find(c => 
        c.referenceName.toLowerCase().includes(contentRef)
    );
    
    if (match) {
        return { container: match, confidence: 'high', strategy: 'content-in-container' };
    }
    
    // Strategy 3: Container name is contained in content name  
    match = containers.find(c => 
        contentRef.includes(c.referenceName.toLowerCase())
    );
    
    if (match) {
        return { container: match, confidence: 'medium', strategy: 'container-in-content' };
    }
    
    // Strategy 4: Pattern matching (underscore separated)
    if (contentRef.includes('_')) {
        const contentParts = contentRef.split('_');
        const basePattern = contentParts[0];
        
        match = containers.find(c => 
            c.referenceName.toLowerCase().startsWith(basePattern.toLowerCase())
        );
        
        if (match) {
            return { container: match, confidence: 'medium', strategy: 'pattern-match' };
        }
    }
    
    return null;
}

async function testContainerInference() {
    console.log('🧪 Testing Container Inference Logic...\n');

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

    // Test inference on sample content
    console.log('🔍 Testing container inference...');
    const sampleContent = sourceData.content.slice(0, 20);
    
    let successCount = 0;
    let totalCount = 0;
    
    for (const contentItem of sampleContent) {
        totalCount++;
        const result = inferContainerForContent(contentItem, sourceData.containers);
        
        if (result) {
            successCount++;
            console.log(`✅ ${contentItem.properties?.referenceName}`);
            console.log(`   → Container: ${result.container.referenceName} (ID: ${result.container.contentViewID})`);
            console.log(`   → Model: ${result.container.contentDefinitionID}, Strategy: ${result.strategy}, Confidence: ${result.confidence}`);
        } else {
            console.log(`❌ ${contentItem.properties?.referenceName} - No container found`);
        }
    }
    
    console.log(`\n📊 Inference Results: ${successCount}/${totalCount} (${Math.round(successCount/totalCount*100)}% success rate)`);
    
    // Test with successful inferences
    if (successCount > 0) {
        console.log('\n🧪 Testing content creation workflow with inferred containers...');
        
        // Initialize reference mapper with test data
        const referenceMapper = new ReferenceMapper('90c39c80-u', 'en-us', true, process.cwd());
        
        // Add model mappings
        sourceData.models.forEach(model => {
            const fakeTargetId = 900 + (model.id || 0);
            referenceMapper.addRecord('model', model, { id: fakeTargetId, displayName: model.displayName });
        });
        
        // Add container mappings  
        sourceData.containers.forEach(container => {
            const fakeTargetId = 4000 + (container.contentViewID || 0);
            referenceMapper.addRecord('container', container, { contentViewID: fakeTargetId, referenceName: container.referenceName });
        });
        
        // Test a successful inference
        const testItem = sampleContent.find(item => inferContainerForContent(item, sourceData.containers));
        if (testItem) {
            const inference = inferContainerForContent(testItem, sourceData.containers);
            console.log(`\n📝 Testing: ${testItem.properties?.referenceName}`);
            console.log(`  📦 Inferred Container: ${inference.container.referenceName} (ID: ${inference.container.contentViewID})`);
            
            // Test mappings
            const containerMapping = referenceMapper.getContainerMappingById(inference.container.contentViewID);
            const modelMapping = referenceMapper.getModelMappingById(inference.container.contentDefinitionID);
            
            console.log(`  🗺️ Container mapping: ${containerMapping ? 'FOUND' : 'NOT FOUND'}`);
            console.log(`  🔗 Model mapping: ${modelMapping ? 'FOUND' : 'NOT FOUND'}`);
            
            if (containerMapping && modelMapping) {
                console.log(`  ✅ This content item would be creatable with inferred container!`);
                
                // Simulate the content creation payload
                const targetContainerID = containerMapping.target.contentViewID;
                console.log(`  🎯 Would create in target container: ${targetContainerID}`);
            } else {
                console.log(`  ❌ Missing mappings - would still fail`);
            }
        }
    }
    
    console.log('\n🎯 Container inference test completed!');
    console.log('\nConclusion:');
    if (successCount > totalCount * 0.8) {
        console.log('✅ Container inference logic works well - implement in main content pusher');
    } else if (successCount > totalCount * 0.5) {
        console.log('⚠️ Container inference needs improvement but shows promise');
    } else {
        console.log('❌ Container inference logic needs significant work');
    }
}

testContainerInference().catch(console.error); 