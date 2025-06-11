const mgmtApi = require('@agility/management-sdk');
const { Auth } = require('./dist/lib/services/auth');

async function testModelLookup() {
    const auth = new Auth();
    
    try {
        const token = await auth.getToken();
        console.log('✅ Successfully retrieved token from Auth service');
        
        const apiOptions = {
            token: token,
            baseUrl: 'https://mgmt.aglty.io/api/v1'
        };
        
        const apiClient = new mgmtApi.ApiClient(apiOptions);
        
        try {
            console.log('\n🔍 Testing getModelByReferenceName for CodeFeature...');
            const model = await apiClient.modelMethods.getModelByReferenceName('CodeFeature', '90c39c80-u');
            console.log('SUCCESS: Model found:', model ? model.referenceName + ' (ID: ' + model.id + ')' : 'null');
        } catch (error) {
            console.log('ERROR getModelByReferenceName CodeFeature:', error.message);
            if (error.response) {
                console.log('  Status:', error.response.status);
                console.log('  Data:', JSON.stringify(error.response.data, null, 2));
            }
        }
        
        try {
            console.log('\n🔍 Testing getModelByReferenceName for AgilityJavascript...');
            const model2 = await apiClient.modelMethods.getModelByReferenceName('AgilityJavascript', '90c39c80-u');
            console.log('SUCCESS: Model found:', model2 ? model2.referenceName + ' (ID: ' + model2.id + ')' : 'null');
        } catch (error) {
            console.log('ERROR getModelByReferenceName AgilityJavascript:', error.message);
            if (error.response) {
                console.log('  Status:', error.response.status);
                console.log('  Data:', JSON.stringify(error.response.data, null, 2));
            }
        }
        
        try {
            console.log('\n🔍 Testing getContentModules...');
            const modules = await apiClient.modelMethods.getContentModules(true, '90c39c80-u', false);
            console.log('SUCCESS: Found', modules.length, 'content modules');
            const codeFeatureModel = modules.find(m => m.referenceName === 'CodeFeature');
            if (codeFeatureModel) {
                console.log('  CodeFeature found in list: ID', codeFeatureModel.id);
            } else {
                console.log('  CodeFeature NOT found in content modules list');
            }
            
            const agilityJavascriptModel = modules.find(m => m.referenceName === 'AgilityJavascript');
            if (agilityJavascriptModel) {
                console.log('  AgilityJavascript found in list: ID', agilityJavascriptModel.id);
            } else {
                console.log('  AgilityJavascript NOT found in content modules list');
            }
        } catch (error) {
            console.log('ERROR getContentModules:', error.message);
            if (error.response) {
                console.log('  Status:', error.response.status);
                console.log('  Data:', JSON.stringify(error.response.data, null, 2));
            }
        }
        
    } catch (error) {
        console.log('❌ Failed to get token:', error.message);
        console.log('💡 Please run: node dist/index.js login');
    }
}

testModelLookup().catch(console.error); 