const fs = require('fs');
const path = require('path');
const mgmtApi = require('@agility/management-sdk');

// Test the problematic models that keep updating
const PROBLEMATIC_MODELS = [
    { sourceName: 'Changelog', sourceId: 36, targetId: 935 },
    { sourceName: 'Footer', sourceId: 35, targetId: 941 }, 
    { sourceName: 'ChangeLog', sourceId: 28, targetId: 935 }
];

const SOURCE_GUID = '67bc73e6-u';
const TARGET_GUID = '90c39c80-u';

async function loadSourceModel(modelId) {
    const modelPath = `agility-files/${SOURCE_GUID}/en-us/preview/models/${modelId}.json`;
    if (!fs.existsSync(modelPath)) {
        throw new Error(`Source model file not found: ${modelPath}`);
    }
    return JSON.parse(fs.readFileSync(modelPath, 'utf8'));
}

async function loadTargetModel(modelId) {
    // Import the authentication service from the CLI
    const { getToken } = require('./dist/lib/services/auth');
    
    const token = await getToken();
    if (!token) {
        throw new Error('No API token found. Run agility-cli auth command first.');
    }
    
    const apiOptions = {
        token: token,
        baseUrl: 'https://mgmt.aglty.io/api/v1'
    };
    
    const apiClient = new mgmtApi.ApiClient(apiOptions);
    
    return await apiClient.modelMethods.getModel(modelId, TARGET_GUID);
}

function deepCompare(obj1, obj2, path = '') {
    const differences = [];
    
    // Check if types are different
    if (typeof obj1 !== typeof obj2) {
        differences.push(`${path}: TYPE DIFF - ${typeof obj1} vs ${typeof obj2}`);
        return differences;
    }
    
    // Handle null/undefined
    if (obj1 === null || obj1 === undefined || obj2 === null || obj2 === undefined) {
        if (obj1 !== obj2) {
            differences.push(`${path}: NULL DIFF - ${obj1} vs ${obj2}`);
        }
        return differences;
    }
    
    // Handle arrays
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
        if (obj1.length !== obj2.length) {
            differences.push(`${path}: ARRAY LENGTH DIFF - ${obj1.length} vs ${obj2.length}`);
        }
        
        const maxLength = Math.max(obj1.length, obj2.length);
        for (let i = 0; i < maxLength; i++) {
            const newPath = `${path}[${i}]`;
            if (i >= obj1.length) {
                differences.push(`${newPath}: MISSING IN SOURCE`);
            } else if (i >= obj2.length) {
                differences.push(`${newPath}: MISSING IN TARGET`);
            } else {
                differences.push(...deepCompare(obj1[i], obj2[i], newPath));
            }
        }
        return differences;
    }
    
    // Handle objects
    if (typeof obj1 === 'object' && typeof obj2 === 'object') {
        const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
        
        for (const key of allKeys) {
            const newPath = path ? `${path}.${key}` : key;
            
            if (!(key in obj1)) {
                differences.push(`${newPath}: MISSING IN SOURCE`);
            } else if (!(key in obj2)) {
                differences.push(`${newPath}: MISSING IN TARGET`);
            } else {
                differences.push(...deepCompare(obj1[key], obj2[key], newPath));
            }
        }
        return differences;
    }
    
    // Handle primitives
    if (obj1 !== obj2) {
        differences.push(`${path}: VALUE DIFF - "${obj1}" vs "${obj2}"`);
    }
    
    return differences;
}

async function testModelComparison() {
    console.log('🔍 TESTING MODEL COMPARISON - FINDING ACTUAL DIFFERENCES\n');
    
    for (const model of PROBLEMATIC_MODELS) {
        console.log(`\n==================== ${model.sourceName} ====================`);
        console.log(`Source ID: ${model.sourceId}, Target ID: ${model.targetId}`);
        
        try {
            // Load both versions
            const sourceModel = await loadSourceModel(model.sourceId);
            const targetModel = await loadTargetModel(model.targetId);
            
            console.log('\n📄 SOURCE MODEL STRUCTURE:');
            console.log(`- ID: ${sourceModel.id}`);
            console.log(`- Reference Name: ${sourceModel.referenceName}`);
            console.log(`- Display Name: ${sourceModel.displayName}`);
            console.log(`- Content Definition Type ID: ${sourceModel.contentDefinitionTypeID}`);
            console.log(`- Has Fields: ${sourceModel.hasOwnProperty('fields')}`);
            console.log(`- Fields Count: ${sourceModel.fields ? sourceModel.fields.length : 'NO FIELDS PROPERTY'}`);
            
            console.log('\n🎯 TARGET MODEL STRUCTURE:');
            console.log(`- ID: ${targetModel.id}`);
            console.log(`- Reference Name: ${targetModel.referenceName}`);
            console.log(`- Display Name: ${targetModel.displayName}`);
            console.log(`- Content Definition Type ID: ${targetModel.contentDefinitionTypeID}`);
            console.log(`- Has Fields: ${targetModel.hasOwnProperty('fields')}`);
            console.log(`- Fields Count: ${targetModel.fields ? targetModel.fields.length : 'NO FIELDS PROPERTY'}`);
            
            // Find all differences
            const differences = deepCompare(sourceModel, targetModel);
            
            if (differences.length === 0) {
                console.log('\n✅ NO DIFFERENCES FOUND - MODELS ARE IDENTICAL!');
            } else {
                console.log(`\n❌ FOUND ${differences.length} DIFFERENCES:`);
                differences.forEach((diff, index) => {
                    console.log(`  ${index + 1}. ${diff}`);
                });
            }
            
        } catch (error) {
            console.error(`❌ Error testing ${model.sourceName}:`, error.message);
        }
    }
}

// Run the test
testModelComparison().catch(console.error); 