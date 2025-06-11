// Test simple folder page creation with our new simplified batch handling
const { pushPages } = require('./dist/lib/pushers/page-pusher');
const { ReferenceMapper } = require('./dist/lib/core-reference-mapper');
const mgmtApi = require('@agility/management-sdk');
const fs = require('fs');

async function testSimpleFolderPage() {
    console.log('🧪 Testing simple folder page creation with legacy pattern...');
    
    // Use environment variable for token
    const token = process.env.AGILITY_TOKEN;
    if (!token) {
        console.log('❌ Please set AGILITY_TOKEN environment variable');
        return;
    }
    
    const options = { token };
    const apiClient = new mgmtApi.ApiClient(options);
    
    const targetGuid = '90c39c80-u';
    const locale = 'en-us';
    
    try {
        // Create a simple folder page (no template, no content)
        const simpleFolderPage = {
            pageID: -1,           // LEGACY: -1 means create new
            channelID: -1,        // LEGACY: -1 means default channel
            name: "test-folder-legacy",
            title: "Test Folder Legacy",
            menuText: "Test Folder Legacy",
            path: "test-folder-legacy",
            pageType: "folder",   // Folder pages don't need templates
            templateName: null,   // No template for folder pages
            parentPageID: -1,     // Root level page
            zones: {},            // Empty zones for folder pages
            visible: {
                menu: true,
                sitemap: true
            },
            seo: {
                metaDescription: "",
                metaKeywords: "",
                metaHTML: ""
            },
            scripts: {
                excludedFromGlobal: false,
                top: "",
                bottom: ""
            }
        };
        
        console.log('📤 Creating folder page with payload:');
        console.log(JSON.stringify({
            pageID: simpleFolderPage.pageID,
            channelID: simpleFolderPage.channelID,
            name: simpleFolderPage.name,
            title: simpleFolderPage.title,
            pageType: simpleFolderPage.pageType,
            templateName: simpleFolderPage.templateName,
            parentPageID: simpleFolderPage.parentPageID,
            zones: simpleFolderPage.zones
        }, null, 2));
        
        // LEGACY API CALL PATTERN
        const result = await apiClient.pageMethods.savePage(simpleFolderPage, targetGuid, locale, -1, -1);
        
        console.log('✅ API Response:');
        console.log(JSON.stringify(result, null, 2));
        
        // Check response format
        if (Array.isArray(result) && result[0] > 0) {
            console.log(`🎉 SUCCESS! Created folder page with ID: ${result[0]}`);
            return true;
        } else if (result && typeof result === 'object' && 'batchID' in result) {
            console.log(`📦 Batch response received: batchID ${result.batchID}, state: ${result.batchState}`);
            if (result.items && result.items.length > 0) {
                const pageItem = result.items.find(item => item.itemType === 1); // itemType 1 = Page
                if (pageItem && pageItem.itemID > 0) {
                    console.log(`🎉 SUCCESS! Created folder page with ID: ${pageItem.itemID}`);
                    return true;
                }
            }
        }
        
        console.log('❌ Unexpected response format');
        return false;
        
    } catch (error) {
        console.error('❌ Error creating folder page:', error.message);
        if (error.response?.data) {
            console.error('📊 API Error Data:', JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}

// Check for token and run test
if (process.env.AGILITY_TOKEN) {
    testSimpleFolderPage().then(success => {
        console.log(success ? '✅ Test completed successfully' : '❌ Test failed');
        process.exit(success ? 0 : 1);
    });
} else {
    console.log('❌ Please set AGILITY_TOKEN environment variable');
    console.log('   You can get this from your Agility portal or CLI config');
    process.exit(1);
} 