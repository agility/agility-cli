/**
 * Debug Missing Entities
 * 
 * Identifies the exact 7 entities missing from the upload sequence
 * to achieve 100% entity inclusion
 */

const { ChainBuilder } = require('./dist/lib/services/chain-builder');
const { UploadSequenceConverter } = require('./dist/lib/services/upload-sequence-converter');

async function debugMissingEntities() {
    console.log('🔍 Debugging Missing Entities\n');
    
    const chainBuilder = new ChainBuilder();
    const guid = '13a8b394-u';
    const locale = 'en-us';
    const isPreview = true;

    try {
        // Step 1: Load source data and perform analysis
        const sourceData = await chainBuilder.loadSourceData(guid, locale, isPreview);
        const analysisResults = await chainBuilder.performChainAnalysis(sourceData);
        
        // Step 2: Convert to upload sequence
        const converter = new UploadSequenceConverter();
        const uploadSequence = converter.convertToUploadSequence(analysisResults, sourceData);
        
        console.log('📊 ENTITY COUNT ANALYSIS');
        console.log('=' .repeat(50));
        console.log(`Source Entities: ${sourceData.metadata.totalEntities}`);
        console.log(`Upload Entities: ${uploadSequence.metadata.totalEntities}`);
        console.log(`Missing: ${sourceData.metadata.totalEntities - uploadSequence.metadata.totalEntities}`);
        
        // Step 3: Build comprehensive entity sets from source data
        const sourceEntitySets = {
            models: new Set(),
            templates: new Set(),
            galleries: new Set(),
            assets: new Set(),
            containers: new Set(),
            content: new Set(),
            pages: new Set()
        };
        
        // Extract all source entity IDs
        sourceData.models?.forEach(model => {
            const modelId = model.referenceName || model.id || model.modelId;
            if (modelId) sourceEntitySets.models.add(`Model:${modelId}`);
        });
        
        sourceData.templates?.forEach(template => {
            const templateId = template.pageTemplateName;
            if (templateId) sourceEntitySets.templates.add(`Template:${templateId}`);
        });
        
        sourceData.galleries?.forEach(gallery => {
            const galleryId = gallery.mediaGroupingID || gallery.id || gallery.galleryId;
            if (galleryId) sourceEntitySets.galleries.add(`Gallery:${galleryId}`);
        });
        
        sourceData.assets?.forEach(asset => {
            const assetId = asset.fileName || asset.mediaID || asset.id || asset.assetId;
            if (assetId) sourceEntitySets.assets.add(`Asset:${assetId}`);
        });
        
        sourceData.containers?.forEach(container => {
            const containerId = container.contentViewID || container.id || container.containerId;
            if (containerId) sourceEntitySets.containers.add(`Container:${containerId}`);
        });
        
        sourceData.content?.forEach(content => {
            const contentId = content.contentID || content.contentId || content.id || 
                             content.properties?.contentID || content.properties?.contentId;
            if (contentId) sourceEntitySets.content.add(`Content:${contentId}`);
        });
        
        sourceData.pages?.forEach(page => {
            const pageId = page.pageID || page.pageId || page.id;
            if (pageId) sourceEntitySets.pages.add(`Page:${pageId}`);
        });
        
        // Step 4: Build upload entity set
        const uploadEntitySet = new Set();
        uploadSequence.batches.forEach(batch => {
            batch.entities.forEach(entity => {
                uploadEntitySet.add(`${entity.type}:${entity.id}`);
            });
        });
        
        // Step 5: Find missing entities by type
        console.log('\n🔍 MISSING ENTITIES BY TYPE');
        console.log('=' .repeat(50));
        
        let totalMissing = 0;
        
        Object.entries(sourceEntitySets).forEach(([type, sourceSet]) => {
            const missing = [...sourceSet].filter(entityKey => !uploadEntitySet.has(entityKey));
            
            if (missing.length > 0) {
                console.log(`\n❌ Missing ${type.toUpperCase()}: ${missing.length} entities`);
                missing.forEach(entityKey => {
                    console.log(`   - ${entityKey}`);
                });
                totalMissing += missing.length;
            } else {
                console.log(`✅ ${type.toUpperCase()}: All ${sourceSet.size} entities included`);
            }
        });
        
        console.log(`\n📊 Total Missing: ${totalMissing} entities`);
        
        // Step 6: Debug entity processing issues
        console.log('\n🔧 PROCESSING DEBUG INFO');
        console.log('=' .repeat(50));
        
        // Check for ID resolution issues
        console.log('Models with missing IDs:');
        sourceData.models?.forEach((model, index) => {
            const modelId = model.referenceName || model.id || model.modelId;
            if (!modelId) {
                console.log(`   ⚠️ Model ${index}: No valid ID found`, {
                    referenceName: model.referenceName,
                    id: model.id,
                    modelId: model.modelId,
                    displayName: model.displayName
                });
            }
        });
        
        console.log('\nAssets with missing IDs:');
        let assetsMissingIds = 0;
        sourceData.assets?.forEach((asset, index) => {
            const assetId = asset.fileName || asset.mediaID || asset.id || asset.assetId;
            if (!assetId) {
                console.log(`   ⚠️ Asset ${index}: No valid ID found`, {
                    fileName: asset.fileName,
                    mediaID: asset.mediaID,
                    id: asset.id,
                    assetId: asset.assetId
                });
                assetsMissingIds++;
            }
        });
        
        console.log(`\n📊 Assets missing IDs: ${assetsMissingIds}`);
        
        return {
            sourceTotal: sourceData.metadata.totalEntities,
            uploadTotal: uploadSequence.metadata.totalEntities,
            missing: totalMissing
        };
        
    } catch (error) {
        console.error('❌ Debug failed:', error.message);
        throw error;
    }
}

// Run the debug
debugMissingEntities()
    .then(result => {
        console.log(`\n🔬 Debug completed: ${result.missing} entities missing`);
        if (result.missing === 0) {
            console.log('🎉 100% entity inclusion achieved!');
        }
    })
    .catch(error => {
        console.error('💥 Debug error:', error);
        process.exit(1);
    }); 