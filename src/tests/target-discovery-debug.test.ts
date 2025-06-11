import { describe, it, expect, beforeAll } from '@jest/globals';
import { ApiClient, Options } from '@agility/management-sdk';
import { Auth } from '../lib/services/auth';
import { TargetInstanceMapper } from '../lib/services/target-instance-mapper';
import { ReferenceMapper } from '../lib/reference-mapper';

describe('Target Discovery Debug', () => {
    let apiClient: ApiClient;
    const TARGET_GUID = '90c39c80-u'; // Instance that has 107 models
    
    beforeAll(async () => {
        const auth = new Auth();
        const token = await auth.getToken();
        
        if (!token) {
            throw new Error("Authentication failed");
        }

        const options: Options = {
            token: token,
            baseUrl: undefined,
            refresh_token: '',
            duration: 0,
            retryCount: 3
        };

        apiClient = new ApiClient(options);
    });

    it('should successfully call getContentModules directly', async () => {
        console.log(`\n🔍 Direct SDK call to getContentModules...`);
        
        try {
            const models = await apiClient.modelMethods.getContentModules(true, TARGET_GUID, false);
            console.log(`✅ SUCCESS: Found ${models.length} content models`);
            expect(models.length).toBeGreaterThan(0);
        } catch (error: any) {
            console.log(`❌ FAILED: ${error.message}`);
            throw error;
        }
    });

    it('should test our TargetInstanceMapper with same parameters', async () => {
        console.log(`\n🔍 Testing our TargetInstanceMapper...`);
        
        const referenceMapper = new ReferenceMapper('source', TARGET_GUID);
        const mapper = new TargetInstanceMapper(apiClient, TARGET_GUID, referenceMapper);
        
        // Create minimal source data to test with
        const sourceData = {
            models: [
                { id: 1, referenceName: 'TestModel1' },
                { id: 2, referenceName: 'TestModel2' }
            ],
            containers: [],
            assets: [],
            galleries: [],
            templates: [],
            pages: []
        };

        try {
            console.log(`📊 Running target discovery...`);
            const result = await mapper.discoverAndMapExistingEntities(sourceData);
            console.log(`✅ Discovery completed:`);
            console.log(`   Mappings found: ${result.mappingsFound}`);
            console.log(`   New entities needed: ${result.newEntitiesNeeded}`);
            console.log(`   Breakdown:`, JSON.stringify(result.entityBreakdown, null, 2));
            
            expect(result).toBeDefined();
        } catch (error: any) {
            console.log(`❌ TargetInstanceMapper failed: ${error.message}`);
            console.log(`   Stack: ${error.stack}`);
            throw error;
        }
    });

    it('should compare the exact API calls made by both approaches', async () => {
        console.log(`\n🔍 Comparing API call implementations...`);
        
        // Test the exact same call our TargetInstanceMapper makes
        console.log(`📞 Calling: apiClient.modelMethods.getContentModules(true, "${TARGET_GUID}", false)`);
        
        try {
            const models = await apiClient.modelMethods.getContentModules(true, TARGET_GUID, false);
            console.log(`✅ Models returned: ${models.length}`);
            
            if (models.length > 0) {
                console.log(`   Sample models:`);
                models.slice(0, 3).forEach((model: any, index: number) => {
                    console.log(`     ${index + 1}. ${model.referenceName} (ID: ${model.id})`);
                });
            }
            
            expect(models.length).toBe(107); // Should match our earlier test
        } catch (error: any) {
            console.log(`❌ Same call failed: ${error.message}`);
            console.log(`📝 This suggests our target discovery has a different issue`);
            throw error;
        }
    });
}); 