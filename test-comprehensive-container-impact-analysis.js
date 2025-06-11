const fs = require('fs');
const path = require('path');

async function comprehensiveContainerImpactAnalysis() {
    console.log('🔍 COMPREHENSIVE CONTAINER IMPACT ANALYSIS');
    console.log('=' .repeat(60));
    
    // Critical containers to investigate
    const criticalContainers = [408, 412, 435, 405, 407, 409, 410, 411, 413, 415, 418];
    
    // Load content data
    const contentDir = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'item');
    const listDir = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'list');
    const pagesFile = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'pages.json');
    const containersDir = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'containers');
    
    console.log('📁 Loading data from agility-files...');
    
    // Load all content
    const contentItems = [];
    
    // Load from item directory
    if (fs.existsSync(contentDir)) {
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
    if (fs.existsSync(listDir)) {
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
    if (fs.existsSync(containersDir)) {
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
    
    console.log(`📦 Loaded ${contentItems.length} content items`);
    console.log(`📦 Loaded ${availableContainers.size} available containers`);
    
    // Find all content that references critical containers
    const criticalContainerReferences = new Map();
    
    function scanForSpecificContainerReferences(obj, containerIds, path = '', sourceContext = '') {
        if (!obj || typeof obj !== 'object') return;
        
        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                scanForSpecificContainerReferences(item, containerIds, `${path}[${index}]`, sourceContext);
            });
            return;
        }
        
        for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            // Look for container ID references
            if ((key === 'contentid' || key === 'contentID' || key === 'containerID') && typeof value === 'number') {
                if (containerIds.includes(value)) {
                    if (!criticalContainerReferences.has(value)) {
                        criticalContainerReferences.set(value, []);
                    }
                    
                    criticalContainerReferences.get(value).push({
                        sourceContext,
                        path: currentPath,
                        fieldName: key,
                        value: value
                    });
                }
            }
            
            // Recursively scan nested objects
            if (typeof value === 'object' && value !== null) {
                scanForSpecificContainerReferences(value, containerIds, currentPath, sourceContext);
            }
        }
    }
    
    // Scan all content for critical container references
    console.log('\n🎯 SCANNING FOR CRITICAL CONTAINER REFERENCES...');
    for (const content of contentItems) {
        const context = `${content.source}:${content.file}`;
        
        if (content.fields) {
            scanForSpecificContainerReferences(content.fields, criticalContainers, 'fields', context);
        }
        
        if (content.properties) {
            scanForSpecificContainerReferences(content.properties, criticalContainers, 'properties', context);
        }
    }
    
    console.log(`\n📊 CRITICAL CONTAINER REFERENCE ANALYSIS:`);
    
    for (const containerID of criticalContainers) {
        console.log(`\n🔍 ContainerID:${containerID}:`);
        
        // Check if container is available in downloaded files
        const isAvailable = availableContainers.has(containerID);
        console.log(`   📁 Available in downloads: ${isAvailable ? '✅ YES' : '❌ NO'}`);
        
        if (isAvailable) {
            const container = availableContainers.get(containerID);
            console.log(`      File: ${container.fileName}`);
            console.log(`      Name: ${container.referenceName || 'No Name'}`);
            console.log(`      Published: ${container.isPublished ? '✅ YES' : '❌ NO'}`);
        }
        
        // Check if content references this container
        const references = criticalContainerReferences.get(containerID) || [];
        console.log(`   🔗 Referenced by content: ${references.length} times`);
        
        if (references.length > 0) {
            console.log(`   📄 REFERENCING CONTENT ANALYSIS:`);
            
            // Group references by content item
            const contentGroups = new Map();
            references.forEach(ref => {
                if (!contentGroups.has(ref.sourceContext)) {
                    contentGroups.set(ref.sourceContext, []);
                }
                contentGroups.get(ref.sourceContext).push(ref);
            });
            
            for (const [sourceContext, refs] of contentGroups) {
                const [source, fileName] = sourceContext.split(':');
                
                // Find the actual content item to check its status
                const contentItem = contentItems.find(c => 
                    c.source === source && c.file === fileName
                );
                
                if (contentItem) {
                    console.log(`      • ${sourceContext}`);
                    console.log(`        Content: ${contentItem.properties?.referenceName || 'No Name'}`);
                    console.log(`        Definition: ${contentItem.properties?.definitionName || 'Unknown'}`);
                    console.log(`        State: ${contentItem.properties?.state || 'Unknown'}`);
                    console.log(`        Modified: ${contentItem.properties?.modified || 'Unknown'}`);
                    console.log(`        Published: ${contentItem.properties?.published ? '✅ YES' : '❌ NO'}`);
                    console.log(`        Fields referencing: ${refs.map(r => r.path).join(', ')}`);
                    
                    // Check if this content would break sync
                    const wouldBreakSync = !isAvailable;
                    console.log(`        🚨 Would break sync: ${wouldBreakSync ? '❌ YES' : '✅ NO'}`);
                } else {
                    console.log(`      • ${sourceContext} - Content item not found in analysis`);
                }
            }
        }
    }
    
    // Check for patterns in missing containers
    console.log(`\n📊 MISSING CONTAINER PATTERN ANALYSIS:`);
    
    const missingContainers = criticalContainers.filter(id => !availableContainers.has(id));
    const availableContainersList = criticalContainers.filter(id => availableContainers.has(id));
    
    console.log(`   Missing: ${missingContainers.length}/${criticalContainers.length} containers`);
    console.log(`   Available: ${availableContainersList.length}/${criticalContainers.length} containers`);
    
    if (missingContainers.length > 0) {
        console.log(`   🚫 Missing containers: ${missingContainers.join(', ')}`);
    }
    
    if (availableContainersList.length > 0) {
        console.log(`   ✅ Available containers: ${availableContainersList.join(', ')}`);
    }
    
    // Calculate sync impact
    console.log(`\n💥 SYNC IMPACT ASSESSMENT:`);
    
    let totalAffectedContent = 0;
    let totalPublishedAffectedContent = 0;
    let totalBrokenReferences = 0;
    
    for (const containerID of missingContainers) {
        const references = criticalContainerReferences.get(containerID) || [];
        totalBrokenReferences += references.length;
        
        const contentGroups = new Map();
        references.forEach(ref => {
            contentGroups.set(ref.sourceContext, true);
        });
        
        totalAffectedContent += contentGroups.size;
        
        // Count published content
        for (const sourceContext of contentGroups.keys()) {
            const [source, fileName] = sourceContext.split(':');
            const contentItem = contentItems.find(c => 
                c.source === source && c.file === fileName
            );
            
            if (contentItem && contentItem.properties?.published) {
                totalPublishedAffectedContent++;
            }
        }
    }
    
    console.log(`   💔 Total broken references: ${totalBrokenReferences}`);
    console.log(`   📄 Total affected content items: ${totalAffectedContent}`);
    console.log(`   📢 Published content affected: ${totalPublishedAffectedContent}`);
    console.log(`   📊 Percentage of total content affected: ${((totalAffectedContent / contentItems.length) * 100).toFixed(2)}%`);
    
    // Recommendations
    console.log(`\n💡 RECOMMENDATIONS:`);
    
    if (totalPublishedAffectedContent > 0) {
        console.log(`   🚨 HIGH IMPACT: ${totalPublishedAffectedContent} published content items have broken dependencies`);
        console.log(`   📝 These content items will likely fail to sync or display incorrectly`);
        console.log(`   🔧 Consider preserving deleted containers for reference during migration`);
    }
    
    if (totalBrokenReferences > 50) {
        console.log(`   ⚠️  MEDIUM IMPACT: ${totalBrokenReferences} broken references may cause sync issues`);
        console.log(`   🛠️  Consider implementing broken reference detection and cleanup`);
    }
    
    if (missingContainers.length === criticalContainers.length) {
        console.log(`   🔥 CRITICAL: ALL critical containers are missing - this suggests systematic issue`);
        console.log(`   🔍 Recommend verifying container discovery logic and SDK access patterns`);
    }
    
    return {
        criticalContainers,
        missingContainers,
        availableContainersList,
        totalAffectedContent,
        totalPublishedAffectedContent,
        totalBrokenReferences
    };
}

comprehensiveContainerImpactAnalysis().catch(console.error); 