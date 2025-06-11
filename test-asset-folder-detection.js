/**
 * Test Asset Folder Detection
 * 
 * Debug why assets in images/block-editor are still uploading on subsequent runs
 * vs gallery assets which are properly detected.
 */

const { ReferenceMapper } = require('./dist/lib/mapper');
const { getAssetFilePath } = require('./dist/lib/utilities/asset-utils');

async function testAssetFolderDetection() {
    console.log('🧪 Testing Asset Folder Detection');
    console.log('=' .repeat(50));

    const sourceGuid = '67bc73e6-u';
    const targetGuid = '90c39c80-u';
    
    // Initialize ReferenceMapper
    const referenceMapper = new ReferenceMapper(sourceGuid, targetGuid);
    await referenceMapper.loadMappings();
    
    console.log('\n📋 Test 1: Gallery Assets vs Folder Assets URL Processing');
    
    // Test gallery asset URL
    const galleryAssetUrl = 'https://cdn.aglty.io/67bc73e6-u/MediaGroupings/123/hero-image.jpg';
    const galleryAssetPath = getAssetFilePath(galleryAssetUrl);
    
    console.log(`Gallery Asset URL: ${galleryAssetUrl}`);
    console.log(`Gallery Asset Path: ${galleryAssetPath}`);
    console.log(`Gallery Pattern Match: ${galleryAssetUrl.match(/\/MediaGroupings\/(\d+)\//)}`);
    
    // Test folder asset URL
    const folderAssetUrl = 'https://cdn.aglty.io/67bc73e6-u/images/block-editor/image.jpg';
    const folderAssetPath = getAssetFilePath(folderAssetUrl);
    
    console.log(`\nFolder Asset URL: ${folderAssetUrl}`);
    console.log(`Folder Asset Path: ${folderAssetPath}`);
    console.log(`MediaGroupings Pattern Match: ${folderAssetUrl.match(/\/MediaGroupings\/(\d+)\//)}`);
    
    // Test what target URLs would be constructed
    const defaultAssetUrl = 'https://origin.agilitycms.com/90c39c80-u';
    
    console.log('\n📋 Test 2: Target URL Construction');
    
    // Gallery asset target (should use gallery ID translation)
    console.log(`\nGallery Asset (should use gallery mapping):`);
    console.log(`- Source: ${galleryAssetUrl}`);
    console.log(`- Would use gallery ID translation if mapping exists`);
    
    // Folder asset target (uses path-based construction)
    console.log(`\nFolder Asset (uses path-based construction):`);
    console.log(`- Source: ${folderAssetUrl}`);
    console.log(`- Path: ${folderAssetPath}`);
    console.log(`- Target URL: ${defaultAssetUrl}/${folderAssetPath}`);
    
    console.log('\n📋 Test 3: Asset Mapping Lookup');
    
    // Check if assets exist in mappings
    const assetRecords = referenceMapper.getRecordsByType('asset');
    console.log(`Total asset mappings: ${assetRecords.length}`);
    
    // Look for assets in block-editor folder
    const blockEditorAssets = assetRecords.filter(record => 
        record.source?.originUrl?.includes('images/block-editor') ||
        record.target?.originUrl?.includes('images/block-editor')
    );
    
    console.log(`\nBlock-editor assets in mappings: ${blockEditorAssets.length}`);
    blockEditorAssets.slice(0, 3).forEach((asset, i) => {
        console.log(`  Asset ${i + 1}:`);
        console.log(`    Source: ${asset.source?.originUrl || 'Unknown'}`);
        console.log(`    Target: ${asset.target?.originUrl || 'Unknown'}`);
        console.log(`    Source fileName: ${asset.source?.fileName || 'Unknown'}`);
        console.log(`    Target fileName: ${asset.target?.fileName || 'Unknown'}`);
    });
    
    // Check gallery mappings
    const galleryRecords = referenceMapper.getRecordsByType('gallery');
    console.log(`\nTotal gallery mappings: ${galleryRecords.length}`);
    galleryRecords.slice(0, 3).forEach((gallery, i) => {
        console.log(`  Gallery ${i + 1}: Source ID ${gallery.source?.mediaGroupingID} → Target ID ${gallery.target?.mediaGroupingID}`);
    });
    
    console.log('\n🔍 Analysis:');
    console.log('- Gallery assets use MediaGroupings/{id}/ pattern and gallery ID translation');
    console.log('- Folder assets use direct path construction: targetUrl + relativePath');
    console.log('- Issue might be:');
    console.log('  1. Folder structure differs between source/target instances');
    console.log('  2. Asset container URLs differ between instances');
    console.log('  3. Existing asset detection fails for folder-based assets');
    console.log('  4. Path construction logic has bugs for certain folder patterns');
}

testAssetFolderDetection().catch(console.error); 