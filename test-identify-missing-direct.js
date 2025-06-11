const fs = require('fs');
const path = require('path');

function loadJsonFiles(dirPath) {
    if (!fs.existsSync(dirPath)) {
        console.log(`❌ Directory not found: ${dirPath}`);
        return [];
    }
    
    const files = fs.readdirSync(dirPath);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    const items = [];
    jsonFiles.forEach(file => {
        const filePath = path.join(dirPath, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        items.push(data);
    });
    
    return items;
}

function checkMissingIds() {
    console.log('🔍 Direct Check for Missing IDs\n');
    
    const basePath = 'agility-files/13a8b394-u/en-us/preview';
    
    // Load models directly
    console.log('📋 Checking Models...');
    const models = loadJsonFiles(path.join(basePath, 'models'));
    console.log(`   Loaded ${models.length} models`);
    
    let modelsWithMissingIds = 0;
    models.forEach((model, index) => {
        const modelId = model.referenceName || model.id || model.modelId;
        if (!modelId) {
            console.log(`   ❌ Model ${index}: Missing ID - displayName: "${model.displayName}"`);
            console.log(`      Available fields:`, Object.keys(model));
            modelsWithMissingIds++;
        }
    });
    console.log(`   Models with missing IDs: ${modelsWithMissingIds}\n`);
    
    // Load assets directly from all subdirectories
    console.log('📎 Checking Assets...');
    const assetDirs = ['posts', 'mobile', 'MediaGroupings', 'logos', 'Attachments', 'json'];
    const allAssets = [];
    assetDirs.forEach(dir => {
        const dirAssets = loadJsonFiles(path.join(basePath, 'assets', dir));
        allAssets.push(...dirAssets);
    });
    const assets = allAssets;
    console.log(`   Loaded ${assets.length} assets from subdirectories`);
    
    let assetsWithMissingIds = 0;
    assets.forEach((asset, index) => {
        const assetId = asset.fileName || asset.mediaID || asset.id || asset.assetId;
        if (!assetId) {
            console.log(`   ❌ Asset ${index}: Missing ID`);
            console.log(`      Available fields:`, Object.keys(asset));
            console.log(`      url: "${asset.url || asset.originUrl || 'No URL'}"`);
            assetsWithMissingIds++;
        }
    });
    console.log(`   Assets with missing IDs: ${assetsWithMissingIds}\n`);
    
    // Load content directly
    console.log('📝 Checking Content...');
    const contentItems = loadJsonFiles(path.join(basePath, 'item'));
    const contentLists = loadJsonFiles(path.join(basePath, 'list'));
    const totalContent = contentItems.length + contentLists.length;
    console.log(`   Loaded ${totalContent} content items (${contentItems.length} items + ${contentLists.length} lists)`);
    
    let contentWithMissingIds = 0;
    [...contentItems, ...contentLists].forEach((content, index) => {
        const contentId = content.contentID || content.contentId || content.id || 
                         content.properties?.contentID || content.properties?.contentId;
        if (!contentId) {
            console.log(`   ❌ Content ${index}: Missing ID`);
            console.log(`      Available fields:`, Object.keys(content));
            if (content.properties) {
                console.log(`      Properties fields:`, Object.keys(content.properties));
            }
            contentWithMissingIds++;
        }
    });
    console.log(`   Content with missing IDs: ${contentWithMissingIds}\n`);
    
    // Check other types for completeness
    const templates = loadJsonFiles(path.join(basePath, 'templates'));
    const containers = loadJsonFiles(path.join(basePath, 'containers'));
    const pages = loadJsonFiles(path.join(basePath, 'sitemap'));
    
    // Check galleries
    console.log('🖼️ Checking Galleries...');
    const galleryDirs = ['assets'];
    const allGalleries = [];
    galleryDirs.forEach(dir => {
        const galleryFiles = loadJsonFiles(path.join(basePath, dir, 'galleries'));
        galleryFiles.forEach(galleryFile => {
            if (galleryFile.assetMediaGroupings) {
                allGalleries.push(...galleryFile.assetMediaGroupings);
            }
        });
    });
    const galleries = allGalleries;
    
    console.log('📊 SUMMARY:');
    console.log(`   Models: ${models.length} total, ${modelsWithMissingIds} missing IDs`);
    console.log(`   Assets: ${assets.length} total, ${assetsWithMissingIds} missing IDs`);
    console.log(`   Content: ${totalContent} total, ${contentWithMissingIds} missing IDs`);
    console.log(`   Templates: ${templates.length} total`);
    console.log(`   Containers: ${containers.length} total`);
    console.log(`   Pages: ${pages.length} total`);
    console.log(`   Galleries: ${galleries.length} total`);
    
    const totalEntities = models.length + assets.length + totalContent + templates.length + containers.length + pages.length + galleries.length;
    const totalMissingIds = modelsWithMissingIds + assetsWithMissingIds + contentWithMissingIds;
    
    console.log(`\n📈 CALCULATIONS:`);
    console.log(`   Total source entities: ${totalEntities}`);
    console.log(`   Total entities with missing IDs: ${totalMissingIds}`);
    console.log(`   Expected upload entities: ${totalEntities - totalMissingIds}`);
    console.log(`   This should match upload sequence count of 6069`);
    
    if ((totalEntities - totalMissingIds) === 6069) {
        console.log(`   ✅ MATCH! Missing IDs explain the discrepancy perfectly.`);
    } else {
        console.log(`   ❌ Still doesn't match. Need further investigation.`);
    }
}

checkMissingIds(); 