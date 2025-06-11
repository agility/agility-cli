const fs = require('fs');

async function testPageCreation() {
    console.log('🔄 Testing simple page creation using legacy pattern...');
    
    // Read source page data
    const pageData = JSON.parse(fs.readFileSync('agility-files/13a8b394-u/en-us/preview/pages/2.json', 'utf8'));
    console.log('📄 Source page:', pageData.name);
    
    // Read template data 
    const templateData = JSON.parse(fs.readFileSync('agility-files/13a8b394-u/en-us/preview/templates/2.json', 'utf8'));
    console.log('🎨 Template:', templateData.pageTemplateName);
    
    // Legacy pattern transformation (exactly like push_legacy.ts line 404-406)
    const pagePayload = {
        ...pageData,
        pageID: -1,        // Key insight: -1 means "create new"
        channelID: -1,     // Key insight: -1 means "default channel"
        parentPageID: pageData.parentPageID  // Keep parent structure
    };
    
    // Remove zones with content references for now (focus on bare page creation)
    pagePayload.zones = {};
    
    console.log('📤 Page payload for creation:');
    console.log(JSON.stringify({
        pageID: pagePayload.pageID,
        name: pagePayload.name,
        templateName: pagePayload.templateName,
        channelID: pagePayload.channelID,
        parentPageID: pagePayload.parentPageID,
        path: pagePayload.path,
        title: pagePayload.title,
        zones: pagePayload.zones
    }, null, 2));
    
    console.log('\n🔍 Key observations:');
    console.log('1. pageID: -1 indicates new page creation');
    console.log('2. channelID: -1 lets Agility assign default channel');
    console.log('3. Empty zones {} should work for basic page shell');
    console.log('4. templateName must match existing template on target');
    
    return pagePayload;
}

testPageCreation().catch(console.error); 