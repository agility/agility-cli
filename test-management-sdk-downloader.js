const { Auth } = require('./dist/lib/services/auth');
const { SimpleManagementSDKDownloader } = require('./dist/lib/downloaders/management-sdk-simple');

async function testManagementSDKDownloader() {
    console.log('🧪 Testing Management SDK-Only Downloader');
    console.log('=========================================');
    
    try {
        // Initialize auth service
        const auth = new Auth();
        const token = await auth.getToken();
        
        if (!token) {
            console.log('❌ No auth token found. Please run: agility login');
            return;
        }
        
        console.log('✅ Auth token retrieved successfully');
        
        // Initialize downloader
        const downloader = new SimpleManagementSDKDownloader({
            guid: '13a8b394-u',  // Texas Gaming (proven test instance)
            locale: 'en-us',
            channel: 'website',
            apiKey: token,
            outputDir: 'agility-files/13a8b394-u/en-us/mgmt-preview',
            verbose: true
        });
        
        // Test download
        const result = await downloader.testDownload();
        
        if (result.success) {
            console.log('\n🎉 Management SDK Download Test: SUCCESS');
            console.log('📊 Statistics:', result.stats);
            
            // Optionally save test data
            console.log('\n💾 Saving test data to disk...');
            await downloader.saveTestData();
            console.log('✅ Test data saved');
            
        } else {
            console.log('❌ Management SDK Download Test: FAILED');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testManagementSDKDownloader(); 