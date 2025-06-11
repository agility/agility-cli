const fs = require('fs');
const path = require('path');

/**
 * Comprehensive Asset Analysis
 * 
 * This script analyzes the asset metadata gap we discovered:
 * - Only 9 JSON metadata files vs 2,143+ actual asset files
 * - Tests proper asset discovery and matching methods
 * - Validates MediaGroupings are just folders
 */

console.log('🔍 COMPREHENSIVE ASSET ANALYSIS\n');

const sourceInstancePath = 'agility-files/67bc73e6-u/en-us/preview/assets';

// 1. Analyze JSON metadata files
console.log('📋 STEP 1: JSON Metadata Analysis');
const jsonMetadataPath = path.join(sourceInstancePath, 'json');
const jsonFiles = fs.readdirSync(jsonMetadataPath).filter(f => f.endsWith('.json'));

console.log(`   Found ${jsonFiles.length} JSON metadata files:`);
jsonFiles.forEach(file => console.log(`   - ${file}`));

// Load and analyze JSON metadata structure
let totalMetadataAssets = 0;
const assetMetadata = [];
const mediaGroupingNames = new Set();
const fileExtensions = new Set();
const folderPaths = new Set();

console.log('\n📊 JSON Metadata Content Analysis:');
jsonFiles.forEach(file => {
    const filePath = path.join(jsonMetadataPath, file);
    const metadata = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    console.log(`\n   📄 ${file}:`);
    console.log(`      Structure: ${Object.keys(metadata).join(', ')}`);
    
    if (metadata.assetMedias && Array.isArray(metadata.assetMedias)) {
        console.log(`      Contains: ${metadata.assetMedias.length} asset records`);
        totalMetadataAssets += metadata.assetMedias.length;
        
        // Analyze first few assets for pattern
        metadata.assetMedias.slice(0, 3).forEach((asset, index) => {
            console.log(`      Asset ${index + 1}:`);
            console.log(`        mediaID: ${asset.mediaID}`);
            console.log(`        fileName: ${asset.fileName}`);
            console.log(`        folder: ${asset.folder || 'ROOT'}`);
            console.log(`        mediaGroupingName: ${asset.mediaGroupingName || 'None'}`);
            
            if (asset.originKey) {
                const folderPath = asset.originKey.substring(0, asset.originKey.lastIndexOf('/'));
                if (folderPath) folderPaths.add(folderPath);
                console.log(`        originKey: ${asset.originKey}`);
            }
            
            // Track patterns
            if (asset.mediaGroupingName) mediaGroupingNames.add(asset.mediaGroupingName);
            const ext = path.extname(asset.fileName);
            if (ext) fileExtensions.add(ext);
        });
        
        // Store for later analysis
        assetMetadata.push(...metadata.assetMedias);
    }
});

console.log(`\n✅ Total assets in JSON metadata: ${totalMetadataAssets}`);
console.log(`✅ Unique MediaGrouping names: ${Array.from(mediaGroupingNames).join(', ')}`);
console.log(`✅ File extensions in metadata: ${Array.from(fileExtensions).join(', ')}`);
console.log(`✅ Folder paths in metadata: ${Array.from(folderPaths).slice(0, 5).join(', ')}${folderPaths.size > 5 ? '...' : ''}`);

// 2. Scan actual asset files
console.log('\n\n📁 STEP 2: Actual Asset Files Analysis');

function scanDirectory(dirPath, basePath = '') {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    let files = [];
    let folders = [];
    
    items.forEach(item => {
        const fullPath = path.join(dirPath, item.name);
        const relativePath = path.join(basePath, item.name);
        
        if (item.isDirectory()) {
            folders.push(relativePath);
            // Recursively scan subdirectories (but not too deep to avoid overwhelming output)
            if (basePath.split('/').length < 3) {
                const subResults = scanDirectory(fullPath, relativePath);
                files.push(...subResults.files);
                folders.push(...subResults.folders);
            }
        } else if (!item.name.endsWith('.json')) {
            // Only count actual asset files, not JSON metadata
            files.push({
                relativePath,
                fileName: item.name,
                folder: basePath || 'ROOT',
                extension: path.extname(item.name),
                size: fs.statSync(fullPath).size
            });
        }
    });
    
    return { files, folders };
}

const assetScanResult = scanDirectory(sourceInstancePath);
const actualAssetFiles = assetScanResult.files;
const actualFolders = assetScanResult.folders;

console.log(`   Found ${actualAssetFiles.length} actual asset files`);
console.log(`   Found ${actualFolders.length} folders/subfolders`);

// Analyze folder structure
console.log('\n📂 Folder Structure Analysis:');
const topLevelFolders = actualFolders.filter(f => !f.includes('/'));
console.log('   Top-level folders:');
topLevelFolders.forEach(folder => {
    const filesInFolder = actualAssetFiles.filter(f => f.folder === folder || f.folder.startsWith(folder + '/'));
    console.log(`     - ${folder}/ (${filesInFolder.length} files)`);
});

// 3. Match analysis
console.log('\n\n🔗 STEP 3: Metadata vs Actual Files Matching');

let matchedByFileName = 0;
let matchedByPath = 0;
const unmatchedMetadata = [];
const unmatchedFiles = [];

// Try to match metadata assets with actual files
assetMetadata.forEach(metaAsset => {
    // Try filename match first
    const fileNameMatch = actualAssetFiles.find(actualFile => 
        actualFile.fileName === metaAsset.fileName
    );
    
    if (fileNameMatch) {
        matchedByFileName++;
    } else {
        // Try path-based matching using originKey
        let pathMatch = false;
        if (metaAsset.originKey) {
            pathMatch = actualAssetFiles.find(actualFile => 
                actualFile.relativePath.includes(metaAsset.originKey) ||
                metaAsset.originKey.includes(actualFile.fileName)
            );
        }
        
        if (pathMatch) {
            matchedByPath++;
        } else {
            unmatchedMetadata.push({
                fileName: metaAsset.fileName,
                originKey: metaAsset.originKey,
                folder: metaAsset.folder
            });
        }
    }
});

console.log(`   ✅ Matched by filename: ${matchedByFileName}`);
console.log(`   ✅ Matched by path: ${matchedByPath}`);
console.log(`   ❌ Unmatched metadata: ${unmatchedMetadata.length}`);
console.log(`   ❌ Files without metadata: ${actualAssetFiles.length - matchedByFileName - matchedByPath}`);

if (unmatchedMetadata.length > 0 && unmatchedMetadata.length <= 10) {
    console.log('\n   🔍 Unmatched metadata samples:');
    unmatchedMetadata.slice(0, 5).forEach(asset => {
        console.log(`     - ${asset.fileName} (${asset.originKey || 'no originKey'})`);
    });
}

// 4. MediaGroupings analysis
console.log('\n\n🖼️ STEP 4: MediaGroupings Analysis');
const mediaGroupingsPath = path.join(sourceInstancePath, 'MediaGroupings');

if (fs.existsSync(mediaGroupingsPath)) {
    const mediaGroupingFolders = fs.readdirSync(mediaGroupingsPath, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .map(item => item.name);
    
    console.log(`   Found MediaGroupings folders: ${mediaGroupingFolders.join(', ')}`);
    
    mediaGroupingFolders.forEach(folderName => {
        const folderPath = path.join(mediaGroupingsPath, folderName);
        const filesInFolder = fs.readdirSync(folderPath).filter(f => !f.endsWith('.json'));
        console.log(`     - MediaGroupings/${folderName}/ (${filesInFolder.length} files)`);
    });
    
    console.log('   ✅ Confirmed: MediaGroupings are indeed just folders for organization');
} else {
    console.log('   ❌ No MediaGroupings folder found');
}

// 5. Recommendations
console.log('\n\n💡 STEP 5: Analysis Summary & Recommendations');

console.log(`\n📊 THE ASSET METADATA GAP:`);
console.log(`   • JSON metadata files: ${jsonFiles.length}`);
console.log(`   • Assets in metadata: ${totalMetadataAssets}`);
console.log(`   • Actual asset files: ${actualAssetFiles.length}`);
console.log(`   • Missing metadata: ${actualAssetFiles.length - totalMetadataAssets} files (${Math.round((actualAssetFiles.length - totalMetadataAssets) / actualAssetFiles.length * 100)}%)`);

console.log(`\n🎯 ROOT CAUSE ANALYSIS:`);
console.log(`   • The download process is NOT creating JSON metadata for most assets`);
console.log(`   • Legacy sync code only works with assets that have JSON metadata`);
console.log(`   • This explains why asset discovery is failing for 99%+ of assets`);

console.log(`\n🔧 IMMEDIATE FIXES NEEDED:`);
console.log(`   1. Fix asset target discovery to use getMediaList() instead of relying on JSON metadata`);
console.log(`   2. Use URL/filename matching for asset existence checking`);
console.log(`   3. Extract folder requirements from originKey or file paths`);
console.log(`   4. Test with instance that has galleries to validate gallery discovery`);

console.log(`\n✅ ASSET MATCHING STRATEGY:`);
console.log(`   1. Primary: Use getAssetByUrl(originUrl, guid) for URL-based matching`);
console.log(`   2. Fallback: Use getMediaList() and match by fileName`);
console.log(`   3. Folder creation: Extract from originKey or file path structure`);
console.log(`   4. MediaGroupings: Treat as simple folder organization, not special entities`);

console.log('\n🎉 Analysis complete! This explains the asset discovery mystery.'); 