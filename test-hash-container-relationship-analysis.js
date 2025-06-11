const { ChainDataLoader } = require('./dist/lib/services/chain-data-loader');
const { Auth } = require('./dist/lib/services/auth');
const mgmtApi = require('@agility/management-sdk');

async function analyzeHashContainerRelationships() {
    console.log('🔍 HASH CONTAINER RELATIONSHIP ANALYSIS');
    console.log('========================================\n');

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
    
    console.log(`✅ Loaded source entities: ${sourceEntities.containers?.length || 0} containers, ${sourceEntities.content?.length || 0} content items\n`);

    // ANALYSIS 1: Examine Hash-Based Container Structure
    console.log('🔍 ANALYSIS 1: HASH-BASED CONTAINER STRUCTURE');
    console.log('===============================================');
    
    const hashContainers = [];
    const baseContainers = [];
    const containerFamilies = new Map();
    
    if (sourceEntities.containers) {
        for (const container of sourceEntities.containers) {
            const ref = container.referenceName;
            
            // Check for hash pattern (8 hex characters at the end)
            const hashMatch = ref.match(/^(.+?)([A-F0-9]{8})$/i);
            if (hashMatch) {
                const baseName = hashMatch[1];
                const hash = hashMatch[2];
                
                hashContainers.push({
                    referenceName: ref,
                    baseName,
                    hash,
                    containerID: container.containerID,
                    modelDefinitionID: container.modelDefinitionID,
                    container: container
                });
                
                // Group by base name
                if (!containerFamilies.has(baseName)) {
                    containerFamilies.set(baseName, { base: null, children: [] });
                }
                containerFamilies.get(baseName).children.push({
                    referenceName: ref,
                    hash,
                    containerID: container.containerID,
                    container
                });
            } else {
                baseContainers.push({
                    referenceName: ref,
                    containerID: container.containerID,
                    modelDefinitionID: container.modelDefinitionID,
                    container: container
                });
                
                // Check if this could be a base for hash variants
                const hasHashVariants = sourceEntities.containers.some(c => 
                    c.referenceName.startsWith(ref) && c.referenceName.match(/[A-F0-9]{8}$/i)
                );
                
                if (hasHashVariants && !containerFamilies.has(ref)) {
                    containerFamilies.set(ref, { base: container, children: [] });
                } else if (hasHashVariants) {
                    containerFamilies.get(ref).base = container;
                }
            }
        }
    }
    
    console.log(`📊 Hash-based containers: ${hashContainers.length}`);
    console.log(`📊 Base containers: ${baseContainers.length}`);
    console.log(`📊 Container families: ${containerFamilies.size}`);
    
    // Examine container families in detail
    console.log('\n🔍 Container Family Analysis:');
    for (const [baseName, family] of containerFamilies.entries()) {
        if (family.children.length > 0) {
            console.log(`\n📦 Family: "${baseName}"`);
            console.log(`   🏠 Base Container: ${family.base ? `ID:${family.base.containerID}` : 'MISSING'}`);
            console.log(`   👶 Child Variants: ${family.children.length}`);
            
            if (family.base) {
                console.log(`   📋 Base Model ID: ${family.base.modelDefinitionID}`);
                console.log(`   📝 Base Description: ${family.base.description || 'No description'}`);
            }
            
            // Show first few children
            family.children.slice(0, 3).forEach(child => {
                console.log(`      🔸 ${child.referenceName} (ID:${child.containerID}, Hash:${child.hash})`);
            });
            if (family.children.length > 3) {
                console.log(`      ... and ${family.children.length - 3} more`);
            }
        }
    }

    // ANALYSIS 2: Content Item Distribution Across Container Families
    console.log('\n\n🔍 ANALYSIS 2: CONTENT DISTRIBUTION IN CONTAINER FAMILIES');
    console.log('=======================================================');
    
    const contentByContainerFamily = new Map();
    
    if (sourceEntities.content) {
        // Focus on ChangeLog content since that's where we see the issue
        const changelogContent = sourceEntities.content.filter(c => 
            c.properties?.referenceName?.includes('changelog') ||
            c.properties?.definitionName === 'ChangeLog' ||
            c.properties?.definitionName === 'Release'
        );
        
        console.log(`📊 Analyzing ${changelogContent.length} ChangeLog-related content items...\n`);
        
        for (const contentItem of changelogContent) {
            const contentRef = contentItem.properties?.referenceName;
            
            if (contentRef) {
                // Find which container family this content belongs to
                for (const [baseName, family] of containerFamilies.entries()) {
                    const belongsToFamily = 
                        contentRef.toLowerCase().includes(baseName.toLowerCase()) ||
                        family.children.some(child => 
                            contentRef.toLowerCase().includes(child.hash.toLowerCase())
                        );
                    
                    if (belongsToFamily) {
                        if (!contentByContainerFamily.has(baseName)) {
                            contentByContainerFamily.set(baseName, []);
                        }
                        contentByContainerFamily.get(baseName).push({
                            contentID: contentItem.contentID,
                            contentRef,
                            definitionName: contentItem.properties?.definitionName
                        });
                    }
                }
            }
        }
        
        console.log('📊 Content distribution by container family:');
        for (const [familyName, contentItems] of contentByContainerFamily.entries()) {
            const family = containerFamilies.get(familyName);
            console.log(`\n📦 Family "${familyName}": ${contentItems.length} content items`);
            console.log(`   🏠 Base container: ${family?.base ? 'EXISTS' : 'MISSING'}`);
            console.log(`   👶 Child containers: ${family?.children.length || 0}`);
            
            // Sample content items
            contentItems.slice(0, 3).forEach(item => {
                console.log(`      📄 ID:${item.contentID} "${item.contentRef}" (${item.definitionName})`);
            });
            if (contentItems.length > 3) {
                console.log(`      ... and ${contentItems.length - 3} more`);
            }
        }
    }

    // ANALYSIS 3: Target Instance Investigation
    console.log('\n\n🔍 ANALYSIS 3: TARGET INSTANCE CONTAINER INVESTIGATION');
    console.log('======================================================');
    
    try {
        // Initialize API client for target instance
        const auth = new Auth();
        const token = await auth.getToken();
        const baseUrl = auth.determineBaseUrl(targetGuid);
        
        const mgmtApiOptions = new mgmtApi.Options();
        mgmtApiOptions.token = token;
        mgmtApiOptions.baseUrl = baseUrl;
        
        const apiClient = new mgmtApi.ApiClient(mgmtApiOptions);
        
        console.log('📥 Loading target instance containers...');
        const targetContainers = await apiClient.containerMethods.getContainerList(targetGuid);
        
        console.log(`✅ Loaded ${targetContainers.length} target containers\n`);
        
        // Check which containers already exist in target
        const targetHashContainers = [];
        const targetBaseContainers = [];
        const targetFamilies = new Map();
        
        for (const container of targetContainers) {
            const ref = container.referenceName;
            const hashMatch = ref.match(/^(.+?)([A-F0-9]{8})$/i);
            
            if (hashMatch) {
                const baseName = hashMatch[1];
                const hash = hashMatch[2];
                
                targetHashContainers.push({
                    referenceName: ref,
                    baseName,
                    hash,
                    containerID: container.containerID
                });
                
                if (!targetFamilies.has(baseName)) {
                    targetFamilies.set(baseName, { base: null, children: [] });
                }
                targetFamilies.get(baseName).children.push({
                    referenceName: ref,
                    hash,
                    containerID: container.containerID
                });
            } else {
                targetBaseContainers.push({
                    referenceName: ref,
                    containerID: container.containerID
                });
            }
        }
        
        console.log(`📊 Target instance hash containers: ${targetHashContainers.length}`);
        console.log(`📊 Target instance base containers: ${targetBaseContainers.length}`);
        console.log(`📊 Target container families: ${targetFamilies.size}`);
        
        // Compare source vs target families
        console.log('\n🔍 Source vs Target Family Comparison:');
        for (const [familyName, sourceFamily] of containerFamilies.entries()) {
            const targetFamily = targetFamilies.get(familyName);
            const sourceChildCount = sourceFamily.children.length;
            const targetChildCount = targetFamily?.children.length || 0;
            
            if (sourceChildCount > 0) {
                console.log(`\n📦 Family "${familyName}"`);
                console.log(`   📥 Source: ${sourceChildCount} children`);
                console.log(`   📤 Target: ${targetChildCount} children`);
                console.log(`   📊 Status: ${targetChildCount === 0 ? '❌ NOT SYNCED' : targetChildCount === sourceChildCount ? '✅ FULLY SYNCED' : '⚠️ PARTIALLY SYNCED'}`);
                
                if (targetChildCount > 0 && targetChildCount < sourceChildCount) {
                    console.log(`   🔍 Missing: ${sourceChildCount - targetChildCount} containers`);
                }
            }
        }

        // ANALYSIS 4: API Container Details Investigation
        console.log('\n\n🔍 ANALYSIS 4: DETAILED CONTAINER STRUCTURE INVESTIGATION');
        console.log('========================================================');
        
        // Get detailed info for a few key containers
        const changelogFamilies = Array.from(containerFamilies.entries()).filter(([name, family]) => 
            name.toLowerCase().includes('changelog') && family.children.length > 0
        );
        
        if (changelogFamilies.length > 0) {
            const [familyName, family] = changelogFamilies[0];
            console.log(`\n🔬 Deep dive into "${familyName}" family:`);
            
            // Examine base container if it exists
            if (family.base) {
                console.log(`\n🏠 BASE CONTAINER: ${family.base.referenceName}`);
                console.log(`   📋 Model ID: ${family.base.modelDefinitionID}`);
                console.log(`   🆔 Container ID: ${family.base.containerID}`);
                console.log(`   📝 Description: ${family.base.description || 'No description'}`);
                console.log(`   🔧 Created: ${family.base.dateCreated}`);
                console.log(`   📊 State: ${family.base.state}`);
            }
            
            // Examine first child container
            if (family.children.length > 0) {
                const firstChild = family.children[0];
                console.log(`\n👶 CHILD CONTAINER: ${firstChild.referenceName}`);
                console.log(`   📋 Model ID: ${firstChild.container.modelDefinitionID}`);
                console.log(`   🆔 Container ID: ${firstChild.container.containerID}`);
                console.log(`   🔗 Hash: ${firstChild.hash}`);
                console.log(`   📝 Description: ${firstChild.container.description || 'No description'}`);
                console.log(`   🔧 Created: ${firstChild.container.dateCreated}`);
                console.log(`   📊 State: ${firstChild.container.state}`);
                
                // Compare base vs child properties
                if (family.base) {
                    console.log(`\n🔍 BASE vs CHILD Comparison:`);
                    console.log(`   📋 Same Model: ${family.base.modelDefinitionID === firstChild.container.modelDefinitionID ? '✅' : '❌'}`);
                    console.log(`   📊 Same State: ${family.base.state === firstChild.container.state ? '✅' : '❌'}`);
                    console.log(`   📝 Description Pattern: ${firstChild.container.description?.includes(family.base.description || '') ? '✅' : '❌'}`);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Failed to load target instance data:', error.message);
        console.log('⚠️ Continuing with source-only analysis...\n');
    }

    // FINAL ANALYSIS SUMMARY
    console.log('\n\n🎯 HASH CONTAINER RELATIONSHIP ANALYSIS SUMMARY');
    console.log('===============================================');
    
    console.log(`📊 DISCOVERED PATTERNS:`);
    console.log(`   🔸 ${hashContainers.length} hash-based containers found`);
    console.log(`   🔸 ${containerFamilies.size} container families identified`);
    console.log(`   🔸 Largest family has ${Math.max(...Array.from(containerFamilies.values()).map(f => f.children.length))} children`);
    
    console.log(`\n💡 KEY INSIGHTS:`);
    console.log(`   1. Hash containers appear to be CHILD INSTANCES of base containers`);
    console.log(`   2. Multiple content items are mapped to the same container family`);
    console.log(`   3. Each hash likely represents a SPECIFIC CONTENT INSTANCE within a list`);
    console.log(`   4. Base containers may be LIST containers, hash containers are ITEM containers`);
    
    console.log(`\n🚨 CRITICAL IMPLICATIONS:`);
    console.log(`   ❌ Current sync trying to create content in WRONG container type`);
    console.log(`   ❌ Hash containers may be AUTO-GENERATED, not manually created`);
    console.log(`   ❌ Content items need to map to CORRECT container in family hierarchy`);
    console.log(`   ❌ We may need to CREATE hash containers on-demand during content sync`);
    
    console.log(`\n🔧 NEXT INVESTIGATION STEPS:`);
    console.log(`   1. Determine if hash containers are auto-created by Agility CMS`);
    console.log(`   2. Understand the parent-child container relationship in target instance`);
    console.log(`   3. Test creating content in base vs hash containers`);
    console.log(`   4. Examine content list vs item container behavior`);
    
    console.log('\n✅ HASH RELATIONSHIP ANALYSIS COMPLETE');
}

// Run the analysis
analyzeHashContainerRelationships().catch(console.error); 