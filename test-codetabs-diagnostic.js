const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const fs = require('fs');
const path = require('path');

async function diagnoseCodeTabsIssue() {
    console.log('🔍 CODETABS DIAGNOSTIC INVESTIGATION');
    console.log('===================================');
    console.log('🎯 OBJECTIVE: Understand why CodeTabs content exists but model mapping fails');
    console.log('📊 Context: Comprehensive analysis shows 100% reconciliation, but mapping shows failure\n');

    const sourceGuid = '67bc73e6-u';
    const locale = 'en-us';
    
    // STEP 1: Load and analyze the problematic content
    console.log('🔍 STEP 1: ANALYZE PROBLEMATIC CONTENT');
    console.log('======================================');
    
    const contentPath = `agility-files/${sourceGuid}/${locale}/preview/item/1138.json`;
    const listPath = `agility-files/${sourceGuid}/${locale}/preview/list/home_codetabs.json`;
    
    console.log(`📄 Content file: ${contentPath}`);
    const contentData = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
    console.log('📊 Content structure:');
    console.log(`   ContentID: ${contentData.contentID}`);
    console.log(`   DefinitionName: "${contentData.properties.definitionName}"`);
    console.log(`   ReferenceName: "${contentData.properties.referenceName}"`);
    console.log(`   Modified: ${contentData.properties.modified}`);
    console.log(`   Fields: ${Object.keys(contentData.fields).join(', ')}`);
    
    console.log(`\n📄 List file: ${listPath}`);
    const listData = JSON.parse(fs.readFileSync(listPath, 'utf8'));
    console.log(`📊 List structure: Array with ${listData.length} items`);
    if (listData.length > 0) {
        console.log(`   First item definitionName: "${listData[0].properties.definitionName}"`);
        console.log(`   First item referenceName: "${listData[0].properties.referenceName}"`);
    }
    
    // STEP 2: Search for any trace of CodeTabs model or container
    console.log('\n🔍 STEP 2: SEARCH FOR CODETABS TRACES');
    console.log('====================================');
    
    // Search all model files
    const modelsDir = `agility-files/${sourceGuid}/${locale}/preview/models`;
    const modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.json'));
    
    console.log(`📁 Searching ${modelFiles.length} model files for CodeTabs...`);
    let codeTabsModelFound = false;
    let codeTabsModelData = null;
    
    for (const modelFile of modelFiles) {
        const modelPath = path.join(modelsDir, modelFile);
        const modelData = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
        
        if (modelData.displayName === 'CodeTabs' || 
            modelData.referenceName === 'CodeTabs' ||
            (modelData.displayName && modelData.displayName.toLowerCase().includes('codetabs')) ||
            (modelData.referenceName && modelData.referenceName.toLowerCase().includes('codetabs'))) {
            
            console.log(`   ✅ Found CodeTabs model in ${modelFile}`);
            console.log(`      DisplayName: "${modelData.displayName}"`);
            console.log(`      ReferenceName: "${modelData.referenceName}"`);
            console.log(`      ID: ${modelData.id}`);
            codeTabsModelFound = true;
            codeTabsModelData = modelData;
            break;
        }
    }
    
    if (!codeTabsModelFound) {
        console.log('   ❌ No CodeTabs model found in models directory');
    }
    
    // Search all container files
    const containersDir = `agility-files/${sourceGuid}/${locale}/preview/containers`;
    const containerFiles = fs.readdirSync(containersDir).filter(f => f.endsWith('.json'));
    
    console.log(`\n📁 Searching ${containerFiles.length} container files for home_codetabs...`);
    let codeTabsContainerFound = false;
    let codeTabsContainerData = null;
    
    for (const containerFile of containerFiles) {
        const containerPath = path.join(containersDir, containerFile);
        const containerData = JSON.parse(fs.readFileSync(containerPath, 'utf8'));
        
        if (containerData.referenceName === 'home_codetabs' ||
            containerFile.includes('codetabs') ||
            containerFile.includes('CodeTabs')) {
            
            console.log(`   ✅ Found CodeTabs container in ${containerFile}`);
            console.log(`      ReferenceName: "${containerData.referenceName}"`);
            console.log(`      ContentDefinitionID: ${containerData.contentDefinitionID}`);
            console.log(`      ContentViewID: ${containerData.contentViewID}`);
            codeTabsContainerFound = true;
            codeTabsContainerData = containerData;
            break;
        }
    }
    
    if (!codeTabsContainerFound) {
        console.log('   ❌ No home_codetabs container found in containers directory');
    }
    
    // STEP 3: Load source data using ChainDataLoader to see what it captures
    console.log('\n🔍 STEP 3: COMPARE WITH CHAIN DATA LOADER');
    console.log('==========================================');
    
    const loader = new ChainDataLoader({
        sourceGuid,
        locale,
        isPreview: true,
        rootPath: process.cwd()
    });
    
    const sourceEntities = await loader.loadSourceEntities();
    
    console.log(`📊 ChainDataLoader results:`);
    console.log(`   Models loaded: ${sourceEntities.models.length}`);
    console.log(`   Containers loaded: ${sourceEntities.containers.length}`);
    console.log(`   Content loaded: ${sourceEntities.content.length}`);
    
    // Check if CodeTabs model is in loaded models
    const codeTabsInModels = sourceEntities.models.find(m => 
        m.displayName === 'CodeTabs' || 
        m.referenceName === 'CodeTabs' ||
        (m.displayName && m.displayName.toLowerCase().includes('codetabs'))
    );
    
    console.log(`   CodeTabs in loaded models: ${codeTabsInModels ? 'YES' : 'NO'}`);
    if (codeTabsInModels) {
        console.log(`      ID: ${codeTabsInModels.id}`);
        console.log(`      DisplayName: "${codeTabsInModels.displayName}"`);
        console.log(`      ReferenceName: "${codeTabsInModels.referenceName}"`);
    }
    
    // Check if home_codetabs container is in loaded containers
    const codeTabsInContainers = sourceEntities.containers.find(c => 
        c.referenceName === 'home_codetabs'
    );
    
    console.log(`   home_codetabs in loaded containers: ${codeTabsInContainers ? 'YES' : 'NO'}`);
    if (codeTabsInContainers) {
        console.log(`      ContainerID: ${codeTabsInContainers.containerID || codeTabsInContainers.contentViewID}`);
        console.log(`      ModelDefinitionID: ${codeTabsInContainers.modelDefinitionID || codeTabsInContainers.contentDefinitionID}`);
        console.log(`      ReferenceName: "${codeTabsInContainers.referenceName}"`);
    }
    
    // Check if content 1138 is in loaded content
    const content1138 = sourceEntities.content.find(c => c.contentID === 1138);
    console.log(`   Content 1138 in loaded content: ${content1138 ? 'YES' : 'NO'}`);
    if (content1138) {
        console.log(`      DefinitionName: "${content1138.properties?.definitionName}"`);
        console.log(`      ReferenceName: "${content1138.properties?.referenceName}"`);
    }
    
    // STEP 4: Diagnose the discrepancy
    console.log('\n🧠 STEP 4: DISCREPANCY ANALYSIS');
    console.log('===============================');
    
    if (codeTabsModelFound && !codeTabsInModels) {
        console.log('⚠️  DISCREPANCY: CodeTabs model exists in files but not loaded by ChainDataLoader');
        console.log('    Possible causes:');
        console.log('    - Model file format issue');
        console.log('    - ChainDataLoader filtering issue'); 
        console.log('    - File path or naming issue');
    }
    
    if (codeTabsContainerFound && !codeTabsInContainers) {
        console.log('⚠️  DISCREPANCY: home_codetabs container exists in files but not loaded by ChainDataLoader');
        console.log('    Possible causes:');
        console.log('    - Container file format issue');
        console.log('    - ChainDataLoader filtering issue');
        console.log('    - File path or naming issue');
    }
    
    if (!codeTabsModelFound && !codeTabsContainerFound) {
        console.log('✅ EXPECTED: CodeTabs model and container truly missing - this is legitimate orphaned content');
        console.log('   Content 1138 references a deleted model/container pair');
        console.log('   This should be reported as "will be skipped" rather than a system error');
    }
    
    if (codeTabsInContainers && !codeTabsInModels) {
        console.log('⚠️  PARTIAL DISCREPANCY: Container exists but model missing');
        console.log('   This suggests the model was deleted but container remains');
        console.log(`   Container modelDefinitionID: ${codeTabsInContainers.modelDefinitionID || codeTabsInContainers.contentDefinitionID}`);
        
        // Check if model with that ID exists
        const modelById = sourceEntities.models.find(m => 
            m.id === (codeTabsInContainers.modelDefinitionID || codeTabsInContainers.contentDefinitionID)
        );
        
        console.log(`   Model with ID ${codeTabsInContainers.modelDefinitionID || codeTabsInContainers.contentDefinitionID} exists: ${modelById ? 'YES' : 'NO'}`);
        if (modelById) {
            console.log(`      Model name: "${modelById.displayName || modelById.referenceName}"`);
        }
    }
    
    // STEP 5: Final diagnosis
    console.log('\n🎯 FINAL DIAGNOSIS');
    console.log('==================');
    
    if (codeTabsModelFound || codeTabsContainerFound) {
        console.log('⚡ ACTION REQUIRED: Data inconsistency detected');
        console.log('   The comprehensive analysis may be missing this model/container due to loading logic');
        console.log('   This explains the discrepancy between 100% reconciliation and mapping failure');
    } else {
        console.log('✅ CONCLUSION: Legitimate orphaned content detected');
        console.log('   Content 1138 references "CodeTabs" model that was deleted');
        console.log('   This is expected behavior and should be reported as "will be skipped"');
        console.log('   The 0.1% failure rate is accurate and acceptable');
    }
    
    console.log('\n✅ CodeTabs diagnostic investigation complete');
}

// Run the diagnostic
diagnoseCodeTabsIssue().catch(console.error); 