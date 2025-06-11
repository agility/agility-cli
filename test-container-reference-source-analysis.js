const fs = require('fs');
const path = require('path');

async function analyzeContainerReferenceSource() {
    console.log('🔍 ANALYZING SOURCE OF CONTAINER REFERENCES');
    console.log('=' .repeat(60));
    
    // Load content data
    const contentDir = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'item');
    const listDir = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'list');
    const pagesFile = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'pages.json');
    
    console.log('📁 Loading content from:');
    console.log(`   Content items: ${contentDir}`);
    console.log(`   Content lists: ${listDir}`);
    console.log(`   Pages: ${pagesFile}`);
    
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
    
    // Load pages
    let pages = [];
    if (fs.existsSync(pagesFile)) {
        try {
            pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
            console.log(`📄 Loaded ${pages.length} pages`);
        } catch (e) {
            console.warn(`   ⚠️  Failed to load pages: ${e.message}`);
        }
    }
    
    console.log(`📦 Loaded ${contentItems.length} content items`);
    
    // Extract container references with detailed tracking
    const containerReferences = new Map(); // containerID -> { source: string, contexts: Array }
    
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
                    containerReferences.set(value, { references: [] });
                }
                
                containerReferences.get(value).references.push({
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
    
    // Scan content items
    console.log('\n🔍 Scanning content items for container references...');
    for (const content of contentItems) {
        const context = `${content.source}:${content.file} (${content.properties?.referenceName || 'No Name'})`;
        
        if (content.fields) {
            scanForContainerReferences(content.fields, 'fields', context);
        }
        
        // Also scan properties for container references
        if (content.properties) {
            scanForContainerReferences(content.properties, 'properties', context);
        }
    }
    
    // Scan pages for container references
    console.log('🔍 Scanning pages for container references...');
    for (const page of pages) {
        const context = `page:${page.name || page.pageID} (PageID:${page.pageID})`;
        
        if (page.zones) {
            scanForContainerReferences(page.zones, 'zones', context);
        }
    }
    
    console.log(`\n📊 CONTAINER REFERENCE ANALYSIS RESULTS:`);
    console.log(`   Total unique container IDs referenced: ${containerReferences.size}`);
    
    // Categorize references by source type
    const referencesBySource = {
        contentFields: new Set(),
        contentProperties: new Set(), 
        pageZones: new Set()
    };
    
    const referenceCounts = {
        contentFields: 0,
        contentProperties: 0,
        pageZones: 0
    };
    
    for (const [containerID, data] of containerReferences) {
        for (const ref of data.references) {
            if (ref.path.startsWith('fields.')) {
                referencesBySource.contentFields.add(containerID);
                referenceCounts.contentFields++;
            } else if (ref.path.startsWith('properties.')) {
                referencesBySource.contentProperties.add(containerID);
                referenceCounts.contentProperties++;
            } else if (ref.path.startsWith('zones.')) {
                referencesBySource.pageZones.add(containerID);
                referenceCounts.pageZones++;
            }
        }
    }
    
    console.log(`\n📊 REFERENCE SOURCE BREAKDOWN:`);
    console.log(`   Content Fields: ${referencesBySource.contentFields.size} unique containers (${referenceCounts.contentFields} total refs)`);
    console.log(`   Content Properties: ${referencesBySource.contentProperties.size} unique containers (${referenceCounts.contentProperties} total refs)`);
    console.log(`   Page Zones: ${referencesBySource.pageZones.size} unique containers (${referenceCounts.pageZones} total refs)`);
    
    // Show detailed breakdown for the critical missing containers
    const criticalContainers = [405, 407, 408, 409, 410, 411, 412, 413, 415, 418];
    
    console.log(`\n🎯 CRITICAL MISSING CONTAINER ANALYSIS:`);
    for (const containerID of criticalContainers) {
        if (containerReferences.has(containerID)) {
            const data = containerReferences.get(containerID);
            console.log(`\n   ContainerID:${containerID} - Referenced ${data.references.length} times:`);
            
            for (const ref of data.references.slice(0, 5)) { // Show first 5 references
                console.log(`     • ${ref.sourceContext}`);
                console.log(`       Field: ${ref.path} (${ref.fieldName}=${ref.value})`);
            }
            
            if (data.references.length > 5) {
                console.log(`     ... and ${data.references.length - 5} more references`);
            }
        } else {
            console.log(`   ContainerID:${containerID} - NOT FOUND in content references`);
        }
    }
    
    // Show containers with the most references (likely important ones)
    console.log(`\n📈 MOST REFERENCED CONTAINERS:`);
    const sortedContainers = Array.from(containerReferences.entries())
        .sort((a, b) => b[1].references.length - a[1].references.length)
        .slice(0, 20);
    
    for (const [containerID, data] of sortedContainers) {
        console.log(`   ContainerID:${containerID} - ${data.references.length} references`);
        
        // Show what types of references
        const refTypes = new Set(data.references.map(r => r.path.split('.')[0]));
        console.log(`     Types: ${Array.from(refTypes).join(', ')}`);
    }
    
    // Analyze container-to-container chains
    console.log(`\n🔗 CONTAINER-TO-CONTAINER CHAIN ANALYSIS:`);
    const containerToContainerChains = [];
    
    for (const content of contentItems) {
        if (!content.fields) continue;
        
        const parentContainerName = content.properties?.definitionName;
        if (!parentContainerName) continue;
        
        // Find container references in this content's fields
        const refs = [];
        scanForContainerReferences(content.fields, 'fields', '');
        
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
    
    console.log(`   Found ${containerToContainerChains.length} container-to-container chains:`);
    
    for (const chain of containerToContainerChains.slice(0, 10)) {
        console.log(`\n     ${chain.parentContainer} → Content:${chain.contentItem}`);
        for (const nested of chain.nestedContainers) {
            console.log(`       └─ ContainerID:${nested.containerID} (at ${nested.path})`);
        }
        console.log(`       Source: ${chain.source}:${chain.file}`);
    }
    
    if (containerToContainerChains.length > 10) {
        console.log(`     ... and ${containerToContainerChains.length - 10} more chains`);
    }
    
    return {
        totalContainerReferences: containerReferences.size,
        referencesBySource,
        referenceCounts,
        containerToContainerChains: containerToContainerChains.length,
        criticalContainersFound: criticalContainers.filter(id => containerReferences.has(id))
    };
}

analyzeContainerReferenceSource().catch(console.error); 