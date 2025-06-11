/**
 * Test script to check for duplicate IDs that might cause Map overwrites
 * 
 * This script checks if models/assets have duplicate IDs that would cause
 * the upload sequence converter to overwrite entities in the Map.
 */

const { ChainBuilder } = require('./dist/lib/services/chain-builder');

async function debugDuplicateIds() {
    console.log('🔍 Debugging Duplicate IDs\n');
    
    const chainBuilder = new ChainBuilder();
    const guid = '13a8b394-u';
    const locale = 'en-us';
    const isPreview = true;

    try {
        // Load source data
        console.log('📥 Loading source data...');
        const sourceData = await chainBuilder.loadSourceData(guid, locale, isPreview);
        
        // Check for duplicate model IDs
        console.log('\n🔍 CHECKING FOR DUPLICATE MODEL IDs...');
        console.log('='.repeat(60));
        
        const modelIds = new Map();
        const modelDuplicates = [];
        
        if (sourceData.models) {
            sourceData.models.forEach((model, index) => {
                const modelId = model.referenceName || model.id || model.modelId;
                const key = `Model:${modelId}`;
                
                if (modelIds.has(key)) {
                    modelDuplicates.push({
                        key,
                        firstIndex: modelIds.get(key).index,
                        duplicateIndex: index,
                        firstModel: modelIds.get(key).model,
                        duplicateModel: model
                    });
                    console.log(`🚨 DUPLICATE FOUND: ${key}`);
                    console.log(`   First occurrence at index ${modelIds.get(key).index}: ${modelIds.get(key).model.displayName}`);
                    console.log(`   Duplicate at index ${index}: ${model.displayName}`);
                } else {
                    modelIds.set(key, { index, model });
                }
            });
        }
        
        console.log(`📊 Models: ${sourceData.models?.length} total, ${modelIds.size} unique IDs, ${modelDuplicates.length} duplicates`);
        
        // Check for duplicate asset IDs
        console.log('\n🔍 CHECKING FOR DUPLICATE ASSET IDs...');
        console.log('='.repeat(60));
        
        const assetIds = new Map();
        const assetDuplicates = [];
        
        if (sourceData.assets) {
            sourceData.assets.forEach((asset, index) => {
                const assetId = asset.fileName || asset.mediaID || asset.id || asset.assetId;
                const key = `Asset:${assetId}`;
                
                if (assetIds.has(key)) {
                    assetDuplicates.push({
                        key,
                        firstIndex: assetIds.get(key).index,
                        duplicateIndex: index,
                        firstAsset: assetIds.get(key).asset,
                        duplicateAsset: asset
                    });
                    console.log(`🚨 DUPLICATE FOUND: ${key}`);
                    console.log(`   First occurrence at index ${assetIds.get(key).index}: ${assetIds.get(key).asset.fileName || 'No fileName'}`);
                    console.log(`   Duplicate at index ${index}: ${asset.fileName || 'No fileName'}`);
                } else {
                    assetIds.set(key, { index, asset });
                }
            });
        }
        
        console.log(`📊 Assets: ${sourceData.assets?.length} total, ${assetIds.size} unique IDs, ${assetDuplicates.length} duplicates`);
        
        // Check other entity types for completeness
        console.log('\n🔍 CHECKING OTHER ENTITY TYPES...');
        console.log('='.repeat(60));
        
        // Templates
        const templateIds = new Set();
        let templateDuplicates = 0;
        if (sourceData.templates) {
            sourceData.templates.forEach(template => {
                const key = `Template:${template.pageTemplateName}`;
                if (templateIds.has(key)) {
                    templateDuplicates++;
                    console.log(`🚨 Template duplicate: ${key}`);
                } else {
                    templateIds.add(key);
                }
            });
        }
        
        // Galleries
        const galleryIds = new Set();
        let galleryDuplicates = 0;
        if (sourceData.galleries) {
            sourceData.galleries.forEach(gallery => {
                const key = `Gallery:${gallery.mediaGroupingID}`;
                if (galleryIds.has(key)) {
                    galleryDuplicates++;
                    console.log(`🚨 Gallery duplicate: ${key}`);
                } else {
                    galleryIds.add(key);
                }
            });
        }
        
        // Containers
        const containerIds = new Set();
        let containerDuplicates = 0;
        if (sourceData.containers) {
            sourceData.containers.forEach(container => {
                const key = `Container:${container.contentViewID}`;
                if (containerIds.has(key)) {
                    containerDuplicates++;
                    console.log(`🚨 Container duplicate: ${key}`);
                } else {
                    containerIds.add(key);
                }
            });
        }
        
        // Content
        const contentIds = new Set();
        let contentDuplicates = 0;
        if (sourceData.content) {
            sourceData.content.forEach(content => {
                const key = `Content:${content.contentID}`;
                if (contentIds.has(key)) {
                    contentDuplicates++;
                    console.log(`🚨 Content duplicate: ${key}`);
                } else {
                    contentIds.add(key);
                }
            });
        }
        
        // Pages
        const pageIds = new Set();
        let pageDuplicates = 0;
        if (sourceData.pages) {
            sourceData.pages.forEach(page => {
                const key = `Page:${page.pageID}`;
                if (pageIds.has(key)) {
                    pageDuplicates++;
                    console.log(`🚨 Page duplicate: ${key}`);
                } else {
                    pageIds.add(key);
                }
            });
        }
        
        console.log(`📊 Templates: ${sourceData.templates?.length} total, ${templateIds.size} unique, ${templateDuplicates} duplicates`);
        console.log(`📊 Galleries: ${sourceData.galleries?.length} total, ${galleryIds.size} unique, ${galleryDuplicates} duplicates`);
        console.log(`📊 Containers: ${sourceData.containers?.length} total, ${containerIds.size} unique, ${containerDuplicates} duplicates`);
        console.log(`📊 Content: ${sourceData.content?.length} total, ${contentIds.size} unique, ${contentDuplicates} duplicates`);
        console.log(`📊 Pages: ${sourceData.pages?.length} total, ${pageIds.size} unique, ${pageDuplicates} duplicates`);
        
        // Calculate expected vs actual upload sequence entities
        const expectedTotal = modelIds.size + assetIds.size + templateIds.size + galleryIds.size + containerIds.size + contentIds.size + pageIds.size;
        const actualTotal = sourceData.metadata.totalEntities;
        const uploadSequenceTotal = 6069; // From previous tests
        
        console.log('\n📊 FINAL ANALYSIS');
        console.log('='.repeat(60));
        console.log(`Total source entities: ${actualTotal}`);
        console.log(`Total unique entity IDs: ${expectedTotal}`);
        console.log(`Upload sequence entities: ${uploadSequenceTotal}`);
        console.log(`Missing from upload sequence: ${expectedTotal - uploadSequenceTotal}`);
        
        const totalDuplicates = modelDuplicates.length + assetDuplicates.length + templateDuplicates + galleryDuplicates + containerDuplicates + contentDuplicates + pageDuplicates;
        console.log(`Total duplicates found: ${totalDuplicates}`);
        
        if (totalDuplicates === (actualTotal - uploadSequenceTotal)) {
            console.log('✅ FOUND THE ISSUE: Duplicate IDs causing Map overwrites!');
        } else {
            console.log('🤔 Duplicates don\'t fully explain the discrepancy...');
        }
        
        return {
            modelDuplicates,
            assetDuplicates,
            totalDuplicates,
            expectedTotal,
            actualTotal,
            uploadSequenceTotal
        };
        
    } catch (error) {
        console.error('❌ Analysis failed:', error.message);
        throw error;
    }
}

// Run the analysis
debugDuplicateIds()
    .then((result) => {
        console.log('\n✅ Duplicate ID analysis completed!');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Analysis failed:', error);
        process.exit(1);
    }); 