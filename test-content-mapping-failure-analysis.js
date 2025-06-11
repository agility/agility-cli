const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');

async function analyzeContentMappingFailures() {
    console.log('🔍 DETAILED CONTENT MAPPING FAILURE ANALYSIS');
    console.log('==========================================');
    console.log('🎯 OBJECTIVE: Identify the specific 3 failing content items and understand why they fail\n');

    const sourceGuid = '67bc73e6-u';
    const locale = 'en-us';
    
    // Load and transform data
    console.log('📥 Loading and transforming data...');
    const loader = new ChainDataLoader({
        sourceGuid,
        locale,
        isPreview: true,
        rootPath: process.cwd()
    });
    
    const sourceEntities = await loader.loadSourceEntities();
    
    // Transform models to structured format
    const transformedModels = transformModels(sourceEntities.models);
    console.log(`✅ Transformed ${transformedModels.length} models`);
    
    // Build comprehensive model and container analysis
    console.log('\n🔍 BUILDING COMPREHENSIVE MAPPING ANALYSIS');
    console.log('=========================================');
    
    // Create model index
    const modelIndex = new Map();
    transformedModels.forEach(model => {
        if (model.definitionID && model.definitionName) {
            modelIndex.set(model.definitionID, model);
        }
    });
    
    console.log(`📋 Model index contains ${modelIndex.size} models:`);
    for (const [id, model] of modelIndex.entries()) {
        console.log(`   ${id}: ${model.definitionName}`);
    }
    
    // Transform containers and link to models
    const enrichedContainers = [];
    let containersWithModels = 0;
    let containersWithoutModels = 0;
    
    if (sourceEntities.containers && Array.isArray(sourceEntities.containers)) {
        sourceEntities.containers.forEach(container => {
            const transformedContainer = transformContainer(container);
            const model = modelIndex.get(transformedContainer.modelDefinitionID);
            
            if (model) {
                enrichedContainers.push({
                    ...transformedContainer,
                    model: model
                });
                containersWithModels++;
            } else {
                containersWithoutModels++;
                console.log(`⚠️ Container ${transformedContainer.containerID} (${transformedContainer.referenceName}) has no model for modelDefinitionID: ${transformedContainer.modelDefinitionID}`);
            }
        });
    }
    
    console.log(`\n📦 Container analysis:`);
    console.log(`   ✅ Containers with models: ${containersWithModels}`);
    console.log(`   ❌ Containers without models: ${containersWithoutModels}`);
    console.log(`   📊 Total enriched containers: ${enrichedContainers.length}`);
    
    // Group containers by model name for analysis
    const containersByModel = new Map();
    enrichedContainers.forEach(container => {
        const modelName = container.model.definitionName;
        if (!containersByModel.has(modelName)) {
            containersByModel.set(modelName, []);
        }
        containersByModel.get(modelName).push(container);
    });
    
    console.log(`\n📊 Containers grouped by model:`);
    for (const [modelName, containers] of containersByModel.entries()) {
        console.log(`   ${modelName}: ${containers.length} containers`);
    }
    
    // Now analyze content mapping failures in detail
    console.log('\n🔍 DETAILED CONTENT MAPPING ANALYSIS');
    console.log('===================================');
    
    const failureAnalysis = {
        exactMatches: [],
        caseMatches: [],
        modelMatches: [],
        noMatches: [],
        invalidContent: []
    };
    
    let totalAnalyzed = 0;
    
    if (sourceEntities.content && Array.isArray(sourceEntities.content)) {
        sourceEntities.content.forEach((contentItem, index) => {
            totalAnalyzed++;
            const definitionName = contentItem.properties?.definitionName;
            const referenceName = contentItem.properties?.referenceName;
            const contentID = contentItem.contentID;
            
            // Check for invalid content first
            if (!definitionName || !referenceName) {
                failureAnalysis.invalidContent.push({
                    index,
                    contentID,
                    definitionName,
                    referenceName,
                    issue: !definitionName ? 'missing definitionName' : 'missing referenceName'
                });
                return;
            }
            
            // Test exact match
            const exactMatch = enrichedContainers.find(c => c.referenceName === referenceName);
            if (exactMatch) {
                failureAnalysis.exactMatches.push({
                    index,
                    contentID,
                    definitionName,
                    referenceName,
                    matchedContainer: exactMatch.referenceName,
                    matchedModel: exactMatch.model.definitionName
                });
                return;
            }
            
            // Test case-insensitive match
            const caseMatch = enrichedContainers.find(c => 
                c.referenceName.toLowerCase() === referenceName.toLowerCase()
            );
            if (caseMatch) {
                failureAnalysis.caseMatches.push({
                    index,
                    contentID,
                    definitionName,
                    referenceName,
                    matchedContainer: caseMatch.referenceName,
                    matchedModel: caseMatch.model.definitionName
                });
                return;
            }
            
            // Test model-aware match
            const modelMatch = enrichedContainers.find(c => 
                c.model && c.model.definitionName === definitionName
            );
            if (modelMatch) {
                failureAnalysis.modelMatches.push({
                    index,
                    contentID,
                    definitionName,
                    referenceName,
                    matchedContainer: modelMatch.referenceName,
                    matchedModel: modelMatch.model.definitionName
                });
                return;
            }
            
            // No match found - this is a failure
            failureAnalysis.noMatches.push({
                index,
                contentID,
                definitionName,
                referenceName,
                availableContainersForModel: containersByModel.get(definitionName)?.map(c => c.referenceName) || [],
                availableModels: Array.from(containersByModel.keys()),
                investigationData: {
                    hasMatchingModel: containersByModel.has(definitionName),
                    totalContainersForModel: containersByModel.get(definitionName)?.length || 0
                }
            });
        });
    }
    
    // Report detailed results
    console.log(`\n📊 DETAILED MAPPING RESULTS (${totalAnalyzed} content items analyzed):`);
    console.log(`   ✅ Exact matches: ${failureAnalysis.exactMatches.length}`);
    console.log(`   ✅ Case-insensitive matches: ${failureAnalysis.caseMatches.length}`);
    console.log(`   ✅ Model-aware matches: ${failureAnalysis.modelMatches.length}`);
    console.log(`   ❌ No matches: ${failureAnalysis.noMatches.length}`);
    console.log(`   ⚠️ Invalid content: ${failureAnalysis.invalidContent.length}`);
    
    const totalSuccesses = failureAnalysis.exactMatches.length + failureAnalysis.caseMatches.length + failureAnalysis.modelMatches.length;
    const successRate = ((totalSuccesses / totalAnalyzed) * 100).toFixed(1);
    console.log(`   📈 Success rate: ${successRate}%`);
    
    // Deep dive into failures
    console.log('\n🔍 DETAILED FAILURE ANALYSIS');
    console.log('============================');
    
    if (failureAnalysis.invalidContent.length > 0) {
        console.log(`\n⚠️ Invalid Content Items (${failureAnalysis.invalidContent.length}):`);
        failureAnalysis.invalidContent.forEach(item => {
            console.log(`   Content ${item.contentID}: ${item.issue}`);
            console.log(`      definitionName: ${item.definitionName}`);
            console.log(`      referenceName: ${item.referenceName}`);
        });
    }
    
    if (failureAnalysis.noMatches.length > 0) {
        console.log(`\n❌ Content Items with No Matches (${failureAnalysis.noMatches.length}):`);
        failureAnalysis.noMatches.forEach((item, i) => {
            console.log(`\n   ${i + 1}. Content ${item.contentID}:`);
            console.log(`      definitionName: "${item.definitionName}"`);
            console.log(`      referenceName: "${item.referenceName}"`);
            console.log(`      hasMatchingModel: ${item.investigationData.hasMatchingModel}`);
            console.log(`      containersForModel: ${item.investigationData.totalContainersForModel}`);
            
            if (item.availableContainersForModel.length > 0) {
                console.log(`      availableContainers: ${item.availableContainersForModel.slice(0, 5).join(', ')}${item.availableContainersForModel.length > 5 ? '...' : ''}`);
            } else {
                console.log(`      availableContainers: NONE`);
                console.log(`      🔍 Available models: ${item.availableModels.slice(0, 10).join(', ')}${item.availableModels.length > 10 ? '...' : ''}`);
                
                // Check for similar model names
                const similarModels = item.availableModels.filter(model => 
                    model.toLowerCase().includes(item.definitionName.toLowerCase()) ||
                    item.definitionName.toLowerCase().includes(model.toLowerCase())
                );
                if (similarModels.length > 0) {
                    console.log(`      🎯 Similar models found: ${similarModels.join(', ')}`);
                }
            }
        });
    }
    
    // Investigate model-aware matching specifically
    if (failureAnalysis.modelMatches.length === 0) {
        console.log('\n🔍 INVESTIGATING WHY MODEL-AWARE MATCHING SHOWS 0');
        console.log('===============================================');
        
        // Test a few content items manually for model matching
        const testContent = sourceEntities.content.slice(0, 5);
        testContent.forEach(contentItem => {
            const definitionName = contentItem.properties?.definitionName;
            const referenceName = contentItem.properties?.referenceName;
            
            console.log(`\n🧪 Testing content ${contentItem.contentID}:`);
            console.log(`   definitionName: "${definitionName}"`);
            console.log(`   referenceName: "${referenceName}"`);
            
            // Check if model exists
            const hasModel = containersByModel.has(definitionName);
            console.log(`   hasMatchingModel: ${hasModel}`);
            
            if (hasModel) {
                const containersForModel = containersByModel.get(definitionName);
                console.log(`   containersForModel: ${containersForModel.length}`);
                console.log(`   containerNames: ${containersForModel.map(c => c.referenceName).slice(0, 3).join(', ')}`);
                
                // Test exact model match logic
                const modelMatch = enrichedContainers.find(c => 
                    c.model && c.model.definitionName === definitionName
                );
                console.log(`   modelMatchFound: ${!!modelMatch}`);
                if (modelMatch) {
                    console.log(`   matchedContainer: ${modelMatch.referenceName}`);
                }
            }
        });
    }
    
    console.log('\n✅ Content mapping failure analysis complete');
}

// Helper functions (same as before but focused on transformation)
function transformModels(rawModels) {
    if (!rawModels || !Array.isArray(rawModels)) return [];
    
    return rawModels
        .map(model => transformModel(model))
        .filter(model => model !== null);
}

function transformModel(rawModel) {
    if (!rawModel) return null;
    
    const transformed = {
        definitionID: rawModel.definitionID || rawModel.id || rawModel.contentDefinitionID,
        definitionName: rawModel.definitionName || rawModel.displayName || rawModel.referenceName,
        fields: rawModel.fields || rawModel.fieldDefinitions || [],
        _originalModel: rawModel
    };
    
    if (!transformed.definitionID || !transformed.definitionName) {
        return null;
    }
    
    return transformed;
}

function transformContainer(rawContainer) {
    if (!rawContainer) return rawContainer;
    
    return {
        containerID: rawContainer.containerID || rawContainer.id,
        referenceName: rawContainer.referenceName,
        modelDefinitionID: rawContainer.modelDefinitionID || rawContainer.contentDefinitionID,
        ...rawContainer
    };
}

// Run the detailed failure analysis
analyzeContentMappingFailures().catch(console.error); 