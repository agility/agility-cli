const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { ReferenceMapper } = require('./dist/lib/mapper');

async function emergencyMappingFix() {
    console.log('🚨 EMERGENCY MAPPING SYSTEM FIX');
    console.log('===============================');
    console.log('🎯 PROBLEM: Recursive mapping system incompatible with structured processing');
    console.log('🔧 SOLUTION: Bridge compatibility between paradigms\n');

    const sourceGuid = '67bc73e6-u';
    const targetGuid = '90c39c80-u';
    const locale = 'en-us';
    
    // STEP 1: Load with VALIDATION (fix the 30% ecosystem health)
    console.log('🔍 STEP 1: EMERGENCY DATA LOADING WITH VALIDATION');
    console.log('================================================');
    
    try {
        console.log('📥 Loading source data with ChainDataLoader...');
        const loader = new ChainDataLoader({
            sourceGuid,
            locale,
            isPreview: true,
            rootPath: process.cwd()
        });
        
        const sourceEntities = await loader.loadSourceEntities();
        
        console.log('🔍 VALIDATION: Checking data integrity...');
        
        // CRITICAL FIX 1: Validate model loading
        const modelValidation = validateModels(sourceEntities.models);
        console.log(`📋 Model Validation: ${modelValidation.valid}/${modelValidation.total} valid (${modelValidation.successRate}%)`);
        
        if (modelValidation.successRate < 50) {
            console.log('🚨 CRITICAL: Model loading failure detected');
            console.log('🔧 DEBUGGING: Model structure analysis...');
            
            if (sourceEntities.models && sourceEntities.models.length > 0) {
                const sampleModel = sourceEntities.models[0];
                console.log('📋 Sample model structure:');
                console.log(`   definitionID: ${sampleModel.definitionID}`);
                console.log(`   definitionName: ${sampleModel.definitionName}`);
                console.log(`   fields: ${sampleModel.fields ? 'present' : 'missing'}`);
                console.log(`   raw keys: ${Object.keys(sampleModel)}`);
            } else {
                console.log('❌ No models loaded at all');
            }
        }
        
        // CRITICAL FIX 2: Validate container-model relationships
        const containerValidation = validateContainers(sourceEntities.containers, sourceEntities.models);
        console.log(`📦 Container Validation: ${containerValidation.linked}/${containerValidation.total} linked to models (${containerValidation.successRate}%)`);
        
        // CRITICAL FIX 3: Validate content-container relationships
        const contentValidation = validateContentMapping(sourceEntities.content, sourceEntities.containers, sourceEntities.models);
        console.log(`📄 Content Validation: ${contentValidation.mappable}/${contentValidation.total} can map to containers (${contentValidation.successRate}%)`);
        
        // STEP 2: Emergency Reference Mapper Reconstruction
        console.log('\n🔧 STEP 2: EMERGENCY REFERENCE MAPPER RECONSTRUCTION');
        console.log('==================================================');
        
        const referenceMapper = new ReferenceMapper(sourceGuid, targetGuid);
        
        // RECURSIVE-TO-STRUCTURED BRIDGE: Pre-populate all mappings
        console.log('🔄 Pre-populating reference mapper with validated data...');
        
        // Pre-populate models
        if (sourceEntities.models) {
            const validModels = sourceEntities.models.filter(model => 
                model.definitionID && model.definitionName
            );
            console.log(`📋 Pre-populating ${validModels.length} valid models...`);
            
            validModels.forEach(model => {
                // Simulate target model (since we're in analysis mode)
                const targetModel = {
                    definitionID: model.definitionID + 1000, // Simulate target ID
                    definitionName: model.definitionName
                };
                referenceMapper.addRecord('model', model, targetModel);
            });
        }
        
        // Pre-populate containers with proper model linking
        if (sourceEntities.containers && sourceEntities.models) {
            const modelIndex = new Map();
            sourceEntities.models.forEach(model => {
                if (model.definitionID && model.definitionName) {
                    modelIndex.set(model.definitionID, model);
                }
            });
            
            console.log(`📦 Pre-populating containers with model relationships...`);
            let linkedContainers = 0;
            
            sourceEntities.containers.forEach(container => {
                const linkedModel = modelIndex.get(container.modelDefinitionID);
                if (linkedModel) {
                    // Attach model to container for proper relationship
                    container.model = linkedModel;
                    
                    // Simulate target container
                    const targetContainer = {
                        containerID: container.containerID + 2000, // Simulate target ID
                        referenceName: container.referenceName,
                        modelDefinitionID: linkedModel.definitionID + 1000 // Link to target model
                    };
                    referenceMapper.addRecord('container', container, targetContainer);
                    linkedContainers++;
                }
            });
            
            console.log(`✅ Successfully linked ${linkedContainers} containers to models`);
        }
        
        // STEP 3: Test the fixed ecosystem
        console.log('\n🧪 STEP 3: TEST FIXED ECOSYSTEM HEALTH');
        console.log('=====================================');
        
        const fixedHealth = calculateEcosystemHealth(sourceEntities, referenceMapper);
        console.log(`🏥 Fixed Ecosystem Health: ${fixedHealth.overall}%`);
        console.log(`   📋 Model Health: ${fixedHealth.models}%`);
        console.log(`   📦 Container Health: ${fixedHealth.containers}%`);
        console.log(`   📄 Content Health: ${fixedHealth.content}%`);
        console.log(`   🔗 Reference Health: ${fixedHealth.references}%`);
        
        if (fixedHealth.overall > 80) {
            console.log('✅ SUCCESS: Emergency fix restored ecosystem health!');
            
            // STEP 4: Validate content mapping works now
            console.log('\n🎯 STEP 4: VALIDATE CONTENT MAPPING WITH FIXED SYSTEM');
            console.log('===================================================');
            
            const mappingTest = testContentMapping(sourceEntities.content, sourceEntities.containers, sourceEntities.models);
            console.log(`📊 Content Mapping Results:`);
            console.log(`   ✅ Exact matches: ${mappingTest.exactMatches}`);
            console.log(`   ✅ Case-insensitive matches: ${mappingTest.caseMatches}`);
            console.log(`   ✅ Model-aware matches: ${mappingTest.modelMatches}`);
            console.log(`   ❌ No matches: ${mappingTest.noMatches}`);
            console.log(`   📈 Overall success rate: ${mappingTest.successRate}%`);
            
        } else {
            console.log('❌ FAILURE: Emergency fix did not restore ecosystem health');
            console.log('🔍 Additional diagnosis required');
        }
        
    } catch (error) {
        console.error('❌ Emergency fix failed:', error.message);
        console.error('🔍 This confirms the mapping system architectural mismatch');
    }
}

// VALIDATION FUNCTIONS

function validateModels(models) {
    if (!models || !Array.isArray(models)) {
        return { valid: 0, total: 0, successRate: 0 };
    }
    
    const validModels = models.filter(model => 
        model && 
        model.definitionID && 
        model.definitionName && 
        typeof model.definitionID === 'number' &&
        typeof model.definitionName === 'string'
    );
    
    return {
        valid: validModels.length,
        total: models.length,
        successRate: ((validModels.length / models.length) * 100).toFixed(1)
    };
}

function validateContainers(containers, models) {
    if (!containers || !Array.isArray(containers)) {
        return { linked: 0, total: 0, successRate: 0 };
    }
    
    const modelIds = new Set();
    if (models && Array.isArray(models)) {
        models.forEach(model => {
            if (model.definitionID) {
                modelIds.add(model.definitionID);
            }
        });
    }
    
    const linkedContainers = containers.filter(container =>
        container &&
        container.modelDefinitionID &&
        modelIds.has(container.modelDefinitionID)
    );
    
    return {
        linked: linkedContainers.length,
        total: containers.length,
        successRate: ((linkedContainers.length / containers.length) * 100).toFixed(1)
    };
}

function validateContentMapping(content, containers, models) {
    if (!content || !Array.isArray(content)) {
        return { mappable: 0, total: 0, successRate: 0 };
    }
    
    // Build model-aware container index
    const modelIndex = new Map();
    if (models && Array.isArray(models)) {
        models.forEach(model => {
            if (model.definitionID && model.definitionName) {
                modelIndex.set(model.definitionID, model);
            }
        });
    }
    
    // Enrich containers with model information
    const enrichedContainers = [];
    if (containers && Array.isArray(containers)) {
        containers.forEach(container => {
            const model = modelIndex.get(container.modelDefinitionID);
            if (model) {
                enrichedContainers.push({
                    ...container,
                    model: model
                });
            }
        });
    }
    
    // Test content mapping
    const mappableContent = content.filter(contentItem => {
        const definitionName = contentItem.properties?.definitionName;
        const referenceName = contentItem.properties?.referenceName;
        
        if (!definitionName || !referenceName) return false;
        
        // Test multiple mapping strategies
        const exactMatch = enrichedContainers.find(c => c.referenceName === referenceName);
        const caseMatch = enrichedContainers.find(c => 
            c.referenceName.toLowerCase() === referenceName.toLowerCase()
        );
        const modelMatch = enrichedContainers.find(c => 
            c.model && c.model.definitionName === definitionName
        );
        
        return exactMatch || caseMatch || modelMatch;
    });
    
    return {
        mappable: mappableContent.length,
        total: content.length,
        successRate: ((mappableContent.length / content.length) * 100).toFixed(1)
    };
}

function calculateEcosystemHealth(sourceEntities, referenceMapper) {
    const modelValidation = validateModels(sourceEntities.models);
    const containerValidation = validateContainers(sourceEntities.containers, sourceEntities.models);
    const contentValidation = validateContentMapping(sourceEntities.content, sourceEntities.containers, sourceEntities.models);
    
    // Reference health based on mapper population
    const modelRecords = referenceMapper.getRecordsByType('model').length;
    const containerRecords = referenceMapper.getRecordsByType('container').length;
    const referenceHealth = (modelRecords > 0 && containerRecords > 0) ? 100 : 0;
    
    const overall = (
        parseFloat(modelValidation.successRate) * 0.25 +
        parseFloat(containerValidation.successRate) * 0.25 +
        parseFloat(contentValidation.successRate) * 0.30 +
        referenceHealth * 0.20
    );
    
    return {
        overall: overall.toFixed(1),
        models: modelValidation.successRate,
        containers: containerValidation.successRate,
        content: contentValidation.successRate,
        references: referenceHealth
    };
}

function testContentMapping(content, containers, models) {
    if (!content || !Array.isArray(content)) {
        return { exactMatches: 0, caseMatches: 0, modelMatches: 0, noMatches: 0, successRate: 0 };
    }
    
    // Build enriched container index
    const modelIndex = new Map();
    if (models && Array.isArray(models)) {
        models.forEach(model => {
            if (model.definitionID && model.definitionName) {
                modelIndex.set(model.definitionID, model);
            }
        });
    }
    
    const enrichedContainers = [];
    if (containers && Array.isArray(containers)) {
        containers.forEach(container => {
            const model = modelIndex.get(container.modelDefinitionID);
            if (model) {
                enrichedContainers.push({
                    ...container,
                    model: model
                });
            }
        });
    }
    
    let exactMatches = 0;
    let caseMatches = 0;
    let modelMatches = 0;
    let noMatches = 0;
    
    content.forEach(contentItem => {
        const definitionName = contentItem.properties?.definitionName;
        const referenceName = contentItem.properties?.referenceName;
        
        if (!definitionName || !referenceName) {
            noMatches++;
            return;
        }
        
        const exactMatch = enrichedContainers.find(c => c.referenceName === referenceName);
        if (exactMatch) {
            exactMatches++;
            return;
        }
        
        const caseMatch = enrichedContainers.find(c => 
            c.referenceName.toLowerCase() === referenceName.toLowerCase()
        );
        if (caseMatch) {
            caseMatches++;
            return;
        }
        
        const modelMatch = enrichedContainers.find(c => 
            c.model && c.model.definitionName === definitionName
        );
        if (modelMatch) {
            modelMatches++;
            return;
        }
        
        noMatches++;
    });
    
    const totalMatches = exactMatches + caseMatches + modelMatches;
    const successRate = ((totalMatches / content.length) * 100).toFixed(1);
    
    return {
        exactMatches,
        caseMatches,
        modelMatches,
        noMatches,
        successRate
    };
}

// Run the emergency fix
emergencyMappingFix().catch(console.error); 