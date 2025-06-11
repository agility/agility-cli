const fs = require('fs');
const _ = require('lodash');

// Copy the exact areModelsDifferent function from model-pusher.ts
function areModelsDifferent(sourceModel, targetModel, shouldLogDiffs = true) {
    // Create copies to avoid modifying originals
    const sourceCopy = _.cloneDeep(sourceModel);
    const targetCopy = _.cloneDeep(targetModel);

    // Ignore IDs and other purely informational fields
    delete sourceCopy.id;
    delete targetCopy.id;
    delete sourceCopy.lastModifiedDate;
    delete targetCopy.lastModifiedDate;
    delete sourceCopy.lastModifiedAuthorID;
    delete targetCopy.lastModifiedAuthorID;
    delete sourceCopy.lastModifiedBy;
    delete targetCopy.lastModifiedBy;
    delete sourceCopy.allowTagging;
    delete targetCopy.allowTagging;
    delete sourceCopy.contentDefinitionTypeName;
    delete targetCopy.contentDefinitionTypeName;
    delete sourceCopy.contentDefinitionTypeID;
    delete targetCopy.contentDefinitionTypeID;
    delete sourceCopy.displayName;
    delete targetCopy.displayName;

    sourceCopy.referenceName = sourceCopy.referenceName.toLowerCase();
    targetCopy.referenceName = targetCopy.referenceName.toLowerCase();

    // Sort fields by name for consistent comparison
    sourceCopy.fields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    targetCopy.fields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Normalize field settings: remove empty string values from settings
    const normalizeFieldSettings = (fields) => {
        fields.forEach(field => {
            if (field.settings) {
                field.settings = Object.fromEntries(
                    Object.entries(field.settings).filter(([, value]) => value !== "")
                );
            }
            // Also ignore field IDs and itemOrder
            delete field.fieldID;
            delete field.itemOrder;
        });
    };

    normalizeFieldSettings(sourceCopy.fields);
    normalizeFieldSettings(targetCopy.fields);

    // Perform a deep comparison on the modified copies
    const areDifferent = !_.isEqual(sourceCopy, targetCopy);

    if (areDifferent && shouldLogDiffs) {
        console.log(`\n❌ Models are DIFFERENT for ${sourceModel.referenceName}:`);
        console.log('Source (normalized):', JSON.stringify(sourceCopy, null, 2));
        console.log('Target (normalized):', JSON.stringify(targetCopy, null, 2));
    } else if (!areDifferent) {
        console.log(`\n✅ Models are IDENTICAL for ${sourceModel.referenceName}`);
    }

    return areDifferent;
}

async function debugModelComparison() {
    try {
        console.log('🔍 Debugging Model Comparison for Post and Category...\n');
        
        // Load source models manually
        const categorySource = JSON.parse(fs.readFileSync('agility-files/13a8b394-u/en-us/preview/models/13.json', 'utf8'));
        const postSource = JSON.parse(fs.readFileSync('agility-files/13a8b394-u/en-us/preview/models/10.json', 'utf8'));
        
        console.log('📋 Source Models Loaded:');
        console.log(`- Category Model: ID ${categorySource.id}, referenceName: ${categorySource.referenceName}`);
        console.log(`- Post Model: ID ${postSource.id}, referenceName: ${postSource.referenceName}`);
        
        // Create mock target models that would be identical (to test the logic)
        const categoryTarget = _.cloneDeep(categorySource);
        const postTarget = _.cloneDeep(postSource);
        
        // Change target IDs to simulate what happens in target instance
        categoryTarget.id = 890; // Target ID from error logs
        postTarget.id = 892;     // Target ID from error logs
        
        console.log('\n🧪 Testing identical models (should be FALSE for different):');
        const categoryDifferent = areModelsDifferent(categorySource, categoryTarget, true);
        const postDifferent = areModelsDifferent(postSource, postTarget, true);
        
        console.log(`\n📊 Results:`);
        console.log(`- Category models different: ${categoryDifferent}`);
        console.log(`- Post models different: ${postDifferent}`);
        
        if (categoryDifferent || postDifferent) {
            console.log('\n⚠️  Our comparison logic is detecting differences in identical models!');
            console.log('This explains why updates are being attempted and failing.');
        } else {
            console.log('\n✅ Comparison logic is working correctly - differences must be real.');
        }
        
    } catch (error) {
        console.error('Error in model comparison debug:', error);
    }
}

debugModelComparison(); 