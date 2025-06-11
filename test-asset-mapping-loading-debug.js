/**
 * Test Asset Mapping Loading Debug
 * 
 * Debug why asset mappings aren't loading even though the file exists.
 */

const { ReferenceMapper } = require('./dist/lib/mapper');
const fs = require('fs');

async function testAssetMappingLoading() {
    console.log('🧪 Testing Asset Mapping Loading');
    console.log('=' .repeat(50));

    const sourceGuid = '67bc73e6-u';
    const targetGuid = '90c39c80-u';
    
    // Check file system first
    const mappingFilePath = `agility-files/${targetGuid}/mappings/asset-mappings.json`;
    console.log(`📂 Checking file: ${mappingFilePath}`);
    
    if (fs.existsSync(mappingFilePath)) {
        const stats = fs.statSync(mappingFilePath);
        console.log(`✅ File exists: ${stats.size} bytes`);
        
        // Try to read first few lines
        const content = fs.readFileSync(mappingFilePath, 'utf8');
        const lines = content.split('\n');
        console.log(`📊 Total lines: ${lines.length}`);
        console.log(`📋 First line: ${lines[0]?.substring(0, 200)}...`);
        
        // Check if it's valid JSON array
        try {
            const parsed = JSON.parse(content);
            console.log(`✅ Valid JSON with ${parsed.length} records`);
            
            // Show first few records
            console.log('\n📋 Sample Records:');
            parsed.slice(0, 3).forEach((record, i) => {
                console.log(`  Record ${i + 1}:`);
                console.log(`    Type: ${record.type}`);
                console.log(`    Source URL: ${record.source?.originUrl || 'N/A'}`);
                console.log(`    Target URL: ${record.target?.originUrl || 'N/A'}`);
                console.log(`    Source fileName: ${record.source?.fileName || 'N/A'}`);
                console.log(`    Target fileName: ${record.target?.fileName || 'N/A'}`);
            });
            
            // Look specifically for block-editor assets
            const blockEditorAssets = parsed.filter(record => 
                record.source?.originUrl?.includes('images/block-editor') ||
                record.target?.originUrl?.includes('images/block-editor')
            );
            console.log(`\n🔍 Block-editor assets in file: ${blockEditorAssets.length}`);
            
        } catch (error) {
            console.log(`❌ Invalid JSON: ${error.message}`);
        }
    } else {
        console.log(`❌ File does not exist`);
    }
    
    // Now test ReferenceMapper loading
    console.log('\n📋 Testing ReferenceMapper Loading');
    const referenceMapper = new ReferenceMapper(sourceGuid, targetGuid);
    
    console.log('Before loadMappings:');
    console.log(`  Asset records: ${referenceMapper.getRecordsByType('asset').length}`);
    
    await referenceMapper.loadMappings();
    
    console.log('After loadMappings:');
    const assetRecords = referenceMapper.getRecordsByType('asset');
    console.log(`  Asset records: ${assetRecords.length}`);
    
    if (assetRecords.length > 0) {
        console.log('\n📋 Sample Loaded Records:');
        assetRecords.slice(0, 3).forEach((record, i) => {
            console.log(`  Loaded Record ${i + 1}:`);
            console.log(`    Source URL: ${record.source?.originUrl || 'N/A'}`);
            console.log(`    Target URL: ${record.target?.originUrl || 'N/A'}`);
        });
        
        // Test specific lookup
        const testUrl = 'https://cdn.aglty.io/67bc73e6-u/images/block-editor/test.jpg';
        const mapping = referenceMapper.getMapping('asset', 'originUrl', testUrl);
        console.log(`\n🔍 Test lookup for ${testUrl}:`);
        console.log(`  Found: ${mapping ? 'Yes' : 'No'}`);
    } else {
        console.log('❌ No asset records loaded - there is a loading issue');
    }
}

testAssetMappingLoading().catch(console.error); 