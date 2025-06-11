const fs = require('fs');
const path = require('path');

/**
 * TEST: Content Sync SDK Internal Consistency Check
 * 
 * This test proves whether the Content Sync SDK is internally consistent:
 * - Content from /list and /item directories (Content Sync SDK)
 * - Container references found in that content
 * - Containers available from /list and /item directories (Content Sync SDK)
 * 
 * NO Management SDK involvement - purely Content Sync SDK data
 */

function loadContentSyncContent() {
    const basePath = 'agility-files/67bc73e6-u/en-us/preview';
    const listPath = path.join(basePath, 'list');
    const itemPath = path.join(basePath, 'item');
    
    let contentItems = [];
    
    console.log('📋 LOADING CONTENT SYNC SDK CONTENT DATA');
    console.log('=========================================');
    
    // Load from /list directory (Content Sync SDK)
    if (fs.existsSync(listPath)) {
        const listFiles = fs.readdirSync(listPath).filter(f => f.endsWith('.json'));
        console.log(`📁 List directory: ${listFiles.length} files`);
        
        for (const file of listFiles) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(listPath, file), 'utf8'));
                if (Array.isArray(content)) {
                    contentItems.push(...content);
                } else {
                    contentItems.push(content);
                }
            } catch (error) {
                console.log(`⚠️ Skipped invalid file: ${file}`);
            }
        }
    }
    
    // Load from /item directory (Content Sync SDK)
    if (fs.existsSync(itemPath)) {
        const itemFiles = fs.readdirSync(itemPath).filter(f => f.endsWith('.json'));
        console.log(`📁 Item directory: ${itemFiles.length} files`);
        
        for (const file of itemFiles) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(itemPath, file), 'utf8'));
                contentItems.push(content);
            } catch (error) {
                console.log(`⚠️ Skipped invalid file: ${file}`);
            }
        }
    }
    
    console.log(`📊 Total Content Sync content loaded: ${contentItems.length} items\n`);
    return contentItems;
}

function loadContentSyncContainers() {
    const basePath = 'agility-files/67bc73e6-u/en-us/preview';
    const listPath = path.join(basePath, 'list');
    const itemPath = path.join(basePath, 'item');
    
    let containers = [];
    const containerIds = new Set();
    
    console.log('📦 LOADING CONTENT SYNC SDK CONTAINER DATA');
    console.log('==========================================');
    
    // Check if Content Sync SDK provides containers in /list or /item
    // Look for container-like data structures
    
    if (fs.existsSync(listPath)) {
        const listFiles = fs.readdirSync(listPath).filter(f => f.endsWith('.json'));
        
        for (const file of listFiles) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(listPath, file), 'utf8'));
                
                // Check if this looks like container data
                if (Array.isArray(content)) {
                    for (const item of content) {
                        if (item.contentViewID && item.referenceName) {
                            containers.push(item);
                            containerIds.add(item.contentViewID);
                        }
                    }
                } else if (content.contentViewID && content.referenceName) {
                    containers.push(content);
                    containerIds.add(content.contentViewID);
                }
            } catch (error) {
                // Skip invalid files
            }
        }
    }
    
    if (fs.existsSync(itemPath)) {
        const itemFiles = fs.readdirSync(itemPath).filter(f => f.endsWith('.json'));
        
        for (const file of itemFiles) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(itemPath, file), 'utf8'));
                
                // Check if this looks like container data
                if (content.contentViewID && content.referenceName) {
                    containers.push(content);
                    containerIds.add(content.contentViewID);
                }
            } catch (error) {
                // Skip invalid files
            }
        }
    }
    
    console.log(`📦 Content Sync containers found: ${containers.length}`);
    console.log(`🔢 Unique container IDs: ${containerIds.size}`);
    console.log(`📋 Sample container IDs: ${Array.from(containerIds).slice(0, 10).join(', ')}\n`);
    
    return { containers, containerIds };
}

function extractContainerReferencesFromContent(contentItems) {
    const referencedContainerIds = new Set();
    const referenceDetails = [];
    
    console.log('🔍 EXTRACTING CONTAINER REFERENCES FROM CONTENT');
    console.log('==============================================');
    
    function scanObject(obj, path = '') {
        if (!obj || typeof obj !== 'object') return;
        
        if (Array.isArray(obj)) {
            obj.forEach((item, index) => scanObject(item, `${path}[${index}]`));
        } else {
            for (const [key, value] of Object.entries(obj)) {
                const currentPath = path ? `${path}.${key}` : key;
                
                // Look for container ID references
                if (key === 'contentid' && typeof value === 'number') {
                    referencedContainerIds.add(value);
                    referenceDetails.push({
                        containerId: value,
                        fieldPath: currentPath,
                        contentId: obj.contentID || 'unknown'
                    });
                }
                
                // Look for container reference names
                if (key === 'referenceName' && typeof value === 'string') {
                    referenceDetails.push({
                        referenceName: value,
                        fieldPath: currentPath,
                        contentId: obj.contentID || 'unknown'
                    });
                }
                
                scanObject(value, currentPath);
            }
        }
    }
    
    contentItems.forEach(content => {
        scanObject(content);
    });
    
    console.log(`🔗 Container IDs referenced in content: ${referencedContainerIds.size}`);
    console.log(`📊 Total references found: ${referenceDetails.length}`);
    console.log(`📋 Sample referenced IDs: ${Array.from(referencedContainerIds).slice(0, 15).join(', ')}\n`);
    
    return { referencedContainerIds, referenceDetails };
}

function analyzeContentSyncConsistency() {
    console.log('🎯 CONTENT SYNC SDK INTERNAL CONSISTENCY ANALYSIS');
    console.log('=================================================\n');
    
    // Step 1: Load Content Sync SDK content
    const contentItems = loadContentSyncContent();
    
    // Step 2: Load Content Sync SDK containers
    const { containers, containerIds } = loadContentSyncContainers();
    
    // Step 3: Extract container references from content
    const { referencedContainerIds, referenceDetails } = extractContainerReferencesFromContent(contentItems);
    
    // Step 4: Find missing containers (Content Sync SDK inconsistency)
    const missingContainerIds = new Set();
    for (const refId of referencedContainerIds) {
        if (!containerIds.has(refId)) {
            missingContainerIds.add(refId);
        }
    }
    
    console.log('🚨 CONTENT SYNC SDK CONSISTENCY RESULTS');
    console.log('=======================================');
    console.log(`📊 Content items provided: ${contentItems.length}`);
    console.log(`📦 Containers provided: ${containers.length}`);
    console.log(`🔗 Container IDs referenced in content: ${referencedContainerIds.size}`);
    console.log(`❌ Missing containers (inconsistency): ${missingContainerIds.size}`);
    
    if (missingContainerIds.size > 0) {
        console.log(`\n🚨 PROOF OF CONTENT SYNC SDK INTERNAL INCONSISTENCY:`);
        console.log(`   The Content Sync SDK provided content that references ${missingContainerIds.size} containers`);
        console.log(`   but did NOT provide those containers in its own data!`);
        console.log(`\n❌ Missing Container IDs:`);
        const sortedMissing = Array.from(missingContainerIds).sort((a, b) => a - b);
        sortedMissing.slice(0, 20).forEach(id => {
            const refCount = referenceDetails.filter(r => r.containerId === id).length;
            console.log(`   - ContainerID:${id} (referenced ${refCount} times)`);
        });
        
        if (sortedMissing.length > 20) {
            console.log(`   ... and ${sortedMissing.length - 20} more missing containers`);
        }
    } else {
        console.log(`\n✅ CONTENT SYNC SDK IS INTERNALLY CONSISTENT`);
        console.log(`   All container references in content are satisfied by provided containers`);
    }
    
    console.log(`\n💡 CONCLUSION:`);
    if (missingContainerIds.size > 0) {
        console.log(`   This proves the Content Sync SDK has internal inconsistencies.`);
        console.log(`   The SDK downloads content but fails to download the containers that content references.`);
        console.log(`   This is NOT a CLI bug - it's a Content Sync SDK data consistency issue.`);
    } else {
        console.log(`   The Content Sync SDK is internally consistent.`);
        console.log(`   The missing container issue must be elsewhere in the pipeline.`);
    }
}

// Run the analysis
analyzeContentSyncConsistency(); 