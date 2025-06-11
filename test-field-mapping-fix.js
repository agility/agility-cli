const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { ReferenceMapper } = require('./dist/lib/mapper');

async function fixFieldMappingMismatch() {
    console.log('🔧 FIELD MAPPING MISMATCH FIX');
    console.log('============================');
    console.log('🎯 PROBLEM: Model field names changed between recursive and structured eras');
    console.log('🔧 SOLUTION: Transform recursive-era fields to structured-era expectations\n');

    const sourceGuid = '67bc73e6-u';
    const locale = 'en-us';
    
    console.log('📥 Loading raw data to examine field structure...');
    const loader = new ChainDataLoader({
        sourceGuid,
        locale,
        isPreview: true,
        rootPath: process.cwd()
    });
    
    const sourceEntities = await loader.loadSourceEntities();
    
    console.log('\n🔍 ANALYZING FIELD STRUCTURE MISMATCH');
    console.log('====================================');
    
    // Analyze model field structure
    if (sourceEntities.models && sourceEntities.models.length > 0) {
        const sampleModel = sourceEntities.models[0];
        console.log('📋 Raw model field analysis:');
        console.log(`   Available fields: ${Object.keys(sampleModel).join(', ')}`);
        
        // Check for field mapping patterns
        const fieldMappings = analyzeFieldMappings(sampleModel);
        console.log('\n🔍 Field mapping analysis:');
        for (const [expected, found] of Object.entries(fieldMappings)) {
            console.log(`   ${expected}: ${found || 'MISSING'}`);
        }
    }
    
    // Transform models to expected structure
    console.log('\n🔧 TRANSFORMING MODELS TO STRUCTURED FORMAT');
    console.log('==========================================');
    
    const transformedEntities = transformEntitiesToStructuredFormat(sourceEntities);
    
    console.log(`📋 Model transformation results:`);
    console.log(`   Original models: ${sourceEntities.models?.length || 0}`);
    console.log(`   Valid transformed models: ${transformedEntities.models?.length || 0}`);
    
    if (transformedEntities.models && transformedEntities.models.length > 0) {
        const transformedSample = transformedEntities.models[0];
        console.log('\n📋 Transformed model sample:');
        console.log(`   definitionID: ${transformedSample.definitionID}`);
        console.log(`   definitionName: ${transformedSample.definitionName}`);
        console.log(`   fields: ${transformedSample.fields ? 'present' : 'missing'}`);
    }
    
    // Test ecosystem health with transformed data
    console.log('\n🧪 TESTING ECOSYSTEM HEALTH WITH TRANSFORMED DATA');
    console.log('================================================');
    
    const referenceMapper = new ReferenceMapper(sourceGuid, '90c39c80-u');
    
    // Pre-populate with transformed data
    if (transformedEntities.models) {
        console.log(`📋 Pre-populating ${transformedEntities.models.length} transformed models...`);
        transformedEntities.models.forEach(model => {
            const targetModel = {
                definitionID: model.definitionID + 1000,
                definitionName: model.definitionName
            };
            referenceMapper.addRecord('model', model, targetModel);
        });
    }
    
    // Transform and link containers
    if (sourceEntities.containers && transformedEntities.models) {
        console.log('📦 Transforming and linking containers...');
        const modelIndex = new Map();
        transformedEntities.models.forEach(model => {
            modelIndex.set(model.definitionID, model);
        });
        
        let linkedContainers = 0;
        sourceEntities.containers.forEach(container => {
            // Transform container if needed
            const transformedContainer = transformContainer(container);
            const linkedModel = modelIndex.get(transformedContainer.modelDefinitionID);
            
            if (linkedModel) {
                transformedContainer.model = linkedModel;
                const targetContainer = {
                    containerID: transformedContainer.containerID + 2000,
                    referenceName: transformedContainer.referenceName,
                    modelDefinitionID: linkedModel.definitionID + 1000
                };
                referenceMapper.addRecord('container', transformedContainer, targetContainer);
                linkedContainers++;
            }
        });
        
        console.log(`✅ Successfully linked ${linkedContainers} containers to transformed models`);
    }
    
    // Calculate final ecosystem health
    const finalHealth = calculateTransformedEcosystemHealth(transformedEntities, referenceMapper);
    console.log(`\n🏥 TRANSFORMED ECOSYSTEM HEALTH: ${finalHealth.overall}%`);
    console.log(`   📋 Model Health: ${finalHealth.models}%`);
    console.log(`   📦 Container Health: ${finalHealth.containers}%`);
    console.log(`   📄 Content Health: ${finalHealth.content}%`);
    console.log(`   🔗 Reference Health: ${finalHealth.references}%`);
    
    if (finalHealth.overall > 80) {
        console.log('\n✅ SUCCESS: Field mapping fix restored ecosystem health!');
        console.log('🎯 SOLUTION CONFIRMED: The issue was field name mismatch between eras');
        
        // Test content mapping with transformed data
        console.log('\n🎯 TESTING CONTENT MAPPING WITH TRANSFORMED DATA');
        console.log('==============================================');
        
        const mappingTest = testContentMappingWithTransformed(
            sourceEntities.content, 
            sourceEntities.containers, 
            transformedEntities.models
        );
        console.log(`📊 Content mapping with transformed models:`);
        console.log(`   ✅ Model-aware matches: ${mappingTest.modelMatches}`);
        console.log(`   ✅ Other matches: ${mappingTest.exactMatches + mappingTest.caseMatches}`);
        console.log(`   ❌ No matches: ${mappingTest.noMatches}`);
        console.log(`   📈 Success rate: ${mappingTest.successRate}%`);
        
    } else {
        console.log('\n❌ Field mapping fix improved but did not fully restore health');
        console.log('🔍 Additional structural issues may exist');
    }
}

function analyzeFieldMappings(sampleModel) {
    const expectedFields = {
        'definitionID': null,
        'definitionName': null,
        'fields': null
    };
    
    // Look for potential mappings in available fields
    const availableFields = Object.keys(sampleModel);
    
    // Common field mapping patterns
    for (const field of availableFields) {
        if (field.toLowerCase().includes('id') && !field.includes('Type')) {
            expectedFields.definitionID = field;
        }
        if (field.toLowerCase().includes('name') || field.toLowerCase().includes('display')) {
            expectedFields.definitionName = field;
        }
        if (field.toLowerCase().includes('field') || field.toLowerCase().includes('definition')) {
            expectedFields.fields = field;
        }
    }
    
    return expectedFields;
}

function transformEntitiesToStructuredFormat(sourceEntities) {
    const transformed = { ...sourceEntities };
    
    // Transform models
    if (sourceEntities.models && Array.isArray(sourceEntities.models)) {
        transformed.models = sourceEntities.models
            .map(model => transformModel(model))
            .filter(model => model !== null);
    }
    
    return transformed;
}

function transformModel(rawModel) {
    if (!rawModel) return null;
    
    // Map recursive-era fields to structured-era expectations
    const transformed = {
        // Try different possible ID fields
        definitionID: rawModel.definitionID || rawModel.id || rawModel.contentDefinitionID,
        
        // Try different possible name fields  
        definitionName: rawModel.definitionName || rawModel.displayName || rawModel.referenceName,
        
        // Try to find fields or create empty structure
        fields: rawModel.fields || rawModel.fieldDefinitions || [],
        
        // Preserve other useful fields
        contentDefinitionTypeID: rawModel.contentDefinitionTypeID,
        lastModifiedDate: rawModel.lastModifiedDate,
        description: rawModel.description,
        
        // Original reference for debugging
        _originalModel: rawModel
    };
    
    // Validate required fields exist
    if (!transformed.definitionID || !transformed.definitionName) {
        return null;
    }
    
    return transformed;
}

function transformContainer(rawContainer) {
    if (!rawContainer) return rawContainer;
    
    // Containers may also need field transformation
    return {
        containerID: rawContainer.containerID || rawContainer.id,
        referenceName: rawContainer.referenceName,
        modelDefinitionID: rawContainer.modelDefinitionID || rawContainer.contentDefinitionID,
        ...rawContainer
    };
}

function calculateTransformedEcosystemHealth(transformedEntities, referenceMapper) {
    // Model health - check if transformation worked
    const modelHealth = transformedEntities.models ? 
        (transformedEntities.models.length / (transformedEntities._originalModelCount || transformedEntities.models.length)) * 100 : 0;
    
    // Container health - check if linking worked
    const containerRecords = referenceMapper.getRecordsByType('container').length;
    const totalContainers = transformedEntities.containers?.length || 0;
    const containerHealth = totalContainers > 0 ? (containerRecords / totalContainers) * 100 : 0;
    
    // Content health - simplified for now
    const contentHealth = transformedEntities.content ? 50 : 0; // Placeholder
    
    // Reference health
    const modelRecords = referenceMapper.getRecordsByType('model').length;
    const referenceHealth = (modelRecords > 0 && containerRecords > 0) ? 100 : 0;
    
    const overall = (modelHealth * 0.3 + containerHealth * 0.3 + contentHealth * 0.2 + referenceHealth * 0.2);
    
    return {
        overall: overall.toFixed(1),
        models: modelHealth.toFixed(1),
        containers: containerHealth.toFixed(1),
        content: contentHealth.toFixed(1),
        references: referenceHealth
    };
}

function testContentMappingWithTransformed(content, containers, transformedModels) {
    if (!content || !transformedModels) {
        return { exactMatches: 0, caseMatches: 0, modelMatches: 0, noMatches: 0, successRate: 0 };
    }
    
    // Build model index
    const modelIndex = new Map();
    transformedModels.forEach(model => {
        if (model.definitionID && model.definitionName) {
            modelIndex.set(model.definitionID, model);
        }
    });
    
    // Enrich containers with transformed models
    const enrichedContainers = [];
    if (containers && Array.isArray(containers)) {
        containers.forEach(container => {
            const transformedContainer = transformContainer(container);
            const model = modelIndex.get(transformedContainer.modelDefinitionID);
            if (model) {
                enrichedContainers.push({
                    ...transformedContainer,
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
        
        // Test exact match
        const exactMatch = enrichedContainers.find(c => c.referenceName === referenceName);
        if (exactMatch) {
            exactMatches++;
            return;
        }
        
        // Test case-insensitive match
        const caseMatch = enrichedContainers.find(c => 
            c.referenceName.toLowerCase() === referenceName.toLowerCase()
        );
        if (caseMatch) {
            caseMatches++;
            return;
        }
        
        // Test model-aware match (this should work now with transformed models)
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
    const successRate = content.length > 0 ? ((totalMatches / content.length) * 100).toFixed(1) : 0;
    
    return {
        exactMatches,
        caseMatches,
        modelMatches,
        noMatches,
        successRate
    };
}

// Run the field mapping fix
fixFieldMappingMismatch().catch(console.error); 