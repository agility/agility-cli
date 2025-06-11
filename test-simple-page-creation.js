const mgmtApi = require('./dist/types/agility/index');

async function testSimplePageCreation() {
    console.log("🔧 Testing Simple Page Creation API Call");
    
    try {
        const apiOptions = {
            token: process.env.AGILITY_API_KEY,
            isPreview: false
        };
        
        const apiClient = new mgmtApi.ApiClient(apiOptions);
        
        // Minimal folder page payload - should work if API is functioning
        const testPayload = {
            pageID: -1,
            name: "test-folder-page",
            title: "Test Folder Page",
            menuText: "Test Folder Page", 
            pageType: "folder",
            templateName: null,
            pageTemplateID: null,
            redirectUrl: "",
            securePage: false,
            excludeFromOutputCache: false,
            visible: {
                menu: true,
                sitemap: true
            },
            seo: {
                metaDescription: "",
                metaKeywords: "",
                metaHTML: "",
                menuVisible: null,
                sitemapVisible: null
            },
            scripts: {
                excludedFromGlobal: false,
                top: "",
                bottom: ""
            },
            zones: {},
            channelID: -1
        };
        
        console.log("📝 Test payload:", JSON.stringify(testPayload, null, 2));
        
        // Test API call
        const targetGuid = "90c39c80-u";
        const locale = "en-us";
        const parentIDArg = -1;
        const placeBeforeIDArg = -1;
        
        console.log("🚀 Calling savePage API...");
        const response = await apiClient.pageMethods.savePage(
            testPayload, 
            targetGuid, 
            locale, 
            parentIDArg, 
            placeBeforeIDArg
        );
        
        console.log("📋 API Response:", JSON.stringify(response, null, 2));
        
        if (Array.isArray(response) && response.length > 0 && response[0] > 0) {
            console.log("✅ SUCCESS: Page created with ID:", response[0]);
        } else if (response && typeof response === 'object' && 'batchID' in response) {
            console.log("🔄 BATCH RESPONSE: batchID", response.batchID);
            if (response.errorData) {
                console.log("❌ BATCH ERROR:", response.errorData);
            }
            if (response.items && response.items.length > 0) {
                const item = response.items[0];
                console.log("📋 Batch Item Details:");
                console.log(`   - itemNull: ${item.itemNull}`);
                console.log(`   - itemTitle: ${item.itemTitle}`);
                console.log(`   - batchState: ${response.batchState}`);
                console.log(`   - statusMessage: ${response.statusMessage}`);
            }
        } else {
            console.log("❌ UNEXPECTED RESPONSE FORMAT");
        }
        
    } catch (error) {
        console.error("💥 Error during test:", error);
        if (error.response) {
            console.error("🔍 Error response:", error.response.data);
        }
    }
}

testSimplePageCreation(); 