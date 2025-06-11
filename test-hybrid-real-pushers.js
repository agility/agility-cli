// Hybrid Test: Mocked Source Data + Real SDK Pushers + Real API Response Mapping
// Uses the SAME pushers as the real sync command but with controlled mock data
// UPDATED: Complete payload structures based on real data validation

console.log('🧪 Hybrid Test: Real Pushers + Complete Payloads + Module Logic');
console.log('=' .repeat(80));

const { TopologicalTwoPassOrchestrator } = require('./dist/lib/services/topological-two-pass-orchestrator');
const { CoreReferenceMapper } = require('./dist/lib/core-reference-mapper');
const { UploadSequenceConverter } = require('./dist/lib/services/upload-sequence-converter');
const auth = require('./dist/lib/services/auth');
const Auth = auth.Auth;

async function testHybridRealPushersComplete() {
    const targetGuid = process.argv[2];
    const locale = 'en-us';
    
    if (!targetGuid) {
        console.log('❌ Error: Please provide a target instance GUID');
        console.log('Usage: node test-hybrid-real-pushers.js <target-guid>');
        process.exit(1);
    }

    console.log(`🎯 Target Instance: ${targetGuid}`);
    console.log(`🌍 Locale: ${locale}`);
    console.log('');

    try {
        // Step 1: Authenticate using auth service
        console.log('🔐 Step 1: Authentication');
        const auth = new Auth();
        const apiKey = await auth.getToken();
        console.log('   ✅ Retrieved API token from keychain');
        console.log('');

        // Step 2: Create complete mocked data with proper structure
        console.log('📄 Step 2: Creating Complete Mock Data');
        const timestamp = Date.now();
        
        const mockedData = createCompleteMockedData(timestamp);
        
        console.log(`   ✅ Created mocked data with ${mockedData.models.length} models`);
        console.log(`   ✅ Created mocked data with ${mockedData.galleries.length} galleries`);
        console.log(`   ✅ Created mocked data with ${mockedData.assets.length} assets`);
        console.log(`   ✅ Created mocked data with ${mockedData.content.length} content items`);
        console.log(`   ✅ Created mocked data with ${mockedData.containers.length} containers`);
        console.log(`   ✅ Created mocked data with ${mockedData.templates.length} templates`);
        console.log(`   ✅ Created mocked data with ${mockedData.pages.length} pages`);
        console.log('');

        // Step 3: Create analysis results
        console.log('🔍 Step 3: Creating Analysis Results');
        const analysisResults = createMockedAnalysisResults(mockedData);
        console.log(`   ✅ Generated ${analysisResults.pageChains.length} page chains`);
        console.log(`   ✅ Total entities in chains: ${analysisResults.pageChains[0].chain.length}`);
        console.log('');

        // Step 4: Initialize orchestrator with real API credentials
        console.log('🚀 Step 4: Initializing Upload Orchestrator');
        const uploadOrchestrator = new TopologicalTwoPassOrchestrator();
        
        // Step 5: Execute upload with real API calls
        console.log('📤 Step 5: Executing Real Upload with Complete Payloads');
        const uploadResult = await uploadOrchestrator.executeUpload(
            analysisResults,
            mockedData,
            targetGuid,
            locale,
            { apiKey: apiKey }, // Use real token
            (step, message, data) => {
                console.log(`   [${step}] ${message}`);
                if (data?.progress) {
                    console.log(`      Progress: ${data.progress}`);
                }
            }
        );

        // Step 6: Validate results
        console.log('');
        console.log('✅ Step 6: Upload Results');
        console.log(`   Total Steps: ${uploadResult.completedSteps}/${uploadResult.totalSteps}`);
        console.log(`   Success: ${uploadResult.success}`);
        console.log(`   Entities Created: ${JSON.stringify(uploadResult.entitiesCreated, null, 2)}`);
        
        if (uploadResult.success) {
            console.log('');
            console.log('🎉 HYBRID TEST SUCCESS!');
            console.log('✅ Real SDK integration working');
            console.log('✅ Complete payload structures validated');
            console.log('✅ Module logic for page zones confirmed');
            console.log('✅ API response mapping between passes verified');
        } else {
            console.log('');
            console.log('❌ HYBRID TEST FAILED');
            console.log('❌ Issues with API integration or payload structure');
            console.log(`❌ Error: ${uploadResult.error}`);
        }

    } catch (error) {
        console.error('');
        console.error('💥 Test Failed with Error:');
        console.error(error.message || error);
        console.error('');
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

function createCompleteMockedData(timestamp) {
    return {
        // Models with complete structure
        models: [
            {
                id: 0, // Use 0 for creation
                referenceName: `MockArticle_${timestamp}`,
                displayName: 'Mock Article Model',
                contentDefinitionTypeID: 0, // Module
                fields: [
                    {
                        name: 'title',
                        label: 'Title',
                        type: 'Text',
                        settings: {
                            DefaultValue: '',
                            Required: 'true'
                        }
                        // Remove fieldID and itemOrder for creation
                    },
                    {
                        name: 'content',
                        label: 'Content',
                        type: 'HTML',
                        settings: {
                            DefaultValue: ''
                        }
                    }
                ]
                // Remove lastModifiedDate, lastModifiedBy, lastModifiedAuthorID
            }
        ],

        // Galleries with proper structure
        galleries: [
            {
                mediaGroupingID: -1, // Use -1 for creation
                name: `MockGallery_${timestamp}`,
                description: 'Mock gallery for testing',
                groupingTypeID: 1,
                isDeleted: false,
                isFolder: false,
                metaData: {}
            }
        ],

        // Assets with complete structure
        assets: [
            {
                mediaID: -1, // Use -1 for creation
                fileName: 'mock-hero-image.jpg',
                url: 'https://cdn.aglty.io/mock/hero-image.jpg',
                originUrl: 'https://cdn.aglty.io/mock/hero-image.jpg',
                edgeUrl: 'https://cdn.aglty.io/mock/hero-image.jpg',
                mediaGroupingID: -1, // Will be mapped after gallery creation
                uploadMethod: 'url-reference'
            }
        ],

        // Containers with COMPLETE structure (all required fields)
        containers: [
            {
                contentViewID: -1, // Use -1 for creation
                referenceName: `mock_articles_${timestamp}`,
                contentViewName: `Mock Articles Container ${timestamp}`,
                contentDefinitionID: -1, // Will be mapped after model creation
                contentDefinitionType: 0, // Module
                contentDefinitionTypeID: 0, // Module
                requiresApproval: true,
                isShared: false,
                isDynamicPageList: false,
                disablePublishFromList: false,
                isPublished: true,
                defaultSortColumn: 'itemOrder',
                defaultSortDirection: 'ASC',
                numRowsInListing: 10,
                enableRSSOutput: false,
                enableAPIOutput: false,
                allowClientSideSave: false,
                usageCount: 0,
                isDeleted: false,
                confirmSharingOnPublish: false,
                columns: [
                    {
                        sortOrder: 0,
                        fieldName: 'title',
                        label: 'Title',
                        isDefaultSort: false,
                        sortDirection: null,
                        typeName: null
                    }
                ]
                // Remove lastModifiedDate, lastModifiedBy for creation
            }
        ],

        // Content with complete structure
        content: [
            {
                contentID: -1, // Use -1 for creation
                properties: {
                    definitionName: `MockArticle_${timestamp}`,
                    referenceName: `mock_articles_${timestamp}`,
                    itemOrder: 1
                    // Remove state, modified, versionID for creation
                },
                fields: {
                    title: 'Sample Mock Article',
                    content: '<p>This is a sample mock article content for testing.</p>'
                },
                seo: {
                    metaDescription: 'Sample mock article for testing',
                    metaKeywords: null,
                    metaHTML: null,
                    menuVisible: null,
                    sitemapVisible: true
                },
                scripts: {
                    top: null,
                    bottom: null
                }
            }
        ],

        // Templates with complete structure
        templates: [
            {
                pageTemplateID: -1, // Use -1 for creation
                pageTemplateName: `MockTemplate_${timestamp}`,
                digitalChannelTypeID: 1,
                digitalChannelTypeName: 'Website',
                agilityCode: false,
                isDeleted: false,
                contentSectionDefinitions: [
                    {
                        pageItemTemplateID: -1, // Always -1 for creation
                        pageTemplateID: -1, // Always -1 for creation
                        pageItemTemplateName: 'Main Content Zone',
                        pageItemTemplateReferenceName: 'MainContentZone',
                        pageItemTemplateType: 0,
                        pageItemTemplateTypeName: 'Variable',
                        itemOrder: 1,
                        contentViewID: null,
                        contentReferenceName: null,
                        contentDefinitionID: null,
                        contentViewName: null,
                        itemContainerID: null,
                        publishContentItemID: null,
                        isShared: false,
                        isSharedTemplate: false,
                        enablePersonalization: false
                    }
                ]
            }
        ],

        // Pages with COMPLETE structure (all required fields)
        pages: [
            {
                pageID: -1, // Use -1 for creation
                name: `mock-test-page-${timestamp}`,
                path: null, // Auto-generated
                title: 'Mock Test Page',
                menuText: 'Mock Test Page',
                pageType: 'static',
                templateName: `MockTemplate_${timestamp}`, // Reference to template
                redirectUrl: '',
                securePage: false,
                excludeFromOutputCache: false,
                visible: {
                    menu: true,
                    sitemap: true
                },
                seo: {
                    metaDescription: 'Mock test page for hybrid testing',
                    metaKeywords: '',
                    metaHTML: '',
                    menuVisible: null,
                    sitemapVisible: null
                },
                scripts: {
                    excludedFromGlobal: false,
                    top: null,
                    bottom: null
                },
                zones: {
                    MainContentZone: [
                        {
                            module: `mock_articles_${timestamp}`, // Module = Container name
                            item: {
                                contentid: -1, // Will be mapped after content creation
                                fulllist: false
                            }
                        }
                    ]
                }
                // Remove properties (state, modified, versionID) for creation
            }
        ]
    };
}

function createMockedAnalysisResults(mockedData) {
    // Create analysis results in format expected by upload sequence converter
    const allEntities = [
        ...mockedData.models.map(m => ({ type: 'Model', id: m.id, data: m })),
        ...mockedData.galleries.map(g => ({ type: 'Gallery', id: g.mediaGroupingID, data: g })),
        ...mockedData.assets.map(a => ({ type: 'Asset', id: a.mediaID, data: a })),
        ...mockedData.content.map(c => ({ type: 'Content', id: c.contentID, data: c })),
        ...mockedData.containers.map(c => ({ type: 'Container', id: c.contentViewID, data: c })),
        ...mockedData.templates.map(t => ({ type: 'Template', id: t.pageTemplateID, data: t })),
        ...mockedData.pages.map(p => ({ type: 'Page', id: p.pageID, data: p }))
    ];

    return {
        pageChains: [{
            chain: allEntities,
            dependencies: [
                { from: 'Page', to: 'Template', relationship: 'template reference' },
                { from: 'Page', to: 'Content', relationship: 'zone content' },
                { from: 'Container', to: 'Model', relationship: 'definition reference' },
                { from: 'Content', to: 'Container', relationship: 'container membership' },
                { from: 'Content', to: 'Model', relationship: 'definition type' },
                { from: 'Asset', to: 'Gallery', relationship: 'gallery membership' }
            ]
        }],
        containerChains: [],
        modelToModelChains: [],
        brokenChains: [],
        itemsOutsideChains: {
            models: [],
            galleries: [],
            assets: [],
            containers: [],
            content: [],
            templates: [],
            pages: []
        },
        reconciliation: {
            totalEntities: allEntities.length,
            totalInChains: allEntities.length,
            brokenItems: 0,
            syncableEntities: allEntities.length
        }
    };
}

// Execute the test
testHybridRealPushersComplete().catch(error => {
    console.error('💥 Unhandled Error:', error);
    process.exit(1);
});

module.exports = { testHybridRealPushersComplete }; 