/**
 * Test Asset Discovery System
 * 
 * Tests the AssetFilesystemScanner to find assets in filesystem that aren't in JSON metadata.
 * This should help identify where our 7 missing entities might be coming from.
 */

const { AssetFilesystemScanner } = require('./dist/lib/services/asset-filesystem-scanner');
const { ChainBuilder } = require('./dist/lib/services/chain-builder');

async function testAssetDiscovery() {
    console.log('🧪 Testing Asset Discovery System\n');
    
    const chainBuilder = new ChainBuilder();
    const scanner = new AssetFilesystemScanner();
    const guid = '13a8b394-u';
    const locale = 'en-us';
    const isPreview = true;

    try {
        // Step 1: Load source data to get JSON assets
        console.log('Step 1: Loading source data for JSON asset comparison...');
        const sourceData = await chainBuilder.loadSourceData(guid, locale, isPreview);
        const jsonAssets = sourceData.assets || [];
        console.log(`✅ Loaded ${jsonAssets.length} JSON assets from source data`);

        // Step 2: Run filesystem asset discovery
        console.log('\nStep 2: Running filesystem asset discovery...');
        const basePath = `agility-files/${guid}/${locale}/${isPreview ? 'preview' : 'live'}`;
        const discoveryResult = await scanner.discoverAssets(basePath, jsonAssets);

        // Step 3: Analyze results
        console.log('\n📊 DISCOVERY ANALYSIS');
        console.log('=' .repeat(60));
        console.log(`Total Filesystem Assets: ${discoveryResult.summary.totalFilesystemAssets}`);
        console.log(`Total JSON Assets: ${discoveryResult.summary.totalJsonAssets}`);
        console.log(`Matched Assets: ${discoveryResult.summary.totalMatched}`);
        console.log(`Orphaned Assets: ${discoveryResult.summary.totalOrphaned}`);
        console.log(`Coverage: ${discoveryResult.summary.coveragePercentage.toFixed(1)}%`);

        // Step 4: Show detailed report
        scanner.printDiscoveryReport(discoveryResult);

        // Step 5: Create upload entries for orphaned assets
        if (discoveryResult.orphanedAssets.length > 0) {
            console.log('\n🔧 UPLOAD ENTRY GENERATION');
            console.log('=' .repeat(40));
            const uploadEntries = scanner.createUploadEntries(discoveryResult.orphanedAssets, guid);
            console.log(`✅ Generated ${uploadEntries.length} upload entries for orphaned assets`);
            
            console.log('\n📋 Sample Upload Entry:');
            if (uploadEntries.length > 0) {
                console.log(JSON.stringify(uploadEntries[0], null, 2));
            }
        }

        // Step 6: Identify potential for 100% reconciliation
        console.log('\n🎯 RECONCILIATION POTENTIAL');
        console.log('=' .repeat(40));
        
        const originalTotal = sourceData.metadata.totalEntities;
        const currentUploadable = originalTotal - 7; // We know 7 are missing
        const potentialAdditional = discoveryResult.orphanedAssets.length;
        const potentialTotal = currentUploadable + potentialAdditional;
        
        console.log(`Original Total Entities: ${originalTotal}`);
        console.log(`Current Uploadable: ${currentUploadable} (99.9%)`);
        console.log(`Potential Additional: ${potentialAdditional} orphaned assets`);
        console.log(`Potential New Total: ${potentialTotal}`);
        
        if (potentialAdditional > 0) {
            const newPercentage = (potentialTotal / originalTotal) * 100;
            console.log(`🚀 Potential Inclusion Rate: ${newPercentage.toFixed(1)}%`);
            
            if (potentialAdditional >= 7) {
                console.log('🎉 Orphaned assets could compensate for missing 7 entities!');
            }
        }

        return {
            success: true,
            discoveryResult,
            reconciliationPotential: {
                originalTotal,
                currentUploadable,
                potentialAdditional,
                potentialTotal
            }
        };

    } catch (error) {
        console.error('❌ Asset discovery test failed:', error.message);
        return { success: false, error };
    }
}

async function main() {
    console.log('🧪 Testing Asset Discovery System\n');
    
    const result = await testAssetDiscovery();
    
    if (result.success) {
        console.log('\n🔬 Test completed: SUCCESS');
    } else {
        console.log('\n🔬 Test completed: FAILED');
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
} 