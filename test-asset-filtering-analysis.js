// Test to understand which assets are being filtered out during entity map building
const { SourceDataLoader } = require('./dist/lib/services/sync-analysis/source-data-loader');
const { UploadSequenceConverter } = require('./dist/lib/services/upload-sequence-converter');

async function analyzeAssetFiltering() {
    console.log('🔍 Asset Filtering Analysis\n');
    
    try {
        // Step 1: Load source data
        console.log('Step 1: Loading source data...');
        const sourceDataLoader = new SourceDataLoader();
        await sourceDataLoader.initialize();
        const sourceData = await sourceDataLoader.loadSourceData('agility-files/13a8b394-u/en-us/preview', {
            verbose: false,
            includeAnalysis: false
        });
        
        console.log(`📊 Source Data:`);
        console.log(`   Total Assets in JSON: ${sourceData.assets?.length || 0}`);
        
        // Step 2: Manually trace asset processing
        console.log('\nStep 2: Manually analyzing asset processing...');
        
        const processedAssets = [];
        const skippedAssets = [];
        
        if (sourceData.assets) {
            sourceData.assets.forEach((asset, index) => {
                const assetId = asset.fileName || asset.mediaID || asset.id || asset.assetId;
                
                if (!assetId) {
                    skippedAssets.push({
                        index,
                        asset,
                        reason: 'Missing ID fields'
                    });
                } else {
                    processedAssets.push({
                        index,
                        assetId,
                        fileName: asset.fileName,
                        mediaID: asset.mediaID,
                        id: asset.id,
                        assetId: asset.assetId
                    });
                }
            });
        }
        
        console.log(`✅ Successfully processed: ${processedAssets.length} assets`);
        console.log(`❌ Skipped during processing: ${skippedAssets.length} assets`);
        
        if (skippedAssets.length > 0) {
            console.log('\n🚨 SKIPPED ASSETS:');
            skippedAssets.forEach((skipped, i) => {
                console.log(`   ${i + 1}. Index ${skipped.index}:`);
                console.log(`      fileName: ${skipped.asset.fileName}`);
                console.log(`      mediaID: ${skipped.asset.mediaID}`);
                console.log(`      id: ${skipped.asset.id}`);
                console.log(`      assetId: ${skipped.asset.assetId}`);
                console.log(`      Reason: ${skipped.reason}`);
                console.log('');
            });
        }
        
        // Step 3: Run actual converter to see filtering
        console.log('Step 3: Running upload sequence converter...');
        const converter = new UploadSequenceConverter();
        const baselineSequence = await converter.convertToUploadSequence({}, sourceData);
        
        console.log(`📦 Converter Results:`);
        console.log(`   Total entities in sequence: ${baselineSequence.metadata.totalEntities}`);
        
        // Count assets in batches
        let assetsInBatches = 0;
        baselineSequence.batches.forEach(batch => {
            const batchAssets = batch.entities.filter(e => e.type === 'Asset').length;
            assetsInBatches += batchAssets;
            console.log(`   Batch ${batch.level}: ${batchAssets} assets`);
        });
        
        console.log(`   Total assets in batches: ${assetsInBatches}`);
        
        // Step 4: Gap analysis
        console.log('\n📊 GAP ANALYSIS:');
        console.log(`   JSON Assets: ${sourceData.assets?.length || 0}`);
        console.log(`   Processed Assets: ${processedAssets.length}`);
        console.log(`   Converter Assets: ${assetsInBatches}`);
        console.log(`   Expected Gap: ${(sourceData.assets?.length || 0) - processedAssets.length} (skipped during ID check)`);
        console.log(`   Actual Gap: ${processedAssets.length - assetsInBatches} (filtered after processing)`);
        
        if (processedAssets.length !== assetsInBatches) {
            console.log('\n🚨 ADDITIONAL FILTERING DETECTED!');
            console.log(`   ${processedAssets.length - assetsInBatches} assets were filtered out AFTER processing`);
            console.log('   This suggests the converter has additional filtering logic beyond ID validation');
        }
        
        return {
            sourceAssets: sourceData.assets?.length || 0,
            processedAssets: processedAssets.length,
            converterAssets: assetsInBatches,
            skippedAssets: skippedAssets.length,
            gapAfterProcessing: processedAssets.length - assetsInBatches
        };
        
    } catch (error) {
        console.error('❌ Error during asset filtering analysis:', error);
        return { error: error.message };
    }
}

// Run the analysis
analyzeAssetFiltering()
    .then(result => {
        if (result.error) {
            console.log('\n❌ Analysis failed:', result.error);
        } else {
            console.log('\n📈 ANALYSIS COMPLETE');
            console.log(`   The gap analysis shows where assets are being lost in the conversion process`);
        }
    })
    .catch(console.error); 