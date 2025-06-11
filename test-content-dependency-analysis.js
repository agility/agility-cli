/**
 * SIMPLE DEBUG: Content Dependency Analysis
 * 
 * Analyze what dependencies content items need and why they might be failing
 */

const path = require('path');
const fs = require('fs');

function main() {
    console.log('🔍 Content Dependency Analysis');
    console.log('=' .repeat(60));

    const sourceGuid = '67bc73e6-u';
    const locale = 'en-us';
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

    // Load source entities
    const models = loadJsonFiles('models');
    const containers = loadJsonFiles('containers');
    const content = loadJsonFiles('item'); // Content items are in 'item' directory
    
    console.log(`📊 Source Data Loaded:`);
    console.log(`  - Models: ${models.length}`);
    console.log(`  - Containers: ${containers.length}`);
    console.log(`  - Content: ${content.length}`);

    // Analyze first few failing content items from logs
    const failingContentNames = [
        'changelog', 'overviewsections', 'angulararticles', 'developerarticles'
    ];

    console.log('\n🔍 Analysis of Failing Content Items:');
    console.log('=' .repeat(60));

    for (const refName of failingContentNames) {
        const contentItem = content.find(c => c.properties?.referenceName === refName);
        
        if (!contentItem) {
            console.log(`\n❌ Content "${refName}" not found in source data`);
            continue;
        }

        console.log(`\n📄 Content: ${refName}`);
        console.log(`    Definition: ${contentItem.properties?.definitionName}`);
        console.log(`    Content ID: ${contentItem.contentID}`);

        // Check container dependency
        const definitionName = contentItem.properties?.definitionName;
        if (definitionName) {
            const container = containers.find(c => c.referenceName === definitionName);
            if (container) {
                console.log(`    ✅ Container found: ${definitionName} (ID: ${container.contentViewID})`);
                
                // Check model dependency
                const modelName = container.contentDefinition?.modelName;
                if (modelName) {
                    const model = models.find(m => m.referenceName === modelName);
                    if (model) {
                        console.log(`    ✅ Model found: ${modelName} (ID: ${model.id})`);
                    } else {
                        console.log(`    ❌ Model NOT found: ${modelName}`);
                    }
                } else {
                    console.log(`    ⚠️ No model dependency in container`);
                }
            } else {
                console.log(`    ❌ Container NOT found: ${definitionName}`);
            }
        }

        // Check content references in fields
        let contentRefs = 0;
        let assetRefs = 0;
        
        const scanForDependencies = (obj, path = '') => {
            if (typeof obj === 'object' && obj !== null) {
                for (const [key, value] of Object.entries(obj)) {
                    const currentPath = path ? `${path}.${key}` : key;
                    
                    if (typeof value === 'string' && value.includes('cdn.aglty.io')) {
                        assetRefs++;
                    } else if (typeof value === 'object' && value !== null) {
                        if ('contentid' in value || 'contentID' in value) {
                            contentRefs++;
                            const refContentId = value.contentid || value.contentID;
                            console.log(`    🔗 Content ref in ${currentPath}: contentID ${refContentId}`);
                            
                            // Check if referenced content exists
                            const referencedContent = content.find(c => c.contentID === refContentId);
                            if (referencedContent) {
                                console.log(`        ✅ Referenced content found: ${referencedContent.properties?.referenceName}`);
                            } else {
                                console.log(`        ❌ Referenced content NOT found: contentID ${refContentId}`);
                            }
                        } else {
                            scanForDependencies(value, currentPath);
                        }
                    }
                }
            }
        };
        
        if (contentItem.fields) {
            scanForDependencies(contentItem.fields);
        }
        
        console.log(`    📊 Dependencies: ${contentRefs} content refs, ${assetRefs} asset refs`);
    }

    console.log('\n🎯 Key Insights:');
    console.log('=' .repeat(60));
    console.log('1. Content items depend on:');
    console.log('   - Container (by definitionName)');
    console.log('   - Model (via container modelName)');
    console.log('   - Other content items (via contentid fields)');
    console.log('   - Assets (via cdn.aglty.io URLs)');
    
    console.log('\n2. For upload to work, ReferenceMapper must have:');
    console.log('   - Source container ID → Target container ID mappings');
    console.log('   - Source model ID → Target model ID mappings'); 
    console.log('   - Source content ID → Target content ID mappings');
    console.log('   - Source asset URL → Target asset URL mappings');

    console.log('\n3. Likely failure reasons:');
    console.log('   - content-item-pusher can\'t find container in target via definitionName');
    console.log('   - ReferenceMapper doesn\'t have container mappings from simplified approach');
    console.log('   - Content references can\'t be resolved without proper ID mappings');

    console.log('\n🔧 Next Investigation Steps:');
    console.log('1. Check if pushModels, pushContainers actually populate ReferenceMapper');
    console.log('2. Test content-item-finder with empty vs populated ReferenceMapper');
    console.log('3. Compare simplified vs proven 2-pass approach');
    console.log('4. Verify change detection to avoid pushing existing items');
}

// Run if this is the main script
if (require.main === module) {
    main();
}

module.exports = { main }; 