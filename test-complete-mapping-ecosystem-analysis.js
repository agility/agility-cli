const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { ReferenceMapper } = require('./dist/lib/mapper');
const fs = require('fs');
const path = require('path');

async function completeMappingEcosystemAnalysis() {
    console.log('🔍 COMPLETE MAPPING ECOSYSTEM ANALYSIS');
    console.log('=====================================');
    console.log('🎯 OBJECTIVE: Understand ALL mapping failures systemically, not symptomatically\n');

    // Load source data
    const sourceGuid = '67bc73e6-u';
    const targetGuid = '90c39c80-u';
    const locale = 'en-us';
    
    console.log('📥 Loading source data...');
    const loader = new ChainDataLoader({
        sourceGuid,
        locale,
        isPreview: true,
        rootPath: process.cwd()
    });
    const sourceEntities = await loader.loadSourceEntities();
    
    console.log(`✅ Loaded source entities:`);
    console.log(`   📋 Models: ${sourceEntities.models?.length || 0}`);
    console.log(`   📦 Containers: ${sourceEntities.containers?.length || 0}`);
    console.log(`   📄 Content: ${sourceEntities.content?.length || 0}\n`);

    // ECOSYSTEM ANALYSIS 1: Model-Container Relationship Matrix
    console.log('🔍 ECOSYSTEM ANALYSIS 1: MODEL-CONTAINER RELATIONSHIP MATRIX');
    console.log('=============================================================');
    
    const modelContainerMatrix = new Map();
    const orphanedContainers = [];
    const modelUsageStats = new Map();
    
    if (sourceEntities.models && sourceEntities.containers) {
        // Build model index
        const modelIndex = new Map();
        sourceEntities.models.forEach(model => {
            modelIndex.set(model.definitionID, model);
            modelUsageStats.set(model.definitionName, {
                model: model,
                containers: [],
                content: [],
                containerTypes: { base: 0, hash: 0 }
            });
        });
        
        // Analyze container-model relationships
        sourceEntities.containers.forEach(container => {
            const modelDefId = container.modelDefinitionID;
            const correspondingModel = modelIndex.get(modelDefId);
            
            if (correspondingModel) {
                const modelName = correspondingModel.definitionName;
                
                if (!modelContainerMatrix.has(modelName)) {
                    modelContainerMatrix.set(modelName, {
                        model: correspondingModel,
                        containers: [],
                        baseContainers: [],
                        hashContainers: [],
                        namingPatterns: new Set()
                    });
                }
                
                const entry = modelContainerMatrix.get(modelName);
                entry.containers.push(container);
                
                // Categorize container types
                const hashMatch = container.referenceName.match(/([A-F0-9]{8})$/i);
                if (hashMatch) {
                    entry.hashContainers.push(container);
                    modelUsageStats.get(modelName).containerTypes.hash++;
                } else {
                    entry.baseContainers.push(container);
                    modelUsageStats.get(modelName).containerTypes.base++;
                }
                
                // Track naming patterns
                const baseName = container.referenceName.replace(/[A-F0-9]{8}$/i, '').replace(/_$/, '');
                entry.namingPatterns.add(baseName);
                
                modelUsageStats.get(modelName).containers.push(container);
            } else {
                orphanedContainers.push({
                    container: container,
                    missingModelId: modelDefId
                });
            }
        });
        
        console.log('📊 Model-Container Matrix:');
        for (const [modelName, data] of modelContainerMatrix.entries()) {
            console.log(`\n📋 Model: ${modelName}`);
            console.log(`   📦 Total Containers: ${data.containers.length}`);
            console.log(`   🏠 Base Containers: ${data.baseContainers.length}`);
            console.log(`   🔸 Hash Containers: ${data.hashContainers.length}`);
            console.log(`   🏷️ Naming Patterns: ${data.namingPatterns.size}`);
            
            if (data.hashContainers.length > 0) {
                console.log(`   🎯 Hash Ratio: ${(data.hashContainers.length / data.containers.length * 100).toFixed(1)}%`);
            }
            
            // Identify potential issues
            if (data.namingPatterns.size > 3) {
                console.log(`   ⚠️ Complex naming: ${data.namingPatterns.size} different patterns`);
            }
            if (data.hashContainers.length > 10) {
                console.log(`   ⚠️ Hash explosion: ${data.hashContainers.length} hash variants`);
            }
        }
        
        if (orphanedContainers.length > 0) {
            console.log(`\n❌ CRITICAL: ${orphanedContainers.length} orphaned containers (no model match)`);
            orphanedContainers.slice(0, 5).forEach(orphan => {
                console.log(`   🚫 ${orphan.container.referenceName} → Missing Model ID: ${orphan.missingModelId}`);
            });
        }
    }

    // ECOSYSTEM ANALYSIS 2: Content-Model-Container Mapping Flow
    console.log('\n\n🔍 ECOSYSTEM ANALYSIS 2: CONTENT-MODEL-CONTAINER MAPPING FLOW');
    console.log('=============================================================');
    
    const contentMappingMatrix = new Map();
    const mappingFailures = [];
    
    if (sourceEntities.content) {
        sourceEntities.content.forEach(contentItem => {
            const contentRef = contentItem.properties?.referenceName;
            const definitionName = contentItem.properties?.definitionName;
            
            if (!contentRef || !definitionName) {
                mappingFailures.push({
                    type: 'missing_properties',
                    contentID: contentItem.contentID,
                    contentRef,
                    definitionName
                });
                return;
            }
            
            // Initialize content mapping entry
            if (!contentMappingMatrix.has(definitionName)) {
                contentMappingMatrix.set(definitionName, {
                    contentItems: [],
                    availableContainers: [],
                    mappingSuccess: { exact: 0, case: 0, partial: 0, none: 0 },
                    mappingStrategies: new Set()
                });
            }
            
            const mapping = contentMappingMatrix.get(definitionName);
            mapping.contentItems.push(contentItem);
            
            // Find available containers for this content model
            const modelData = modelContainerMatrix.get(definitionName);
            if (modelData) {
                mapping.availableContainers = modelData.containers;
                
                // Test mapping strategies
                const exactMatch = modelData.containers.find(c => c.referenceName === contentRef);
                const caseMatch = modelData.containers.find(c => 
                    c.referenceName.toLowerCase() === contentRef.toLowerCase()
                );
                const partialMatch = modelData.containers.find(c => 
                    c.referenceName.toLowerCase().includes(contentRef.toLowerCase()) ||
                    contentRef.toLowerCase().includes(c.referenceName.toLowerCase())
                );
                
                if (exactMatch) {
                    mapping.mappingSuccess.exact++;
                    mapping.mappingStrategies.add('exact');
                } else if (caseMatch) {
                    mapping.mappingSuccess.case++;
                    mapping.mappingStrategies.add('case_insensitive');
                } else if (partialMatch) {
                    mapping.mappingSuccess.partial++;
                    mapping.mappingStrategies.add('partial');
                } else {
                    mapping.mappingSuccess.none++;
                    mapping.mappingStrategies.add('failure');
                    mappingFailures.push({
                        type: 'no_container_match',
                        contentID: contentItem.contentID,
                        contentRef,
                        definitionName,
                        availableContainers: modelData.containers.length
                    });
                }
            } else {
                mappingFailures.push({
                    type: 'no_model_containers',
                    contentID: contentItem.contentID,
                    contentRef,
                    definitionName
                });
            }
        });
        
        console.log('📊 Content-Model-Container Mapping Analysis:');
        for (const [modelName, mapping] of contentMappingMatrix.entries()) {
            const total = mapping.contentItems.length;
            const success = mapping.mappingSuccess.exact + mapping.mappingSuccess.case + mapping.mappingSuccess.partial;
            const successRate = ((success / total) * 100).toFixed(1);
            
            console.log(`\n📋 Model: ${modelName}`);
            console.log(`   📄 Content Items: ${total}`);
            console.log(`   📦 Available Containers: ${mapping.availableContainers.length}`);
            console.log(`   ✅ Mapping Success Rate: ${successRate}%`);
            console.log(`   🎯 Strategies: ${Array.from(mapping.mappingStrategies).join(', ')}`);
            
            if (mapping.mappingSuccess.none > 0) {
                console.log(`   ❌ Failed Mappings: ${mapping.mappingSuccess.none}/${total} (${((mapping.mappingSuccess.none/total)*100).toFixed(1)}%)`);
            }
            
            // Identify specific problems
            const containerToContentRatio = mapping.availableContainers.length / total;
            if (containerToContentRatio > 2) {
                console.log(`   ⚠️ Container explosion: ${containerToContentRatio.toFixed(1)}x containers vs content`);
            }
            if (containerToContentRatio < 0.5 && total > 5) {
                console.log(`   ⚠️ Container shortage: Only ${mapping.availableContainers.length} containers for ${total} content items`);
            }
        }
    }

    // ECOSYSTEM ANALYSIS 3: Reference Mapper Simulation and State Analysis
    console.log('\n\n🔍 ECOSYSTEM ANALYSIS 3: REFERENCE MAPPER ECOSYSTEM STATE');
    console.log('========================================================');
    
    const referenceMapper = new ReferenceMapper(sourceGuid, targetGuid);
    const mappingSimulation = {
        models: { total: 0, successful: 0, withContainers: 0 },
        containers: { total: 0, successful: 0, withContent: 0, orphaned: 0 },
        content: { total: 0, mappable: 0, unmappable: 0 },
        crossReferences: { valid: 0, broken: 0 }
    };
    
    // Simulate mapping process
    if (sourceEntities.models) {
        mappingSimulation.models.total = sourceEntities.models.length;
        sourceEntities.models.forEach(model => {
            if (model.definitionName && model.fields) {
                mappingSimulation.models.successful++;
                if (modelUsageStats.get(model.definitionName)?.containers.length > 0) {
                    mappingSimulation.models.withContainers++;
                }
            }
        });
    }
    
    if (sourceEntities.containers) {
        mappingSimulation.containers.total = sourceEntities.containers.length;
        mappingSimulation.containers.orphaned = orphanedContainers.length;
        mappingSimulation.containers.successful = sourceEntities.containers.length - orphanedContainers.length;
        
        sourceEntities.containers.forEach(container => {
            const hasModel = sourceEntities.models?.find(m => m.definitionID === container.modelDefinitionID);
            if (hasModel) {
                const modelName = hasModel.definitionName;
                const hasContent = contentMappingMatrix.has(modelName) && 
                                 contentMappingMatrix.get(modelName).contentItems.length > 0;
                if (hasContent) {
                    mappingSimulation.containers.withContent++;
                    mappingSimulation.crossReferences.valid++;
                } else {
                    mappingSimulation.crossReferences.broken++;
                }
            }
        });
    }
    
    if (sourceEntities.content) {
        mappingSimulation.content.total = sourceEntities.content.length;
        for (const [modelName, mapping] of contentMappingMatrix.entries()) {
            const mappableCount = mapping.mappingSuccess.exact + mapping.mappingSuccess.case + mapping.mappingSuccess.partial;
            mappingSimulation.content.mappable += mappableCount;
            mappingSimulation.content.unmappable += mapping.mappingSuccess.none;
        }
    }
    
    console.log('📊 Reference Mapper Ecosystem Simulation:');
    console.log(`   📋 Models: ${mappingSimulation.models.successful}/${mappingSimulation.models.total} viable (${((mappingSimulation.models.successful/mappingSimulation.models.total)*100).toFixed(1)}%)`);
    console.log(`   📦 Containers: ${mappingSimulation.containers.successful}/${mappingSimulation.containers.total} linked to models (${((mappingSimulation.containers.successful/mappingSimulation.containers.total)*100).toFixed(1)}%)`);
    console.log(`   📄 Content: ${mappingSimulation.content.mappable}/${mappingSimulation.content.total} mappable to containers (${((mappingSimulation.content.mappable/mappingSimulation.content.total)*100).toFixed(1)}%)`);
    console.log(`   🔗 Valid Cross-references: ${mappingSimulation.crossReferences.valid}`);
    console.log(`   💔 Broken Cross-references: ${mappingSimulation.crossReferences.broken}`);
    
    // Calculate overall ecosystem health
    const overallHealth = (
        (mappingSimulation.models.successful / mappingSimulation.models.total) * 0.3 +
        (mappingSimulation.containers.successful / mappingSimulation.containers.total) * 0.3 +
        (mappingSimulation.content.mappable / mappingSimulation.content.total) * 0.4
    ) * 100;
    
    console.log(`\n🏥 Overall Ecosystem Health: ${overallHealth.toFixed(1)}%`);
    if (overallHealth < 70) {
        console.log('   🚨 CRITICAL: Ecosystem requires major architectural intervention');
    } else if (overallHealth < 85) {
        console.log('   ⚠️ WARNING: Ecosystem has significant issues requiring attention');
    } else {
        console.log('   ✅ HEALTHY: Ecosystem is functioning well with minor issues');
    }

    // ECOSYSTEM ANALYSIS 4: Systemic Problem Identification
    console.log('\n\n🔍 ECOSYSTEM ANALYSIS 4: SYSTEMIC PROBLEM IDENTIFICATION');
    console.log('=======================================================');
    
    const systemicProblems = [];
    
    // Problem 1: Model-Container Orphaning
    if (orphanedContainers.length > 0) {
        systemicProblems.push({
            category: 'Data Integrity',
            severity: 'CRITICAL',
            title: 'Model-Container Orphaning',
            description: `${orphanedContainers.length} containers reference non-existent models`,
            impact: 'Complete breakdown of model-container relationship chain',
            rootCause: 'Model loading failure or data corruption',
            solution: 'Implement model validation and relationship integrity checking'
        });
    }
    
    // Problem 2: Content Mapping Failures
    const totalMappingFailures = mappingSimulation.content.unmappable;
    if (totalMappingFailures > 0) {
        systemicProblems.push({
            category: 'Content Mapping',
            severity: totalMappingFailures > 50 ? 'CRITICAL' : 'HIGH',
            title: 'Content-Container Mapping Failures',
            description: `${totalMappingFailures} content items cannot map to containers`,
            impact: 'Content sync failures, infinite loops, incomplete syncs',
            rootCause: 'Inconsistent naming conventions and missing mapping strategies',
            solution: 'Implement robust multi-strategy content-container mapping system'
        });
    }
    
    // Problem 3: Hash Container Complexity
    const hashHeavyModels = Array.from(modelContainerMatrix.entries()).filter(([_, data]) => 
        data.hashContainers.length > 5
    );
    if (hashHeavyModels.length > 0) {
        systemicProblems.push({
            category: 'Container Architecture',
            severity: 'MEDIUM',
            title: 'Hash Container Architecture Complexity',
            description: `${hashHeavyModels.length} models have complex hash container hierarchies`,
            impact: 'Difficult debugging, performance issues, maintenance overhead',
            rootCause: 'Lack of hash container lifecycle management',
            solution: 'Implement hash container relationship tracking and lifecycle management'
        });
    }
    
    // Problem 4: Cross-Reference Integrity
    const brokenReferenceRatio = mappingSimulation.crossReferences.broken / 
        (mappingSimulation.crossReferences.valid + mappingSimulation.crossReferences.broken);
    if (brokenReferenceRatio > 0.1) {
        systemicProblems.push({
            category: 'Reference Integrity',
            severity: brokenReferenceRatio > 0.3 ? 'CRITICAL' : 'HIGH',
            title: 'Cross-Reference Integrity Failure',
            description: `${(brokenReferenceRatio * 100).toFixed(1)}% of cross-references are broken`,
            impact: 'Cascading failures throughout the sync process',
            rootCause: 'Lack of transactional mapping and state validation',
            solution: 'Implement transactional reference mapping with integrity constraints'
        });
    }
    
    // Problem 5: Ecosystem Health
    if (overallHealth < 80) {
        systemicProblems.push({
            category: 'System Architecture',
            severity: overallHealth < 60 ? 'CRITICAL' : 'HIGH',
            title: 'Overall Ecosystem Health Degradation',
            description: `Ecosystem health at ${overallHealth.toFixed(1)}% indicates systemic issues`,
            impact: 'Unreliable sync operations, frequent failures, maintenance overhead',
            rootCause: 'Accumulation of architectural debt and lack of holistic design',
            solution: 'Comprehensive architectural refactoring with unified mapping framework'
        });
    }
    
    console.log('🚨 IDENTIFIED SYSTEMIC PROBLEMS:');
    systemicProblems.forEach((problem, index) => {
        console.log(`\n${index + 1}. ${problem.title} [${problem.severity}]`);
        console.log(`   📋 Category: ${problem.category}`);
        console.log(`   📄 Description: ${problem.description}`);
        console.log(`   💥 Impact: ${problem.impact}`);
        console.log(`   🔍 Root Cause: ${problem.rootCause}`);
        console.log(`   🔧 Solution: ${problem.solution}`);
    });

    // FINAL ARCHITECTURAL SOLUTION FRAMEWORK
    console.log('\n\n🎯 ARCHITECTURAL SOLUTION FRAMEWORK');
    console.log('===================================');
    
    console.log('📊 ECOSYSTEM SUMMARY:');
    console.log(`   🏥 Health Score: ${overallHealth.toFixed(1)}%`);
    console.log(`   🚨 Critical Issues: ${systemicProblems.filter(p => p.severity === 'CRITICAL').length}`);
    console.log(`   ⚠️ High Priority Issues: ${systemicProblems.filter(p => p.severity === 'HIGH').length}`);
    console.log(`   📄 Total Mapping Failures: ${mappingFailures.length}`);
    console.log(`   💔 Broken Cross-References: ${mappingSimulation.crossReferences.broken}`);
    
    console.log('\n🏗️ REQUIRED ARCHITECTURAL COMPONENTS:');
    console.log('   1. 📋 Model-Container-Content Relationship Manager');
    console.log('   2. 🎯 Multi-Strategy Container Mapping Engine');
    console.log('   3. 🔸 Hash Container Lifecycle Management System');
    console.log('   4. 🔗 Transactional Reference Mapper with Integrity Validation');
    console.log('   5. 🏥 Ecosystem Health Monitoring and Auto-Recovery');
    console.log('   6. 📊 Unified Mapping Strategy Selection Framework');
    
    console.log('\n💡 IMPLEMENTATION PRIORITY:');
    const criticalIssues = systemicProblems.filter(p => p.severity === 'CRITICAL');
    const highIssues = systemicProblems.filter(p => p.severity === 'HIGH');
    
    if (criticalIssues.length > 0) {
        console.log('   🔴 IMMEDIATE: Fix critical data integrity issues');
        criticalIssues.forEach(issue => console.log(`      - ${issue.title}`));
    }
    if (highIssues.length > 0) {
        console.log('   🟠 HIGH: Address high-impact mapping failures');
        highIssues.forEach(issue => console.log(`      - ${issue.title}`));
    }
    console.log('   🟡 MEDIUM: Implement comprehensive architectural framework');
    
    console.log('\n✅ COMPLETE MAPPING ECOSYSTEM ANALYSIS FINISHED');
    console.log('🚀 Ready for systematic architectural solution implementation');
}

// Run the complete ecosystem analysis
completeMappingEcosystemAnalysis().catch(console.error); 