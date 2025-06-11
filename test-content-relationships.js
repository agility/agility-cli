const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { UniversalReferenceExtractor } = require('./dist/lib/services/sync-analysis/universal-reference-extractor');

async function testContentRelationships() {
    console.log('🔍 Testing Enhanced Content→Content Relationship Detection');
    console.log('=' .repeat(80));
    
    try {
        // Load source data
        const loader = new ChainDataLoader({
            sourceGuid: '67bc73e6-u',
            locale: 'en-us',
            isPreview: true,
            rootPath: process.cwd() + '/agility-files',
            elements: ['Content']
        });
        
        console.log('📊 Loading content entities...');
        const sourceEntities = await loader.loadSourceEntities();
        
        console.log(`✅ Loaded ${sourceEntities.content?.length || 0} content items`);
        
        // Test the enhanced reference extractor
        const extractor = new UniversalReferenceExtractor();
        
        // Test specific content items we know have relationships
        const testContentIds = [729, 379, 396]; // From our earlier analysis
        
        console.log('\n🔍 Testing Enhanced Reference Extraction on Known Content Items:');
        
        testContentIds.forEach(contentId => {
            const contentItem = sourceEntities.content?.find(c => c.contentID === contentId);
            if (contentItem) {
                console.log(`\n📝 Content:${contentId} → ${contentItem.properties?.referenceName || 'Unknown'}`);
                console.log(`   Definition: ${contentItem.properties?.definitionName || 'Unknown'}`);
                
                // Extract references using our enhanced extractor
                const references = extractor.extractAllReferences(contentItem, 'content', contentId);
                
                console.log(`   🔗 Total References Found: ${references.length}`);
                
                // Group by relationship type
                const refsByType = {};
                references.forEach(ref => {
                    const type = ref.relationshipType || 'unknown';
                    if (!refsByType[type]) refsByType[type] = [];
                    refsByType[type].push(ref);
                });
                
                Object.entries(refsByType).forEach(([type, refs]) => {
                    console.log(`   📊 ${type}: ${refs.length} references`);
                    refs.slice(0, 3).forEach(ref => {
                        console.log(`      → ${ref.targetType}:${ref.targetId} (${ref.fieldPath})`);
                    });
                });
                
                // Show raw field data for debugging
                console.log(`   🔍 Raw Field Analysis:`);
                if (contentItem.fields) {
                    Object.entries(contentItem.fields).forEach(([fieldName, fieldValue]) => {
                        if (typeof fieldValue === 'object' && fieldValue !== null) {
                            // Check for LinkedContentDropdown patterns
                            if (fieldValue.referencename && fieldValue.sortids) {
                                console.log(`      🎯 LinkedContentDropdown: ${fieldName}`);
                                console.log(`         referencename: ${fieldValue.referencename}`);
                                console.log(`         sortids: ${fieldValue.sortids}`);
                            }
                            
                            // Check for direct content references
                            if (fieldValue.contentid) {
                                console.log(`      🎯 Direct Content Reference: ${fieldName}`);
                                console.log(`         contentid: ${fieldValue.contentid}`);
                            }
                        }
                        
                        // Check for ValueField patterns
                        if (fieldName.endsWith('_ValueField')) {
                            console.log(`      🎯 ValueField Pattern: ${fieldName}`);
                            console.log(`         value: ${fieldValue}`);
                        }
                    });
                }
            } else {
                console.log(`\n❌ Content:${contentId} not found in loaded data`);
            }
        });
        
        // Test all content for relationship patterns
        console.log('\n📊 COMPREHENSIVE CONTENT RELATIONSHIP ANALYSIS:');
        
        let totalContentRefs = 0;
        let contentWithRefs = 0;
        const relationshipTypes = new Set();
        
        sourceEntities.content?.forEach(contentItem => {
            const references = extractor.extractAllReferences(contentItem, 'content', contentItem.contentID);
            const contentToContentRefs = references.filter(ref => ref.targetType === 'content');
            
            if (contentToContentRefs.length > 0) {
                contentWithRefs++;
                totalContentRefs += contentToContentRefs.length;
                
                contentToContentRefs.forEach(ref => {
                    relationshipTypes.add(ref.relationshipType);
                });
            }
        });
        
        console.log(`   📝 Content items with content references: ${contentWithRefs}`);
        console.log(`   🔗 Total content→content references: ${totalContentRefs}`);
        console.log(`   🏷️  Relationship types found: ${Array.from(relationshipTypes).join(', ')}`);
        
        // Show examples of each relationship type
        console.log('\n🎯 EXAMPLES BY RELATIONSHIP TYPE:');
        
        Array.from(relationshipTypes).forEach(relType => {
            console.log(`\n   ${relType}:`);
            
            let exampleCount = 0;
            sourceEntities.content?.some(contentItem => {
                const references = extractor.extractAllReferences(contentItem, 'content', contentItem.contentID);
                const typeRefs = references.filter(ref => 
                    ref.targetType === 'content' && ref.relationshipType === relType
                );
                
                if (typeRefs.length > 0 && exampleCount < 3) {
                    console.log(`      Content:${contentItem.contentID} → ${contentItem.properties?.referenceName}`);
                    typeRefs.slice(0, 2).forEach(ref => {
                        console.log(`         → Content:${ref.targetId} (${ref.fieldPath})`);
                    });
                    exampleCount++;
                }
                
                return exampleCount >= 3;
            });
        });
        
        console.log('\n✅ Enhanced Content Relationship Detection Test Complete!');
        
    } catch (error) {
        console.error('❌ Error during content relationship test:', error);
        console.error(error.stack);
    }
}

// Run the test
testContentRelationships(); 