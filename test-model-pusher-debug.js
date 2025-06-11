/**
 * Debug Model Pusher - Test model upload directly
 * 
 * This script loads source models and tests the model pusher to identify
 * the root cause of "Unable to save the model" errors that cascade to
 * break container and content mappings.
 */

const path = require('path');
const { pushModels } = require('./dist/lib/pushers/model-pusher');
const { ReferenceMapper } = require('./dist/lib/mapper');
const mgmtApi = require('@agility/management-sdk');
const fs = require('fs');
const auth = require('./dist/lib/services/auth');
const Auth = auth.Auth;

async function testModelPusher() {
    console.log('🧪 MODEL PUSHER DEBUG TEST');
    console.log('==================================================\n');
    
    try {
        // Load models from local files directly (simpler approach)
        console.log('📥 Loading source models from files...');
        const modelsPath = path.join(process.cwd(), 'agility-files', '13a8b394-u', 'en-us', 'preview', 'models');
        
        if (!fs.existsSync(modelsPath)) {
            throw new Error(`Models directory not found: ${modelsPath}`);
        }
        
        const modelFiles = fs.readdirSync(modelsPath).filter(file => file.endsWith('.json'));
        console.log(`📁 Found ${modelFiles.length} model files`);
        
        const models = [];
        for (const file of modelFiles.slice(0, 5)) { // Take first 5 for testing
            const filePath = path.join(modelsPath, file);
            const modelData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            models.push(modelData);
        }
        
        console.log(`✅ Loaded ${models.length} models for testing`);
        console.log(`🎯 Testing models: ${models.map(m => m.referenceName).join(', ')}\n`);
        
        // Set up API client using auth service
        console.log('🔧 Getting auth token and initializing API client...');
        const authService = new Auth();
        const token = await authService.getToken();
        const options = {
            token: token,
            baseUrl: 'https://mgmt.aglty.io'
        };
        
        // Test against Target Instance 1
        const targetGuid = '90c39c80-u';
        console.log(`🎯 Target instance: ${targetGuid}\n`);
        
        // Initialize reference mapper
        const referenceMapper = new ReferenceMapper('13a8b394-u', targetGuid);
        
        // Test model pusher with detailed debugging
        console.log('🚀 Testing model pusher...');
        const modelResults = await pushModels(
            models,
            options,
            targetGuid,
            referenceMapper,
            true, // Enable detailed model diffs
            (processed, total, status) => {
                console.log(`  📊 Progress: ${processed}/${total} (${status === 'error' ? '❌ ERROR' : '✅ SUCCESS'})`);
            }
        );
        
        console.log('\n📊 MODEL PUSHER RESULTS:');
        console.log(`✅ Successful: ${modelResults.successfulModels}`);
        console.log(`❌ Failed: ${modelResults.failedModels}`);
        console.log(`📋 Status: ${modelResults.status}`);
        
        if (modelResults.failedModels > 0) {
            console.log('\n🚨 FAILURES DETECTED - this explains the cascade effect!');
            console.log('   Model failures → Container mapping fails → Content uploads fail with itemNull: true');
        } else {
            console.log('\n✅ All models succeeded - the cascade issue might be elsewhere');
        }
        
        console.log('\n🔍 Reference mapper state after model processing:');
        const modelMappings = referenceMapper.getRecordsByType('model');
        console.log(`   📋 Model mappings created: ${modelMappings.length}`);
        
        if (modelMappings.length > 0) {
            console.log('   🔗 Sample mappings:');
            modelMappings.slice(0, 3).forEach(mapping => {
                console.log(`     - ${mapping.source?.referenceName} (${mapping.source?.id}) → ${mapping.target?.id}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Model pusher test failed:', error.message);
        if (error.stack) {
            console.error('   Stack:', error.stack);
        }
    }
}

// Run the test
testModelPusher().catch(console.error); 