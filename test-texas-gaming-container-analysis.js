const fs = require('fs');
const path = require('path');

async function analyzeTexasGamingContainers() {
    console.log('🎰 TEXAS GAMING CONTAINER ANALYSIS');
    console.log('=' .repeat(60));
    console.log('Instance: 13a8b394-u (Texas Gaming)');
    console.log('Comparing with documentation site issues...\n');
    
    // Texas Gaming data paths
    const texasGuid = '13a8b394-u';
    const contentDir = path.join(process.cwd(), 'agility-files', texasGuid, 'en-us', 'preview', 'item');
    const listDir = path.join(process.cwd(), 'agility-files', texasGuid, 'en-us', 'preview', 'list');
    const containersDir = path.join(process.cwd(), 'agility-files', texasGuid, 'en-us', 'preview', 'containers');
    const pagesFile = path.join(process.cwd(), 'agility-files', texasGuid, 'en-us', 'preview', 'pages.json');
    
    console.log('📁 Loading Texas Gaming data...');
    
    // Check if data exists
    const hasData = {
        content: fs.existsSync(contentDir),
        list: fs.existsSync(listDir),
        containers: fs.existsSync(containersDir),
        pages: fs.existsSync(pagesFile)
    };
    
    console.log(`   Content items: ${hasData.content ? '✅' : '❌'} ${contentDir}`);
    console.log(`   Content lists: ${hasData.list ? '✅' : '❌'} ${listDir}`);
    console.log(`   Containers: ${hasData.containers ? '✅' : '❌'} ${containersDir}`);
    console.log(`   Pages: ${hasData.pages ? '✅' : '❌'} ${pagesFile}`);
    
    if (!hasData.content && !hasData.list) {
        console.log('\n🚨 NO CONTENT DATA FOUND');
        console.log('   Run: node dist/index.js pull --guid 13a8b394-u --locale en-us --channel website --verbose');
        return;
    }
    
    // Load all content
    const contentItems = [];
    
    // Load from item directory
    if (hasData.content) {
        const itemFiles = fs.readdirSync(contentDir).filter(f => f.endsWith('.json'));
        for (const file of itemFiles) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(contentDir, file), 'utf8'));
                contentItems.push({ ...content, source: 'item', file });
            } catch (e) {
                console.warn(`   ⚠️  Failed to load ${file}: ${e.message}`);
            }
        }
    }
    
    // Load from list directory
    if (hasData.list) {
        const listFiles = fs.readdirSync(listDir).filter(f => f.endsWith('.json'));
        for (const file of listFiles) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(listDir, file), 'utf8'));
                if (Array.isArray(content)) {
                    content.forEach((item, index) => {
                        contentItems.push({ ...item, source: 'list', file: `${file}[${index}]` });
                    });
                } else {
                    contentItems.push({ ...content, source: 'list', file });
                }
            } catch (e) {
                console.warn(`   ⚠️  Failed to load ${file}: ${e.message}`);
            }
        }
    }
    
    // Load available containers
    const availableContainers = new Map();
    if (hasData.containers) {
        const containerFiles = fs.readdirSync(containersDir).filter(f => f.endsWith('.json'));
        for (const file of containerFiles) {
            try {
                const container = JSON.parse(fs.readFileSync(path.join(containersDir, file), 'utf8'));
                availableContainers.set(container.contentViewID, {
                    ...container,
                    fileName: file
                });
            } catch (e) {
                console.warn(`   ⚠️  Failed to load container ${file}: ${e.message}`);
            }
        }
    }
    
    console.log(`\n📊 TEXAS GAMING DATA SUMMARY:`);
    console.log(`   Content items: ${contentItems.length}`);
    console.log(`   Available containers: ${availableContainers.size}`);
    
    // Extract all container references
    const containerReferences = new Map();
    
    function scanForContainerReferences(obj, path = '', sourceContext = '') {
        if (!obj || typeof obj !== 'object') return;
        
        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                scanForContainerReferences(item, `${path}[${index}]`, sourceContext);
            });
            return;
        }
        
        for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            // Look for container ID references
            if ((key === 'contentid' || key === 'contentID' || key === 'containerID') && typeof value === 'number' && value > 0) {
                if (!containerReferences.has(value)) {
                    containerReferences.set(value, []);
                }
                
                containerReferences.get(value).push({
                    sourceContext,
                    path: currentPath,
                    fieldName: key,
                    value: value
                });
            }
            
            // Recursively scan nested objects
            if (typeof value === 'object' && value !== null) {
                scanForContainerReferences(value, currentPath, sourceContext);
            }
        }
    }
    
    // Scan all content for container references
    console.log('\n🔍 Scanning for container references...');
    for (const content of contentItems) {
        const context = `${content.source}:${content.file}`;
        
        if (content.fields) {
            scanForContainerReferences(content.fields, 'fields', context);
        }
        
        if (content.properties) {
            scanForContainerReferences(content.properties, 'properties', context);
        }
    }
    
    console.log(`\n📊 CONTAINER REFERENCE ANALYSIS:`);
    console.log(`   Total unique container IDs referenced: ${containerReferences.size}`);
    console.log(`   Available containers on disk: ${availableContainers.size}`);
    
    // Find missing containers
    const missingContainers = [];
    const foundContainers = [];
    
    for (const containerID of containerReferences.keys()) {
        if (availableContainers.has(containerID)) {
            foundContainers.push(containerID);
        } else {
            missingContainers.push(containerID);
        }
    }
    
    console.log(`   ✅ Found containers: ${foundContainers.length}`);
    console.log(`   ❌ Missing containers: ${missingContainers.length}`);
    
    if (missingContainers.length > 0) {
        console.log(`\n🚨 MISSING CONTAINER DETAILS:`);
        
        // Sort by reference count
        const missingWithCounts = missingContainers.map(id => ({
            id,
            refCount: containerReferences.get(id).length
        })).sort((a, b) => b.refCount - a.refCount);
        
        console.log(`   Top missing containers by reference count:`);
        for (const { id, refCount } of missingWithCounts.slice(0, 10)) {
            console.log(`     ContainerID:${id} - ${refCount} references`);
        }
        
        // Check content status for missing containers
        console.log(`\n📄 CONTENT IMPACT ANALYSIS:`);
        
        let totalAffectedContent = 0;
        let publishedAffectedContent = 0;
        let totalBrokenReferences = 0;
        
        for (const containerID of missingContainers) {
            const references = containerReferences.get(containerID);
            totalBrokenReferences += references.length;
            
            const contentGroups = new Set();
            references.forEach(ref => {
                contentGroups.add(ref.sourceContext);
            });
            
            totalAffectedContent += contentGroups.size;
            
            // Check if any affected content is published
            for (const sourceContext of contentGroups) {
                const [source, fileName] = sourceContext.split(':');
                const contentItem = contentItems.find(c => 
                    c.source === source && c.file === fileName
                );
                
                if (contentItem && contentItem.properties?.published) {
                    publishedAffectedContent++;
                }
            }
        }
        
        console.log(`   💔 Total broken references: ${totalBrokenReferences}`);
        console.log(`   📄 Total affected content items: ${totalAffectedContent}`);
        console.log(`   📢 Published content affected: ${publishedAffectedContent}`);
        console.log(`   📊 Percentage of content affected: ${((totalAffectedContent / contentItems.length) * 100).toFixed(2)}%`);
        
        // Compare with documentation site
        console.log(`\n📈 COMPARISON WITH DOCUMENTATION SITE:`);
        console.log(`   Documentation site (67bc73e6-u):`);
        console.log(`     - Missing containers: 11 critical containers`);
        console.log(`     - Broken references: 110`);
        console.log(`     - Published content affected: 0`);
        console.log(`     - Content affected: 5.28%`);
        console.log(`   Texas Gaming (13a8b394-u):`);
        console.log(`     - Missing containers: ${missingContainers.length}`);
        console.log(`     - Broken references: ${totalBrokenReferences}`);
        console.log(`     - Published content affected: ${publishedAffectedContent}`);
        console.log(`     - Content affected: ${((totalAffectedContent / contentItems.length) * 100).toFixed(2)}%`);
        
        if (missingContainers.length < 11) {
            console.log(`   🎯 Texas Gaming appears CLEANER than documentation site`);
        } else if (publishedAffectedContent === 0) {
            console.log(`   ✅ Similar issue pattern but no published content affected`);
        } else {
            console.log(`   🚨 Texas Gaming has MORE severe issues than documentation site`);
        }
    } else {
        console.log(`\n🎉 EXCELLENT: No missing containers found!`);
        console.log(`   Texas Gaming has a clean container reference structure`);
        console.log(`   All referenced containers are available`);
    }
    
    // Container-to-container chain analysis
    console.log(`\n🔗 CONTAINER CHAIN ANALYSIS:`);
    const containerToContainerChains = [];
    
    for (const content of contentItems) {
        if (!content.fields) continue;
        
        const parentContainerName = content.properties?.definitionName;
        if (!parentContainerName) continue;
        
        // Check if this content has nested container references
        const nestedContainerRefs = [];
        function findNestedRefs(obj, path = '') {
            if (!obj || typeof obj !== 'object') return;
            
            for (const [key, value] of Object.entries(obj)) {
                if ((key === 'contentid' || key === 'contentID') && typeof value === 'number') {
                    nestedContainerRefs.push({ containerID: value, path });
                }
                if (typeof value === 'object' && value !== null) {
                    findNestedRefs(value, path ? `${path}.${key}` : key);
                }
            }
        }
        
        findNestedRefs(content.fields);
        
        if (nestedContainerRefs.length > 0) {
            containerToContainerChains.push({
                parentContainer: parentContainerName,
                contentItem: content.properties?.referenceName || 'No Name',
                nestedContainers: nestedContainerRefs,
                source: content.source,
                file: content.file
            });
        }
    }
    
    console.log(`   Found ${containerToContainerChains.length} container-to-container chains`);
    
    if (containerToContainerChains.length > 0) {
        console.log(`   Sample chains:`);
        for (const chain of containerToContainerChains.slice(0, 5)) {
            console.log(`     ${chain.parentContainer} → Content:${chain.contentItem}`);
            for (const nested of chain.nestedContainers.slice(0, 3)) {
                const isAvailable = availableContainers.has(nested.containerID);
                console.log(`       └─ ContainerID:${nested.containerID} ${isAvailable ? '✅' : '❌'} (at ${nested.path})`);
            }
        }
    }
    
    return {
        totalContent: contentItems.length,
        totalContainers: availableContainers.size,
        referencedContainers: containerReferences.size,
        missingContainers: missingContainers.length,
        containerChains: containerToContainerChains.length
    };
}

analyzeTexasGamingContainers().catch(console.error); 