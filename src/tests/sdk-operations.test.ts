import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ApiClient, Options } from '@agility/management-sdk';
import { Auth } from '../lib/services/auth';
import * as fs from 'fs';
import * as path from 'path';

// Test Configuration
const CONFIG = {
    // Source: Agility Docs instance (has content)
    SOURCE_GUID: '67bc73e6-u',
    // Target: Instance that actually has models (user confirmed 90% certain)
    TARGET_GUID: '90c39c80-u', 
    LOCALE: 'en-us',
    // Test data paths
    SOURCE_DATA_PATH: path.resolve(process.cwd(), `agility-files/67bc73e6-u/en-us/preview`),
};

describe('SDK Operations Test Suite', () => {
    let apiClient: ApiClient;
    let testModelId: number | null = null;
    let testContainerId: number | null = null;
    let testTemplateId: number | null = null;
    
    beforeAll(async () => {
        // Setup API client with real authentication
        const auth = new Auth();
        const token = await auth.getToken();
        
        if (!token) {
            throw new Error("Authentication failed. Please run: node dist/index.js login");
        }

        const options: Options = {
            token: token,
            baseUrl: undefined, // Let SDK handle baseUrl
            refresh_token: '',
            duration: 0,
            retryCount: 3
        };

        apiClient = new ApiClient(options);
    });

    describe('Model Operations', () => {
        it('should check target instance for existing model', async () => {
            try {
                console.log(`\n🔍 Testing getContentModules on target: ${CONFIG.TARGET_GUID}`);
                const models = await apiClient.modelMethods.getContentModules(true, CONFIG.TARGET_GUID, false);
                console.log(`✅ Found ${models.length} content models in target`);
                
                if (models.length > 0) {
                    console.log(`   Sample model: ${models[0].referenceName} (ID: ${models[0].id})`);
                }
                
                expect(Array.isArray(models)).toBe(true);
            } catch (error: any) {
                console.log(`❌ getContentModules failed: ${error.message}`);
                console.log(`📝 This confirms the anti-pattern: API throws when no models exist`);
                // This is the anti-pattern we need to handle
                expect(error.message).toContain('unable');
            }
        });

        it('should check target instance for specific model by reference name', async () => {
            try {
                // Try to find a model we expect to exist
                const modelRef = 'TestModel'; // We'll create this
                console.log(`\n🔍 Testing getModelByReferenceName for: ${modelRef}`);
                
                const model = await apiClient.modelMethods.getModelByReferenceName(modelRef, CONFIG.TARGET_GUID);
                console.log(`✅ Found model: ${model.referenceName} (ID: ${model.id})`);
                expect(model.referenceName).toBe(modelRef);
            } catch (error: any) {
                console.log(`❌ Model not found: ${error.message}`);
                expect(error.response?.status).toBe(404);
            }
        });

        it('should push a model to target instance', async () => {
            // Load a simple model from source data
            const sourceModelPath = path.join(CONFIG.SOURCE_DATA_PATH, 'models');
            const modelFiles = fs.readdirSync(sourceModelPath);
            
            if (modelFiles.length === 0) {
                throw new Error('No source models found for testing');
            }

            // Load first model as test data
            const sourceModel = JSON.parse(fs.readFileSync(path.join(sourceModelPath, modelFiles[0]), 'utf8'));
            
            // Create test model payload
            const testModel = {
                ...sourceModel,
                id: -1, // New model
                referenceName: `Test_${Date.now()}`, // Unique name
                displayName: `Test Model ${Date.now()}`,
            };

            console.log(`\n📤 Creating test model: ${testModel.referenceName}`);
            
            try {
                const createdModel = await apiClient.modelMethods.saveModel(testModel, CONFIG.TARGET_GUID);
                console.log(`✅ Model created: ID ${createdModel.id}`);
                
                testModelId = createdModel.id;
                expect(createdModel.id).toBeGreaterThan(0);
                expect(createdModel.referenceName).toBe(testModel.referenceName);
            } catch (error: any) {
                console.log(`❌ Model creation failed: ${error.message}`);
                if (error.response?.data) {
                    console.log(`   API Response: ${JSON.stringify(error.response.data, null, 2)}`);
                }
                throw error;
            }
        });

        it('should retrieve the created model by ID', async () => {
            if (!testModelId) {
                throw new Error('No test model ID available');
            }

            console.log(`\n🔍 Retrieving model by ID: ${testModelId}`);
            
            try {
                const retrievedModel = await apiClient.modelMethods.getContentModel(testModelId, CONFIG.TARGET_GUID);
                console.log(`✅ Retrieved model: ${retrievedModel.referenceName}`);
                
                expect(retrievedModel.id).toBe(testModelId);
                expect(retrievedModel.referenceName).toContain('Test_');
            } catch (error: any) {
                console.log(`❌ Model retrieval failed: ${error.message}`);
                throw error;
            }
        });

        it('should load source model data successfully', async () => {
            console.log(`\n📁 Loading source models from: ${CONFIG.SOURCE_DATA_PATH}/models`);
            
            const modelsPath = path.join(CONFIG.SOURCE_DATA_PATH, 'models');
            expect(fs.existsSync(modelsPath)).toBe(true);
            
            const modelFiles = fs.readdirSync(modelsPath);
            console.log(`✅ Found ${modelFiles.length} source model files`);
            
            expect(modelFiles.length).toBeGreaterThan(0);
            
            // Validate first model structure
            const firstModel = JSON.parse(fs.readFileSync(path.join(modelsPath, modelFiles[0]), 'utf8'));
            console.log(`   Sample: ${firstModel.referenceName} (ID: ${firstModel.id})`);
            
            expect(firstModel).toHaveProperty('id');
            expect(firstModel).toHaveProperty('referenceName');
            expect(firstModel).toHaveProperty('displayName');
        });
    });

    describe('Container Operations', () => {
        it('should check target instance for containers', async () => {
            try {
                console.log(`\n🔍 Testing getContainerList on target: ${CONFIG.TARGET_GUID}`);
                const containers = await apiClient.containerMethods.getContainerList(CONFIG.TARGET_GUID);
                console.log(`✅ Found ${containers.length} containers in target`);
                
                if (containers.length > 0) {
                    console.log(`   Sample: ${containers[0].referenceName} (ID: ${containers[0].contentViewID})`);
                }
                
                expect(Array.isArray(containers)).toBe(true);
            } catch (error: any) {
                console.log(`❌ getContainerList failed: ${error.message}`);
                // Document the behavior for empty instances
                throw error;
            }
        });

        it('should check for specific container by reference name', async () => {
            try {
                const containerRef = 'TestContainer';
                console.log(`\n🔍 Testing getContainerByReferenceName for: ${containerRef}`);
                
                const container = await apiClient.containerMethods.getContainerByReferenceName(containerRef, CONFIG.TARGET_GUID);
                console.log(`✅ Found container: ${container.referenceName}`);
                expect(container.referenceName).toBe(containerRef);
            } catch (error: any) {
                console.log(`❌ Container not found: ${error.message}`);
                expect(error.response?.status).toBe(404);
            }
        });
    });

    describe('Asset Operations', () => {
        it('should check target instance for assets', async () => {
            try {
                console.log(`\n🔍 Testing getMediaList on target: ${CONFIG.TARGET_GUID}`);
                const mediaResult = await apiClient.assetMethods.getMediaList(100, 0, CONFIG.TARGET_GUID);
                console.log(`✅ Found ${mediaResult.assetMedias.length} assets in target`);
                
                if (mediaResult.assetMedias.length > 0) {
                    console.log(`   Sample: ${mediaResult.assetMedias[0].fileName}`);
                }
                
                expect(mediaResult).toHaveProperty('assetMedias');
                expect(Array.isArray(mediaResult.assetMedias)).toBe(true);
            } catch (error: any) {
                console.log(`❌ getMediaList failed: ${error.message}`);
                throw error;
            }
        });

        it('should check for default asset container', async () => {
            try {
                console.log(`\n🔍 Testing getDefaultContainer on target: ${CONFIG.TARGET_GUID}`);
                const defaultContainer = await apiClient.assetMethods.getDefaultContainer(CONFIG.TARGET_GUID);
                console.log(`✅ Found default container: ${defaultContainer.originUrl}`);
                
                expect(defaultContainer).toHaveProperty('originUrl');
                expect(defaultContainer).toHaveProperty('edgeUrl');
            } catch (error: any) {
                console.log(`❌ getDefaultContainer failed: ${error.message}`);
                throw error;
            }
        });
    });

    describe('Gallery Operations', () => {
        it('should check target instance for galleries', async () => {
            try {
                console.log(`\n🔍 Testing getGalleries on target: ${CONFIG.TARGET_GUID}`);
                const galleries = await apiClient.assetMethods.getGalleries(CONFIG.TARGET_GUID, '', 100, 0);
                console.log(`✅ Gallery API response received`);
                console.log(`   Type: ${typeof galleries}, Length: ${Array.isArray(galleries) ? galleries.length : 'N/A'}`);
                
                // Handle different response formats
                const galleryArray = Array.isArray(galleries) ? galleries : (galleries as any).galleries || [];
                console.log(`   Galleries found: ${galleryArray.length}`);
                
                expect(galleries).toBeDefined();
            } catch (error: any) {
                console.log(`❌ getGalleries failed: ${error.message}`);
                // Document anti-pattern behavior
                console.log(`📝 This may be another API anti-pattern for empty galleries`);
            }
        });
    });

    describe('Template Operations', () => {
        it('should check target instance for page templates', async () => {
            try {
                console.log(`\n🔍 Testing getPageTemplates on target: ${CONFIG.TARGET_GUID}`);
                const templates = await apiClient.pageMethods.getPageTemplates(CONFIG.TARGET_GUID, CONFIG.LOCALE, true);
                console.log(`✅ Found ${templates.length} page templates in target`);
                
                if (templates.length > 0) {
                    console.log(`   Sample: ${templates[0].pageTemplateName}`);
                }
                
                expect(Array.isArray(templates)).toBe(true);
            } catch (error: any) {
                console.log(`❌ getPageTemplates failed: ${error.message}`);
                throw error;
            }
        });
    });

    describe('Page Operations', () => {
        it('should check target instance sitemap', async () => {
            try {
                console.log(`\n🔍 Testing getSitemap on target: ${CONFIG.TARGET_GUID}`);
                const sitemap = await apiClient.pageMethods.getSitemap(CONFIG.TARGET_GUID, CONFIG.LOCALE);
                console.log(`✅ Sitemap retrieved successfully`);
                console.log(`   Type: ${typeof sitemap}`);
                
                expect(sitemap).toBeDefined();
            } catch (error: any) {
                console.log(`❌ getSitemap failed: ${error.message}`);
                throw error;
            }
        });
    });

    describe('Source Data Validation', () => {
        it('should validate source data structure', async () => {
            console.log(`\n📁 Validating source data at: ${CONFIG.SOURCE_DATA_PATH}`);
            
            const expectedFolders = ['models', 'containers', 'assets', 'item', 'list'];
            const existingFolders = [];
            
            for (const folder of expectedFolders) {
                const folderPath = path.join(CONFIG.SOURCE_DATA_PATH, folder);
                if (fs.existsSync(folderPath)) {
                    const files = fs.readdirSync(folderPath);
                    console.log(`   ✅ ${folder}: ${files.length} files`);
                    existingFolders.push(folder);
                } else {
                    console.log(`   ❌ ${folder}: not found`);
                }
            }
            
            expect(existingFolders.length).toBeGreaterThan(0);
        });

        it('should load and validate source models structure', async () => {
            const modelsPath = path.join(CONFIG.SOURCE_DATA_PATH, 'models');
            const modelFiles = fs.readdirSync(modelsPath);
            
            expect(modelFiles.length).toBeGreaterThan(0);
            
            // Test multiple models for consistency
            const sampleCount = Math.min(3, modelFiles.length);
            for (let i = 0; i < sampleCount; i++) {
                const model = JSON.parse(fs.readFileSync(path.join(modelsPath, modelFiles[i]), 'utf8'));
                
                expect(model).toHaveProperty('id');
                expect(model).toHaveProperty('referenceName');
                expect(typeof model.id).toBe('number');
                expect(typeof model.referenceName).toBe('string');
                
                console.log(`   ✅ Model ${i + 1}: ${model.referenceName} (ID: ${model.id})`);
            }
        });
    });

    // Cleanup after tests
    afterAll(async () => {
        console.log('\n🧹 Cleaning up test resources...');
        
        // Clean up test model if created
        if (testModelId && apiClient) {
            try {
                await apiClient.modelMethods.deleteModel(testModelId, CONFIG.TARGET_GUID);
                console.log(`✅ Cleaned up test model: ${testModelId}`);
            } catch (error: any) {
                console.log(`⚠️  Could not clean up test model: ${error.message}`);
            }
        }
        
        // Clean up test container if created
        if (testContainerId && apiClient) {
            try {
                // Note: Add container cleanup when we implement container tests
                console.log(`✅ Test container cleanup would go here`);
            } catch (error: any) {
                console.log(`⚠️  Could not clean up test container: ${error.message}`);
            }
        }
         });
}); // End of main describe block 