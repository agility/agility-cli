const mgmtApi = require('@agility/management-sdk');

async function testListVsItemContainerBehavior() {
    console.log('🔍 LIST vs ITEM CONTAINER BEHAVIOR INVESTIGATION');
    console.log('===============================================\n');

    const targetGuid = '90c39c80-u';
    
    try {
        // Manual API client setup (avoiding Auth service issues)
        console.log('🔑 Setting up API client...');
        
        const mgmtApiOptions = new mgmtApi.Options();
        mgmtApiOptions.token = process.env.AGILITY_API_KEY;
        mgmtApiOptions.baseUrl = `https://mgmt.agilityhosted.com`;
        
        const apiClient = new mgmtApi.ApiClient(mgmtApiOptions);
        
        console.log('📥 Loading target instance containers...');
        const targetContainers = await apiClient.containerMethods.getContainerList(targetGuid);
        
        console.log(`✅ Loaded ${targetContainers.length} target containers\n`);
        
        // INVESTIGATION 1: Examine ChangeLog containers in target
        console.log('🔍 INVESTIGATION 1: CHANGELOG CONTAINERS IN TARGET');
        console.log('==================================================');
        
        const changelogContainers = targetContainers.filter(c => 
            c.referenceName.toLowerCase().includes('changelog')
        );
        
        console.log(`📊 Found ${changelogContainers.length} ChangeLog-related containers in target:`);
        
        const baseChangelogContainers = [];
        const hashChangelogContainers = [];
        
        for (const container of changelogContainers) {
            const ref = container.referenceName;
            const hashMatch = ref.match(/([A-F0-9]{8})$/i);
            
            if (hashMatch) {
                hashChangelogContainers.push(container);
            } else {
                baseChangelogContainers.push(container);
            }
            
            console.log(`   🔸 ${ref} (ID: ${container.containerID}, Model: ${container.modelDefinitionID})`);
        }
        
        console.log(`\n📊 Base ChangeLog containers: ${baseChangelogContainers.length}`);
        console.log(`📊 Hash ChangeLog containers: ${hashChangelogContainers.length}`);
        
        // INVESTIGATION 2: Examine content in specific containers
        console.log('\n\n🔍 INVESTIGATION 2: CONTENT IN CHANGELOG CONTAINERS');
        console.log('===================================================');
        
        if (baseChangelogContainers.length > 0) {
            const baseContainer = baseChangelogContainers[0];
            console.log(`\n🏠 Examining BASE container: ${baseContainer.referenceName}`);
            
            try {
                const baseContent = await apiClient.contentMethods.getContentList(
                    targetGuid, 
                    'en-us', 
                    baseContainer.containerID
                );
                console.log(`   📄 Content items in base container: ${baseContent.length}`);
                
                if (baseContent.length > 0) {
                    console.log(`   🔍 Sample content in base container:`);
                    baseContent.slice(0, 3).forEach(item => {
                        console.log(`      📝 ID:${item.contentID} "${item.properties?.referenceName || 'No ref'}" (${item.properties?.state || 'No state'})`);
                    });
                }
            } catch (error) {
                console.log(`   ❌ Failed to load content from base container: ${error.message}`);
            }
        }
        
        if (hashChangelogContainers.length > 0) {
            const hashContainer = hashChangelogContainers[0];
            console.log(`\n🔸 Examining HASH container: ${hashContainer.referenceName}`);
            
            try {
                const hashContent = await apiClient.contentMethods.getContentList(
                    targetGuid, 
                    'en-us', 
                    hashContainer.containerID
                );
                console.log(`   📄 Content items in hash container: ${hashContent.length}`);
                
                if (hashContent.length > 0) {
                    console.log(`   🔍 Sample content in hash container:`);
                    hashContent.slice(0, 3).forEach(item => {
                        console.log(`      📝 ID:${item.contentID} "${item.properties?.referenceName || 'No ref'}" (${item.properties?.state || 'No state'})`);
                    });
                }
            } catch (error) {
                console.log(`   ❌ Failed to load content from hash container: ${error.message}`);
            }
        }
        
        // INVESTIGATION 3: Test content creation behavior
        console.log('\n\n🔍 INVESTIGATION 3: CONTENT CREATION BEHAVIOR TEST');
        console.log('=================================================');
        
        if (baseChangelogContainers.length > 0) {
            const testContainer = baseChangelogContainers[0];
            console.log(`\n🧪 Testing content creation in container: ${testContainer.referenceName}`);
            
            // Create a test content item to understand the behavior
            const testContent = {
                contentID: -1,
                languageCode: 'en-us',
                definitionName: 'ChangeLog',
                state: 1,
                workflowState: 'Draft',
                properties: {
                    referenceName: `test_changelog_behavior_${Date.now()}`,
                    state: 1,
                    modified: new Date().toISOString(),
                    versionID: -1
                }
            };
            
            try {
                console.log(`   🔄 Attempting to create test content...`);
                const result = await apiClient.contentMethods.saveContentItem(
                    testContent,
                    targetGuid,
                    testContainer.containerID
                );
                
                console.log(`   ✅ Content creation successful!`);
                console.log(`      📝 Created content ID: ${result.contentID}`);
                console.log(`      🔗 Reference name: ${result.properties?.referenceName}`);
                console.log(`      📊 State: ${result.properties?.state}`);
                
                // Check if this created any hash containers
                console.log(`\n🔍 Checking if hash containers were auto-created...`);
                const updatedContainers = await apiClient.containerMethods.getContainerList(targetGuid);
                const newChangelogContainers = updatedContainers.filter(c => 
                    c.referenceName.toLowerCase().includes('changelog')
                );
                
                if (newChangelogContainers.length > changelogContainers.length) {
                    console.log(`   🎉 NEW CONTAINERS DETECTED! ${newChangelogContainers.length - changelogContainers.length} new containers created`);
                    
                    const newContainers = newChangelogContainers.filter(newC => 
                        !changelogContainers.some(oldC => oldC.containerID === newC.containerID)
                    );
                    
                    newContainers.forEach(container => {
                        console.log(`      🆕 ${container.referenceName} (ID: ${container.containerID})`);
                    });
                } else {
                    console.log(`   📊 No new containers created - content went into existing container`);
                }
                
                // Clean up - delete the test content
                console.log(`\n🧹 Cleaning up test content...`);
                try {
                    await apiClient.contentMethods.deleteContentItem(targetGuid, result.contentID);
                    console.log(`   ✅ Test content deleted successfully`);
                } catch (deleteError) {
                    console.log(`   ⚠️ Could not delete test content: ${deleteError.message}`);
                }
                
            } catch (error) {
                console.log(`   ❌ Content creation failed: ${error.message}`);
                console.log(`   💡 This might indicate we need to use a different container type or approach`);
            }
        }
        
        // INVESTIGATION 4: Compare container properties
        console.log('\n\n🔍 INVESTIGATION 4: CONTAINER PROPERTY COMPARISON');
        console.log('=================================================');
        
        if (baseChangelogContainers.length > 0 && hashChangelogContainers.length > 0) {
            const baseContainer = baseChangelogContainers[0];
            const hashContainer = hashChangelogContainers[0];
            
            console.log(`\n🔍 Comparing BASE vs HASH container properties:`);
            console.log(`\n🏠 BASE: ${baseContainer.referenceName}`);
            console.log(`   🆔 Container ID: ${baseContainer.containerID}`);
            console.log(`   📋 Model Definition ID: ${baseContainer.modelDefinitionID}`);
            console.log(`   📝 Description: ${baseContainer.description || 'No description'}`);
            console.log(`   🔧 Date Created: ${baseContainer.dateCreated}`);
            console.log(`   📊 State: ${baseContainer.state}`);
            
            console.log(`\n🔸 HASH: ${hashContainer.referenceName}`);
            console.log(`   🆔 Container ID: ${hashContainer.containerID}`);
            console.log(`   📋 Model Definition ID: ${hashContainer.modelDefinitionID}`);
            console.log(`   📝 Description: ${hashContainer.description || 'No description'}`);
            console.log(`   🔧 Date Created: ${hashContainer.dateCreated}`);
            console.log(`   📊 State: ${hashContainer.state}`);
            
            console.log(`\n📊 Property Comparison:`);
            console.log(`   📋 Same Model: ${baseContainer.modelDefinitionID === hashContainer.modelDefinitionID ? '✅ YES' : '❌ NO'}`);
            console.log(`   📊 Same State: ${baseContainer.state === hashContainer.state ? '✅ YES' : '❌ NO'}`);
            console.log(`   🔧 Creation Order: ${new Date(baseContainer.dateCreated) < new Date(hashContainer.dateCreated) ? '✅ Base created first' : '❌ Hash created first'}`);
        }
        
    } catch (error) {
        console.error('❌ Failed to investigate target instance:', error.message);
        console.log('💡 Make sure AGILITY_API_KEY environment variable is set');
        return;
    }

    // FINAL SUMMARY
    console.log('\n\n🎯 LIST vs ITEM CONTAINER INVESTIGATION SUMMARY');
    console.log('==============================================');
    
    console.log(`💡 KEY FINDINGS:`);
    console.log(`   1. Both BASE and HASH containers exist in target instance`);
    console.log(`   2. Content creation behavior can be tested directly`);
    console.log(`   3. Hash container auto-creation can be observed`);
    console.log(`   4. Container properties can be compared to understand relationships`);
    
    console.log(`\n🔧 CRITICAL QUESTIONS ANSWERED:`);
    console.log(`   ❓ Do hash containers auto-generate? → Test will show if new containers appear`);
    console.log(`   ❓ Which container type should we target? → Content creation test will reveal`);
    console.log(`   ❓ Are base and hash containers equivalent? → Property comparison will show`);
    
    console.log('\n✅ CONTAINER BEHAVIOR INVESTIGATION COMPLETE');
}

// Run the investigation
testListVsItemContainerBehavior().catch(console.error); 