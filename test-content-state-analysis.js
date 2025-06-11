const fs = require('fs');
const path = require('path');

// Import state analysis functions
const { getContentStateInfo, getStateSyncImpact, CONTENT_STATES } = require('./dist/lib/services/sync-analysis/types.js');

async function analyzeContentStates() {
    const instancePath = 'agility-files/67bc73e6-u/en-us/preview';
    
    console.log('🔍 CONTENT STATE ANALYSIS WITH ENHANCED LABELS');
    console.log('===========================================');
    
    // Load content from the problematic documentation site
    const contentPath = path.join(instancePath, 'item');
    const contentFiles = fs.readdirSync(contentPath).filter(f => f.endsWith('.json'));
    
    console.log(`📄 Analyzing ${contentFiles.length} content items for state patterns...\n`);
    
    const stateAnalysis = new Map();
    const problemContainers = [405, 407, 408, 409, 410, 411, 412, 413, 415, 418]; // Known missing containers
    
    let contentWithBrokenRefs = 0;
    let totalBrokenRefs = 0;
    
    for (const file of contentFiles) {
        const filePath = path.join(contentPath, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        const state = content.properties?.state;
        if (!state) continue;
        
        // Track state distribution
        if (!stateAnalysis.has(state)) {
            stateAnalysis.set(state, { count: 0, items: [], brokenRefs: 0 });
        }
        
        // Check if this content references problematic containers
        let hasBrokenRefs = false;
        let brokenRefCount = 0;
        
        function scanForContainerRefs(obj, path = '') {
            if (!obj || typeof obj !== 'object') return;
            
            for (const [key, value] of Object.entries(obj)) {
                if ((key === 'contentid' || key === 'contentID') && typeof value === 'number') {
                    if (problemContainers.includes(value)) {
                        hasBrokenRefs = true;
                        brokenRefCount++;
                        totalBrokenRefs++;
                    }
                } else if (typeof value === 'object') {
                    scanForContainerRefs(value, path ? `${path}.${key}` : key);
                }
            }
        }
        
        scanForContainerRefs(content.fields);
        
        if (hasBrokenRefs) {
            contentWithBrokenRefs++;
            stateAnalysis.get(state).brokenRefs += brokenRefCount;
        }
        
        stateAnalysis.get(state).count++;
        stateAnalysis.get(state).items.push({
            contentID: content.contentID,
            referenceName: content.properties?.referenceName,
            modified: content.properties?.modified,
            hasBrokenRefs,
            brokenRefCount
        });
    }
    
    console.log('📊 ENHANCED STATE ANALYSIS WITH SYNC IMPACT');
    console.log('==========================================');
    
    let totalUnsyncable = 0;
    let totalProblematic = 0;
    let totalNormal = 0;
    
    for (const [state, data] of Array.from(stateAnalysis.entries())) {
        const stateInfo = getContentStateInfo(state);
        const syncImpact = getStateSyncImpact(state);
        const percentage = ((data.count / contentFiles.length) * 100).toFixed(1);
        
        console.log(`\n${stateInfo.formatted}: ${data.count} items (${percentage}%)`);
        console.log(`   📝 Description: ${stateInfo.description}`);
        console.log(`   🎯 Sync Impact: ${getSyncImpactLabel(syncImpact)}`);
        console.log(`   💔 Items with broken refs: ${data.items.filter(i => i.hasBrokenRefs).length}`);
        console.log(`   🔗 Total broken refs: ${data.brokenRefs}`);
        
        if (syncImpact === 'unsyncable') totalUnsyncable += data.count;
        else if (syncImpact === 'problematic') totalProblematic += data.count;
        else totalNormal += data.count;
        
        // Show examples of problematic content
        const problematicItems = data.items.filter(i => i.hasBrokenRefs);
        if (problematicItems.length > 0) {
            console.log(`   📄 Example problematic content:`);
            problematicItems.slice(0, 3).forEach(item => {
                console.log(`      • ContentID:${item.contentID} (${item.referenceName || 'No Name'})`);
                console.log(`        Modified: ${item.modified || 'Unknown'}`);
                console.log(`        Broken refs: ${item.brokenRefCount}`);
            });
            if (problematicItems.length > 3) {
                console.log(`      ... and ${problematicItems.length - 3} more with broken references`);
            }
        }
    }
    
    console.log(`\n🔍 BROKEN REFERENCE ANALYSIS`);
    console.log(`==========================`);
    console.log(`📄 Content items with broken refs: ${contentWithBrokenRefs}/${contentFiles.length} (${((contentWithBrokenRefs/contentFiles.length)*100).toFixed(1)}%)`);
    console.log(`💔 Total broken container references: ${totalBrokenRefs}`);
    
    console.log(`\n📈 SYNC IMPACT SUMMARY`);
    console.log(`====================`);
    console.log(`🚫 Unsyncable (will be skipped): ${totalUnsyncable} items`);
    console.log(`⚠️  Problematic (may cause issues): ${totalProblematic} items`);
    console.log(`✅ Normal (should sync fine): ${totalNormal} items`);
    
    if (totalUnsyncable > 0) {
        console.log(`\n💡 ROOT CAUSE ANALYSIS`);
        console.log(`=====================`);
        console.log(`• Deleted content (state 3): Content was deleted but references remain`);
        console.log(`• Unpublished content (state 7): Content was unpublished but dependencies exist`);
        console.log(`• This explains the SDK mismatch: Content Sync includes all states, Management SDK filters these out`);
        console.log(`• Production sites usually have cleaner referential integrity`);
        console.log(`• Development/staging environments often have content churn leading to broken references`);
    }
    
    console.log(`\n🎯 ARCHITECTURAL IMPLICATIONS`);
    console.log(`===========================`);
    console.log(`• Content Sync SDK: Downloads ALL content regardless of state (includes deleted/unpublished)`);
    console.log(`• Management SDK: Only manages ACTIVE content (filters out deleted/unpublished)`);
    console.log(`• Sync challenges: References to state 3/7 content cannot be resolved during sync`);
    console.log(`• This explains why 100% syncs have been historically difficult to achieve`);
}

function getSyncImpactLabel(impact) {
    switch (impact) {
        case 'normal': return '✅ Normal (will sync)';
        case 'problematic': return '⚠️  Problematic (may fail)';
        case 'unsyncable': return '🚫 Unsyncable (will be skipped)';
        case 'pending': return '⏳ Pending (workflow dependent)';
        default: return '❓ Unknown';
    }
}

analyzeContentStates().catch(console.error); 