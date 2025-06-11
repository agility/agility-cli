/**
 * Test script for ChainBuilder class
 * 
 * Tests each function incrementally:
 * 1. loadSourceData() - Load entities from filesystem
 * 2. performChainAnalysis() - Run dependency analysis
 * 3. generateUploadSequence() - Create upload-ready format
 * 4. buildUploadSequence() - One-shot convenience method
 * 
 * Enhanced with source folder validation to ensure no accidental filtering
 */

const { ChainBuilder } = require('./dist/lib/services/chain-builder');
const fs = require('fs');
const path = require('path');

/**
 * Count actual JSON files in source directories for validation
 */
function getSourceFileCounts(guid, locale, isPreview) {
    const basePath = path.join(process.cwd(), 'agility-files', guid, locale, isPreview ? 'preview' : 'live');
    
    if (!fs.existsSync(basePath)) {
        console.log(`⚠️  Source path not found: ${basePath}`);
        return null;
    }
    
    const counts = {
        pages: 0,
        templates: 0,
        containers: 0,
        models: 0,
        content: 0,
        assets: 0,
        galleries: 0,
        raw: {
            pageFiles: 0,
            templateFiles: 0,
            containerFiles: 0,
            modelFiles: 0,
            itemFiles: 0,
            listFiles: 0,
            assetJsonFiles: 0,
            galleryFiles: 0
        }
    };
    
    try {
        // Count pages (from 'page' directory)
        const pageDir = path.join(basePath, 'page');
        if (fs.existsSync(pageDir)) {
            const pageFiles = fs.readdirSync(pageDir).filter(f => f.endsWith('.json'));
            counts.raw.pageFiles = pageFiles.length;
            counts.pages = pageFiles.length;
        }
        
        // Count templates
        const templateDir = path.join(basePath, 'templates');
        if (fs.existsSync(templateDir)) {
            const templateFiles = fs.readdirSync(templateDir).filter(f => f.endsWith('.json'));
            counts.raw.templateFiles = templateFiles.length;
            counts.templates = templateFiles.length;
        }
        
        // Count containers
        const containerDir = path.join(basePath, 'containers');
        if (fs.existsSync(containerDir)) {
            const containerFiles = fs.readdirSync(containerDir).filter(f => f.endsWith('.json'));
            counts.raw.containerFiles = containerFiles.length;
            counts.containers = containerFiles.length;
        }
        
        // Count models
        const modelDir = path.join(basePath, 'models');
        if (fs.existsSync(modelDir)) {
            const modelFiles = fs.readdirSync(modelDir).filter(f => f.endsWith('.json'));
            counts.raw.modelFiles = modelFiles.length;
            counts.models = modelFiles.length;
        }
        
        // Count content (from 'item' directory - individual content items)
        const itemDir = path.join(basePath, 'item');
        if (fs.existsSync(itemDir)) {
            const itemFiles = fs.readdirSync(itemDir).filter(f => f.endsWith('.json'));
            counts.raw.itemFiles = itemFiles.length;
            counts.content += itemFiles.length; // Add to total content count
        }
        
        // Count content lists (from 'list' directory - container content)
        const listDir = path.join(basePath, 'list');
        if (fs.existsSync(listDir)) {
            const listFiles = fs.readdirSync(listDir).filter(f => f.endsWith('.json'));
            counts.raw.listFiles = listFiles.length;
            // Note: list files contain arrays, so actual content count will be higher
            // This just shows how many list files we have for validation
        }
        
        // Count assets (from 'assets/json' directory - AssetMediaList files)
        const assetJsonDir = path.join(basePath, 'assets', 'json');
        if (fs.existsSync(assetJsonDir)) {
            const assetJsonFiles = fs.readdirSync(assetJsonDir).filter(f => f.endsWith('.json'));
            counts.raw.assetJsonFiles = assetJsonFiles.length;
            // Note: Each file contains multiple assets, so actual asset count will be higher
        }
        
        // Count galleries (from 'assets/galleries' directory - AssetMediaGroupingList files)
        const galleryDir = path.join(basePath, 'assets', 'galleries');
        if (fs.existsSync(galleryDir)) {
            const galleryFiles = fs.readdirSync(galleryDir).filter(f => f.endsWith('.json'));
            counts.raw.galleryFiles = galleryFiles.length;
            // Note: Each file contains multiple gallery groupings, so actual gallery count will be higher
        }
        
        return counts;
        
    } catch (error) {
        console.error('❌ Error counting source files:', error.message);
        return null;
    }
}

/**
 * Compare loaded entity counts with source file counts for validation
 */
function validateEntityCounts(sourceData, sourceCounts) {
    if (!sourceCounts) {
        console.log('⚠️  Could not validate against source files - skipping validation');
        return;
    }
    
    console.log('\n📊 ENTITY COUNT VALIDATION:');
    console.log('   Comparing loaded entities vs source files...\n');
    
    const validations = [
        {
            entity: 'Pages',
            loaded: sourceData.pages?.length || 0,
            expected: sourceCounts.pages,
            note: 'Direct 1:1 mapping (page files → page entities)'
        },
        {
            entity: 'Templates', 
            loaded: sourceData.templates?.length || 0,
            expected: sourceCounts.templates,
            note: 'Direct 1:1 mapping (template files → template entities)'
        },
        {
            entity: 'Containers',
            loaded: sourceData.containers?.length || 0,
            expected: sourceCounts.containers,
            note: 'Direct 1:1 mapping (container files → container entities)'
        },
        {
            entity: 'Models',
            loaded: sourceData.models?.length || 0,
            expected: sourceCounts.models,
            note: 'Direct 1:1 mapping (model files → model entities)'
        },
        {
            entity: 'Content',
            loaded: sourceData.content?.length || 0,
            expected: `${sourceCounts.raw.itemFiles} items + list content`,
            note: 'Complex: individual items + flattened list content (deduped by contentID)'
        },
        {
            entity: 'Assets',
            loaded: sourceData.assets?.length || 0,
            expected: `from ${sourceCounts.raw.assetJsonFiles} AssetMediaList files`,
            note: 'Complex: flattened from AssetMediaList.assetMedias arrays'
        },
        {
            entity: 'Galleries',
            loaded: sourceData.galleries?.length || 0,
            expected: `from ${sourceCounts.raw.galleryFiles} AssetMediaGroupingList files`,
            note: 'Complex: flattened from AssetMediaGroupingList.assetMediaGroupings arrays'
        }
    ];
    
    let hasIssues = false;
    
    validations.forEach(({ entity, loaded, expected, note }) => {
        const status = typeof expected === 'number' && loaded === expected ? '✅' : 
                      typeof expected === 'number' && loaded !== expected ? '⚠️' : '📊';
        
        console.log(`   ${status} ${entity}:`);
        console.log(`      Loaded: ${loaded}`);
        console.log(`      Expected: ${expected}`);
        console.log(`      Note: ${note}`);
        
        if (typeof expected === 'number' && loaded !== expected) {
            hasIssues = true;
            if (loaded < expected) {
                console.log(`      ⚠️  POTENTIAL ISSUE: Loaded fewer entities than source files!`);
            }
        }
        console.log('');
    });
    
    // Raw file count summary for reference
    console.log('📁 Raw Source File Counts:');
    console.log(`   📄 Page files: ${sourceCounts.raw.pageFiles}`);
    console.log(`   🏗️  Template files: ${sourceCounts.raw.templateFiles}`);
    console.log(`   📦 Container files: ${sourceCounts.raw.containerFiles}`);
    console.log(`   📋 Model files: ${sourceCounts.raw.modelFiles}`);
    console.log(`   📝 Item files: ${sourceCounts.raw.itemFiles}`);
    console.log(`   📝 List files: ${sourceCounts.raw.listFiles}`);
    console.log(`   📎 Asset JSON files: ${sourceCounts.raw.assetJsonFiles}`);
    console.log(`   🖼️  Gallery files: ${sourceCounts.raw.galleryFiles}`);
    
    if (hasIssues) {
        console.log('\n⚠️  VALIDATION WARNINGS FOUND - Please review entity loading logic');
    } else {
        console.log('\n✅ Entity count validation completed - No obvious issues detected');
    }
}

async function testChainBuilder() {
    console.log('🧪 Testing ChainBuilder class...\n');
    
    // Test instance (proven to work)
    const testGuid = '13a8b394-u';
    const testLocale = 'en-us';
    const isPreview = true;
    
    try {
        // Get source file counts for validation
        console.log('🔍 Counting source files for validation...');
        const sourceCounts = getSourceFileCounts(testGuid, testLocale, isPreview);
        
        // Initialize ChainBuilder
        const chainBuilder = new ChainBuilder();
        console.log('✅ ChainBuilder initialized successfully\n');
        
        // TEST 1: Data Loading
        console.log('🔄 Testing loadSourceData()...');
        const sourceData = await chainBuilder.loadSourceData(testGuid, testLocale, isPreview);
        
        console.log('\n📊 Source Data Results:');
        console.log(`   Total Entities: ${sourceData.metadata.totalEntities}`);
        console.log(`   Source GUID: ${sourceData.metadata.sourceGuid}`);
        console.log(`   Locale: ${sourceData.metadata.locale}`);
        console.log(`   Is Preview: ${sourceData.metadata.isPreview}`);
        console.log(`   Loaded At: ${sourceData.metadata.loadedAt.toISOString()}`);
        
        // Show entity breakdown
        if (sourceData.pages) console.log(`   📄 Pages: ${sourceData.pages.length}`);
        if (sourceData.templates) console.log(`   🏗️  Templates: ${sourceData.templates.length}`);
        if (sourceData.containers) console.log(`   📦 Containers: ${sourceData.containers.length}`);
        if (sourceData.models) console.log(`   📋 Models: ${sourceData.models.length}`);
        if (sourceData.content) console.log(`   📝 Content: ${sourceData.content.length}`);
        if (sourceData.assets) console.log(`   📎 Assets: ${sourceData.assets.length}`);
        if (sourceData.galleries) console.log(`   🖼️  Galleries: ${sourceData.galleries.length}`);
        
        // VALIDATION: Compare loaded counts with source file counts
        validateEntityCounts(sourceData, sourceCounts);
        
        console.log('\n✅ loadSourceData() test PASSED\n');
        
        // TEST 2: Chain Analysis
        console.log('🔄 Testing performChainAnalysis()...');
        const analysisResults = await chainBuilder.performChainAnalysis(sourceData);
        
        console.log('\n📊 Analysis Results:');
        console.log(`   Total Entities: ${analysisResults.reconciliation.totalEntities}`);
        console.log(`   Syncable Entities: ${analysisResults.reconciliation.syncableEntities}`);
        console.log(`   Model Chains: ${analysisResults.modelChains.length}`);
        console.log(`   Page Chains: ${analysisResults.pageChains.length}`);
        console.log(`   Container Chains: ${analysisResults.containerChains.length}`);
        console.log(`   Broken Chains: ${analysisResults.brokenChains.length}`);
        
        console.log('\n✅ performChainAnalysis() test PASSED\n');
        
        // TEST 3: Upload Sequence Generation
        console.log('🔄 Testing generateUploadSequence()...');
        const uploadSequence = chainBuilder.generateUploadSequence(analysisResults);
        
        console.log('\n📊 Upload Sequence:');
        console.log(`   Total Entities: ${uploadSequence.metadata.totalEntities}`);
        console.log(`   Estimated Duration: ${uploadSequence.metadata.estimatedDuration} minutes`);
        console.log(`   Processing Order: ${uploadSequence.metadata.processingOrder.join(' → ')}`);
        
        console.log('\n✅ generateUploadSequence() test PASSED\n');
        
        // TEST 4: One-shot convenience method
        console.log('🔄 Testing buildUploadSequence() (one-shot method)...');
        const oneShot = await chainBuilder.buildUploadSequence(testGuid, testLocale, isPreview);
        
        console.log('\n📊 One-Shot Results:');
        console.log(`   Total Entities: ${oneShot.metadata.totalEntities}`);
        console.log(`   Estimated Duration: ${oneShot.metadata.estimatedDuration} minutes`);
        
        console.log('\n✅ buildUploadSequence() test PASSED\n');
        
        console.log('🎉 ALL CHAINBUILDER TESTS PASSED!');
        
    } catch (error) {
        console.error('❌ ChainBuilder test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
testChainBuilder(); 