const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');

async function fixSpaceNormalizationAndCircularRefs() {
    console.log('🔧 SPACE NORMALIZATION & CIRCULAR REFERENCE FIX');
    console.log('===============================================');
    console.log('🎯 OBJECTIVES:');
    console.log('   1. Fix space normalization in model names (DocSection ↔ Doc Section)');
    console.log('   2. Investigate circular model references');
    console.log('   3. Achieve 100% content mapping success\n');

    const sourceGuid = '67bc73e6-u';
    const locale = 'en-us';
    
    // Load source data
    console.log('📥 Loading source data...');
    const loader = new ChainDataLoader({
        sourceGuid,
        locale,
        isPreview: true,
        rootPath: process.cwd()
    });
    
    const sourceEntities = await loader.loadSourceEntities();
    
    // STEP 1: Enhanced model transformation with space normalization
    console.log('\n🔧 STEP 1: ENHANCED MODEL TRANSFORMATION WITH SPACE NORMALIZATION');
    console.log('================================================================');
    
    const transformedModels = transformModelsWithSpaceNormalization(sourceEntities.models);
    console.log(`✅ Transformed ${transformedModels.length} models with space normalization`);
    
    // Show space normalization mapping
    console.log('\n📋 Space normalization mapping:');
    transformedModels.forEach(model => {
        const original = model._originalModel.displayName || model._originalModel.referenceName;
        const normalized = model.definitionName;
        const normalizedKey = normalizeSpaces(normalized);
        
        if (original !== normalized || normalized !== normalizedKey) {
            console.log(`   "${original}" → "${normalized}" → key:"${normalizedKey}"`);
        }
    });
    
    // STEP 2: Investigate circular model references
    console.log('\n🔍 STEP 2: INVESTIGATING CIRCULAR MODEL REFERENCES');
    console.log('=================================================');
    
    const circularAnalysis = analyzeCircularModelReferences(transformedModels);
    console.log(`📊 Circular reference analysis:`);
    console.log(`   🔄 Models with self-references: ${circularAnalysis.selfReferences.length}`);
    console.log(`   🔄 Models with circular chains: ${circularAnalysis.circularChains.length}`);
    console.log(`   🔄 Complex dependency models: ${circularAnalysis.complexDependencies.length}`);
    
    if (circularAnalysis.selfReferences.length > 0) {
        console.log('\n🔄 Self-referencing models:');
        circularAnalysis.selfReferences.forEach(model => {
            console.log(`   ${model.definitionName}: ${model.selfRefFields.join(', ')}`);
        });
    }
    
    if (circularAnalysis.circularChains.length > 0) {
        console.log('\n🔄 Circular dependency chains:');
        circularAnalysis.circularChains.forEach(chain => {
            console.log(`   ${chain.join(' → ')}`);
        });
    }
    
    // STEP 3: Enhanced container mapping with space normalization
    console.log('\n🔧 STEP 3: ENHANCED CONTAINER MAPPING WITH SPACE NORMALIZATION');
    console.log('============================================================');
    
    // Create enhanced model indices
    const modelIndex = new Map();
    const normalizedModelIndex = new Map();
    
    transformedModels.forEach(model => {
        if (model.definitionID && model.definitionName) {
            modelIndex.set(model.definitionID, model);
            
            // Create normalized space index
            const normalizedName = normalizeSpaces(model.definitionName);
            if (!normalizedModelIndex.has(normalizedName)) {
                normalizedModelIndex.set(normalizedName, []);
            }
            normalizedModelIndex.get(normalizedName).push(model);
        }
    });
    
    console.log(`📋 Model indices created:`);
    console.log(`   🆔 ID-based index: ${modelIndex.size} entries`);
    console.log(`   🔤 Normalized name index: ${normalizedModelIndex.size} entries`);
    
    // Show normalized groupings
    console.log('\n📊 Normalized model groupings:');
    for (const [normalizedName, models] of normalizedModelIndex.entries()) {
        if (models.length > 1) {
            console.log(`   "${normalizedName}": ${models.map(m => m.definitionName).join(', ')}`);
        }
    }
    
    // Transform and enrich containers
    const enrichedContainers = [];
    let containersWithModels = 0;
    let containersWithoutModels = 0;
    
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
        }
    });
    
    console.log(`\n📦 Enhanced container analysis:`);
    console.log(`   ✅ Containers with models: ${containersWithModels}`);
    console.log(`   ❌ Containers without models: ${containersWithoutModels}`);
    
    // STEP 4: Enhanced content mapping with multiple strategies
    console.log('\n🎯 STEP 4: ENHANCED CONTENT MAPPING WITH MULTIPLE STRATEGIES');
    console.log('==========================================================');
    
    const enhancedMappingResults = performEnhancedContentMapping(
        sourceEntities.content,
        enrichedContainers,
        normalizedModelIndex
    );
    
    console.log(`📊 Enhanced mapping results:`);
    console.log(`   ✅ Exact matches: ${enhancedMappingResults.exactMatches.length}`);
    console.log(`   ✅ Case-insensitive matches: ${enhancedMappingResults.caseMatches.length}`);
    console.log(`   ✅ Model-aware matches: ${enhancedMappingResults.modelMatches.length}`);
    console.log(`   ✅ Space-normalized matches: ${enhancedMappingResults.spaceNormalizedMatches.length}`);
    console.log(`   ❌ No matches: ${enhancedMappingResults.noMatches.length}`);
    console.log(`   ⚠️ Invalid content: ${enhancedMappingResults.invalidContent.length}`);
    
    const totalSuccesses = enhancedMappingResults.exactMatches.length + 
                          enhancedMappingResults.caseMatches.length + 
                          enhancedMappingResults.modelMatches.length +
                          enhancedMappingResults.spaceNormalizedMatches.length;
    const totalAnalyzed = sourceEntities.content.length;
    const successRate = ((totalSuccesses / totalAnalyzed) * 100).toFixed(1);
    
    console.log(`   📈 Success rate: ${successRate}%`);
    
    // STEP 5: Detailed analysis of remaining failures
    if (enhancedMappingResults.noMatches.length > 0) {
        console.log('\n🔍 DETAILED ANALYSIS OF REMAINING FAILURES');
        console.log('=========================================');
        
        enhancedMappingResults.noMatches.forEach((item, i) => {
            console.log(`\n❌ Failure ${i + 1}: Content ${item.contentID}`);
            console.log(`   definitionName: "${item.definitionName}"`);
            console.log(`   referenceName: "${item.referenceName}"`);
            console.log(`   normalizedName: "${normalizeSpaces(item.definitionName)}"`);
            
            // Check if normalized model exists
            const normalizedModels = normalizedModelIndex.get(normalizeSpaces(item.definitionName));
            if (normalizedModels && normalizedModels.length > 0) {
                console.log(`   🎯 Found normalized models: ${normalizedModels.map(m => m.definitionName).join(', ')}`);
                console.log(`   🔍 Issue may be: Container linkage problem or content reference issue`);
            } else {
                console.log(`   ❌ No models found even after space normalization`);
                console.log(`   🔍 Issue: Model truly missing (orphaned content)`);
            }
            
            // Check for similar/partial matches
            const similarModels = Array.from(normalizedModelIndex.keys()).filter(key =>
                key.includes(normalizeSpaces(item.definitionName).toLowerCase()) ||
                normalizeSpaces(item.definitionName).toLowerCase().includes(key.toLowerCase())
            );
            if (similarModels.length > 0) {
                console.log(`   🎯 Similar models: ${similarModels.join(', ')}`);
            }
        });
    }
    
    // STEP 6: Success verification
    if (successRate >= 99.5) {
        console.log('\n✅ SUCCESS: Enhanced mapping achieved near-perfect success rate!');
        console.log('🎯 Space normalization and enhanced strategies resolved the mapping issues');
        
        if (enhancedMappingResults.spaceNormalizedMatches.length > 0) {
            console.log(`\n🔧 Space normalization rescued ${enhancedMappingResults.spaceNormalizedMatches.length} content items:`);
            enhancedMappingResults.spaceNormalizedMatches.slice(0, 5).forEach(match => {
                console.log(`   Content ${match.contentID}: "${match.definitionName}" → "${match.matchedModel}"`);
            });
        }
        
    } else {
        console.log('\n⚠️ Further investigation needed for remaining failures');
    }
    
    console.log('\n✅ Space normalization and circular reference analysis complete');
}

function normalizeSpaces(text) {
    if (!text) return '';
    return text.replace(/\s+/g, '').toLowerCase();
}

function transformModelsWithSpaceNormalization(rawModels) {
    if (!rawModels || !Array.isArray(rawModels)) return [];
    
    return rawModels
        .map(model => transformModelWithSpaceNormalization(model))
        .filter(model => model !== null);
}

function transformModelWithSpaceNormalization(rawModel) {
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

function analyzeCircularModelReferences(models) {
    const analysis = {
        selfReferences: [],
        circularChains: [],
        complexDependencies: []
    };
    
    models.forEach(model => {
        const modelName = model.definitionName;
        const fields = model.fields || [];
        
        // Check for self-references
        const selfRefFields = [];
        if (Array.isArray(fields)) {
            fields.forEach(field => {
                if (field.type === 'Content' && field.contentDefinitionName === modelName) {
                    selfRefFields.push(field.name || field.fieldName);
                }
            });
        }
        
        if (selfRefFields.length > 0) {
            analysis.selfReferences.push({
                definitionName: modelName,
                selfRefFields: selfRefFields
            });
        }
        
        // Check for complex dependencies (multiple content fields)
        const contentFields = fields.filter(field => field.type === 'Content');
        if (contentFields.length > 2) {
            analysis.complexDependencies.push({
                definitionName: modelName,
                contentFieldCount: contentFields.length,
                referencedModels: contentFields.map(f => f.contentDefinitionName).filter(Boolean)
            });
        }
    });
    
    return analysis;
}

function performEnhancedContentMapping(content, enrichedContainers, normalizedModelIndex) {
    const results = {
        exactMatches: [],
        caseMatches: [],
        modelMatches: [],
        spaceNormalizedMatches: [],
        noMatches: [],
        invalidContent: []
    };
    
    if (!content || !Array.isArray(content)) return results;
    
    content.forEach((contentItem, index) => {
        const definitionName = contentItem.properties?.definitionName;
        const referenceName = contentItem.properties?.referenceName;
        const contentID = contentItem.contentID;
        
        // Check for invalid content
        if (!definitionName || !referenceName) {
            results.invalidContent.push({
                index, contentID, definitionName, referenceName,
                issue: !definitionName ? 'missing definitionName' : 'missing referenceName'
            });
            return;
        }
        
        // Strategy 1: Exact container match
        const exactMatch = enrichedContainers.find(c => c.referenceName === referenceName);
        if (exactMatch) {
            results.exactMatches.push({
                index, contentID, definitionName, referenceName,
                matchedContainer: exactMatch.referenceName,
                matchedModel: exactMatch.model.definitionName
            });
            return;
        }
        
        // Strategy 2: Case-insensitive container match
        const caseMatch = enrichedContainers.find(c => 
            c.referenceName.toLowerCase() === referenceName.toLowerCase()
        );
        if (caseMatch) {
            results.caseMatches.push({
                index, contentID, definitionName, referenceName,
                matchedContainer: caseMatch.referenceName,
                matchedModel: caseMatch.model.definitionName
            });
            return;
        }
        
        // Strategy 3: Model-aware match (exact model name)
        const modelMatch = enrichedContainers.find(c => 
            c.model && c.model.definitionName === definitionName
        );
        if (modelMatch) {
            results.modelMatches.push({
                index, contentID, definitionName, referenceName,
                matchedContainer: modelMatch.referenceName,
                matchedModel: modelMatch.model.definitionName
            });
            return;
        }
        
        // Strategy 4: Space-normalized model match (NEW!)
        const normalizedContentName = normalizeSpaces(definitionName);
        const normalizedModels = normalizedModelIndex.get(normalizedContentName);
        
        if (normalizedModels && normalizedModels.length > 0) {
            // Find a container that uses one of these normalized models
            const spaceNormalizedMatch = enrichedContainers.find(c => 
                normalizedModels.some(model => model.definitionID === c.model.definitionID)
            );
            
            if (spaceNormalizedMatch) {
                results.spaceNormalizedMatches.push({
                    index, contentID, definitionName, referenceName,
                    matchedContainer: spaceNormalizedMatch.referenceName,
                    matchedModel: spaceNormalizedMatch.model.definitionName,
                    normalizedFrom: definitionName,
                    normalizedTo: spaceNormalizedMatch.model.definitionName
                });
                return;
            }
        }
        
        // No match found
        results.noMatches.push({
            index, contentID, definitionName, referenceName
        });
    });
    
    return results;
}

// Run the enhanced fix
fixSpaceNormalizationAndCircularRefs().catch(console.error); 