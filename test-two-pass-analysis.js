/**
 * Test script for Two-Pass Analysis Service
 * 
 * Sub-task 21.9.3.1: Analyze current 2-pass model implementation
 * 
 * Tests the analysis of the current 2-pass model pattern and validates
 * the design for universal 2-pass implementation across all entity types.
 */

const { TwoPassAnalysisService } = require('./dist/lib/services/two-pass-analysis');

async function testTwoPassAnalysis() {
    console.log('🧪 Testing Two-Pass Analysis Service\n');
    
    const analysisService = new TwoPassAnalysisService();

    try {
        // Test 1: Generate comprehensive analysis report
        console.log('Step 1: Generating comprehensive two-pass analysis report...');
        analysisService.generateAnalysisReport();
        
        // Test 2: Validate the 2-pass design
        console.log('\n📋 Step 2: Validating 2-pass pattern design...');
        const validation = analysisService.validateTwoPassDesign();
        
        if (validation.isValid) {
            console.log('✅ 2-pass pattern design is valid - no circular dependencies or missing patterns');
        } else {
            console.log('❌ 2-pass pattern design has issues:');
            validation.issues.forEach(issue => {
                console.log(`   - ${issue}`);
            });
        }
        
        // Test 3: Examine specific patterns
        console.log('\n📋 Step 3: Examining specific 2-pass patterns...');
        
        const modelPattern = analysisService.analyzeCurrentModelPattern();
        console.log(`\n🔍 Model Pattern (Current Implementation):`);
        console.log(`   Dependencies: ${modelPattern.dependencies.join(', ') || 'None (foundational)'}`);
        console.log(`   Circular Handling: ${modelPattern.circularHandling}`);
        console.log(`   Stub Fields: ${modelPattern.payloadPreparation.stubFields.join(', ')}`);
        
        const contentPattern = analysisService.designContentPattern();
        console.log(`\n🔍 Content Pattern (Most Complex):`);
        console.log(`   Dependencies: ${contentPattern.dependencies.join(', ')}`);
        console.log(`   Circular Handling: ${contentPattern.circularHandling}`);
        console.log(`   Stub Fields: ${contentPattern.payloadPreparation.stubFields.join(', ')}`);
        
        // Test 4: Processing order validation
        console.log('\n📋 Step 4: Validating processing order...');
        const order = analysisService.generateProcessingOrder();
        
        console.log(`\n🔄 Pass 1 Order (Foundation Building):`);
        order.pass1Order.forEach((entity, index) => {
            const pattern = analysisService.getAllTwoPassPatterns().find(p => p.entityType === entity);
            console.log(`   ${index + 1}. ${entity} - ${pattern ? pattern.pass1Description : 'Unknown'}`);
        });
        
        console.log(`\n🔄 Pass 2 Order (Reference Population):`);
        order.pass2Order.forEach((entity, index) => {
            const pattern = analysisService.getAllTwoPassPatterns().find(p => p.entityType === entity);
            console.log(`   ${index + 1}. ${entity} - ${pattern ? pattern.pass2Description : 'Unknown'}`);
        });
        
        // Test 5: Key insights summary
        console.log('\n📋 Step 5: Key insights from model implementation...');
        const insights = analysisService.getModelImplementationInsights();
        insights.forEach((insight, index) => {
            console.log(`   ${index + 1}. ${insight.replace(/🔑 \*\*/g, '').replace(/\*\*/g, '')}`);
        });
        
        // Test 6: Circular dependency patterns
        console.log('\n📋 Step 6: Entities with circular dependency handling...');
        const allPatterns = analysisService.getAllTwoPassPatterns();
        const circularPatterns = allPatterns.filter(p => p.circularHandling);
        
        if (circularPatterns.length > 0) {
            console.log('   Entities that can have circular dependencies:');
            circularPatterns.forEach(pattern => {
                console.log(`   - ${pattern.entityType}: ${pattern.pass1Description}`);
            });
        } else {
            console.log('   No circular dependency patterns found.');
        }
        
        // Summary
        console.log('\n🎉 ANALYSIS SUMMARY');
        console.log('=====================================');
        console.log(`✅ Total entity types analyzed: ${allPatterns.length}`);
        console.log(`✅ Entities with circular handling: ${circularPatterns.length}`);
        console.log(`✅ Pass 1 processing steps: ${order.pass1Order.length}`);
        console.log(`✅ Pass 2 processing steps: ${order.pass2Order.length}`);
        console.log(`✅ Design validation: ${validation.isValid ? 'PASSED' : 'FAILED'}`);
        
        if (validation.isValid) {
            console.log('✅ Ready to proceed with Sub-task 21.9.3.2: Design 2-pass pattern for Containers');
        } else {
            console.log('⚠️  Fix design issues before proceeding');
        }
        
        return {
            patterns: allPatterns,
            validation,
            order,
            insights
        };
        
    } catch (error) {
        console.error('❌ Analysis failed:', error.message);
        throw error;
    }
}

// Run the test
testTwoPassAnalysis()
    .then((results) => {
        console.log('\n✅ Two-pass analysis completed successfully!');
        console.log(`📊 Generated ${results.patterns.length} entity patterns with ${results.insights.length} implementation insights`);
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Analysis suite failed:', error);
        process.exit(1);
    }); 