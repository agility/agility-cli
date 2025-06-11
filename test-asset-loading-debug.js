const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const fs = require('fs');

async function debugAssetLoading() {
    console.log('🔍 Debug Asset Loading in Sync Analysis\n');
    
    try {
        // Step 1: Check raw JSON data
        console.log('Step 1: Raw JSON File Analysis');
        const jsonData = JSON.parse(fs.readFileSync('agility-files/13a8b394-u/en-us/preview/assets/json/1.json', 'utf8'));
        console.log(`   📊 Raw JSON totalCount: ${jsonData.totalCount}`);
        console.log(`   📊 Raw JSON assetMedias.length: ${jsonData.assetMedias.length}`);
        
        // Step 2: Test Chain Data Loader directly
        console.log('\nStep 2: Chain Data Loader Processing');
        const chainDataLoader = new ChainDataLoader({
            sourceGuid: '13a8b394-u',
            locale: 'en-us',
            isPreview: true,
            rootPath: process.cwd(),
            elements: ['Assets']
        });
        
        const sourceEntities = await chainDataLoader.loadSourceEntities();
        console.log(`   📊 Chain Data Loader assets: ${sourceEntities.assets?.length || 0}`);
        
        // Step 3: Compare the differences
        if (sourceEntities.assets) {
            console.log('\nStep 3: Asset Comparison Analysis');
            const loadedAssetIds = new Set(sourceEntities.assets.map(a => a.mediaID));
            const rawAssetIds = new Set(jsonData.assetMedias.map(a => a.mediaID));
            
            console.log(`   Raw asset IDs count: ${rawAssetIds.size}`);
            console.log(`   Loaded asset IDs count: ${loadedAssetIds.size}`);
            
            // Find missing assets
            const missingAssets = jsonData.assetMedias.filter(asset => !loadedAssetIds.has(asset.mediaID));
            console.log(`   Missing assets: ${missingAssets.length}`);
            
            if (missingAssets.length > 0) {
                console.log('\nStep 4: Missing Asset Analysis');
                missingAssets.slice(0, 5).forEach((asset, i) => {
                    console.log(`   ${i+1}. mediaID: ${asset.mediaID}, fileName: ${asset.fileName}, isDeleted: ${asset.isDeleted}`);
                });
            }
            
            // Check for filtering patterns
            const deletedAssets = jsonData.assetMedias.filter(a => a.isDeleted);
            const folderAssets = jsonData.assetMedias.filter(a => a.isFolder);
            
            console.log(`\nStep 5: Asset Type Breakdown`);
            console.log(`   Total assets: ${jsonData.assetMedias.length}`);
            console.log(`   Deleted assets: ${deletedAssets.length}`);
            console.log(`   Folder assets: ${folderAssets.length}`);
            console.log(`   Regular files: ${jsonData.assetMedias.length - deletedAssets.length - folderAssets.length}`);
        }
        
    } catch (error) {
        console.error('❌ Error during asset loading debug:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
    }
}

debugAssetLoading(); 