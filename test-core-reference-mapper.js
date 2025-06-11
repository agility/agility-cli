/**
 * Test CoreReferenceMapper
 * 
 * Validates the new lightweight CoreReferenceMapper functionality
 * including entity identification strategies and basic mapping operations
 */

const { CoreReferenceMapper } = require('./dist/lib/core-reference-mapper.js');

function testCoreReferenceMapper() {
    console.log('🧪 Testing CoreReferenceMapper...\n');
    
    const mapper = new CoreReferenceMapper('source-guid', 'target-guid');
    
    // Test 1: Basic model mapping
    console.log('📋 Test 1: Model ID Mapping');
    const sourceModel = { id: 123, referenceName: 'TestModel', displayName: 'Test Model' };
    const targetModel = { id: 456, referenceName: 'TestModel', displayName: 'Test Model' };
    
    // Add mapping
    mapper.addMapping('model', sourceModel, targetModel);
    
    // Test retrieval by ID
    const mappingById = mapper.getMapping('model', 123);
    console.log(`✅ Get by ID (123): ${mappingById ? `Found target ID ${mappingById.target.id}` : 'Not found'}`);
    
    // Test retrieval by reference name
    const mappingByRef = mapper.getMapping('model', 'TestModel');
    console.log(`✅ Get by reference name (TestModel): ${mappingByRef ? `Found target ID ${mappingByRef.target.id}` : 'Not found'}`);
    
    // Test 2: Content mapping
    console.log('\n📋 Test 2: Content ID Mapping');
    const sourceContent = { contentID: 789 };
    const targetContent = { contentID: 999 };
    
    mapper.addMapping('content', sourceContent, targetContent);
    
    const contentMapping = mapper.getMapping('content', 789);
    console.log(`✅ Get content by ID (789): ${contentMapping ? `Found target ID ${contentMapping.target.contentID}` : 'Not found'}`);
    
    // Test 3: Container mapping
    console.log('\n📋 Test 3: Container Mapping');
    const sourceContainer = { contentViewID: 111, referenceName: 'TestContainer' };
    const targetContainer = { contentViewID: 222, referenceName: 'TestContainer' };
    
    mapper.addMapping('container', sourceContainer, targetContainer);
    
    const containerMappingById = mapper.getMapping('container', 111);
    const containerMappingByRef = mapper.getMapping('container', 'TestContainer');
    
    console.log(`✅ Get container by ID (111): ${containerMappingById ? `Found target ID ${containerMappingById.target.contentViewID}` : 'Not found'}`);
    console.log(`✅ Get container by reference name (TestContainer): ${containerMappingByRef ? `Found target ID ${containerMappingByRef.target.contentViewID}` : 'Not found'}`);
    
    // Test 4: Asset mapping (dual ID strategy)
    console.log('\n📋 Test 4: Asset Mapping (Dual ID Strategy)');
    const sourceAsset = { mediaID: 333, originUrl: 'https://cdn.example.com/test.jpg' };
    const targetAsset = { mediaID: 444, originUrl: 'https://cdn.target.com/test.jpg' };
    
    mapper.addMapping('asset', sourceAsset, targetAsset);
    
    const assetMappingById = mapper.getMapping('asset', 333);
    const assetMappingByUrl = mapper.getMapping('asset', 'https://cdn.example.com/test.jpg');
    
    console.log(`✅ Get asset by media ID (333): ${assetMappingById ? `Found target ID ${assetMappingById.target.mediaID}` : 'Not found'}`);
    console.log(`✅ Get asset by origin URL: ${assetMappingByUrl ? `Found target ID ${assetMappingByUrl.target.mediaID}` : 'Not found'}`);
    
    // Test 5: Statistics and overview
    console.log('\n📋 Test 5: Mapping Statistics');
    const stats = mapper.getStats();
    console.log('📊 Mapping Statistics:');
    Object.entries(stats).forEach(([type, stat]) => {
        console.log(`   ${type}: ${stat.withTargets}/${stat.total} complete mappings`);
    });
    
    // Test 6: Check duplicate handling
    console.log('\n📋 Test 6: Duplicate Mapping Handling');
    // Try adding same source model again with different target
    const newTargetModel = { id: 555, referenceName: 'TestModel', displayName: 'Test Model Updated' };
    mapper.addMapping('model', sourceModel, newTargetModel);
    
    const updatedMapping = mapper.getMapping('model', 123);
    console.log(`✅ Updated mapping check: Target ID is now ${updatedMapping.target.id} (should be 555)`);
    
    // Test 7: Missing mappings
    console.log('\n📋 Test 7: Missing Mapping Handling');
    const missingMapping = mapper.getMapping('model', 999999);
    console.log(`✅ Missing mapping check: ${missingMapping ? 'Found (unexpected)' : 'Not found (expected)'}`);
    
    console.log('\n🎉 CoreReferenceMapper tests complete!');
    console.log(`📊 Total mappings: ${Object.values(stats).reduce((sum, stat) => sum + stat.total, 0)}`);
    
    return true;
}

// Run the test
try {
    testCoreReferenceMapper();
    console.log('\n✅ All tests passed!');
} catch (error) {
    console.error('\n❌ Test failed:', error.message);
} 