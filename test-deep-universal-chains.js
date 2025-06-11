const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { UniversalChainBuilder } = require('./dist/lib/services/sync-analysis/universal-chain-builder');

async function testDeepUniversalChains() {
    console.log('🚀 Testing Deep Universal Recursive Chain Analysis');
    console.log('=' .repeat(80));
    
    try {
        // Load source data
        const loader = new ChainDataLoader({
            sourceGuid: '67bc73e6-u',
            locale: 'en-us',
            isPreview: true,
            rootPath: process.cwd() + '/agility-files',
            elements: ['Content', 'Containers', 'Models', 'Assets', 'Galleries', 'Templates', 'Pages']
        });
        
        console.log('📊 Loading source entities...');
        const sourceEntities = await loader.loadSourceEntities();
        
        console.log(`✅ Loaded entities:`);
        console.log(`   📄 Content: ${sourceEntities.content?.length || 0}`);
        console.log(`   📦 Containers: ${sourceEntities.containers?.length || 0}`);
        console.log(`   🏗️  Models: ${sourceEntities.models?.length || 0}`);
        console.log(`   🖼️  Assets: ${sourceEntities.assets?.length || 0}`);
        console.log(`   📁 Galleries: ${sourceEntities.galleries?.length || 0}`);
        console.log(`   📋 Templates: ${sourceEntities.templates?.length || 0}`);
        console.log(`   📖 Pages: ${sourceEntities.pages?.length || 0}`);
        
        // Build deep universal chains
        const chainBuilder = new UniversalChainBuilder();
        
        console.log('\n🔗 Building Deep Universal Chains...');
        const deepAnalysis = chainBuilder.buildDeepUniversalChains(sourceEntities);
        
        console.log('\n📊 DEEP UNIVERSAL CHAIN ANALYSIS RESULTS');
        console.log('=' .repeat(80));
        
        // Overall metrics
        console.log(`🎯 Total References: ${deepAnalysis.totalReferences}`);
        console.log(`🌳 Deep Chains: ${deepAnalysis.deepChains.length}`);
        console.log(`🔄 Circular Dependencies: ${deepAnalysis.circularDependencies.length}`);
        console.log(`🌐 Root Entities: ${deepAnalysis.rootEntities.length}`);
        console.log(`📏 Max Chain Depth: ${deepAnalysis.metrics.maxDepth}`);
        console.log(`🔗 Cross-Entity Relationships: ${deepAnalysis.crossEntityRelationships.totalCrossEntityRelationships}`);
        
        // Show root entities
        console.log('\n🌱 ROOT ENTITIES (not referenced by others):');
        deepAnalysis.rootEntities.slice(0, 10).forEach(root => {
            console.log(`   ${root.entityType}:${root.entityId} → ${root.entityName}`);
        });
        
        // Show deepest chains
        console.log('\n🏔️  DEEPEST DEPENDENCY CHAINS:');
        const sortedChains = deepAnalysis.deepChains
            .sort((a, b) => getMaxDepth(b) - getMaxDepth(a))
            .slice(0, 5);
            
        sortedChains.forEach((chain, index) => {
            const maxDepth = getMaxDepth(chain);
            console.log(`\n   ${index + 1}. ${chain.entity.entityType}:${chain.entity.entityId} → ${chain.entity.entityName}`);
            console.log(`      📏 Max Depth: ${maxDepth}`);
            console.log(`      🔗 Direct Dependencies: ${chain.totalDependencies}`);
            console.log(`      🏷️  Relationship Types: ${chain.relationshipTypes.join(', ')}`);
            
            // Show first few levels of the chain
            showChainHierarchy(chain, '      ', 0, 3);
        });
        
        // Show circular dependencies
        if (deepAnalysis.circularDependencies.length > 0) {
            console.log('\n🔄 CIRCULAR DEPENDENCIES:');
            deepAnalysis.circularDependencies.slice(0, 5).forEach((circular, index) => {
                console.log(`\n   ${index + 1}. Cycle Length: ${circular.cycleLength}`);
                console.log(`      Entity Types: ${circular.entityTypes.join(' → ')}`);
                console.log(`      Cycle: ${circular.cycle.join(' → ')}`);
            });
        }
        
        // Cross-entity relationship matrix
        console.log('\n🌐 CROSS-ENTITY RELATIONSHIP MATRIX:');
        const matrix = deepAnalysis.crossEntityRelationships.relationshipMatrix;
        Object.entries(matrix).forEach(([source, targets]) => {
            console.log(`   ${source}:`);
            Object.entries(targets).forEach(([target, count]) => {
                console.log(`      → ${target}: ${count} relationships`);
            });
        });
        
        console.log(`\n🏆 Most Common Cross-Entity Relationship: ${deepAnalysis.crossEntityRelationships.mostCommonCrossEntityRelationship}`);
        
        // Show content→content relationships specifically
        console.log('\n📝 CONTENT→CONTENT RELATIONSHIP ANALYSIS:');
        const contentToContentChains = deepAnalysis.deepChains.filter(chain => 
            chain.entity.entityType === 'content' && 
            chain.dependencies.some(dep => dep.entity.entityType === 'content')
        );
        
        console.log(`   Found ${contentToContentChains.length} content items with content dependencies`);
        
        contentToContentChains.slice(0, 5).forEach((chain, index) => {
            const contentDeps = chain.dependencies.filter(dep => dep.entity.entityType === 'content');
            console.log(`\n   ${index + 1}. Content:${chain.entity.entityId} → ${chain.entity.entityName}`);
            console.log(`      📝 Content Dependencies: ${contentDeps.length}`);
            
            contentDeps.slice(0, 3).forEach(dep => {
                console.log(`         → Content:${dep.entity.entityId} (${dep.entity.entityName})`);
                console.log(`           Relationship Types: ${dep.relationshipTypes.join(', ')}`);
            });
        });
        
        // Show container→container relationships
        console.log('\n📦 CONTAINER→CONTAINER RELATIONSHIP ANALYSIS:');
        const containerToContainerChains = deepAnalysis.deepChains.filter(chain => 
            chain.entity.entityType === 'container' && 
            chain.dependencies.some(dep => dep.entity.entityType === 'container')
        );
        
        console.log(`   Found ${containerToContainerChains.length} containers with container dependencies`);
        
        containerToContainerChains.slice(0, 3).forEach((chain, index) => {
            const containerDeps = chain.dependencies.filter(dep => dep.entity.entityType === 'container');
            console.log(`\n   ${index + 1}. Container:${chain.entity.entityId} → ${chain.entity.entityName}`);
            console.log(`      📦 Container Dependencies: ${containerDeps.length}`);
            
            containerDeps.slice(0, 2).forEach(dep => {
                console.log(`         → Container:${dep.entity.entityId} (${dep.entity.entityName})`);
            });
        });
        
        console.log('\n✅ Deep Universal Chain Analysis Complete!');
        console.log(`🎯 Successfully analyzed ${deepAnalysis.totalReferences} relationships across ${deepAnalysis.metrics.totalNodes} entities`);
        
    } catch (error) {
        console.error('❌ Error during deep universal chain analysis:', error);
        console.error(error.stack);
    }
}

// Helper functions
function getMaxDepth(chain) {
    if (chain.dependencies.length === 0) return chain.depth;
    return Math.max(chain.depth, ...chain.dependencies.map(d => getMaxDepth(d)));
}

function showChainHierarchy(chain, indent, currentDepth, maxDepth) {
    if (currentDepth >= maxDepth) {
        if (chain.dependencies.length > 0) {
            console.log(`${indent}└─ ... (${chain.dependencies.length} more dependencies)`);
        }
        return;
    }
    
    chain.dependencies.slice(0, 3).forEach((dep, index) => {
        const isLast = index === Math.min(2, chain.dependencies.length - 1);
        const prefix = isLast ? '└─' : '├─';
        const nextIndent = indent + (isLast ? '   ' : '│  ');
        
        console.log(`${indent}${prefix} ${dep.entity.entityType}:${dep.entity.entityId} (${dep.entity.entityName})`);
        
        if (dep.dependencies.length > 0) {
            showChainHierarchy(dep, nextIndent, currentDepth + 1, maxDepth);
        }
    });
    
    if (chain.dependencies.length > 3) {
        console.log(`${indent}└─ ... (${chain.dependencies.length - 3} more dependencies)`);
    }
}

// Run the test
testDeepUniversalChains(); 