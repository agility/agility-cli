const mgmtApi = require('@agility/management-sdk');
const { Auth } = require('../dist/lib/services/auth');

async function testContainerLookup() {
    console.log('🔍 CONTAINER VERIFICATION TEST');
    console.log('==============================');
    
    // Test the most frequently missing containers from our analysis
    const criticalMissingIds = [
        435, // missing in 20 content items - HIGHEST PRIORITY
        412, // missing in 19 content items
        433, // missing in 18 content items  
        587, // missing in 18 content items
        1004 // found in content item 1008 example
    ];

    const sourceGuid = '67bc73e6-u';
    console.log(`📡 Source Instance: ${sourceGuid}`);
    console.log(`🎯 Testing ${criticalMissingIds.length} most critical missing containers\n`);
    
    const auth = new Auth();
    
    try {
        const token = await auth.getToken();
        console.log('✅ Successfully retrieved token from Auth service');
        
        const apiOptions = {
            token: token,
            baseUrl: 'https://mgmt.aglty.io/api/v1'
        };
        
        const apiClient = new mgmtApi.ApiClient(apiOptions);
        console.log(`✅ Management SDK initialized\n`);
        
        const results = {
            found: [],
            missing: [],
            errors: []
        };

        for (const containerId of criticalMissingIds) {
            try {
                console.log(`🔍 Testing ContainerID:${containerId}...`);
                
                // Try to get the container using Management SDK
                const container = await apiClient.contentContainerMethods.getContentContainer(containerId, sourceGuid);
                
                if (container) {
                    console.log(`   ✅ FOUND: ${container.referenceName || container.contentViewName || 'No Name'}`);
                    console.log(`   📋 Type: ${container.contentDefinitionType === 1 ? 'Item Container' : 'List Container'}`);
                    results.found.push({
                        id: containerId,
                        name: container.referenceName || container.contentViewName,
                        type: container.contentDefinitionType
                    });
                } else {
                    console.log(`   ❌ NOT FOUND: Container returned null`);
                    results.missing.push(containerId);
                }
                
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    console.log(`   ❌ NOT FOUND: Container does not exist (404)`);
                    results.missing.push(containerId);
                } else {
                    console.log(`   ⚠️  ERROR: ${error.message}`);
                    if (error.response) {
                        console.log(`      Status: ${error.response.status}`);
                        if (error.response.data) {
                            console.log(`      Data: ${JSON.stringify(error.response.data, null, 2)}`);
                        }
                    }
                    results.errors.push({ id: containerId, error: error.message });
                }
            }
            
            console.log(''); // Empty line for readability
        }

        // Final Results
        console.log('📊 VERIFICATION RESULTS:');
        console.log('========================');
        console.log(`✅ Found in source instance: ${results.found.length}`);
        console.log(`❌ Missing from source instance: ${results.missing.length}`);
        console.log(`⚠️  Errors during verification: ${results.errors.length}\n`);

        if (results.found.length > 0) {
            console.log('🚨 DOWNLOAD PROCESS BUG CONFIRMED!');
            console.log('   These containers exist in source but weren\'t downloaded:');
            results.found.forEach(container => {
                console.log(`   - ContainerID:${container.id} (${container.name}) - Type: ${container.type === 1 ? 'Item' : 'List'}`);
            });
            console.log('\n💡 RECOMMENDATION: Investigate container download process');
            console.log('   - Check download filters');
            console.log('   - Check pagination limits');
            console.log('   - Check nested container discovery logic\n');
        }

        if (results.missing.length > 0) {
            console.log('🗑️  CONTENT INTEGRITY ISSUE CONFIRMED!');
            console.log('   These containers were deleted from source but content still references them:');
            results.missing.forEach(id => {
                console.log(`   - ContainerID:${id}`);
            });
            console.log('\n💡 RECOMMENDATION: Clean up content references to deleted containers\n');
        }

        if (results.errors.length > 0) {
            console.log('⚠️  VERIFICATION ERRORS:');
            results.errors.forEach(err => {
                console.log(`   - ContainerID:${err.id}: ${err.error}`);
            });
        }
        
        console.log('\n🎯 CONCLUSION:');
        if (results.found.length > 0) {
            console.log('✅ Download process bug confirmed - containers exist but aren\'t being downloaded');
        } else if (results.missing.length === criticalMissingIds.length) {
            console.log('✅ Content integrity issue confirmed - containers were deleted from source');
        } else {
            console.log('🤔 Mixed results require further investigation');
        }
        
    } catch (error) {
        console.log('❌ Failed to get token:', error.message);
        console.log('💡 Please run: node dist/index.js login');
    }
}

testContainerLookup().catch(console.error); 