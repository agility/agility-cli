const agility = require('@agility/management-sdk');
const { Auth } = require('./dist/lib/services/auth');

async function verifyLiveInstanceData() {
    console.log('🔍 LIVE INSTANCE VERIFICATION');
    console.log('=============================');
    console.log('🎯 OBJECTIVE: Check if CodeTabs model/container exist in live instance but were skipped during pull');
    console.log('📊 Context: Content 1138 exists locally but CodeTabs model/container are missing\n');

    const sourceGuid = '67bc73e6-u';
    const locale = 'en-us';
    
    try {
        // STEP 1: Initialize Management SDK with auth
        console.log('🔐 STEP 1: AUTHENTICATING WITH MANAGEMENT SDK');
        console.log('==============================================');
        
        const authService = new Auth();
        const token = await authService.getToken();
        
        if (!token) {
            throw new Error('Failed to get management token');
        }
        
        console.log('✅ Authentication successful');
        
        // Initialize Management SDK
        const managementClient = agility.getApi({
            location: 'USA',
            websiteID: sourceGuid,
            token: token
        });
        
        console.log(`✅ Management SDK initialized for instance: ${sourceGuid}`);
        
        // STEP 2: Query for CodeTabs model directly
        console.log('\n🔍 STEP 2: QUERY FOR CODETABS MODEL');
        console.log('===================================');
        
        try {
            // Get all content definitions (models)
            console.log('📡 Fetching all content definitions from live instance...');
            const contentDefinitions = await managementClient.contentDefinitions.list();
            
            console.log(`📊 Found ${contentDefinitions.length} content definitions in live instance`);
            
            // Search for CodeTabs model
            const codeTabsModel = contentDefinitions.find(def => 
                def.displayName === 'CodeTabs' || 
                def.referenceName === 'CodeTabs' ||
                (def.displayName && def.displayName.toLowerCase().includes('codetabs')) ||
                (def.referenceName && def.referenceName.toLowerCase().includes('codetabs'))
            );
            
            if (codeTabsModel) {
                console.log('✅ FOUND: CodeTabs model exists in live instance!');
                console.log(`   ID: ${codeTabsModel.contentDefinitionID}`);
                console.log(`   DisplayName: "${codeTabsModel.displayName}"`);
                console.log(`   ReferenceName: "${codeTabsModel.referenceName}"`);
                console.log(`   LastModified: ${codeTabsModel.lastModifiedDate}`);
                console.log(`   Fields: ${codeTabsModel.fields ? codeTabsModel.fields.length : 'N/A'} fields`);
                
                if (codeTabsModel.fields && codeTabsModel.fields.length > 0) {
                    console.log('   Field names: ' + codeTabsModel.fields.map(f => f.name).join(', '));
                }
                
                console.log('🚨 ISSUE DETECTED: CodeTabs model exists in live instance but missing from local files!');
                console.log('   This indicates a pull/sync SDK issue where this model was skipped');
                
            } else {
                console.log('❌ CodeTabs model not found in live instance');
                console.log('   Top 10 model names for reference:');
                contentDefinitions.slice(0, 10).forEach(def => {
                    console.log(`   - "${def.displayName}" (${def.referenceName})`);
                });
            }
            
        } catch (error) {
            console.error('❌ Error querying content definitions:', error.message);
        }
        
        // STEP 3: Query for home_codetabs container directly  
        console.log('\n🔍 STEP 3: QUERY FOR HOME_CODETABS CONTAINER');
        console.log('============================================');
        
        try {
            // Get all content views (containers)
            console.log('📡 Fetching all content views from live instance...');
            const contentViews = await managementClient.contentViews.list();
            
            console.log(`📊 Found ${contentViews.length} content views in live instance`);
            
            // Search for home_codetabs container
            const codeTabsContainer = contentViews.find(view => 
                view.referenceName === 'home_codetabs' ||
                (view.referenceName && view.referenceName.toLowerCase().includes('codetabs'))
            );
            
            if (codeTabsContainer) {
                console.log('✅ FOUND: home_codetabs container exists in live instance!');
                console.log(`   ID: ${codeTabsContainer.contentViewID}`);
                console.log(`   ReferenceName: "${codeTabsContainer.referenceName}"`);
                console.log(`   ContentDefinitionID: ${codeTabsContainer.contentDefinitionID}`);
                console.log(`   LastModified: ${codeTabsContainer.lastModifiedDate}`);
                console.log(`   IsPublished: ${codeTabsContainer.isPublished}`);
                console.log(`   IsDeleted: ${codeTabsContainer.isDeleted}`);
                
                console.log('🚨 ISSUE DETECTED: home_codetabs container exists in live instance but missing from local files!');
                console.log('   This indicates a pull/sync SDK issue where this container was skipped');
                
            } else {
                console.log('❌ home_codetabs container not found in live instance');
                console.log('   Top 10 container names for reference:');
                contentViews.slice(0, 10).forEach(view => {
                    console.log(`   - "${view.referenceName}" (DefID: ${view.contentDefinitionID})`);
                });
            }
            
        } catch (error) {
            console.error('❌ Error querying content views:', error.message);
        }
        
        // STEP 4: Query for content item 1138 to verify it exists
        console.log('\n🔍 STEP 4: VERIFY CONTENT ITEM 1138');
        console.log('===================================');
        
        try {
            // Try to get the specific content item
            console.log('📡 Fetching content item 1138 from live instance...');
            
            // We need to find which container this content belongs to first
            // Let's try to get content by searching through containers that might contain it
            let content1138Found = false;
            
            // If we found the container above, use it
            if (codeTabsContainer) {
                try {
                    const containerContent = await managementClient.contentItems.list({
                        contentViewID: codeTabsContainer.contentViewID,
                        locale: locale
                    });
                    
                    const content1138 = containerContent.find(item => item.contentID === 1138);
                    
                    if (content1138) {
                        console.log('✅ FOUND: Content item 1138 exists in live instance!');
                        console.log(`   ContentID: ${content1138.contentID}`);
                        console.log(`   State: ${content1138.properties.state}`);
                        console.log(`   Modified: ${content1138.properties.modified}`);
                        console.log(`   DefinitionName: "${content1138.properties.definitionName}"`);
                        console.log(`   ReferenceName: "${content1138.properties.referenceName}"`);
                        
                        if (content1138.fields) {
                            console.log(`   Fields: ${Object.keys(content1138.fields).join(', ')}`);
                        }
                        
                        content1138Found = true;
                    }
                } catch (error) {
                    console.log(`⚠️  Could not fetch content from container: ${error.message}`);
                }
            }
            
            if (!content1138Found) {
                console.log('❌ Content item 1138 not found or not accessible');
            }
            
        } catch (error) {
            console.error('❌ Error querying content item:', error.message);
        }
        
        // STEP 5: Summary and recommendations
        console.log('\n🎯 SUMMARY AND RECOMMENDATIONS');
        console.log('==============================');
        
        const modelExists = !!codeTabsModel;
        const containerExists = !!codeTabsContainer; 
        
        if (modelExists || containerExists) {
            console.log('🚨 PULL/SYNC SDK ISSUE CONFIRMED!');
            console.log('================================');
            
            if (modelExists) {
                console.log('✅ CodeTabs model EXISTS in live instance but MISSING from local files');
            }
            if (containerExists) {
                console.log('✅ home_codetabs container EXISTS in live instance but MISSING from local files');
            }
            
            console.log('\n🔧 RECOMMENDED ACTIONS:');
            console.log('1. Investigate pull/sync SDK filtering or download logic');
            console.log('2. Check if certain model types or containers are being skipped');
            console.log('3. Re-run pull command with verbose logging to identify skip reasons');
            console.log('4. Verify pull command parameters and filters');
            
            console.log('\n📊 IMPACT ON MAPPING:');
            console.log('- Content mapping failure is due to missing local files, not missing live data');
            console.log('- Once pull/sync issue is fixed, mapping should achieve 100% success');
            console.log('- This explains the discrepancy between comprehensive analysis and mapping results');
            
        } else {
            console.log('✅ NO PULL/SYNC ISSUE DETECTED');
            console.log('==============================');
            console.log('- CodeTabs model and container truly do not exist in live instance');
            console.log('- Content item 1138 is legitimate orphaned content');
            console.log('- 99.9% mapping success rate is accurate and expected');
        }
        
    } catch (error) {
        console.error('❌ Authentication or SDK initialization failed:', error.message);
        console.log('\n🔧 TROUBLESHOOTING:');
        console.log('1. Ensure auth token is valid for this instance');
        console.log('2. Check if instance GUID is correct');
        console.log('3. Verify Management SDK permissions');
    }
    
    console.log('\n✅ Live instance verification complete');
}

// Run the verification
verifyLiveInstanceData().catch(console.error); 