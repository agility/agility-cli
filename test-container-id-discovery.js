const fs = require('fs');
const path = require('path');

// Load content from Sync SDK files
function loadContentFromSyncSDK() {
    const listPath = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'list');
    const itemPath = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'item');
    
    let contentItems = [];
    
    // Load from list files
    if (fs.existsSync(listPath)) {
        const listFiles = fs.readdirSync(listPath).filter(f => f.endsWith('.json'));
        for (const file of listFiles) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(listPath, file), 'utf8'));
                if (Array.isArray(content)) {
                    contentItems.push(...content);
                } else {
                    contentItems.push(content);
                }
            } catch {
                // Skip invalid files
            }
        }
    }
    
    // Load from item files  
    if (fs.existsSync(itemPath)) {
        const itemFiles = fs.readdirSync(itemPath).filter(f => f.endsWith('.json'));
        for (const file of itemFiles) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(itemPath, file), 'utf8'));
                contentItems.push(content);
            } catch {
                // Skip invalid files
            }
        }
    }
    
    return contentItems;
}

// Extract container IDs from content
function extractContainerIdsFromContent(contentItems) {
    const containerIds = new Set();
    
    for (const contentItem of contentItems) {
        try {
            scanObjectForContainerReferences(contentItem, '', containerIds);
        } catch {
            // Skip invalid content items
        }
    }
    
    return containerIds;
}

// Recursively scan object for container references
function scanObjectForContainerReferences(obj, path, containerIds) {
    if (!obj || typeof obj !== 'object') return;
    
    for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        
        // Look for contentid/contentID fields that indicate container references
        if ((key === 'contentid' || key === 'contentID') && typeof value === 'number') {
            containerIds.add(value);
        }
        
        // Recursively scan nested objects and arrays
        if (typeof value === 'object' && value !== null) {
            if (Array.isArray(value)) {
                value.forEach((item, index) => {
                    scanObjectForContainerReferences(item, `${currentPath}[${index}]`, containerIds);
                });
            } else {
                scanObjectForContainerReferences(value, currentPath, containerIds);
            }
        }
    }
}

// Check which containers exist in downloaded files
function getDownloadedContainerIds() {
    const containerPath = path.join(process.cwd(), 'agility-files', '67bc73e6-u', 'en-us', 'preview', 'containers');
    const downloadedIds = new Set();
    
    if (fs.existsSync(containerPath)) {
        const containerFiles = fs.readdirSync(containerPath).filter(f => f.endsWith('.json'));
        for (const file of containerFiles) {
            try {
                const container = JSON.parse(fs.readFileSync(path.join(containerPath, file), 'utf8'));
                if (container.contentViewID) {
                    downloadedIds.add(container.contentViewID);
                }
            } catch {
                // Skip invalid files
            }
        }
    }
    
    return downloadedIds;
}

// Main analysis
console.log('🔍 Analyzing container ID discovery...');

const contentItems = loadContentFromSyncSDK();
console.log(`📋 Loaded ${contentItems.length} content items`);

const referencedContainerIds = extractContainerIdsFromContent(contentItems);
console.log(`🔍 Found ${referencedContainerIds.size} unique container IDs referenced in content`);

const downloadedContainerIds = getDownloadedContainerIds();
console.log(`📁 Found ${downloadedContainerIds.size} downloaded containers`);

// Find missing containers
const missingContainerIds = new Set();
for (const id of referencedContainerIds) {
    if (!downloadedContainerIds.has(id)) {
        missingContainerIds.add(id);
    }
}

console.log(`\n❌ Missing containers: ${missingContainerIds.size}`);
const missingArray = Array.from(missingContainerIds).sort((a, b) => a - b);

// Check for our specific missing containers
const criticalMissing = [405, 407, 408, 409, 410];
console.log(`\n🎯 Critical missing containers check:`);
for (const id of criticalMissing) {
    const isReferenced = referencedContainerIds.has(id);
    const isDownloaded = downloadedContainerIds.has(id);
    console.log(`   ContainerID:${id} - Referenced: ${isReferenced}, Downloaded: ${isDownloaded}`);
}

console.log(`\n📊 First 20 missing container IDs:`);
missingArray.slice(0, 20).forEach(id => {
    console.log(`   ContainerID:${id}`);
});

console.log(`\n📊 All missing container IDs:`);
console.log(missingArray.join(', ')); 