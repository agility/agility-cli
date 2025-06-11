const { SourceDataLoader } = require('./dist/lib/services/sync-analysis/source-data-loader');
const { UploadSequenceConverter } = require('./dist/lib/services/upload-sequence-converter');

async function identifyMissingEntities() {
    console.log('🔍 Identifying Missing Entities\n');
    
    // Load source data
    console.log('🔄 Loading source data...');
    const loader = new SourceDataLoader();
    await loader.initialize('13a8b394-u', 'en-us');
    const sourceData = await loader.loadSourceData('13a8b394-u', 'en-us', { bypassChainAnalysis: true });
    
    console.log(`✅ Loaded source entities:`);
    console.log(`   📋 Models: ${sourceData.models?.length || 0}`);
    console.log(`   📎 Assets: ${sourceData.assets?.length || 0}`);
    console.log(`   📝 Content: ${sourceData.content?.length || 0}`);
    console.log(`   🏗️  Templates: ${sourceData.templates?.length || 0}`);
    console.log(`   📦 Containers: ${sourceData.containers?.length || 0}`);
    console.log(`   📄 Pages: ${sourceData.pages?.length || 0}`);
    console.log(`   🖼️  Galleries: ${sourceData.galleries?.length || 0}`);
    
    const totalSource = (sourceData.models?.length || 0) + 
                       (sourceData.assets?.length || 0) + 
                       (sourceData.content?.length || 0) + 
                       (sourceData.templates?.length || 0) + 
                       (sourceData.containers?.length || 0) + 
                       (sourceData.pages?.length || 0) + 
                       (sourceData.galleries?.length || 0);
                       
    console.log(`📊 Total Source Entities: ${totalSource}\n`);
    
    // Check for missing IDs in models
    console.log('🔍 Analyzing Models with Missing IDs:');
    let modelsWithMissingIds = 0;
    if (sourceData.models) {
        sourceData.models.forEach((model, index) => {
            const modelId = model.referenceName || model.id || model.modelId;
            if (!modelId) {
                console.log(`   ❌ Model ${index}: ${JSON.stringify({
                    referenceName: model.referenceName,
                    id: model.id,
                    modelId: model.modelId,
                    displayName: model.displayName
                }, null, 2)}`);
                modelsWithMissingIds++;
            }
        });
    }
    console.log(`📊 Models with missing IDs: ${modelsWithMissingIds}\n`);
    
    // Check for missing IDs in assets  
    console.log('🔍 Analyzing Assets with Missing IDs:');
    let assetsWithMissingIds = 0;
    if (sourceData.assets) {
        sourceData.assets.forEach((asset, index) => {
            const assetId = asset.fileName || asset.mediaID || asset.id || asset.assetId;
            if (!assetId) {
                console.log(`   ❌ Asset ${index}: ${JSON.stringify({
                    fileName: asset.fileName,
                    mediaID: asset.mediaID,
                    id: asset.id,
                    assetId: asset.assetId,
                    url: asset.url,
                    originUrl: asset.originUrl
                }, null, 2)}`);
                assetsWithMissingIds++;
            }
        });
    }
    console.log(`📊 Assets with missing IDs: ${assetsWithMissingIds}\n`);
    
    // Check for missing IDs in content
    console.log('🔍 Analyzing Content with Missing IDs:');
    let contentWithMissingIds = 0;
    if (sourceData.content) {
        sourceData.content.forEach((content, index) => {
            const contentId = content.contentID || content.contentId || content.id || 
                             content.properties?.contentID || content.properties?.contentId;
            if (!contentId) {
                console.log(`   ❌ Content ${index}: ${JSON.stringify({
                    contentID: content.contentID,
                    contentId: content.contentId,
                    id: content.id,
                    properties: content.properties
                }, null, 2)}`);
                contentWithMissingIds++;
            }
        });
    }
    console.log(`📊 Content with missing IDs: ${contentWithMissingIds}\n`);
    
    const totalMissing = modelsWithMissingIds + assetsWithMissingIds + contentWithMissingIds;
    console.log(`📊 SUMMARY:`);
    console.log(`   Total entities missing IDs: ${totalMissing}`);
    console.log(`   Expected upload entities: ${totalSource - totalMissing}`);
    console.log(`   This should match our upload sequence count of 6069`);
}

identifyMissingEntities().catch(console.error); 