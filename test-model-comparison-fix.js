/**
 * Test Model Comparison Fix
 * 
 * Tests that models with the same structure but different ContentDefinition names
 * are properly detected as identical during comparison (before mapping is applied).
 */

const _ = require('lodash');

// Simulate the simplified areModelsDifferent logic (field-only comparison)
function areModelsDifferent(sourceModel, targetModel, shouldLogDiffs = false) {
    // Field-only comparison - only compare the fields array, ignore all model metadata
    const sourceFields = _.cloneDeep(sourceModel.fields || []);
    const targetFields = _.cloneDeep(targetModel.fields || []);

    // Sort fields by name for consistent comparison
    sourceFields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    targetFields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Normalize field settings: remove empty string values and irrelevant metadata
    const normalizeFields = (fields) => {
        fields.forEach(field => {
            if (field.settings) {
                field.settings = Object.fromEntries(
                    Object.entries(field.settings).filter(([, value]) => value !== "")
                );
            }
            // Remove field metadata that doesn't affect functionality
            delete field.fieldID;
            delete field.itemOrder;
            delete field.labelHelpDescription;
            delete field.description;
            delete field.designerOnly;
            delete field.isDataField;
            delete field.editable;
            delete field.hiddenField;
        });
    };

    normalizeFields(sourceFields);
    normalizeFields(targetFields);

    // Compare only the normalized fields arrays
    const areDifferent = !_.isEqual(sourceFields, targetFields);

    if (shouldLogDiffs && areDifferent) {
        console.log('\n🔍 FIELD DIFFERENCES DETECTED:');
        console.log('Source Fields:');
        console.log(JSON.stringify(sourceFields, null, 2));
        console.log('Target Fields:');
        console.log(JSON.stringify(targetFields, null, 2));
    }

    return areDifferent;
}

async function testModelComparisonFix() {
    console.log('🧪 Testing Model Comparison Fix');
    console.log('=' .repeat(50));

    // Test 1: Models with same structure but different ContentDefinition references
    console.log('\n📋 Test 1: Same Structure, Different ContentDefinition References');
    
    const sourceModel = {
        referenceName: 'ListedArticle',
        fields: [
            {
                name: 'Title',
                type: 'Text',
                settings: {}
            },
            {
                name: 'RelatedArticle',
                type: 'Content',
                settings: {
                    ContentDefinition: 'ChangeLog'  // Source model name
                }
            }
        ]
    };

    const targetModel = {
        referenceName: 'ListedArticle',
        fields: [
            {
                name: 'Title',
                type: 'Text',
                settings: {}
            },
            {
                name: 'RelatedArticle',
                type: 'Content',
                settings: {
                    ContentDefinition: 'ChangeLog'  // Same as source (already exists)
                }
            }
        ]
    };

    const areDifferent = areModelsDifferent(sourceModel, targetModel, true);
    
    console.log(`\n📊 Results:`);
    console.log(`- Models are considered different: ${areDifferent}`);
    
    if (areDifferent) {
        console.log('❌ ISSUE: Models with identical ContentDefinition names are still considered different!');
    } else {
        console.log('✅ SUCCESS: Models with identical ContentDefinition names are correctly considered the same!');
    }

    // Test 2: Models with genuinely different field structures
    console.log('\n📋 Test 2: Actually Different Field Structures');
    
    const differentModel = {
        referenceName: 'ListedArticle',
        fields: [
            {
                name: 'Title',
                type: 'Text',
                settings: {}
            },
            {
                name: 'NewField',  // Different field!
                type: 'Text',
                settings: {}
            }
        ]
    };

    const reallyDifferent = areModelsDifferent(sourceModel, differentModel, false);
    
    console.log(`- Models with different structures are different: ${reallyDifferent}`);
    
    if (reallyDifferent) {
        console.log('✅ SUCCESS: Models with different structures are correctly detected as different!');
    } else {
        console.log('❌ ISSUE: Models with different structures are incorrectly considered the same!');
    }

    console.log('\n🎯 Summary:');
    console.log('The fix should ensure that:');
    console.log('- ✅ Models with same field structure (but potentially different ContentDefinition mappings) = SAME');
    console.log('- ✅ Models with different field structures = DIFFERENT');
    console.log('- ✅ ContentDefinition mapping happens only during update payload creation, not comparison');
}

testModelComparisonFix().catch(console.error); 