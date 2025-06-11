const mgmtApi = require('@agility/management-sdk');
const { Auth } = require('./dist/lib/services/auth');

async function testPageRoundtrip() {
    console.log('🔄 Testing page round-trip functionality...');
    
    // Initialize API client
    const auth = new Auth();
    const token = await auth.getToken();
    const options = { token };
    const apiClient = new mgmtApi.ApiClient(options);
    
    const targetGuid = '90c39c80-u';
    const locale = 'en-us';
    
    try {
        // Step 1: Get sitemap to find a page
        console.log('📋 Getting sitemap...');
        const sitemap = await apiClient.pageMethods.getPagesSitemap(targetGuid, locale);
        
        if (!sitemap || sitemap.length === 0) {
            console.log('❌ No pages found in sitemap');
            return;
        }
        
        // Find first page
        const firstPage = sitemap[0];
        console.log(`🎯 Found page: ${firstPage.name} (ID: ${firstPage.pageID})`);
        
        // Step 2: Get full page details
        console.log('📥 Getting full page details...');
        const fullPage = await apiClient.pageMethods.getPage(firstPage.pageID, targetGuid, locale);
        console.log('📊 Page structure:', JSON.stringify({
            pageID: fullPage.pageID,
            name: fullPage.name,
            templateName: fullPage.templateName,
            channelID: fullPage.channelID,
            parentPageID: fullPage.parentPageID,
            zones: Object.keys(fullPage.zones || {})
        }, null, 2));
        
        // Step 3: Try to save it back (this should work without changes)
        console.log('💾 Attempting to save page back to target...');
        
        // Prepare payload for save (legacy pattern)
        const savePayload = {
            ...fullPage,
            pageID: fullPage.pageID, // Keep existing ID for update
            channelID: fullPage.channelID // Keep existing channel
        };
        
        console.log('📤 Save payload structure:', JSON.stringify({
            pageID: savePayload.pageID,
            name: savePayload.name,
            templateName: savePayload.templateName,
            channelID: savePayload.channelID,
            parentPageID: savePayload.parentPageID,
            zones: Object.keys(savePayload.zones || {})
        }, null, 2));
        
        const saveResult = await apiClient.pageMethods.savePage(savePayload, targetGuid, locale, fullPage.parentPageID, -1);
        
        console.log('✅ Save successful!');
        console.log('📊 Save result:', JSON.stringify(saveResult, null, 2));
        
    } catch (error) {
        console.error('❌ Error during round-trip test:', error.message);
        if (error.response) {
            console.error('📊 Error response:', JSON.stringify(error.response.data, null, 2));
        }
        console.error('🔍 Full error:', error);
    }
}

testPageRoundtrip().catch(console.error); 