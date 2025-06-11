const mgmtApi = require('@agility/management-sdk');
const Auth = require('./src/lib/services/auth').Auth;

async function testContainerListPagination() {
    try {
        console.log('🔍 Testing getContainerList pagination capabilities...');
        
        // Setup authentication
        const auth = new Auth();
        const token = await auth.getToken();
        const guid = '67bc73e6-u';
        
        const mgmtApiOptions = new mgmtApi.Options();
        mgmtApiOptions.token = token;
        mgmtApiOptions.baseUrl = auth.determineBaseUrl(guid);
        
        const apiClient = new mgmtApi.ApiClient(mgmtApiOptions);
        
        console.log('\n📋 Test 1: Standard getContainerList()');
        const standardResult = await apiClient.containerMethods.getContainerList(guid);
        console.log(`   Standard result: ${standardResult.length} containers`);
        
        console.log('\n📋 Test 2: Try getContainerList with additional parameters...');
        
        // Test various potential pagination parameter patterns
        const testCases = [
            // Skip/Take pattern
            { params: [guid, 0, 100], name: 'skip=0, take=100' },
            { params: [guid, 0, 500], name: 'skip=0, take=500' },
            { params: [guid, 100, 100], name: 'skip=100, take=100' },
            
            // PageSize/Offset pattern  
            { params: [guid, 500, 0], name: 'pageSize=500, offset=0' },
            { params: [guid, 1000, 0], name: 'pageSize=1000, offset=0' },
            
            // Options object pattern
            { params: [guid, { pageSize: 500, skip: 0 }], name: 'options object' },
            { params: [guid, { take: 500, skip: 0 }], name: 'options object take/skip' },
        ];
        
        for (const testCase of testCases) {
            try {
                console.log(`\n   Testing: ${testCase.name}`);
                const result = await apiClient.containerMethods.getContainerList(...testCase.params);
                console.log(`   ✅ SUCCESS: ${result.length} containers with ${testCase.name}`);
                
                // If we get more containers, this confirms pagination
                if (result.length > standardResult.length) {
                    console.log(`   🎯 PAGINATION CONFIRMED! Got ${result.length - standardResult.length} additional containers`);
                }
            } catch (error) {
                console.log(`   ❌ Failed with ${testCase.name}: ${error.message}`);
            }
        }
        
        console.log('\n📋 Test 3: Check if there are more containers by trying large skip');
        try {
            const largeSkipResult = await apiClient.containerMethods.getContainerList(guid, 500, 1000);
            console.log(`   Large skip result: ${largeSkipResult.length} containers`);
        } catch (error) {
            console.log(`   Large skip failed: ${error.message}`);
        }
        
        console.log('\n📋 Test 4: Manual pagination loop to find all containers');
        const allContainers = [];
        let skip = 0;
        const take = 100;
        let hasMore = true;
        
        while (hasMore) {
            try {
                const pageResult = await apiClient.containerMethods.getContainerList(guid, skip, take);
                console.log(`   Page at skip=${skip}: ${pageResult.length} containers`);
                
                if (pageResult.length === 0) {
                    hasMore = false;
                } else {
                    allContainers.push(...pageResult);
                    skip += take;
                    
                    // Safety limit to prevent infinite loop
                    if (skip > 2000) {
                        console.log('   ⚠️ Reached safety limit of 2000 skip');
                        hasMore = false;
                    }
                }
            } catch (error) {
                console.log(`   ❌ Pagination failed at skip=${skip}: ${error.message}`);
                hasMore = false;
            }
        }
        
        console.log(`\n🎯 FINAL RESULTS:`);
        console.log(`   Standard getContainerList(): ${standardResult.length} containers`);
        console.log(`   Manual pagination total: ${allContainers.length} containers`);
        console.log(`   Difference: ${allContainers.length - standardResult.length} additional containers`);
        
        if (allContainers.length > standardResult.length) {
            console.log(`\n✅ PAGINATION CONFIRMED! getContainerList() has pagination limits.`);
            console.log(`   Standard call only returns first ${standardResult.length} containers`);
            console.log(`   Total available: ${allContainers.length} containers`);
            
            // Show container ID ranges
            const standardIds = standardResult.map(c => c.contentViewID).sort((a, b) => a - b);
            const allIds = allContainers.map(c => c.contentViewID).sort((a, b) => a - b);
            
            console.log(`\n📊 Container ID Ranges:`);
            console.log(`   Standard range: ${standardIds[0]} - ${standardIds[standardIds.length - 1]}`);
            console.log(`   Full range: ${allIds[0]} - ${allIds[allIds.length - 1]}`);
        } else {
            console.log(`\n❓ No additional containers found through pagination`);
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testContainerListPagination().catch(console.error); 