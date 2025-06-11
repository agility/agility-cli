const fs = require('fs');
const path = require('path');

// Our test-container-id-discovery.js showed:
// - 1,046 unique container IDs referenced in content  
// - 356 containers downloaded
// - 768 containers missing (1,046 - 356 = 690, but our test showed 768)

console.log('🔍 Analyzing container discovery method effectiveness...');

// Load the pull log to see what discovery methods found
const logPath = 'agility-files/67bc73e6-u/en-us/preview/logs';
if (fs.existsSync(logPath)) {
    const logFiles = fs.readdirSync(logPath).filter(f => f.includes('pull-'));
    const latestLog = logFiles.sort().pop();
    
    if (latestLog) {
        console.log(`📋 Analyzing latest pull log: ${latestLog}`);
        const logContent = fs.readFileSync(path.join(logPath, latestLog), 'utf8');
        
        // Extract key metrics from log
        const metrics = {
            getContainerList: 0,
            modelBased: 0,
            contentBased: 0,
            totalDiscovered: 0,
            actualDownloaded: 0,
            errors: 0
        };
        
        // Parse log for container discovery info
        const lines = logContent.split('\n');
        for (const line of lines) {
            if (line.includes('Standard getContainerList found:')) {
                const match = line.match(/(\d+) containers/);
                if (match) metrics.getContainerList = parseInt(match[1]);
            }
            
            if (line.includes('Model-based discovery complete:')) {
                const match = line.match(/(\d+) containers/);
                if (match) metrics.modelBased = parseInt(match[1]);
            }
            
            if (line.includes('Content-based discovery:')) {
                const match = line.match(/(\d+) containers retrieved/);
                if (match) metrics.contentBased = parseInt(match[1]);
            }
            
            if (line.includes('Total containers discovered:')) {
                const match = line.match(/(\d+)/);
                if (match) metrics.totalDiscovered = parseInt(match[1]);
            }
            
            if (line.includes('Downloaded') && line.includes('containers')) {
                const match = line.match(/Downloaded (\d+) containers/);
                if (match) metrics.actualDownloaded = parseInt(match[1]);
            }
            
            if (line.includes('errors')) {
                const match = line.match(/(\d+) errors/);
                if (match) metrics.errors = parseInt(match[1]);
            }
        }
        
        console.log('\n📊 DISCOVERY METHOD BREAKDOWN:');
        console.log(`   🔍 getContainerList(): ${metrics.getContainerList} containers`);
        console.log(`   🏗️  Model-based discovery: ${metrics.modelBased} containers`);
        console.log(`   📋 Content-based discovery: ${metrics.contentBased} containers found`);
        console.log(`   🎯 Total discovered: ${metrics.totalDiscovered} containers`);
        console.log(`   ✅ Actually downloaded: ${metrics.actualDownloaded} containers`);
        console.log(`   ❌ Download errors: ${metrics.errors} errors`);
        
        const additionalFromModels = metrics.modelBased - metrics.getContainerList;
        const discoveryVsDownload = metrics.totalDiscovered - metrics.actualDownloaded;
        
        console.log('\n🧮 CALCULATION BREAKDOWN:');
        console.log(`   Additional from models: ${additionalFromModels} containers`);
        console.log(`   Discovery vs Download gap: ${discoveryVsDownload} containers`);
        console.log(`   Content-based success rate: ${metrics.contentBased}/1046 = ${((metrics.contentBased/1046)*100).toFixed(1)}%`);
        
        if (metrics.contentBased < 100) {
            const failedContentBased = 1046 - metrics.contentBased;
            console.log(`   Content-based failures: ${failedContentBased} containers (${((failedContentBased/1046)*100).toFixed(1)}%)`);
        }
    }
}

// Let's also check what we know about getContainersByModel effectiveness
console.log('\n🏗️  MODEL-BASED DISCOVERY ANALYSIS:');

// Load models to see how many we have
const modelsPath = 'agility-files/67bc73e6-u/en-us/preview/models';
if (fs.existsSync(modelsPath)) {
    const modelFiles = fs.readdirSync(modelsPath).filter(f => f.endsWith('.json'));
    console.log(`   📋 Total models available: ${modelFiles.length}`);
    
    // Check if we can find any patterns in missing container IDs
    console.log('\n🔍 MISSING CONTAINER ANALYSIS:');
    
    // From our previous test, we know these ranges are problematic:
    const containerRanges = {
        'Low IDs (1-361)': { min: 1, max: 361, downloaded: 0, missing: 0 },
        'Mid IDs (362-500)': { min: 362, max: 500, downloaded: 0, missing: 0 },
        'High IDs (501-1000)': { min: 501, max: 1000, downloaded: 0, missing: 0 },
        'Very High IDs (1001+)': { min: 1001, max: 9999, downloaded: 0, missing: 0 }
    };
    
    // Load downloaded container IDs
    const containerPath = 'agility-files/67bc73e6-u/en-us/preview/containers';
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
    
    // From our content analysis, we know these container IDs are referenced
    const referencedIds = [362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 376, 377, 378, 379, 380, 381, 382, 385, 386, 388, 389, 390, 391, 392, 393, 394, 395, 396, 397, 398, 399, 400, 401, 405, 406, 407, 408, 409, 410, 411, 412]; // subset for analysis
    
    console.log('   🎯 Sample missing container analysis:');
    let sampleMissing = 0;
    for (const id of referencedIds) {
        const isDownloaded = downloadedIds.has(id);
        if (!isDownloaded) {
            sampleMissing++;
            if (sampleMissing <= 10) {
                console.log(`      ContainerID:${id} - Referenced in content but not downloaded`);
            }
        }
    }
    
    console.log(`   📊 Sample missing count: ${sampleMissing}/${referencedIds.length} containers`);
    
} else {
    console.log('   ❌ Models directory not found');
}

console.log('\n🎯 RECOMMENDATIONS:');
console.log('1. Check if getContainersByModel() is finding additional containers');
console.log('2. Improve error handling in content-based discovery to see why 768+ containers fail');
console.log('3. Consider if some missing containers are legitimately deleted/archived');
console.log('4. Look into whether getContainerList() has pagination parameters'); 