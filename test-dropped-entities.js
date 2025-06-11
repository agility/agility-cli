/**
 * Test script to identify which specific entities are being dropped
 * 
 * This script will show exactly which models and assets are missing IDs
 * and being skipped during upload sequence conversion.
 */

const { ChainBuilder } = require('./dist/lib/services/chain-builder');

async function debugDroppedEntities() {
    console.log('🔍 Debugging Dropped Entities\n');
    
    const chainBuilder = new ChainBuilder();
    const guid = '13a8b394-u';
    const locale = 'en-us';
    const isPreview = true;

    try {
        // Load source data
        console.log('📥 Loading source data...');
        const sourceData = await chainBuilder.loadSourceData(guid, locale, isPreview);
        
        console.log(`✅ Loaded ${sourceData.metadata.totalEntities} total entities`);
        console.log(`   📋 Models: ${sourceData.models?.length || 0}`);
        console.log(`   📎 Assets: ${sourceData.assets?.length || 0}`);
        
        // Simulate what UploadSequenceConverter does for models
        console.log('\n🔍 ANALYZING MODELS...');
        console.log('='.repeat(50));
        
        let validModels = 0;
        let invalidModels = 0;
        const invalidModelDetails = [];
        
        if (sourceData.models) {
            sourceData.models.forEach((model, index) => {
                const modelId = model.referenceName || model.id || model.modelId;
                
                if (!modelId) {
                    invalidModels++;
                    invalidModelDetails.push({
                        index,
                        model: {
                            referenceName: model.referenceName,
                            id: model.id,
                            modelId: model.modelId,
                            displayName: model.displayName,
                            keys: Object.keys(model)
                        }
                    });
                    console.log(`❌ Model ${index}: Missing ID fields`);
                    console.log(`   Display Name: "${model.displayName || 'N/A'}"`);
                    console.log(`   Reference Name: "${model.referenceName || 'N/A'}"`);
                    console.log(`   ID: "${model.id || 'N/A'}"`);
                    console.log(`   Available keys: ${Object.keys(model).join(', ')}`);
                    console.log('');
                } else {
                    validModels++;
                }
            });
        }
        
        console.log(`📊 Model Summary: ${validModels} valid, ${invalidModels} invalid`);
        
        // Simulate what UploadSequenceConverter does for assets
        console.log('\n🔍 ANALYZING ASSETS...');
        console.log('='.repeat(50));
        
        let validAssets = 0;
        let invalidAssets = 0;
        const invalidAssetDetails = [];
        
        if (sourceData.assets) {
            sourceData.assets.forEach((asset, index) => {
                const assetId = asset.fileName || asset.mediaID || asset.id || asset.assetId;
                
                if (!assetId) {
                    invalidAssets++;
                    invalidAssetDetails.push({
                        index,
                        asset: {
                            fileName: asset.fileName,
                            mediaID: asset.mediaID,
                            id: asset.id,
                            assetId: asset.assetId,
                            keys: Object.keys(asset)
                        }
                    });
                    console.log(`❌ Asset ${index}: Missing ID fields`);
                    console.log(`   File Name: "${asset.fileName || 'N/A'}"`);
                    console.log(`   Media ID: "${asset.mediaID || 'N/A'}"`);
                    console.log(`   ID: "${asset.id || 'N/A'}"`);
                    console.log(`   Asset ID: "${asset.assetId || 'N/A'}"`);
                    console.log(`   Available keys: ${Object.keys(asset).join(', ')}`);
                    console.log('');
                } else {
                    validAssets++;
                }
            });
        }
        
        console.log(`📊 Asset Summary: ${validAssets} valid, ${invalidAssets} invalid`);
        
        // Show the first few invalid entities in detail
        if (invalidModelDetails.length > 0) {
            console.log('\n🔬 DETAILED ANALYSIS - INVALID MODELS:');
            invalidModelDetails.slice(0, 2).forEach((detail, i) => {
                console.log(`\nModel ${i + 1}:`);
                console.log(JSON.stringify(detail.model, null, 2));
            });
        }
        
        if (invalidAssetDetails.length > 0) {
            console.log('\n🔬 DETAILED ANALYSIS - INVALID ASSETS:');
            invalidAssetDetails.slice(0, 2).forEach((detail, i) => {
                console.log(`\nAsset ${i + 1}:`);
                console.log(JSON.stringify(detail.asset, null, 2));
            });
        }
        
        // Summary
        console.log('\n📊 FINAL SUMMARY');
        console.log('='.repeat(50));
        console.log(`Models: ${validModels}/${sourceData.models?.length} will be processed`);
        console.log(`Assets: ${validAssets}/${sourceData.assets?.length} will be processed`);
        console.log(`Total dropped: ${invalidModels + invalidAssets} entities`);
        
        if (invalidModels === 1 && invalidAssets === 6) {
            console.log('✅ This matches the 7-entity discrepancy we observed!');
        }
        
        return {
            models: { valid: validModels, invalid: invalidModels, details: invalidModelDetails },
            assets: { valid: validAssets, invalid: invalidAssets, details: invalidAssetDetails }
        };
        
    } catch (error) {
        console.error('❌ Analysis failed:', error.message);
        throw error;
    }
}

// Run the analysis
debugDroppedEntities()
    .then((result) => {
        console.log('\n✅ Dropped entities analysis completed!');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Analysis failed:', error);
        process.exit(1);
    }); 