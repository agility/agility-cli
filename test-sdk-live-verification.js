const mgmtApi = require('@agility/management-sdk');
const { Auth } = require('./dist/lib/services/auth');

async function verifyMissingContainers() {
    console.log('🔍 LIVE SDK CONTAINER VERIFICATION');
    console.log('==================================\n');

    // Test the most frequently missing containers
    const criticalMissingIds = [
        435, // missing in 20 content items - TEST THIS FIRST
        412, // missing in 19 content items
        433, // missing in 18 content items  
        587, // missing in 18 content items
        859  // missing in 17 content items
    ];

    const sourceGuid = '67bc73e6-u';
    
    console.log(`📡 Source Instance: ${sourceGuid}`);
    console.log(`🎯 Testing ${criticalMissingIds.length} most critical missing containers\n`);

    const auth = new Auth();
    
    try {
        const token = await auth.getToken();
        console.log('✅ Successfully retrieved token from Auth service');
        
        const apiOptions = {
            token: token
        };
        
        const apiClient = new mgmtApi.ApiClient(apiOptions);
        console.log(`✅ Management SDK initialized for instance: ${sourceGuid}\n`);

        // Now run the live verification
        console.log('🚀 Starting live verification...\n');
        
        const results = {
            found: [],
            missing: [],
            errors: []
        };

        for (const containerId of criticalMissingIds) {
            try {
                console.log(`🔍 Testing ContainerID:${containerId}...`);
                
                // Try to get the container using correct Management SDK API
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
                    console.log(`   ❌ NOT FOUND: Container does not exist`);
                    results.missing.push(containerId);
                }
                
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    console.log(`   ❌ NOT FOUND: Container does not exist in source instance (404)`);
                    results.missing.push(containerId);
                } else {
                    console.log(`   ⚠️  ERROR: ${error.message}`);
                    if (error.response) {
                        console.log(`      Status: ${error.response.status}`);
                    }
                    results.errors.push({ id: containerId, error: error.message });
                }
            }
            
            console.log(''); // Empty line for readability
        }

        // Results summary
        console.log('📊 VERIFICATION RESULTS:');
        console.log('========================');
        console.log(`✅ Found in source instance: ${results.found.length}`);
        console.log(`❌ Missing from source instance: ${results.missing.length}`);
        console.log(`⚠️  Errors during verification: ${results.errors.length}\n`);

        if (results.found.length > 0) {
            console.log('🚨 DOWNLOAD PROCESS BUG CONFIRMED!');
            console.log('   These containers exist in source but weren\'t downloaded:');
            results.found.forEach(container => {
                console.log(`   - ContainerID:${container.id} (${container.name})`);
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

        console.log('\n🎯 ANALYSIS COMPLETE');
        console.log('====================');
        console.log('✅ Live SDK verification has provided definitive answers');
        console.log('📊 Results above will guide next steps for sync improvement');

    } catch (error) {
        console.log('❌ Failed to get token:', error.message);
        console.log('💡 Please run: node dist/index.js login');
    }
}

// Run the verification
verifyMissingContainers().catch(console.error); 