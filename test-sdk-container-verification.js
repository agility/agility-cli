const { agilityMgmt } = require('@agility/management-sdk');
const fs = require('fs');
const path = require('path');
const mgmtApi = require('@agility/management-sdk');

/**
 * SDK Container Verification Test
 * Tests if frequently missing containers actually exist in source instance
 */

async function testContainerExistence() {
    console.log('🔍 SDK CONTAINER VERIFICATION TEST');
    console.log('=====================================\n');

    // Most frequently missing containers from analysis
    const testContainerIds = [
        435, // missing in 20 content items
        412, // missing in 19 content items  
        433, // missing in 18 content items
        587, // missing in 18 content items
        859, // missing in 17 content items
        858, // missing in 11 content items
        422, // missing in 7 content items
        1177, // missing in 4 content items
        1003, // from sample content analysis
        1004  // from sample content analysis
    ];

    const sourceGuid = '67bc73e6-u';
    const locale = 'en-us';

    try {
        // Initialize Management SDK
        console.log(`📡 Connecting to source instance: ${sourceGuid}`);
        console.log(`🌍 Locale: ${locale}\n`);
        
        // Note: You'll need to provide the API key
        // For now, we'll simulate what the verification would look like
        console.log('⚠️  SDK Authentication needed - please provide API key for live testing');
        console.log('📋 CONTAINERS TO VERIFY:\n');

        const results = {
            found: [],
            missing: [],
            errors: []
        };

        for (const containerId of testContainerIds) {
            try {
                console.log(`🔍 Testing ContainerID:${containerId}...`);
                
                // TODO: Replace with actual SDK call when API key is available
                // const container = await mgmtClient.contentContainers.get(containerId);
                
                // For now, simulate the API call structure
                console.log(`   📞 Would call: managementClient.contentContainers.get(${containerId})`);
                console.log(`   ⏳ Waiting for response...`);
                
                // Simulate response handling
                console.log(`   ❓ Result: [NEEDS LIVE SDK CALL]\n`);
                
            } catch (error) {
                console.log(`   ❌ Error testing ContainerID:${containerId}: ${error.message}\n`);
                results.errors.push({ id: containerId, error: error.message });
            }
        }

        // Summary (will be populated with real results)
        console.log('📊 VERIFICATION SUMMARY:');
        console.log('========================');
        console.log(`✅ Found in source instance: ${results.found.length}`);
        console.log(`❌ Missing from source instance: ${results.missing.length}`);
        console.log(`⚠️  Errors during verification: ${results.errors.length}`);
        
        if (results.found.length > 0) {
            console.log('\n🚨 DOWNLOAD PROCESS BUG CONFIRMED:');
            console.log('   These containers exist in source but weren\'t downloaded!');
            results.found.forEach(container => {
                console.log(`   - ContainerID:${container.id} (${container.name || 'No Name'})`);
            });
        }
        
        if (results.missing.length > 0) {
            console.log('\n🗑️  CONTENT INTEGRITY ISSUE:');
            console.log('   These containers were deleted but content still references them:');
            results.missing.forEach(id => {
                console.log(`   - ContainerID:${id}`);
            });
        }

        console.log('\n💡 TO ENABLE LIVE TESTING:');
        console.log('1. Add your Management SDK API key');
        console.log('2. Uncomment the actual SDK calls');
        console.log('3. Run this script to get definitive results');
        
    } catch (error) {
        console.error('❌ SDK Verification failed:', error.message);
        console.error('💡 Make sure API key is configured and instance is accessible');
    }
}

/**
 * Alternative: Check downloaded container files directly
 * This can give us some immediate insights while we setup SDK verification
 */
function checkDownloadedContainers() {
    console.log('\n🔍 CHECKING DOWNLOADED CONTAINER FILES:');
    console.log('======================================\n');
    
    const containerPath = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'containers');
    
    if (!fs.existsSync(containerPath)) {
        console.log('❌ Container directory not found:', containerPath);
        return;
    }
    
    console.log('📁 Container directory:', containerPath);
    
    const testIds = [435, 412, 433, 587, 859, 858, 422, 1177, 1003, 1004];
    
    console.log('\n🔍 Checking for container files:');
    testIds.forEach(id => {
        const containerFile = path.join(containerPath, `container-${id}.json`);
        const listFile = path.join(containerPath, 'list', `${id}.json`);
        const itemFile = path.join(containerPath, 'item', `${id}.json`);
        
        const fileExists = fs.existsSync(containerFile);
        const listExists = fs.existsSync(listFile);
        const itemExists = fs.existsSync(itemFile);
        
        if (fileExists || listExists || itemExists) {
            console.log(`✅ ContainerID:${id} - Found files:`);
            if (fileExists) console.log(`   📄 ${containerFile}`);
            if (listExists) console.log(`   📋 ${listFile}`);
            if (itemExists) console.log(`   📝 ${itemFile}`);
        } else {
            console.log(`❌ ContainerID:${id} - NO FILES FOUND`);
        }
    });
    
    // List all container files to see what we actually have
    console.log('\n📋 ALL DOWNLOADED CONTAINER FILES:');
    try {
        const files = fs.readdirSync(containerPath);
        console.log(`Total files in containers directory: ${files.length}`);
        
        // Check list and item subdirectories
        const listPath = path.join(containerPath, 'list');
        const itemPath = path.join(containerPath, 'item');
        
        if (fs.existsSync(listPath)) {
            const listFiles = fs.readdirSync(listPath);
            console.log(`List containers: ${listFiles.length} files`);
            console.log('Sample list files:', listFiles.slice(0, 10));
        }
        
        if (fs.existsSync(itemPath)) {
            const itemFiles = fs.readdirSync(itemPath);
            console.log(`Item containers: ${itemFiles.length} files`);
            console.log('Sample item files:', itemFiles.slice(0, 10));
        }
        
    } catch (error) {
        console.log('❌ Error reading container files:', error.message);
    }
}

async function sdkContainerVerification() {
    console.log('🔍 SDK CONTAINER VERIFICATION TEST');
    console.log('=' .repeat(60));
    
    // Critical containers to test
    const criticalContainers = [408, 412, 435, 405, 407, 409, 410, 411, 413, 415, 418];
    
    // Initialize SDK client
    const options = {
        baseUrl: 'https://mgmt.aglty.io',
        websiteName: '67bc73e6-u',
        token: process.env.AGILITY_MGMT_API_TOKEN || '',
        isPreview: true
    };
    
    if (!options.token) {
        console.error('❌ AGILITY_MGMT_API_TOKEN environment variable not set');
        return;
    }
    
    const apiClient = new mgmtApi.ApiClient(options);
    const guid = '67bc73e6-u';
    
    console.log(`🌐 Testing against instance: ${guid}`);
    console.log(`📍 API Base URL: ${options.baseUrl}`);
    
    console.log('\n🔍 COMPREHENSIVE CONTAINER VERIFICATION:');
    
    const results = {
        foundViaGetByID: [],
        foundViaGetList: [],
        foundViaGetByModel: [],
        notFoundAnywhere: [],
        errors: []
    };
    
    // Test 1: Try getContainerByID for each critical container
    console.log('\n📋 1. Testing getContainerByID...');
    for (const containerID of criticalContainers) {
        try {
            const container = await apiClient.containerMethods.getContainerByID(containerID, guid);
            
            if (container) {
                console.log(`   ✅ ContainerID:${containerID} - Found via getContainerByID`);
                console.log(`      Name: ${container.referenceName || 'No Name'}`);
                console.log(`      ContentViewID: ${container.contentViewID}`);
                console.log(`      IsPublished: ${container.isPublished}`);
                console.log(`      ModelDefinitionID: ${container.modelDefinitionID}`);
                
                results.foundViaGetByID.push({
                    containerID,
                    container,
                    method: 'getContainerByID'
                });
            } else {
                console.log(`   ⚠️  ContainerID:${containerID} - getContainerByID returned null`);
                results.notFoundAnywhere.push(containerID);
            }
        } catch (error) {
            console.log(`   ❌ ContainerID:${containerID} - Error: ${error.message}`);
            results.errors.push({
                containerID,
                method: 'getContainerByID',
                error: error.message
            });
        }
    }
    
    // Test 2: Check if containers are in getContainerList
    console.log('\n📋 2. Testing getContainerList...');
    try {
        const allContainers = await apiClient.containerMethods.getContainerList(guid);
        console.log(`   📦 Total containers in list: ${allContainers.length}`);
        
        for (const containerID of criticalContainers) {
            const found = allContainers.find(c => c.contentViewID === containerID);
            if (found) {
                console.log(`   ✅ ContainerID:${containerID} - Found in getContainerList`);
                results.foundViaGetList.push({
                    containerID,
                    container: found,
                    method: 'getContainerList'
                });
            } else {
                console.log(`   ❌ ContainerID:${containerID} - Not found in getContainerList`);
            }
        }
    } catch (error) {
        console.log(`   ❌ Error getting container list: ${error.message}`);
        results.errors.push({
            method: 'getContainerList',
            error: error.message
        });
    }
    
    // Test 3: Try to find via models (get all models, then get containers by model)
    console.log('\n📋 3. Testing getContainersByModel...');
    try {
        // Get all models first
        const contentModels = await apiClient.modelMethods.getContentModels(guid);
        const pageModels = await apiClient.modelMethods.getPageModules(true, guid);
        const allModels = [...contentModels, ...pageModels];
        
        console.log(`   📋 Checking ${allModels.length} models for containers...`);
        
        const foundViaModels = new Set();
        
        for (const model of allModels) {
            try {
                const modelContainers = await apiClient.containerMethods.getContainersByModel(model.id, guid);
                
                for (const container of modelContainers) {
                    if (criticalContainers.includes(container.contentViewID)) {
                        if (!foundViaModels.has(container.contentViewID)) {
                            console.log(`   ✅ ContainerID:${container.contentViewID} - Found via model ${model.displayName} (ID: ${model.id})`);
                            foundViaModels.add(container.contentViewID);
                            
                            results.foundViaGetByModel.push({
                                containerID: container.contentViewID,
                                container,
                                method: 'getContainersByModel',
                                modelID: model.id,
                                modelName: model.displayName
                            });
                        }
                    }
                }
            } catch (error) {
                // Some models might not have containers - this is normal
                if (!error.message.includes('404')) {
                    console.log(`   ⚠️  Model ${model.displayName}: ${error.message}`);
                }
            }
        }
        
        // Check which critical containers were NOT found via models
        for (const containerID of criticalContainers) {
            if (!foundViaModels.has(containerID)) {
                console.log(`   ❌ ContainerID:${containerID} - Not found via any model`);
            }
        }
        
    } catch (error) {
        console.log(`   ❌ Error getting models: ${error.message}`);
        results.errors.push({
            method: 'getModels/getContainersByModel',
            error: error.message
        });
    }
    
    // Summary
    console.log('\n📊 VERIFICATION SUMMARY:');
    console.log('=' .repeat(60));
    
    console.log(`\n✅ FOUND CONTAINERS:`);
    console.log(`   Via getContainerByID: ${results.foundViaGetByID.length}`);
    console.log(`   Via getContainerList: ${results.foundViaGetList.length}`);
    console.log(`   Via getContainersByModel: ${results.foundViaGetByModel.length}`);
    
    console.log(`\n❌ NOT FOUND:`);
    const allFound = new Set([
        ...results.foundViaGetByID.map(r => r.containerID),
        ...results.foundViaGetList.map(r => r.containerID),
        ...results.foundViaGetByModel.map(r => r.containerID)
    ]);
    
    const notFound = criticalContainers.filter(id => !allFound.has(id));
    console.log(`   Completely missing: ${notFound.length} containers`);
    if (notFound.length > 0) {
        console.log(`   IDs: ${notFound.join(', ')}`);
    }
    
    console.log(`\n⚠️  ERRORS: ${results.errors.length}`);
    if (results.errors.length > 0) {
        for (const error of results.errors) {
            console.log(`   ${error.method}: ${error.error}`);
        }
    }
    
    // Detailed analysis for found containers
    if (results.foundViaGetByID.length > 0) {
        console.log(`\n🔍 DETAILED ANALYSIS OF FOUND CONTAINERS:`);
        
        for (const result of results.foundViaGetByID) {
            const container = result.container;
            console.log(`\n   ContainerID:${result.containerID}:`);
            console.log(`     Name: ${container.referenceName || 'No Name'}`);
            console.log(`     ContentViewID: ${container.contentViewID}`);
            console.log(`     IsPublished: ${container.isPublished}`);
            console.log(`     IsShared: ${container.isShared}`);
            console.log(`     ModelDefinitionID: ${container.modelDefinitionID}`);
            console.log(`     ContentDefinitionType: ${container.contentDefinitionType}`);
            
            // This explains why they're not being saved!
            if (container.contentViewID === -1) {
                console.log(`     🚨 CRITICAL: contentViewID is -1 (deleted/archived container)`);
                console.log(`     📝 This explains why it's not being saved to files`);
            }
        }
    }
    
    // Final conclusions
    console.log(`\n💡 CONCLUSIONS:`);
    
    if (results.foundViaGetByID.length === criticalContainers.length) {
        console.log(`   ✅ ALL critical containers can be found via getContainerByID`);
        console.log(`   🔧 The issue is NOT with SDK access or discovery`);
        console.log(`   🎯 The issue is that containers have contentViewID: -1 (deleted/archived)`);
        console.log(`   📂 These containers exist but are being skipped during file saving`);
    } else if (results.foundViaGetByID.length > 0) {
        console.log(`   ⚠️  PARTIAL: ${results.foundViaGetByID.length}/${criticalContainers.length} containers found`);
        console.log(`   🔍 Mixed situation - some containers accessible, others truly missing`);
    } else {
        console.log(`   ❌ CRITICAL: NO containers found via any method`);
        console.log(`   🚨 This suggests SDK access issues or authentication problems`);
    }
    
    return results;
}

// Run both checks
async function runVerification() {
    await testContainerExistence();
    checkDownloadedContainers();
    await sdkContainerVerification();
}

runVerification().catch(console.error); 