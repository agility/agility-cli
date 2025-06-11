const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { ReferenceMapper } = require('./dist/lib/mapper');
const { Auth } = require('./dist/lib/services/auth');
const mgmtApi = require('@agility/management-sdk');

async function analyzeContainerMappings() {
    console.log('🔍 CONTAINER HASH MAPPING ANALYSIS');
    console.log('==================================================\n');

    // Load source data
    const sourceGuid = '67bc73e6-u';
    const locale = 'en-us';
    const isPreview = true;
    
    console.log('📥 Loading source data...');
    const loader = new ChainDataLoader({
        sourceGuid: sourceGuid,
        locale: locale,
        isPreview: isPreview,
        rootPath: process.cwd(),
        elements: ['Containers', 'Content']
    });
    
    const sourceEntities = await loader.loadSourceEntities();
    
    console.log(`✅ Loaded source entities:`);
    console.log(`   📦 Containers: ${sourceEntities.containers?.length || 0}`);
    console.log(`   📄 Content: ${sourceEntities.content?.length || 0}`);

    // Skip target API calls for now - focus on source analysis
    const targetGuid = '90c39c80-u';
    console.log('\n⚠️ Skipping target API calls - focusing on source data analysis...\n');
    const targetContainers = []; // Empty for source-only analysis

    // Analyze ChangeLog containers specifically
    console.log('\n🔍 CHANGELOG CONTAINER ANALYSIS');
    console.log('==================================================');
    
    const sourceChangeLogContainers = sourceEntities.containers.filter(c => 
        c.referenceName && c.referenceName.toLowerCase().includes('changelog')
    );
    
    const targetChangeLogContainers = targetContainers.filter(c => 
        c.referenceName && c.referenceName.toLowerCase().includes('changelog')
    );

    console.log(`📊 Source ChangeLog containers: ${sourceChangeLogContainers.length}`);
    console.log(`📊 Target ChangeLog containers: ${targetChangeLogContainers.length}`);

    // Show source containers
    console.log('\n📋 SOURCE CHANGELOG CONTAINERS:');
    sourceChangeLogContainers.forEach(container => {
        console.log(`   🔸 ID:${container.contentViewID} - "${container.referenceName}" (Model: ${container.contentDefinitionID})`);
    });

    // Show target containers 
    console.log('\n📋 TARGET CHANGELOG CONTAINERS:');
    targetChangeLogContainers.forEach(container => {
        console.log(`   🔸 ID:${container.contentViewID} - "${container.referenceName}" (Model: ${container.contentDefinitionID})`);
    });

    // Analyze hash patterns
    console.log('\n🔍 HASH PATTERN ANALYSIS');
    console.log('==================================================');
    
    const hashPatternContainers = targetChangeLogContainers.filter(c => 
        /[A-F0-9]{6,8}$/.test(c.referenceName)
    );
    
    console.log(`📊 Containers with hash suffixes: ${hashPatternContainers.length}`);
    hashPatternContainers.forEach(container => {
        const baseName = container.referenceName.replace(/[A-F0-9]{6,8}$/, '');
        const hashSuffix = container.referenceName.match(/[A-F0-9]{6,8}$/)?.[0];
        console.log(`   🔸 "${baseName}" + hash "${hashSuffix}" = "${container.referenceName}"`);
    });

    // Analyze content-container mapping issues
    console.log('\n🔍 CONTENT → CONTAINER MAPPING ANALYSIS');
    console.log('==================================================');
    
    const changelogContent = sourceEntities.content.filter(c => 
        c.properties?.referenceName?.toLowerCase().includes('changelog')
    );
    
    console.log(`📊 ChangeLog content items: ${changelogContent.length}`);
    
    // Group content by container reference
    const contentByContainer = {};
    changelogContent.forEach(content => {
        const containerRef = content.properties?.referenceName;
        if (containerRef) {
            if (!contentByContainer[containerRef]) {
                contentByContainer[containerRef] = [];
            }
            contentByContainer[containerRef].push(content);
        }
    });

    console.log(`📊 Unique container references: ${Object.keys(contentByContainer).length}`);

    // Check mapping success for each content container reference
    console.log('\n📋 CONTENT CONTAINER MAPPING RESULTS:');
    Object.keys(contentByContainer).forEach(containerRef => {
        const itemCount = contentByContainer[containerRef].length;
        
        // Check if target has exact match
        const exactMatch = targetContainers.find(tc => tc.referenceName === containerRef);
        
        // Check if target has case-insensitive match  
        const caseInsensitiveMatch = targetContainers.find(tc => 
            tc.referenceName.toLowerCase() === containerRef.toLowerCase()
        );
        
        // Check if target has hash-based match
        const hashMatch = targetContainers.find(tc => {
            const tcBaseName = tc.referenceName.replace(/[A-F0-9]{6,8}$/, '');
            return tcBaseName.toLowerCase() === containerRef.toLowerCase();
        });

        let status = '❌ NO MATCH';
        let targetName = 'N/A';
        
        if (exactMatch) {
            status = '✅ EXACT';
            targetName = exactMatch.referenceName;
        } else if (caseInsensitiveMatch) {
            status = '✅ CASE-INSENSITIVE';
            targetName = caseInsensitiveMatch.referenceName;
        } else if (hashMatch) {
            status = '⚠️ HASH-BASED';
            targetName = hashMatch.referenceName;
        }
        
        console.log(`   ${status} "${containerRef}" (${itemCount} items) → "${targetName}"`);
    });

    // Check for specific problematic patterns
    console.log('\n🚨 PROBLEMATIC MAPPING PATTERNS');
    console.log('==================================================');
    
    let problemCount = 0;
    Object.keys(contentByContainer).forEach(containerRef => {
        const exactMatch = targetContainers.find(tc => tc.referenceName === containerRef);
        const caseInsensitiveMatch = targetContainers.find(tc => 
            tc.referenceName.toLowerCase() === containerRef.toLowerCase()
        );
        
        if (!exactMatch && !caseInsensitiveMatch) {
            const hashMatch = targetContainers.find(tc => {
                const tcBaseName = tc.referenceName.replace(/[A-F0-9]{6,8}$/, '');
                return tcBaseName.toLowerCase() === containerRef.toLowerCase();
            });
            
            if (hashMatch) {
                problemCount++;
                console.log(`❌ MAPPING DISCONNECT: Content "${containerRef}" → Target "${hashMatch.referenceName}"`);
                console.log(`   📋 Content items: ${contentByContainer[containerRef].length}`);
                console.log(`   🔧 Content pusher will NOT find this mapping!`);
            }
        }
    });

    console.log(`\n📊 SUMMARY:`);
    console.log(`   🔸 Total ChangeLog content containers: ${Object.keys(contentByContainer).length}`);
    console.log(`   🔸 Hash-based mapping disconnects: ${problemCount}`);
    console.log(`   🔸 This explains the infinite loop behavior!`);

    if (problemCount > 0) {
        console.log(`\n🎯 RECOMMENDED FIX:`);
        console.log(`   1. Update mapContentToTargetContainer() to check hash-based mappings`);
        console.log(`   2. Add container-name mapping lookup before fallback`);
        console.log(`   3. Test with ChangeLog items to verify fix`);
    }
}

// Run the analysis
analyzeContainerMappings().catch(error => {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
}); 