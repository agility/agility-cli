const mgmtApi = require('@agility/management-sdk');

async function testPageOperations() {
    console.log('🔄 Testing page operations...');
    
    // Use hardcoded token for testing (you'd need to provide this)
    const token = process.env.AGILITY_TOKEN || 'your-token-here';
    const options = { token };
    const apiClient = new mgmtApi.ApiClient(options);
    
    const targetGuid = '90c39c80-u';
    const locale = 'en-us';
    
    try {
        // Step 1: Get sitemap to see page structure
        console.log('📋 Getting sitemap...');
        const sitemap = await apiClient.pageMethods.getPagesSitemap(targetGuid, locale);
        
        if (!sitemap || sitemap.length === 0) {
            console.log('❌ No pages found in sitemap');
            return;
        }
        
        console.log(`📊 Found ${sitemap.length} pages in sitemap`);
        
        // Show first few pages
        sitemap.slice(0, 3).forEach(page => {
            console.log(`  📄 ${page.name} (ID: ${page.pageID}, Template: ${page.templateName})`);
        });
        
        // Step 2: Get full details of first page
        const firstPage = sitemap[0];
        console.log(`\n🎯 Getting details for: ${firstPage.name}`);
        
        const fullPage = await apiClient.pageMethods.getPage(firstPage.pageID, targetGuid, locale);
        
        console.log('📊 Page structure:');
        console.log(JSON.stringify({
            pageID: fullPage.pageID,
            name: fullPage.name,
            templateName: fullPage.templateName,
            channelID: fullPage.channelID,
            parentPageID: fullPage.parentPageID,
            menuText: fullPage.menuText,
            zones: fullPage.zones ? Object.keys(fullPage.zones) : [],
            zoneDetails: fullPage.zones
        }, null, 2));
        
    } catch (error) {
        console.error('❌ Error during test:', error.message);
        if (error.response) {
            console.error('📊 Response status:', error.response.status);
            console.error('📊 Response data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

// Check if token is available
if (!process.env.AGILITY_TOKEN) {
    console.log('⚠️ Please set AGILITY_TOKEN environment variable');
    console.log('   You can find your token in your CLI config or Agility portal');
    process.exit(1);
}

testPageOperations().catch(console.error); 