const fs = require('fs');
const _ = require('lodash');

// Current comparison logic (from model-pusher.ts)
function areModelsDifferent(sourceModel, targetModel) {
    const sourceCopy = _.cloneDeep(sourceModel);
    const targetCopy = _.cloneDeep(targetModel);

    // Remove metadata fields
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

    // Sort and normalize fields
    sourceCopy.fields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    targetCopy.fields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const normalizeFieldSettings = (fields) => {
        fields.forEach(field => {
            if (field.settings) {
                field.settings = Object.fromEntries(
                    Object.entries(field.settings).filter(([, value]) => value !== "")
                );
            }
            delete field.fieldID;
            delete field.itemOrder;
        });
    };

    normalizeFieldSettings(sourceCopy.fields);
    normalizeFieldSettings(targetCopy.fields);

    return !_.isEqual(sourceCopy, targetCopy);
}

// NEW: Field-only comparison logic
function areFieldsDifferent(sourceModel, targetModel) {
    const sourceFields = _.cloneDeep(sourceModel.fields || []);
    const targetFields = _.cloneDeep(targetModel.fields || []);

    // Sort fields by name for consistent comparison
    sourceFields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    targetFields.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Normalize field settings: remove empty string values and metadata
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

    return !_.isEqual(sourceFields, targetFields);
}

async function testComparisons() {
    try {
        console.log('🔍 Testing Current vs Field-Only Model Comparison...\n');
        
        // Load source models
        const categorySource = JSON.parse(fs.readFileSync('agility-files/13a8b394-u/en-us/preview/models/13.json', 'utf8'));
        const postSource = JSON.parse(fs.readFileSync('agility-files/13a8b394-u/en-us/preview/models/10.json', 'utf8'));
        
        // Create mock target models with different metadata but same fields
        const categoryTarget = _.cloneDeep(categorySource);
        const postTarget = _.cloneDeep(postSource);
        
        // Simulate realistic target differences (metadata only)
        categoryTarget.id = 890;
        categoryTarget.lastModifiedDate = "2025-06-05T10:00:00.00";
        categoryTarget.displayName = "Blog Category"; // Different display name
        categoryTarget.description = "Different description"; // Different description
        
        postTarget.id = 892;
        postTarget.lastModifiedDate = "2025-06-05T10:00:00.00";
        postTarget.displayName = "Blog Post"; // Different display name
        
        console.log('📊 Testing Category Model:');
        const categoryCurrentDiff = areModelsDifferent(categorySource, categoryTarget);
        const categoryFieldDiff = areFieldsDifferent(categorySource, categoryTarget);
        console.log(`  Current comparison (full model): ${categoryCurrentDiff ? 'DIFFERENT' : 'IDENTICAL'}`);
        console.log(`  Field-only comparison: ${categoryFieldDiff ? 'DIFFERENT' : 'IDENTICAL'}`);
        
        console.log('\n📊 Testing Post Model:');
        const postCurrentDiff = areModelsDifferent(postSource, postTarget);
        const postFieldDiff = areFieldsDifferent(postSource, postTarget);
        console.log(`  Current comparison (full model): ${postCurrentDiff ? 'DIFFERENT' : 'IDENTICAL'}`);
        console.log(`  Field-only comparison: ${postFieldDiff ? 'DIFFERENT' : 'IDENTICAL'}`);
        
        console.log('\n🎯 Analysis:');
        if ((categoryCurrentDiff || postCurrentDiff) && (!categoryFieldDiff && !postFieldDiff)) {
            console.log('✅ SOLUTION IDENTIFIED:');
            console.log('   Current logic detects differences in metadata, but fields are identical.');
            console.log('   Switching to field-only comparison would prevent unnecessary updates.');
            console.log('   This would avoid the HTTP 500 errors for models with identical fields.');
        } else {
            console.log('❓ Need further investigation - field differences may be real.');
        }
        
    } catch (error) {
        console.error('Error in comparison test:', error);
    }
}

testComparisons(); 