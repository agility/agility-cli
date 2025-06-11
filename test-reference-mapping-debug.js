/**
 * DEBUG SCRIPT: Reference Mapping Analysis
 * 
 * This script will help diagnose why content items are failing with itemNull: true
 * by examining the ReferenceMapper state after models/containers/assets are processed.
 */

const { ReferenceMapper } = require('./dist/lib/mapper');
const mgmtApi = require('@agility/management-sdk');
const path = require('path');
const fs = require('fs');

async function main() {
    console.log('🔍 Reference Mapping Debug Analysis');
    console.log('=' .repeat(60));

    // Set up basic parameters
    const sourceGuid = '67bc73e6-u';
    const targetGuid = '90c39c80-u';
    const locale = 'en-us';
    
    try {
        // Initialize ReferenceMapper
        console.log('\n📋 Step 1: Initialize ReferenceMapper');
        const referenceMapper = new ReferenceMapper(sourceGuid, targetGuid);
        
        // Load source data to see what should be mapped
        console.log('\n📥 Step 2: Load Source Data for Analysis');
        const sourceDataPath = path.join(process.cwd(), 'agility-files', sourceGuid, locale, 'preview');
        
        const loadJsonFiles = (folderPath) => {
            const fullPath = path.join(sourceDataPath, folderPath);
            if (!fs.existsSync(fullPath)) {
                console.log(`⚠️ Path does not exist: ${fullPath}`);
                return [];
            }
            
            const files = fs.readdirSync(fullPath).filter(file => file.endsWith('.json'));
            return files.map(file => {
                const filePath = path.join(fullPath, file);
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            });
        };

        // Load entities that should have been processed before content
        const models = loadJsonFiles('models');
        const containers = loadJsonFiles('containers');
        const assets = loadJsonFiles('assets/list').concat(loadJsonFiles('assets/item'));
        const content = loadJsonFiles('content/list').concat(loadJsonFiles('content/item'));
        
        console.log(`📊 Source Data Loaded:`);
        console.log(`  - Models: ${models.length}`);
        console.log(`  - Containers: ${containers.length}`);
        console.log(`  - Assets: ${assets.length}`);
        console.log(`  - Content: ${content.length}`);

        // Initialize API client to check target state
        console.log('\n🔧 Step 3: Initialize API Client');
        const apiKey = process.env.AGILITY_API_KEY;
        if (!apiKey) {
            throw new Error('AGILITY_API_KEY environment variable is required');
        }
        
        const options = { 
            token: apiKey,
            baseUrl: 'https://mgmt.aglty.io',
            timeout: 30000
        };
        
        const apiClient = new mgmtApi.ApiClient(options);

        // Check what exists in target instance
        console.log('\n🎯 Step 4: Check Target Instance State');
        
        console.log('\n📋 Models in Target:');
        try {
            const targetModels = await apiClient.modelMethods.getModels(targetGuid);
            console.log(`  Found ${targetModels.length} models in target`);
            for (const model of targetModels.slice(0, 5)) {
                console.log(`    - ${model.referenceName} (ID: ${model.id})`);
            }
            if (targetModels.length > 5) {
                console.log(`    ... and ${targetModels.length - 5} more`);
            }
        } catch (err) {
            console.log(`  ❌ Error retrieving models: ${err.message}`);
        }

        console.log('\n📦 Containers in Target:');
        try {
            const targetContainers = await apiClient.containerMethods.getContainers(targetGuid);
            console.log(`  Found ${targetContainers.length} containers in target`);
            for (const container of targetContainers.slice(0, 5)) {
                console.log(`    - ${container.referenceName} (ID: ${container.contentViewID})`);
            }
            if (targetContainers.length > 5) {
                console.log(`    ... and ${targetContainers.length - 5} more`);
            }
        } catch (err) {
            console.log(`  ❌ Error retrieving containers: ${err.message}`);
        }

        console.log('\n📎 Assets in Target:');
        try {
            const targetAssets = await apiClient.assetMethods.getMediaList(100, 0, targetGuid);
            console.log(`  Found ${targetAssets?.length || 0} assets in target (showing first 100)`);
            if (targetAssets && targetAssets.length > 0) {
                for (const asset of targetAssets.slice(0, 5)) {
                    console.log(`    - ${asset.fileName} (ID: ${asset.mediaID})`);
                }
                if (targetAssets.length > 5) {
                    console.log(`    ... and ${targetAssets.length - 5} more`);
                }
            }
        } catch (err) {
            console.log(`  ❌ Error retrieving assets: ${err.message}`);
        }

        // Analyze first few content items that would fail
        console.log('\n🔍 Step 5: Analyze Content Item Dependencies');
        
        const problematicContent = content.slice(0, 5); // Check first 5 content items
        
        for (const contentItem of problematicContent) {
            console.log(`\n📄 Content Item: ${contentItem.properties?.referenceName || 'Unknown'}`);
            console.log(`    Definition: ${contentItem.properties?.definitionName || 'Unknown'}`);
            
            // Check what dependencies this content item has
            console.log('    Dependencies needed:');
            
            // Check container dependency
            const containerName = contentItem.properties?.definitionName;
            if (containerName) {
                console.log(`      - Container: ${containerName} (based on definitionName)`);
            }
            
            // Check for asset references in fields
            if (contentItem.fields) {
                const assetRefs = [];
                const scanForAssets = (obj, path = '') => {
                    if (typeof obj === 'object' && obj !== null) {
                        for (const [key, value] of Object.entries(obj)) {
                            const currentPath = path ? `${path}.${key}` : key;
                            if (typeof value === 'string' && value.includes('cdn.aglty.io')) {
                                assetRefs.push({ path: currentPath, url: value });
                            } else if (typeof value === 'object') {
                                scanForAssets(value, currentPath);
                            }
                        }
                    }
                };
                
                scanForAssets(contentItem.fields);
                
                if (assetRefs.length > 0) {
                    console.log(`      - Assets: ${assetRefs.length} asset references found`);
                    for (const ref of assetRefs.slice(0, 3)) {
                        console.log(`        * ${ref.path}: ${ref.url.split('/').pop()}`);
                    }
                }
            }

            // Check for content references
            if (contentItem.fields) {
                const contentRefs = [];
                const scanForContent = (obj, path = '') => {
                    if (typeof obj === 'object' && obj !== null) {
                        for (const [key, value] of Object.entries(obj)) {
                            const currentPath = path ? `${path}.${key}` : key;
                            if (typeof value === 'object' && value !== null) {
                                if ('contentid' in value || 'contentID' in value) {
                                    contentRefs.push({ path: currentPath, contentID: value.contentid || value.contentID });
                                }
                            } else if (typeof value === 'object') {
                                scanForContent(value, currentPath);
                            }
                        }
                    }
                };
                
                scanForContent(contentItem.fields);
                
                if (contentRefs.length > 0) {
                    console.log(`      - Content: ${contentRefs.length} content references found`);
                    for (const ref of contentRefs.slice(0, 3)) {
                        console.log(`        * ${ref.path}: contentID ${ref.contentID}`);
                    }
                }
            }
        }

        console.log('\n🎯 Step 6: Reference Mapping Diagnosis Summary');
        console.log('=' .repeat(60));
        console.log('Based on this analysis, the likely issues are:');
        console.log('1. ReferenceMapper may not have proper model → target model ID mappings');
        console.log('2. Container dependencies may not be properly mapped');
        console.log('3. Asset URL mappings may be missing');
        console.log('4. Content items expect mapped references but simplified pusher approach may not set them');
        console.log('\n🔧 Next steps:');
        console.log('- Check if existing pushers actually populate ReferenceMapper during processing');
        console.log('- Verify content-item-pusher logic for finding existing content');
        console.log('- Test with individual pushers vs simplified approach');

    } catch (error) {
        console.error('❌ Error during reference mapping analysis:', error.message);
        console.error(error.stack);
    }
}

// Run if this is the main script
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main }; 