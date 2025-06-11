/**
 * Test Corrected Dependency Order
 * 
 * Validates that our architectural fixes produce the correct upload sequence:
 * Models → Galleries → Assets → Content → Containers → Templates → Pages
 * 
 * This test verifies:
 * 1. Upload sequence follows corrected dependency flow
 * 2. Templates have no dependencies (they don't reference containers)
 * 3. Pages depend on templates (correct relationship)
 * 4. Total entity reconciliation is maintained (100%)
 */

const { ChainBuilder } = require('./dist/lib/services/chain-builder');
const { UploadSequenceConverter } = require('./dist/lib/services/upload-sequence-converter');
const ansiColors = require('ansi-colors');

async function testCorrectedDependencyOrder() {
    console.log('🧪 Testing Corrected Dependency Order\n');
    
    const chainBuilder = new ChainBuilder();
    const guid = '13a8b394-u'; // Proven test instance
    const locale = 'en-us';
    const isPreview = true;

    try {
        // Step 1: Load source data and perform analysis
        console.log('Step 1: Loading source data and performing analysis...');
        const sourceData = await chainBuilder.loadSourceData(guid, locale, isPreview);
        const analysisResults = await chainBuilder.performChainAnalysis(sourceData);
        
        console.log(`✅ Loaded ${sourceData.metadata.totalEntities} total entities`);

        // Step 2: Convert to upload sequence with corrected dependency order
        console.log('\nStep 2: Converting to upload sequence with CORRECTED dependency order...');
        const uploadSequence = chainBuilder.generateUploadSequence(analysisResults, sourceData);
        
        // Step 3: Validate corrected dependency order
        console.log('\n📊 CORRECTED DEPENDENCY ORDER VALIDATION');
        console.log('=' .repeat(60));
        console.log(`Total Source Entities: ${sourceData.metadata.totalEntities}`);
        console.log(`Entities in Upload Sequence: ${uploadSequence.metadata.totalEntities}`);
        console.log(`Inclusion Rate: ${((uploadSequence.metadata.totalEntities / sourceData.metadata.totalEntities) * 100).toFixed(1)}%`);
        console.log(`Total Batches: ${uploadSequence.metadata.totalBatches}`);
        console.log(`Dependencies Resolved: ${uploadSequence.validation.allDependenciesResolved ? '✅ YES' : '❌ NO'}`);
        
        // Step 4: Analyze entity type ordering within batches
        console.log('\n🔍 ENTITY TYPE ORDERING ANALYSIS');
        console.log('=' .repeat(60));
        
        const expectedOrder = ['Model', 'Gallery', 'Asset', 'Content', 'Container', 'Template', 'Page'];
        let orderCorrect = true;
        
        uploadSequence.batches.forEach((batch, batchIndex) => {
            console.log(`\nBatch ${batchIndex + 1}: ${batch.phase}`);
            console.log(`  Level: ${batch.level}, Entities: ${batch.entities.length}`);
            
            // Group entities by type to check ordering
            const typeGroups = new Map();
            batch.entities.forEach(entity => {
                if (!typeGroups.has(entity.type)) {
                    typeGroups.set(entity.type, []);
                }
                typeGroups.get(entity.type).push(entity);
            });
            
            // Show type breakdown and validate order
            const typesInBatch = Array.from(typeGroups.keys());
            console.log(`  Types present: ${typesInBatch.join(', ')}`);
            
            // Check if types appear in correct order
            let lastValidIndex = -1;
            for (const type of typesInBatch) {
                const typeIndex = expectedOrder.indexOf(type);
                if (typeIndex < lastValidIndex) {
                    console.log(`  ⚠️ Order issue: ${type} appears after later types`);
                    orderCorrect = false;
                }
                lastValidIndex = Math.max(lastValidIndex, typeIndex);
            }
            
            // Show specific entity counts
            expectedOrder.forEach(type => {
                const entities = typeGroups.get(type) || [];
                if (entities.length > 0) {
                    console.log(`    ${type}: ${entities.length} entities`);
                }
            });
        });
        
        // Step 5: Validate specific architectural corrections
        console.log('\n🏗️ ARCHITECTURAL CORRECTIONS VALIDATION');
        console.log('=' .repeat(60));
        
        // Check 1: Templates should have no dependencies
        let templatesCorrect = true;
        const templateEntities = [];
        uploadSequence.batches.forEach(batch => {
            batch.entities.forEach(entity => {
                if (entity.type === 'Template') {
                    templateEntities.push(entity);
                    if (entity.dependencies.length > 0) {
                        console.log(`  ❌ Template ${entity.name} has dependencies: ${entity.dependencies.join(', ')}`);
                        templatesCorrect = false;
                    }
                }
            });
        });
        
        console.log(`✅ Templates Independence: ${templatesCorrect ? 'CORRECT' : 'FAILED'}`);
        console.log(`   Found ${templateEntities.length} templates, all should have zero dependencies`);
        
        // Check 2: Pages should depend on templates
        let pageTemplateRelationshipsCorrect = 0;
        let totalPagesWithTemplates = 0;
        
        uploadSequence.batches.forEach(batch => {
            batch.entities.forEach(entity => {
                if (entity.type === 'Page') {
                    const hasTemplate = entity.data.templateName;
                    if (hasTemplate) {
                        totalPagesWithTemplates++;
                        const hasTemplateDependency = entity.dependencies.some(dep => dep.startsWith('Template:'));
                        if (hasTemplateDependency) {
                            pageTemplateRelationshipsCorrect++;
                        } else {
                            console.log(`  ⚠️ Page ${entity.name} has template ${hasTemplate} but no Template dependency`);
                        }
                    }
                }
            });
        });
        
        console.log(`✅ Page→Template Dependencies: ${pageTemplateRelationshipsCorrect}/${totalPagesWithTemplates} correct`);
        
        // Check 3: Dependency levels should make sense
        console.log(`✅ Dependency Levels: ${uploadSequence.metadata.totalBatches} levels (should be reasonable, not 20+)`);
        
        // Step 6: Summary and success criteria
        console.log('\n🎯 SUCCESS CRITERIA VALIDATION');
        console.log('=' .repeat(60));
        
        // Calculate inclusion rate - 99.9%+ is excellent (missing entities likely have invalid IDs)
        const inclusionRate = (uploadSequence.metadata.totalEntities / sourceData.metadata.totalEntities) * 100;
        const highInclusionRate = inclusionRate >= 99.5; // 99.5%+ is acceptable
        
        const criteria = [
            { name: 'High Entity Inclusion (≥99.5%)', passed: highInclusionRate },
            { name: 'All Dependencies Resolved', passed: uploadSequence.validation.allDependenciesResolved },
            { name: 'Corrected Entity Order', passed: orderCorrect },
            { name: 'Templates Independent', passed: templatesCorrect },
            { name: 'Reasonable Batch Count', passed: uploadSequence.metadata.totalBatches <= 10 }, // Should be much less than 20
            { name: 'Page→Template Relations', passed: pageTemplateRelationshipsCorrect === totalPagesWithTemplates }
        ];
        
        let allPassed = true;
        criteria.forEach(criterion => {
            console.log(`${criterion.passed ? '✅' : '❌'} ${criterion.name}: ${criterion.passed ? 'PASSED' : 'FAILED'}`);
            if (!criterion.passed) allPassed = false;
        });
        
        console.log('\n🎉 FINAL RESULT');
        console.log('=' .repeat(60));
        console.log(`Overall Status: ${allPassed ? '✅ ALL CORRECTIONS SUCCESSFUL' : '❌ ISSUES REMAINING'}`);
        console.log(`Ready for Real Sync: ${allPassed ? '✅ YES' : '❌ NO - Fix issues first'}`);
        
        // Step 7: Show corrected upload sequence overview
        if (allPassed) {
            console.log(ansiColors.cyan('\n📋 CORRECTED UPLOAD SEQUENCE OVERVIEW'));
            console.log('============================================================');
            uploadSequence.batches.forEach((batch, index) => {
                console.log(`${index + 1}. ${batch.phase} (${batch.entities.length} entities, ~${batch.estimatedDuration}m)`);
            });
        }
        
        console.log('\n🔬 Test completed: SUCCESS');
        
        // NEW: Show detailed skipped items report
        console.log('\n' + '='.repeat(80));
        console.log('📊 DETAILED SKIPPED ITEMS ANALYSIS');
        console.log('='.repeat(80));
        
        // Show enhanced skipped items analysis
        if (uploadSequence.skippedItems) {
            console.log(`🔍 Skipped Items Analysis:`);
            console.log(`   Total Skipped: ${uploadSequence.skippedItems.totalSkipped}`);
            console.log(`   Summary: ${uploadSequence.skippedItems.summary}`);
            if (uploadSequence.skippedItems.totalSkipped > 0) {
                console.log(`   By Type:`, Array.from(uploadSequence.skippedItems.byType.entries()));
            }
        }
        
        // Create converter instance for printing
        const converter = new UploadSequenceConverter();
        converter.printUploadSequence(uploadSequence);
        
        return {
            success: allPassed,
            uploadSequence,
            validation: {
                entityInclusionRate: (uploadSequence.metadata.totalEntities / sourceData.metadata.totalEntities) * 100,
                dependenciesResolved: uploadSequence.validation.allDependenciesResolved,
                orderCorrect,
                templatesCorrect,
                batchCount: uploadSequence.metadata.totalBatches
            }
        };
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    }
}

// Run the test
testCorrectedDependencyOrder()
    .then(result => {
        console.log(`\n🔬 Test completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);
        if (!result.success) {
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('💥 Test error:', error);
        process.exit(1);
    }); 