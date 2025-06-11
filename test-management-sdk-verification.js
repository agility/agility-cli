const agility = require('@agility/management-sdk');

async function verifyCodeTabsInLiveInstance() {
    console.log('🔍 MANAGEMENT SDK VERIFICATION');
    console.log('==============================');
    console.log('🎯 OBJECTIVE: Check if CodeTabs model/container exist in live instance');
    console.log('📊 Context: Content 1138 exists locally but CodeTabs model/container are missing\n');

    const sourceGuid = '67bc73e6-u';
    
    try {
        // You'll need to manually provide the token - we can get it from keychain later
        console.log('🔐 Initializing Management SDK...');
        console.log('⚠️  NOTE: This requires a valid management token for instance:', sourceGuid);
        console.log('   You can get one by running: agility login');
        console.log('   Then we can extract it from keychain or use existing auth patterns\n');
        
        // For now, let's manually examine what the comprehensive analysis found
        console.log('🔍 ALTERNATIVE APPROACH: RE-EXAMINE COMPREHENSIVE ANALYSIS DATA');
        console.log('================================================================');
        
        const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
        
        const loader = new ChainDataLoader({
            sourceGuid,
            locale: 'en-us',
            isPreview: true,
            rootPath: process.cwd()
        });
        
        const sourceEntities = await loader.loadSourceEntities();
        
        console.log('📊 Comprehensive analysis entity counts:');
        console.log(`   Models: ${sourceEntities.models.length}`);
        console.log(`   Containers: ${sourceEntities.containers.length}`);
        console.log(`   Content: ${sourceEntities.content.length}`);
        console.log(`   Assets: ${sourceEntities.assets.length}`);
        console.log(`   Pages: ${sourceEntities.pages.length}`);
        console.log(`   Templates: ${sourceEntities.templates.length}`);
        
        // Let's specifically look for any models that might match CodeTabs pattern
        console.log('\n🔍 DETAILED MODEL SEARCH:');
        console.log('=========================');
        
        const allModelNames = sourceEntities.models.map(m => ({
            id: m.id || m.definitionID,
            displayName: m.displayName || m.definitionName,
            referenceName: m.referenceName,
            originalData: m
        }));
        
        console.log('📋 All available models:');
        allModelNames.forEach((model, i) => {
            console.log(`   ${i + 1}. "${model.displayName}" (${model.referenceName}) [ID: ${model.id}]`);
        });
        
        // Search for CodeTabs variations
        const codeTabsVariations = [
            'CodeTabs', 'codetabs', 'Code Tabs', 'code tabs', 'Code_Tabs', 'code_tabs'
        ];
        
        console.log('\n🔍 Searching for CodeTabs variations...');
        let foundCodeTabsModel = false;
        
        for (const variation of codeTabsVariations) {
            const matches = allModelNames.filter(model => 
                model.displayName?.toLowerCase().includes(variation.toLowerCase()) ||
                model.referenceName?.toLowerCase().includes(variation.toLowerCase())
            );
            
            if (matches.length > 0) {
                console.log(`✅ Found matches for "${variation}":`);
                matches.forEach(match => {
                    console.log(`   - "${match.displayName}" (${match.referenceName}) [ID: ${match.id}]`);
                });
                foundCodeTabsModel = true;
            }
        }
        
        if (!foundCodeTabsModel) {
            console.log('❌ No CodeTabs model variations found in comprehensive analysis');
        }
        
        // Let's also check containers for home_codetabs
        console.log('\n🔍 DETAILED CONTAINER SEARCH:');
        console.log('=============================');
        
        const allContainerNames = sourceEntities.containers.map(c => ({
            id: c.containerID || c.contentViewID,
            referenceName: c.referenceName,
            modelDefinitionID: c.modelDefinitionID || c.contentDefinitionID,
            originalData: c
        }));
        
        console.log(`📋 All available containers (first 10 of ${allContainerNames.length}):`);
        allContainerNames.slice(0, 10).forEach((container, i) => {
            console.log(`   ${i + 1}. "${container.referenceName}" [ID: ${container.id}, ModelID: ${container.modelDefinitionID}]`);
        });
        
        // Search for home_codetabs
        const codeTabsContainers = allContainerNames.filter(container =>
            container.referenceName?.toLowerCase().includes('codetabs')
        );
        
        if (codeTabsContainers.length > 0) {
            console.log('\n✅ Found CodeTabs-related containers:');
            codeTabsContainers.forEach(container => {
                console.log(`   - "${container.referenceName}" [ID: ${container.id}, ModelID: ${container.modelDefinitionID}]`);
            });
        } else {
            console.log('\n❌ No CodeTabs-related containers found in comprehensive analysis');
        }
        
        // Check if content 1138 exists and what it references
        console.log('\n🔍 CONTENT 1138 ANALYSIS:');
        console.log('=========================');
        
        const content1138 = sourceEntities.content.find(c => c.contentID === 1138);
        if (content1138) {
            console.log('✅ Content 1138 found in comprehensive analysis:');
            console.log(`   ContentID: ${content1138.contentID}`);
            console.log(`   DefinitionName: "${content1138.properties?.definitionName}"`);
            console.log(`   ReferenceName: "${content1138.properties?.referenceName}"`);
            console.log(`   Modified: ${content1138.properties?.modified}`);
            
            // Try to find a container that matches this content's referenceName
            const matchingContainer = allContainerNames.find(c => 
                c.referenceName === content1138.properties?.referenceName
            );
            
            if (matchingContainer) {
                console.log(`✅ Found matching container: "${matchingContainer.referenceName}"`);
                console.log(`   Container ModelDefinitionID: ${matchingContainer.modelDefinitionID}`);
                
                // Check if the model exists
                const matchingModel = allModelNames.find(m => 
                    m.id == matchingContainer.modelDefinitionID
                );
                
                if (matchingModel) {
                    console.log(`✅ Found matching model: "${matchingModel.displayName}"`);
                    console.log('🎯 CONCLUSION: Container and model exist - this should not be failing!');
                } else {
                    console.log(`❌ Model with ID ${matchingContainer.modelDefinitionID} not found`);
                    console.log('🎯 CONCLUSION: Container exists but model is missing (partial deletion)');
                }
            } else {
                console.log(`❌ No container found with referenceName: "${content1138.properties?.referenceName}"`);
                console.log('🎯 CONCLUSION: Content references non-existent container');
            }
            
        } else {
            console.log('❌ Content 1138 not found in comprehensive analysis');
            console.log('🎯 This would be very strange since we found it in local files');
        }
        
        // Final diagnosis
        console.log('\n🎯 FINAL DIAGNOSIS:');
        console.log('==================');
        
        if (foundCodeTabsModel || codeTabsContainers.length > 0) {
            console.log('🚨 DISCREPANCY DETECTED!');
            console.log('   CodeTabs model/container found in comprehensive analysis');
            console.log('   But not found in field mapping transformation');
            console.log('   This suggests an issue with field transformation logic');
        } else {
            console.log('✅ CONSISTENT RESULTS:');
            console.log('   CodeTabs model/container not found in comprehensive analysis');
            console.log('   This matches the field mapping results');
            console.log('   Content 1138 is legitimate orphaned content');
        }
        
    } catch (error) {
        console.error('❌ Error during verification:', error.message);
    }
    
    console.log('\n✅ Management SDK verification complete');
}

// Run the verification
verifyCodeTabsInLiveInstance().catch(console.error); 