const fs = require('fs');
const mgmtApi = require('@agility/management-sdk');
const _ = require('lodash');

async function comparePostModels() {
    try {
        console.log('🔍 DETAILED POST MODEL COMPARISON\n');
        
        // Get source Post model (ID 10)
        const sourcePostPath = 'agility-files/13a8b394-u/en-us/preview/models/10.json';
        const sourcePost = JSON.parse(fs.readFileSync(sourcePostPath, 'utf8'));
        
        // Get target Post model via API
        const options = {
            baseUrl: 'https://mgmt.aglty.io',
            token: process.env.AGILITY_CLI_TOKEN
        };
        const apiClient = new mgmtApi.ApiClient(options);
        const targetPost = await apiClient.modelMethods.getModelByReferenceName('Post', '90c39c80-u');
        
        console.log('📋 SOURCE POST MODEL (ID: ' + sourcePost.id + ')');
        console.log('═══════════════════════════════════════');
        console.log(JSON.stringify(sourcePost, null, 2));
        
        console.log('\n📋 TARGET POST MODEL (ID: ' + targetPost.id + ')');
        console.log('═══════════════════════════════════════');
        console.log(JSON.stringify(targetPost, null, 2));
        
        console.log('\n🔍 FIELD-BY-FIELD COMPARISON');
        console.log('═══════════════════════════════════════');
        
        const sourceFields = sourcePost.fields || [];
        const targetFields = targetPost.fields || [];
        
        console.log(`Source has ${sourceFields.length} fields, Target has ${targetFields.length} fields\n`);
        
        const maxFields = Math.max(sourceFields.length, targetFields.length);
        
        for (let i = 0; i < maxFields; i++) {
            const sourceField = sourceFields[i];
            const targetField = targetFields[i];
            
            console.log(`--- FIELD ${i + 1} ---`);
            
            if (!sourceField) {
                console.log('❌ Source: MISSING');
                console.log('✅ Target:', JSON.stringify(targetField, null, 2));
            } else if (!targetField) {
                console.log('✅ Source:', JSON.stringify(sourceField, null, 2));
                console.log('❌ Target: MISSING');
            } else if (_.isEqual(sourceField, targetField)) {
                console.log(`✅ Field "${sourceField.name}" is IDENTICAL`);
            } else {
                console.log(`❌ Field "${sourceField.name}" is DIFFERENT`);
                console.log('Source:', JSON.stringify(sourceField, null, 2));
                console.log('Target:', JSON.stringify(targetField, null, 2));
                
                // Detailed property comparison
                const sourceKeys = Object.keys(sourceField);
                const targetKeys = Object.keys(targetField);
                const allKeys = [...new Set([...sourceKeys, ...targetKeys])];
                
                console.log('   Property differences:');
                allKeys.forEach(key => {
                    if (!_.isEqual(sourceField[key], targetField[key])) {
                        console.log(`     ${key}:`);
                        console.log(`       Source: ${JSON.stringify(sourceField[key])}`);
                        console.log(`       Target: ${JSON.stringify(targetField[key])}`);
                    }
                });
            }
            console.log('');
        }
        
        console.log('\n🔍 TOP-LEVEL PROPERTY COMPARISON');
        console.log('═══════════════════════════════════════');
        
        // Compare non-field properties
        const sourceProps = _.omit(sourcePost, ['fields', 'id', 'lastModifiedDate', 'lastModifiedAuthorID', 'lastModifiedBy']);
        const targetProps = _.omit(targetPost, ['fields', 'id', 'lastModifiedDate', 'lastModifiedAuthorID', 'lastModifiedBy']);
        
        const allPropKeys = [...new Set([...Object.keys(sourceProps), ...Object.keys(targetProps)])];
        
        allPropKeys.forEach(key => {
            if (!_.isEqual(sourceProps[key], targetProps[key])) {
                console.log(`❌ Property "${key}" differs:`);
                console.log(`   Source: ${JSON.stringify(sourceProps[key])}`);
                console.log(`   Target: ${JSON.stringify(targetProps[key])}`);
            } else {
                console.log(`✅ Property "${key}" is identical`);
            }
        });
        
    } catch (error) {
        console.error('Error comparing Post models:', error);
    }
}

comparePostModels(); 