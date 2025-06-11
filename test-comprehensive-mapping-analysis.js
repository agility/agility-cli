const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { ReferenceMapper } = require('./dist/lib/mapper');

async function comprehensiveMappingAnalysis() {
    console.log('🔍 COMPREHENSIVE MAPPING ANALYSIS');
    console.log('=====================================\n');

    // Load source data
    const sourceGuid = '67bc73e6-u';
    const targetGuid = '90c39c80-u';
    const locale = 'en-us';
    const channel = 'website';
    
    console.log('📥 Loading source data...');
    const loader = new ChainDataLoader({
        sourceGuid,
        locale,
        isPreview: true,
        rootPath: process.cwd()
    });
    const sourceEntities = await loader.loadSourceEntities();
    
    console.log(`✅ Loaded source entities:`);
    console.log(`   📦 Models: ${sourceEntities.models?.length || 0}`);
    console.log(`   📦 Containers: ${sourceEntities.containers?.length || 0}`);
    console.log(`   📄 Content: ${sourceEntities.content?.length || 0}`);
    console.log(`   🖼️ Assets: ${sourceEntities.assets?.length || 0}`);
    console.log(`   🖼️ Galleries: ${sourceEntities.galleries?.length || 0}\n`);

    // Initialize reference mapper and simulate existing mappings
    const referenceMapper = new ReferenceMapper(sourceGuid, targetGuid);
    console.log('📋 Initial reference mapper state:');
    console.log(`   📦 Models: ${referenceMapper.getRecordsByType('model').length}`);
    console.log(`   📦 Containers: ${referenceMapper.getRecordsByType('container').length}`);
    console.log(`   📄 Content: ${referenceMapper.getRecordsByType('content').length}\n`);

    // ANALYSIS 1: Model Field Dependencies and Circular References
    console.log('🔍 ANALYSIS 1: MODEL FIELD DEPENDENCIES');
    console.log('========================================');
    
    const modelsWithContentFields = [];
    const circularReferences = [];
    
    if (sourceEntities.models) {
        for (const model of sourceEntities.models) {
            let hasContentField = false;
            let contentFieldCount = 0;
            
            if (model.fields) {
                for (const field of model.fields) {
                    if (field.definitionTypeName === 'ContentDefinition') {
                        hasContentField = true;
                        contentFieldCount++;
                        console.log(`   📋 Model "${model.displayName}" has ContentDefinition field: "${field.name}"`);
                        
                        // Check for circular references
                        if (field.settings && field.settings.ContentDefinition === model.definitionName) {
                            circularReferences.push({
                                model: model.displayName,
                                field: field.name,
                                referencesItself: true
                            });
                        }
                    }
                }
            }
            
            if (hasContentField) {
                modelsWithContentFields.push({
                    displayName: model.displayName,
                    definitionName: model.definitionName,
                    contentFieldCount
                });
            }
        }
    }
    
    console.log(`\n📊 Models with ContentDefinition fields: ${modelsWithContentFields.length}`);
    console.log(`🔄 Circular references detected: ${circularReferences.length}\n`);

    // ANALYSIS 2: Container-to-Model Mapping Issues
    console.log('🔍 ANALYSIS 2: CONTAINER-TO-MODEL MAPPING');
    console.log('=========================================');
    
    const containerModelMismatches = [];
    const containersByModel = new Map();
    
    if (sourceEntities.containers) {
        for (const container of sourceEntities.containers) {
            const modelRef = container.modelDefinitionID;
            const containerRef = container.referenceName;
            
            // Find corresponding model
            const correspondingModel = sourceEntities.models?.find(m => m.definitionID === modelRef);
            
            if (correspondingModel) {
                const modelName = correspondingModel.definitionName;
                
                if (!containersByModel.has(modelName)) {
                    containersByModel.set(modelName, []);
                }
                containersByModel.get(modelName).push(containerRef);
                
                // Check for naming mismatches (ensure strings exist)
                if (containerRef && modelName &&
                    !containerRef.toLowerCase().includes(modelName.toLowerCase()) && 
                    !modelName.toLowerCase().includes(containerRef.toLowerCase())) {
                    containerModelMismatches.push({
                        container: containerRef,
                        model: modelName,
                        mismatchType: 'naming'
                    });
                }
            } else {
                containerModelMismatches.push({
                    container: containerRef,
                    model: `MISSING_MODEL_${modelRef}`,
                    mismatchType: 'missing_model'
                });
            }
        }
    }
    
    console.log(`📊 Container-Model mismatches: ${containerModelMismatches.length}`);
    if (containerModelMismatches.length > 0) {
        console.log('   🔍 Mismatches (first 10):');
        containerModelMismatches.slice(0, 10).forEach(mismatch => {
            console.log(`      ❌ "${mismatch.container}" → Model:"${mismatch.model}" (${mismatch.mismatchType})`);
        });
    }
    
    console.log(`\n📊 Models with multiple containers:`);
    for (const [modelName, containers] of containersByModel.entries()) {
        if (containers.length > 1) {
            console.log(`   📦 Model:"${modelName}" → ${containers.length} containers: ${containers.slice(0, 3).join(', ')}${containers.length > 3 ? '...' : ''}`);
        }
    }

    // ANALYSIS 3: Hash-Based Container Names (The ChangeLog Issue)
    console.log('\n🔍 ANALYSIS 3: HASH-BASED CONTAINER NAMES');
    console.log('==========================================');
    
    const hashBasedContainers = [];
    const baseNameGroups = new Map();
    
    if (sourceEntities.containers) {
        for (const container of sourceEntities.containers) {
            const ref = container.referenceName;
            
            // Check for hash-like suffixes (8 hex characters)
            const hashMatch = ref.match(/([A-F0-9]{8})$/);
            if (hashMatch) {
                const hash = hashMatch[1];
                const baseName = ref.replace(hashMatch[0], '');
                
                hashBasedContainers.push({
                    referenceName: ref,
                    baseName,
                    hash
                });
                
                if (!baseNameGroups.has(baseName)) {
                    baseNameGroups.set(baseName, []);
                }
                baseNameGroups.get(baseName).push(ref);
            }
        }
    }
    
    console.log(`📊 Hash-based containers detected: ${hashBasedContainers.length}`);
    console.log(`📊 Base name groups with hashes: ${baseNameGroups.size}`);
    
    if (hashBasedContainers.length > 0) {
        console.log('   🔍 Hash-based containers (first 10):');
        hashBasedContainers.slice(0, 10).forEach(container => {
            console.log(`      🔸 "${container.referenceName}" (base:"${container.baseName}", hash:${container.hash})`);
        });
    }

    // ANALYSIS 4: Content Items and Container Resolution
    console.log('\n🔍 ANALYSIS 4: CONTENT CONTAINER RESOLUTION');
    console.log('===========================================');
    
    const changelogContent = [];
    const contentContainerMappings = new Map();
    
    if (sourceEntities.content) {
        // Focus on ChangeLog content that's been problematic
        for (const contentItem of sourceEntities.content) {
            const contentRef = contentItem.properties?.referenceName;
            const definitionName = contentItem.properties?.definitionName;
            
            if (contentRef && (contentRef.includes('changelog') || definitionName === 'ChangeLog' || definitionName === 'Release')) {
                changelogContent.push({
                    contentID: contentItem.contentID,
                    contentRef,
                    definitionName,
                    state: contentItem.properties?.state
                });
                
                // Track which containers these content items should map to
                if (!contentContainerMappings.has(contentRef)) {
                    contentContainerMappings.set(contentRef, []);
                }
                
                // Find potential matching containers
                const potentialContainers = sourceEntities.containers?.filter(container => {
                    const containerRef = container.referenceName;
                    
                    // Direct match
                    if (containerRef.toLowerCase() === contentRef.toLowerCase()) return true;
                    
                    // Hash-based match
                    if (containerRef.toLowerCase().includes(contentRef.toLowerCase())) return true;
                    
                    // Model-based match
                    const correspondingModel = sourceEntities.models?.find(m => m.definitionID === container.modelDefinitionID);
                    if (correspondingModel?.definitionName === definitionName) return true;
                    
                    return false;
                });
                
                if (potentialContainers) {
                    contentContainerMappings.get(contentRef).push(...potentialContainers.map(c => c.referenceName));
                }
            }
        }
    }
    
    console.log(`📊 ChangeLog-related content items: ${changelogContent.length}`);
    console.log(`📊 Content → Container mappings identified: ${contentContainerMappings.size}`);
    
    if (changelogContent.length > 0) {
        console.log('\n   🔍 Sample ChangeLog content items:');
        changelogContent.slice(0, 10).forEach(content => {
            const containers = contentContainerMappings.get(content.contentRef) || [];
            console.log(`      📄 ID:${content.contentID} "${content.contentRef}" (${content.definitionName}) → ${containers.length} containers`);
            if (containers.length > 0) {
                console.log(`         🎯 Containers: ${containers.slice(0, 3).join(', ')}${containers.length > 3 ? '...' : ''}`);
            }
        });
    }

    // ANALYSIS 5: Model Change Detection Patterns
    console.log('\n🔍 ANALYSIS 5: MODEL CHANGE DETECTION ISSUES');
    console.log('============================================');
    
    const modelsLikelyCausingIssues = [];
    
    if (sourceEntities.models) {
        for (const model of sourceEntities.models) {
            let issueCount = 0;
            const issues = [];
            
            // Check for ContentDefinition fields
            const contentFields = model.fields?.filter(f => f.definitionTypeName === 'ContentDefinition') || [];
            if (contentFields.length > 0) {
                issueCount++;
                issues.push(`${contentFields.length} ContentDefinition fields`);
            }
            
            // Check for helper fields that might cause comparison issues
            const helperFields = model.fields?.filter(f => 
                f.name.includes('_TextField') || 
                f.name.includes('_ValueField')
            ) || [];
            if (helperFields.length > 0) {
                issueCount++;
                issues.push(`${helperFields.length} helper fields`);
            }
            
            // Check for complex field types
            const complexFields = model.fields?.filter(f => 
                f.definitionTypeName === 'ContentDefinition' ||
                f.definitionTypeName === 'MediaGallery' ||
                f.definitionTypeName === 'AttachmentList'
            ) || [];
            if (complexFields.length > 2) {
                issueCount++;
                issues.push(`${complexFields.length} complex fields`);
            }
            
            if (issueCount > 0) {
                modelsLikelyCausingIssues.push({
                    displayName: model.displayName,
                    definitionName: model.definitionName,
                    issueCount,
                    issues
                });
            }
        }
    }
    
    console.log(`📊 Models likely causing change detection issues: ${modelsLikelyCausingIssues.length}`);
    if (modelsLikelyCausingIssues.length > 0) {
        console.log('   🔍 Problematic models (first 10):');
        modelsLikelyCausingIssues.slice(0, 10).forEach(model => {
            console.log(`      ⚠️ "${model.displayName}" (${model.issueCount} issues): ${model.issues.join(', ')}`);
        });
    }

    // FINAL SUMMARY AND RECOMMENDATIONS
    console.log('\n🎯 COMPREHENSIVE MAPPING ANALYSIS SUMMARY');
    console.log('==========================================');
    console.log(`📊 Total Models: ${sourceEntities.models?.length || 0}`);
    console.log(`📊 Total Containers: ${sourceEntities.containers?.length || 0}`);
    console.log(`📊 Total Content: ${sourceEntities.content?.length || 0}`);
    console.log(`📊 ChangeLog Content: ${changelogContent.length}`);
    console.log(`📊 Hash-based Containers: ${hashBasedContainers.length}`);
    console.log(`📊 Models with Content Fields: ${modelsWithContentFields.length}`);
    console.log(`📊 Models Likely Causing Issues: ${modelsLikelyCausingIssues.length}`);
    
    console.log('\n🚨 PRIORITY ISSUES TO FIX:');
    if (hashBasedContainers.length > 10) {
        console.log(`   🔴 HIGH: ${hashBasedContainers.length} hash-based containers causing infinite loops`);
    }
    if (modelsWithContentFields.length > 5) {
        console.log(`   🔴 HIGH: ${modelsWithContentFields.length} models with ContentDefinition fields causing continuous updates`);
    }
    if (contentContainerMappings.size > 0) {
        const unmappedContent = Array.from(contentContainerMappings.entries()).filter(([_, containers]) => containers.length === 0);
        if (unmappedContent.length > 0) {
            console.log(`   🔴 HIGH: ${unmappedContent.length} content items cannot find containers`);
        }
    }
    
    console.log('\n💡 RECOMMENDED FIX ORDER:');
    console.log('   1. Fix hash-based container mapping (case-insensitive lookup)');
    console.log('   2. Fix model comparison to handle ContentDefinition fields properly');
    console.log('   3. Implement proper content-to-container resolution strategy');
    console.log('   4. Add comprehensive change detection for incremental sync');
    
    console.log('\n✅ ANALYSIS COMPLETE - Use findings above for systematic fixes');
}

// Run the analysis
comprehensiveMappingAnalysis().catch(console.error); 