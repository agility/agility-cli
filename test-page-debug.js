const fs = require('fs');

async function debugPageCreation() {
    console.log('🔍 Analyzing differences between legacy (97% success) vs current (0% success) patterns...\n');
    
    // Read source page data
    const pageData = JSON.parse(fs.readFileSync('agility-files/13a8b394-u/en-us/preview/pages/2.json', 'utf8'));
    
    console.log('🔍 LEGACY PATTERN (from push_legacy.ts line 404-406):');
    const legacyPayload = {
        ...pageData,
        pageID: -1,        // ✅ Set to -1 for new pages  
        channelID: -1,     // ✅ Set to -1 to let API assign default
        parentPageID: pageData.parentPageID,  // ✅ Keep original (or map for child pages)
        zones: pageData.zones  // ✅ Keep zones AS-IS for content mapping
    };
    
    console.log('✅ Legacy payload structure:');
    console.log(JSON.stringify({
        pageID: legacyPayload.pageID,
        name: legacyPayload.name,
        templateName: legacyPayload.templateName,
        channelID: legacyPayload.channelID,
        title: legacyPayload.title,
        parentPageID: legacyPayload.parentPageID,
        zones: Object.keys(legacyPayload.zones || {}),
        zoneContent: legacyPayload.zones
    }, null, 2));
    
    console.log('\n🚨 CURRENT FAILING PATTERN ISSUES:');
    console.log('1. ❌ Complex zone translation logic instead of simple content ID mapping');
    console.log('2. ❌ channelID discovery instead of using -1');
    console.log('3. ❌ pageTemplateID lookup instead of using templateName');
    console.log('4. ❌ Complex payload cleanup instead of simple property setting');
    console.log('5. ❌ Batch polling instead of simple response handling');
    
    console.log('\n🎯 KEY INSIGHTS FROM LEGACY CODE:');
    console.log('✅ Legacy just sets pageID = -1, channelID = -1');
    console.log('✅ Legacy maps content IDs in zones by direct replacement');
    console.log('✅ Legacy uses simple API call: savePage(page, guid, locale, parentPageID, -1)');
    console.log('✅ Legacy handles response as simple array [pageID] or batch object');
    
    console.log('\n🔧 EXACT LEGACY ZONE MAPPING PATTERN:');
    console.log('```javascript');
    console.log('if(zone[z].item.contentId && processedContentIds[zone[z].item.contentId]) {');
    console.log('    zone[z].item.contentId = processedContentIds[zone[z].item.contentId];');
    console.log('}');
    console.log('```');
    
    console.log('\n📊 SIMPLIFIED DEBUG PAYLOAD (what legacy would send):');
    
    // Mock some content mappings
    const mockContentMappings = {
        10086: 99901,  // PromoBanner
        10101: 99902,  // WinningNumbersCarousel
        10082: 99903,  // eInstants
        10075: 99904,  // PromoBanner
        10089: 99905   // EinstantRecentWinners
    };
    
    // Apply legacy zone mapping
    const mappedZones = JSON.parse(JSON.stringify(legacyPayload.zones));
    if (mappedZones && mappedZones.MainContentZone) {
        mappedZones.MainContentZone.forEach(zoneItem => {
            const sourceContentId = zoneItem.item.contentId;
            if (sourceContentId && mockContentMappings[sourceContentId]) {
                zoneItem.item.contentId = mockContentMappings[sourceContentId];
                console.log(`  📍 Mapped: ${sourceContentId} -> ${mockContentMappings[sourceContentId]}`);
            }
        });
    }
    
    const finalLegacyPayload = {
        ...legacyPayload,
        zones: mappedZones
    };
    
    console.log('\n📤 FINAL LEGACY PAYLOAD (ready for API):');
    console.log(JSON.stringify({
        pageID: finalLegacyPayload.pageID,
        name: finalLegacyPayload.name,
        templateName: finalLegacyPayload.templateName,
        channelID: finalLegacyPayload.channelID,
        title: finalLegacyPayload.title,
        zones: finalLegacyPayload.zones
    }, null, 2));
    
    console.log('\n🎯 THIS SHOULD BE THE EXACT PATTERN THAT WORKED AT 97% SUCCESS!');
}

debugPageCreation().catch(console.error); 