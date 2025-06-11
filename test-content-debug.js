/**
 * Content Creation Debug Test
 * 
 * Focused test to debug content creation issues without running full sync
 */

const path = require('path');
const fs = require('fs');

// Import our modules
const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { BatchContentItemPusher } = require('./dist/lib/pushers/batch-content-item-pusher');
const { ReferenceMapper } = require('./dist/lib/mapper');
const mgmtApi = require('@agility/management-sdk');

async function debugContentCreation() {
    console.log('🧪 Starting Content Creation Debug Test...\n');

    // 1. Load source data
    console.log('📥 Loading source data...');
    const loader = new ChainDataLoader({
        sourceGuid: '67bc73e6-u',
        locale: 'en-us',
        isPreview: true,
        rootPath: process.cwd(),
        elements: ['Models', 'Containers', 'Content']
    });

    const sourceData = await loader.loadSourceEntities();
    console.log(`✅ Loaded: ${sourceData.models?.length || 0} models, ${sourceData.containers?.length || 0} containers, ${sourceData.content?.length || 0} content items\n`);

    // 2. Investigate content-to-container relationships
    console.log('🔍 Investigating content-to-container relationships...');
    
    // Check if some content items from /list/ have container IDs
    const contentWithContainers = sourceData.content.filter(c => c.contentViewID !== undefined);
    const contentWithoutContainers = sourceData.content.filter(c => c.contentViewID === undefined);
    
    console.log(`📊 Content with containers: ${contentWithContainers.length}`);
    console.log(`📊 Content without containers: ${contentWithoutContainers.length}\n`);
    
    if (contentWithContainers.length > 0) {
        console.log('✅ Found content items WITH container IDs:');
        contentWithContainers.slice(0, 5).forEach(item => {
            console.log(`  - ${item.properties?.referenceName} (ID: ${item.contentID}) → Container: ${item.contentViewID}`);
        });
        console.log('');
    }
    
    // Check for patterns in reference names
    console.log('🔍 Analyzing reference name patterns...');
    const sampleContent = sourceData.content.slice(0, 10);
    const sampleContainers = sourceData.containers.slice(0, 10);
    
    console.log('📝 Sample content reference names:');
    sampleContent.forEach(item => {
        console.log(`  - ${item.properties?.referenceName} (${item.properties?.definitionName})`);
    });
    
    console.log('\n📦 Sample container reference names:');
    sampleContainers.forEach(container => {
        console.log(`  - ${container.referenceName} (Model ID: ${container.contentDefinitionID})`);
    });
    
    // Look for potential matches
    console.log('\n🔗 Looking for potential content-container matches...');
    for (const contentItem of sampleContent) {
        const contentRef = contentItem.properties?.referenceName || '';
        const potentialContainers = sourceData.containers.filter(c => 
            c.referenceName.toLowerCase().includes(contentRef.toLowerCase()) ||
            contentRef.toLowerCase().includes(c.referenceName.toLowerCase())
        );
        
        if (potentialContainers.length > 0) {
            console.log(`  🎯 "${contentRef}" might match:`);
            potentialContainers.forEach(container => {
                console.log(`    - Container: ${container.referenceName} (ID: ${container.contentViewID})`);
            });
        }
    }

    // 3. Initialize reference mapper
    console.log('\n🗺️ Initializing reference mapper...');
    const referenceMapper = new ReferenceMapper('90c39c80-u', 'en-us', true, process.cwd());
    
    // Add some test model mappings (simulate what would be there after model sync)
    if (sourceData.models) {
        sourceData.models.slice(0, 10).forEach(model => {
            const fakeTargetId = 900 + (model.id || 0); // Create fake but consistent target IDs
            console.log(`  Adding test model mapping: ${model.id} → ${fakeTargetId} (${model.displayName})`);
            referenceMapper.addRecord('model', model, { id: fakeTargetId, displayName: model.displayName });
        });
    }

    // Add some test container mappings  
    if (sourceData.containers) {
        sourceData.containers.slice(0, 10).forEach(container => {
            const fakeTargetId = 4000 + (container.contentViewID || 0);
            console.log(`  Adding test container mapping: ${container.contentViewID} → ${fakeTargetId} (${container.referenceName})`);
            referenceMapper.addRecord('container', container, { contentViewID: fakeTargetId, referenceName: container.referenceName });
        });
    }
    
    // 4. Test content that DOES have container IDs
    if (contentWithContainers.length > 0) {
        console.log('\n🧪 Testing content items that HAVE container IDs...');
        const testItem = contentWithContainers[0];
        console.log(`📝 Testing: ${testItem.properties?.referenceName} (ID: ${testItem.contentID})`);
        console.log(`  📦 Container ID: ${testItem.contentViewID}`);
        
        const containerMapping = referenceMapper.getContainerMappingById(testItem.contentViewID);
        console.log(`  🗺️ Container mapping: ${containerMapping ? `${testItem.contentViewID} → ${containerMapping.target?.contentViewID}` : 'NOT FOUND'}`);
        
        // Find the source container
        const sourceContainer = sourceData.containers?.find(c => c.contentViewID === testItem.contentViewID);
        if (sourceContainer) {
            console.log(`  📋 Source container: ${sourceContainer.referenceName} (Model ID: ${sourceContainer.contentDefinitionID})`);
            
            // Check model mapping
            const modelMapping = referenceMapper.getModelMappingById(sourceContainer.contentDefinitionID);
            console.log(`  🔗 Model mapping: ${modelMapping ? `${sourceContainer.contentDefinitionID} → ${modelMapping.target?.id}` : 'NOT FOUND'}`);
            
            if (containerMapping && modelMapping) {
                console.log(`  ✅ This content item should be creatable!`);
            } else {
                console.log(`  ❌ Missing mappings - would fail`);
            }
        }
    }

    console.log('\n🎯 Debug analysis completed!');
    console.log('\nKey findings:');
    console.log(`- Content items without containers: ${contentWithoutContainers.length}`);
    console.log(`- Content items with containers: ${contentWithContainers.length}`);
    console.log('\nNext steps:');
    console.log('1. Determine how to associate content items with containers');
    console.log('2. Either fix the data loading or implement container inference');
    console.log('3. Test content creation with proper container associations');
}

// Run the test
debugContentCreation().catch(console.error); 