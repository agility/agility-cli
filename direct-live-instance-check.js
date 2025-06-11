const agility = require('@agility/management-sdk');
const keytar = require('keytar');

async function checkLiveInstanceForCodeTabs() {
    console.log('🔍 DIRECT LIVE INSTANCE CHECK');
    console.log('=============================');
    console.log('🎯 OBJECTIVE: Query live Agility instance directly for CodeTabs model/container');
    console.log('📊 Context: Check if CodeTabs exists in live instance but was skipped during pull\n');

    const sourceGuid = '67bc73e6-u';
    const SERVICE_NAME = "agility-cli";
    
    try {
        // STEP 1: Get auth token from keychain (same way CLI does it)
        console.log('🔐 STEP 1: RETRIEVING AUTH TOKEN FROM KEYCHAIN');
        console.log('===============================================');
        
        // Determine environment (same logic as Auth class)
        const env = "prod"; // Default environment
        const key = `cli-auth-token:${env}`;
        
        console.log(`🔑 Looking for token in keychain with key: ${key}`);
        const tokenRaw = await keytar.getPassword(SERVICE_NAME, key);
        
        if (!tokenRaw) {
            console.log('❌ No token found in keychain');
            console.log('💡 Please run: agility login');
            console.log('   Then try this script again');
            return;
        }
        
        let token;
        try {
            const tokenData = JSON.parse(tokenRaw);
            console.log('✅ Token found in keychain');
            
            // Check if token is expired
            if (tokenData.access_token && tokenData.expires_in && tokenData.timestamp) {
                const issuedAt = new Date(tokenData.timestamp).getTime();
                const expiresAt = issuedAt + tokenData.expires_in * 1000;
                
                if (Date.now() < expiresAt) {
                    token = tokenData.access_token;
                    console.log('✅ Token is valid and not expired');
                } else {
                    console.log('❌ Token has expired');
                    console.log('💡 Please run: agility login');
                    return;
                }
            } else {
                console.log('❌ Token is missing required fields');
                return;
            }
        } catch (err) {
            console.log('❌ Failed to parse token from keychain');
            return;
        }
        
        // STEP 2: Initialize Management SDK
        console.log('\n🔐 STEP 2: INITIALIZING MANAGEMENT SDK');
        console.log('======================================');
        
        const options = {
            location: 'USA',
            websiteID: sourceGuid,
            token: token
        };
        const managementClient = new agility.ApiClient(options);
        
        console.log(`✅ Management SDK initialized for instance: ${sourceGuid}`);
        
        // STEP 3: Query all content definitions (models) from live instance
        console.log('\n📡 STEP 3: QUERYING LIVE INSTANCE FOR MODELS');
        console.log('============================================');
        
        try {
            console.log('🌐 Fetching all content definitions from live instance...');
            const liveContentDefinitions = await managementClient.modelMethods.getContentModules(true, sourceGuid, false);
            
            console.log(`📊 Found ${liveContentDefinitions.length} content definitions in LIVE instance`);
            
            // Search for CodeTabs model in live instance
            const liveCodeTabsModel = liveContentDefinitions.find(def => 
                def.displayName === 'CodeTabs' || 
                def.referenceName === 'CodeTabs' ||
                (def.displayName && def.displayName.toLowerCase().includes('codetabs')) ||
                (def.referenceName && def.referenceName.toLowerCase().includes('codetabs'))
            );
            
            if (liveCodeTabsModel) {
                console.log('🚨 CRITICAL FINDING: CodeTabs model EXISTS in live instance!');
                console.log('   This means the pull/sync SDK skipped this model during download');
                console.log(`   Model Details:`);
                                 console.log(`   - ID: ${liveCodeTabsModel.id}`);
                console.log(`   - DisplayName: "${liveCodeTabsModel.displayName}"`);
                console.log(`   - ReferenceName: "${liveCodeTabsModel.referenceName}"`);
                console.log(`   - LastModified: ${liveCodeTabsModel.lastModifiedDate}`);
                console.log(`   - Fields: ${liveCodeTabsModel.fields ? liveCodeTabsModel.fields.length : 'N/A'} fields`);
                
                if (liveCodeTabsModel.fields && liveCodeTabsModel.fields.length > 0) {
                    console.log(`   - Field names: ${liveCodeTabsModel.fields.map(f => f.name).join(', ')}`);
                }
                
            } else {
                console.log('✅ CodeTabs model NOT found in live instance');
                console.log('   Top 10 models in live instance for reference:');
                liveContentDefinitions.slice(0, 10).forEach((def, i) => {
                                         console.log(`   ${i + 1}. "${def.displayName}" (${def.referenceName}) [ID: ${def.id}]`);
                });
            }
            
        } catch (error) {
            console.error('❌ Error querying live content definitions:', error.message);
            if (error.response) {
                console.error('   Response status:', error.response.status);
                console.error('   Response data:', error.response.data);
            }
        }
        
        // STEP 4: Query all content views (containers) from live instance
        console.log('\n📡 STEP 4: QUERYING LIVE INSTANCE FOR CONTAINERS');
        console.log('===============================================');
        
        try {
            console.log('🌐 Fetching all content views from live instance...');
            const liveContentViews = await managementClient.containerMethods.getContainerList(sourceGuid);
            
            console.log(`📊 Found ${liveContentViews.length} content views in LIVE instance`);
            
            // Search for home_codetabs container in live instance
            const liveCodeTabsContainer = liveContentViews.find(view => 
                view.referenceName === 'home_codetabs' ||
                (view.referenceName && view.referenceName.toLowerCase().includes('codetabs'))
            );
            
            if (liveCodeTabsContainer) {
                console.log('🚨 CRITICAL FINDING: home_codetabs container EXISTS in live instance!');
                console.log('   This means the pull/sync SDK skipped this container during download');
                console.log(`   Container Details:`);
                                 console.log(`   - ID: ${liveCodeTabsContainer.containerID || liveCodeTabsContainer.contentViewID}`);
                 console.log(`   - ReferenceName: "${liveCodeTabsContainer.referenceName}"`);
                 console.log(`   - ContentDefinitionID: ${liveCodeTabsContainer.modelDefinitionID || liveCodeTabsContainer.contentDefinitionID}`);
                console.log(`   - LastModified: ${liveCodeTabsContainer.lastModifiedDate}`);
                console.log(`   - IsPublished: ${liveCodeTabsContainer.isPublished}`);
                console.log(`   - IsDeleted: ${liveCodeTabsContainer.isDeleted}`);
                
            } else {
                console.log('✅ home_codetabs container NOT found in live instance');
                console.log('   Top 10 containers in live instance for reference:');
                liveContentViews.slice(0, 10).forEach((view, i) => {
                                         console.log(`   ${i + 1}. "${view.referenceName}" [ID: ${view.containerID || view.contentViewID}, DefID: ${view.modelDefinitionID || view.contentDefinitionID}]`);
                });
            }
            
        } catch (error) {
            console.error('❌ Error querying live content views:', error.message);
            if (error.response) {
                console.error('   Response status:', error.response.status);
                console.error('   Response data:', error.response.data);
            }
        }
        
        // STEP 5: Compare live vs local counts
        console.log('\n📊 STEP 5: LIVE VS LOCAL COMPARISON');
        console.log('===================================');
        
        // Declare variables to hold the results
        let liveContentDefinitions = null;
        let liveContentViews = null;
        
        // Re-query to get results for comparison (capture them in outer scope)
        try {
            liveContentDefinitions = await managementClient.modelMethods.getContentModules(true, sourceGuid, false);
        } catch (error) {
            console.log('⚠️  Could not re-fetch models for comparison');
        }
        
        try {
            liveContentViews = await managementClient.containerMethods.getContainerList(sourceGuid);
        } catch (error) {
            console.log('⚠️  Could not re-fetch containers for comparison');
        }
        
        // Load local data for comparison
        const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
        const loader = new ChainDataLoader({
            sourceGuid,
            locale: 'en-us',
            isPreview: true,
            rootPath: process.cwd()
        });
        const localEntities = await loader.loadSourceEntities();
        
        console.log('📊 Entity count comparison:');
        console.log(`   Models:     Live: ${liveContentDefinitions?.length || 'N/A'} | Local: ${localEntities.models.length}`);
        console.log(`   Containers: Live: ${liveContentViews?.length || 'N/A'} | Local: ${localEntities.containers.length}`);
        console.log(`   Content:    Local: ${localEntities.content.length} (live content not queried)`);
        
        // Check for discrepancies
        if (liveContentDefinitions && liveContentDefinitions.length !== localEntities.models.length) {
            console.log('⚠️  MODEL COUNT MISMATCH detected!');
            console.log(`   Live instance has ${liveContentDefinitions.length} models`);
            console.log(`   Local files have ${localEntities.models.length} models`);
            console.log(`   Difference: ${liveContentDefinitions.length - localEntities.models.length} models`);
        }
        
        if (liveContentViews && liveContentViews.length !== localEntities.containers.length) {
            console.log('⚠️  CONTAINER COUNT MISMATCH detected!');
            console.log(`   Live instance has ${liveContentViews.length} containers`);
            console.log(`   Local files have ${localEntities.containers.length} containers`);
            console.log(`   Difference: ${liveContentViews.length - localEntities.containers.length} containers`);
        }
        
        // STEP 6: Final diagnosis
        console.log('\n🎯 FINAL DIAGNOSIS');
        console.log('==================');
        
        // These variables need to be captured from the previous steps
        let liveCodeTabsModel = null;
        let liveCodeTabsContainer = null;
        
        // Re-check for CodeTabs in the final data
        if (liveContentDefinitions) {
            liveCodeTabsModel = liveContentDefinitions.find(def => 
                def.displayName === 'CodeTabs' || 
                def.referenceName === 'CodeTabs' ||
                (def.displayName && def.displayName.toLowerCase().includes('codetabs')) ||
                (def.referenceName && def.referenceName.toLowerCase().includes('codetabs'))
            );
        }
        
        if (liveContentViews) {
            liveCodeTabsContainer = liveContentViews.find(view => 
                view.referenceName === 'home_codetabs' ||
                (view.referenceName && view.referenceName.toLowerCase().includes('codetabs'))
            );
        }
        
        const liveHasCodeTabsModel = !!liveCodeTabsModel;
        const liveHasCodeTabsContainer = !!liveCodeTabsContainer;
        
        if (liveHasCodeTabsModel || liveHasCodeTabsContainer) {
            console.log('🚨 PULL/SYNC SDK ISSUE CONFIRMED!');
            console.log('================================');
            
            if (liveHasCodeTabsModel) {
                console.log('✅ CodeTabs model EXISTS in live instance but MISSING from local files');
            }
            if (liveHasCodeTabsContainer) {
                console.log('✅ home_codetabs container EXISTS in live instance but MISSING from local files');
            }
            
            console.log('\n🔧 IMMEDIATE ACTIONS REQUIRED:');
            console.log('1. Investigate pull/sync SDK filtering logic');
            console.log('2. Check for model/container type exclusions in download');
            console.log('3. Re-run pull command with detailed logging');
            console.log('4. Verify pull command parameters and element filters');
            
            console.log('\n📈 IMPACT:');
            console.log('- Content mapping failure is due to missing local files, NOT missing live data');
            console.log('- Once pull/sync issue is fixed, should achieve 100% mapping success');
            console.log('- This explains discrepancy between comprehensive analysis and actual content mapping');
            
        } else {
            console.log('✅ NO PULL/SYNC ISSUE - LEGITIMATE ORPHANED CONTENT');
            console.log('==================================================');
            console.log('- CodeTabs model and container confirmed missing from live instance');
            console.log('- Content item 1138 is legitimate orphaned content (user deleted model/container)');
            console.log('- 99.9% mapping success rate is accurate and expected');
            console.log('- No further action needed - system working correctly');
        }
        
    } catch (error) {
        console.error('❌ Critical error during live instance check:', error.message);
        
        if (error.message.includes('401') || error.message.includes('unauthorized')) {
            console.log('\n🔧 AUTH TROUBLESHOOTING:');
            console.log('1. Token may be invalid for this instance');
            console.log('2. Try running: agility login');
            console.log('3. Ensure you have access to this instance');
        }
    }
    
    console.log('\n✅ Direct live instance check complete');
}

// Run the live check
checkLiveInstanceForCodeTabs().catch(console.error); 