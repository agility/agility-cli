/**
 * Debug script to examine sourceData structure
 * 
 * This debug script inspects the exact structure of sourceData to understand
 * why content and galleries are not being mapped properly.
 */

const { ChainBuilder } = require('./dist/lib/services/chain-builder');

async function debugSourceDataStructure() {
    console.log('🔍 Debugging Source Data Structure\n');
    
    const chainBuilder = new ChainBuilder();
    const guid = '13a8b394-u';
    const locale = 'en-us';
    const isPreview = true;

    try {
        console.log('Loading source data...');
        const sourceData = await chainBuilder.loadSourceData(guid, locale, isPreview);
        
        console.log('\n📊 SOURCE DATA STRUCTURE ANALYSIS');
        console.log('=' .repeat(60));
        
        // Check what properties exist on sourceData
        console.log('\n🔑 Available properties on sourceData:');
        Object.keys(sourceData).forEach(key => {
            const value = sourceData[key];
            if (Array.isArray(value)) {
                console.log(`  ${key}: Array[${value.length}]`);
            } else if (typeof value === 'object' && value !== null) {
                console.log(`  ${key}: Object with keys: ${Object.keys(value).join(', ')}`);
            } else {
                console.log(`  ${key}: ${typeof value} = ${value}`);
            }
        });
        
        // Detailed analysis of problematic arrays
        console.log('\n🔍 DETAILED CONTENT ANALYSIS');
        console.log('-' .repeat(40));
        
        if (sourceData.content && Array.isArray(sourceData.content)) {
            console.log(`✅ content array exists with ${sourceData.content.length} items`);
            
            if (sourceData.content.length > 0) {
                const firstContent = sourceData.content[0];
                console.log('\n📝 First content item structure:');
                console.log(JSON.stringify(firstContent, null, 2));
                
                console.log('\n🔑 Content ID fields check:');
                console.log(`  contentID: ${firstContent.contentID}`);
                console.log(`  contentId: ${firstContent.contentId}`);
                console.log(`  id: ${firstContent.id}`);
                console.log(`  properties?.contentID: ${firstContent.properties?.contentID}`);
                console.log(`  properties?.contentId: ${firstContent.properties?.contentId}`);
            }
        } else {
            console.log('❌ content array missing or not an array');
            console.log(`   Type: ${typeof sourceData.content}`);
            console.log(`   Value: ${sourceData.content}`);
        }
        
        console.log('\n🔍 DETAILED GALLERIES ANALYSIS');
        console.log('-' .repeat(40));
        
        if (sourceData.galleries && Array.isArray(sourceData.galleries)) {
            console.log(`✅ galleries array exists with ${sourceData.galleries.length} items`);
            
            if (sourceData.galleries.length > 0) {
                const firstGallery = sourceData.galleries[0];
                console.log('\n🖼️ First gallery item structure:');
                console.log(JSON.stringify(firstGallery, null, 2));
                
                console.log('\n🔑 Gallery ID fields check:');
                console.log(`  mediaGroupingID: ${firstGallery.mediaGroupingID}`);
                console.log(`  id: ${firstGallery.id}`);
                console.log(`  galleryId: ${firstGallery.galleryId}`);
            }
        } else {
            console.log('❌ galleries array missing or not an array');
            console.log(`   Type: ${typeof sourceData.galleries}`);
            console.log(`   Value: ${sourceData.galleries}`);
        }
        
        // Check if content is actually nested somewhere else
        console.log('\n🔍 SEARCHING FOR CONTENT IN OTHER LOCATIONS');
        console.log('-' .repeat(50));
        
        function searchForContent(obj, path = '') {
            if (typeof obj !== 'object' || obj === null) return;
            
            Object.keys(obj).forEach(key => {
                const value = obj[key];
                const currentPath = path ? `${path}.${key}` : key;
                
                if (Array.isArray(value) && value.length > 0) {
                    // Check if this looks like content array
                    const firstItem = value[0];
                    if (firstItem && (firstItem.contentID || firstItem.contentId || firstItem.properties)) {
                        console.log(`📝 Found potential content at: ${currentPath} (${value.length} items)`);
                        console.log(`   Sample item keys: ${Object.keys(firstItem).slice(0, 5).join(', ')}`);
                    }
                    
                    // Check if this looks like galleries array  
                    if (firstItem && (firstItem.mediaGroupingID || firstItem.galleryId)) {
                        console.log(`🖼️ Found potential galleries at: ${currentPath} (${value.length} items)`);
                        console.log(`   Sample item keys: ${Object.keys(firstItem).slice(0, 5).join(', ')}`);
                    }
                }
                
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    searchForContent(value, currentPath);
                }
            });
        }
        
        searchForContent(sourceData);
        
        return sourceData;
        
    } catch (error) {
        console.error('❌ Debug failed:', error.message);
        throw error;
    }
}

// Run the debug
debugSourceDataStructure()
    .then(() => {
        console.log('\n✅ Debug completed!');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Debug failed:', error);
        process.exit(1);
    }); 