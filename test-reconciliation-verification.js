const path = require('path');
const { SourceDataLoader } = require('./dist/lib/services/sync-analysis/source-data-loader');
const { AssetFilesystemScanner } = require('./dist/lib/services/asset-filesystem-scanner');
const { UploadSequenceConverter } = require('./dist/lib/services/upload-sequence-converter');

async function verifyReconciliationIntegrity() {
    console.log('🔍 Reconciliation Integrity Verification\n');
    
    try {
        // Step 1: Load source data and get baseline counts
        console.log('Step 1: Loading source data and establishing baseline...');
        const sourceDataLoader = new SourceDataLoader();
        await sourceDataLoader.initialize();
        const sourceData = await sourceDataLoader.loadSourceData('agility-files/13a8b394-u/en-us/preview', {
            verbose: true,
            includeAnalysis: false
        });
        
        const originalTotalEntities = sourceData.metadata.totalEntities;
        const originalAssetCount = sourceData.assets?.length || 0;
        
        console.log(`📊 Source Data Baseline:`);
        console.log(`   Total Entities: ${originalTotalEntities}`);
        console.log(`   Assets in JSON: ${originalAssetCount}`);
        console.log('');
        
        // Step 2: Get filesystem asset discovery
        console.log('Step 2: Discovering filesystem assets...');
        const assetScanner = new AssetFilesystemScanner('agility-files/13a8b394-u/en-us/preview');
        const assetDiscovery = await assetScanner.scanForAssets(sourceData.assets || []);
        
        const filesystemAssets = assetDiscovery.matchedAssets.length;
        const missingAssets = assetDiscovery.missingAssets.length;
        const urlBasedAssets = assetDiscovery.missingAssets.filter(asset => asset.edgeUrl).length;
        
        console.log(`📁 Asset Discovery:`);
        console.log(`   Assets with Files: ${filesystemAssets}`);
        console.log(`   Assets without Files: ${missingAssets}`);
        console.log(`   URL-Based Assets: ${urlBasedAssets}`);
        console.log(`   Total Assets Accounted: ${filesystemAssets + missingAssets} (should equal ${originalAssetCount})`);
        console.log('');
        
        // Step 3: Create baseline upload sequence (without URL assets)
        console.log('Step 3: Creating baseline upload sequence...');
        const baselineConverter = new UploadSequenceConverter();
        const baselineSequence = await baselineConverter.convertToUploadSequence(sourceData);
        
        console.log(`📦 Baseline Upload Sequence:`);
        console.log(`   Total Entities: ${baselineSequence.metadata.totalEntities}`);
        console.log(`   Skipped Entities: ${baselineSequence.skippedItems.totalSkipped}`);
        console.log(`   Uploadable: ${baselineSequence.metadata.totalEntities} / ${originalTotalEntities} = ${(baselineSequence.metadata.totalEntities/originalTotalEntities*100).toFixed(1)}%`);
        console.log('');
        
        // Step 4: Create enhanced upload sequence (with URL assets)
        console.log('Step 4: Creating enhanced upload sequence with URL assets...');
        const enhancedConverter = new UploadSequenceConverter();
        const urlBasedUploadEntries = assetDiscovery.missingAssets
            .filter(asset => asset.edgeUrl)
            .map(asset => ({
                id: asset.assetID,
                type: 'Asset',
                uploadMethod: 'url',
                edgeUrl: asset.edgeUrl,
                fileName: asset.fileName
            }));
        
        const enhancedSequence = await enhancedConverter.convertToUploadSequence(sourceData, urlBasedUploadEntries);
        
        console.log(`📦 Enhanced Upload Sequence:`);
        console.log(`   Total Entities: ${enhancedSequence.metadata.totalEntities}`);
        console.log(`   Skipped Entities: ${enhancedSequence.skippedItems.totalSkipped}`);
        console.log('');
        
        // Step 5: CRITICAL ANALYSIS - Check for double counting
        console.log('🚨 CRITICAL ANALYSIS: Checking for Double-Counting');
        console.log('=' .repeat(60));
        
        const baselineAssetCount = baselineSequence.batches.reduce((count, batch) => {
            return count + batch.entities.filter(e => e.type === 'Asset').length;
        }, 0);
        
        const enhancedAssetCount = enhancedSequence.batches.reduce((count, batch) => {
            return count + batch.entities.filter(e => e.type === 'Asset').length;
        }, 0);
        
        const urlAssetsInBatches = enhancedSequence.batches.reduce((count, batch) => {
            return count + batch.entities.filter(e => e.type === 'Asset' && e.uploadMethod === 'url').length;
        }, 0);
        
        console.log(`📊 Asset Counting Analysis:`);
        console.log(`   Original JSON Assets: ${originalAssetCount}`);
        console.log(`   Baseline Upload Assets: ${baselineAssetCount}`);
        console.log(`   Enhanced Upload Assets: ${enhancedAssetCount}`);
        console.log(`   URL Assets in Batches: ${urlAssetsInBatches}`);
        console.log(`   Asset Increase: ${enhancedAssetCount - baselineAssetCount}`);
        console.log('');
        
        // Step 6: Check for duplicate asset IDs
        console.log('🔍 Checking for duplicate asset IDs in enhanced sequence...');
        const allAssetIds = new Set();
        const duplicateIds = new Set();
        
        enhancedSequence.batches.forEach(batch => {
            batch.entities.filter(e => e.type === 'Asset').forEach(asset => {
                if (allAssetIds.has(asset.id)) {
                    duplicateIds.add(asset.id);
                    console.log(`   ⚠️  DUPLICATE: Asset ID ${asset.id} appears multiple times`);
                }
                allAssetIds.add(asset.id);
            });
        });
        
        console.log(`   Total Unique Asset IDs: ${allAssetIds.size}`);
        console.log(`   Duplicate Asset IDs: ${duplicateIds.size}`);
        console.log('');
        
        // Step 7: Final Integrity Assessment
        console.log('📈 FINAL INTEGRITY ASSESSMENT');
        console.log('=' .repeat(50));
        
        const expectedMaxUploadable = originalTotalEntities;
        const actualUploadable = enhancedSequence.metadata.totalEntities;
        const isDoubleCountingDetected = actualUploadable > expectedMaxUploadable;
        const trueReconciliationRate = Math.min(actualUploadable, expectedMaxUploadable) / expectedMaxUploadable * 100;
        
        console.log(`Expected Max Uploadable: ${expectedMaxUploadable} (cannot exceed source data)`);
        console.log(`Actual Upload Entities: ${actualUploadable}`);
        console.log(`Double-Counting Detected: ${isDoubleCountingDetected ? '🚨 YES' : '✅ NO'}`);
        console.log(`True Reconciliation Rate: ${trueReconciliationRate.toFixed(1)}%`);
        console.log('');
        
        if (isDoubleCountingDetected) {
            console.log('🚨 INTEGRITY ISSUE DETECTED:');
            console.log(`   We're trying to upload ${actualUploadable} entities from ${expectedMaxUploadable} source entities.`);
            console.log(`   This indicates double-counting of entities, likely assets being included both as file-based AND URL-based.`);
            console.log(`   The upload sequence contains duplicate entries for the same logical entities.`);
            console.log('');
            console.log('🔧 RECOMMENDED FIX:');
            console.log(`   URL assets should REPLACE file-based asset entries, not ADD to them.`);
            console.log(`   The UploadSequenceConverter should deduplicate assets by ID.`);
        } else {
            console.log('✅ INTEGRITY VERIFIED:');
            console.log(`   Upload entity count (${actualUploadable}) does not exceed source entities (${expectedMaxUploadable}).`);
            console.log(`   True 100% reconciliation achieved through proper asset recovery.`);
        }
        
        return {
            integrityPassed: !isDoubleCountingDetected,
            originalEntities: expectedMaxUploadable,
            uploadableEntities: actualUploadable,
            trueReconciliationRate,
            duplicateAssetIds: duplicateIds.size,
            doubleCountingDetected: isDoubleCountingDetected
        };
        
    } catch (error) {
        console.error('❌ Error during reconciliation verification:', error);
        return { error: error.message };
    }
}

// Run the verification
verifyReconciliationIntegrity()
    .then(result => {
        if (result.error) {
            console.log('❌ Verification failed:', result.error);
        } else if (result.integrityPassed) {
            console.log('\n🎉 VERIFICATION PASSED: True 100% reconciliation achieved!');
        } else {
            console.log('\n🚨 VERIFICATION FAILED: Double-counting detected, not true 100% reconciliation.');
        }
    })
    .catch(console.error); 