# Payload Documentation Validation

## 🔍 **Comparison: payload.md vs Real Agility Data**

This document compares the payload structures documented in `payload.md` against real data from Agility instances to validate accuracy and identify corrections needed.

---

## ✅ **Validation Results**

### **1. Model Structures - ACCURATE**

**Real Model Example** (from `models/20.json`):
```json
{
  "id": 20,
  "lastModifiedDate": "2021-09-22T13:52:30.137",
  "displayName": "Listed Link",
  "referenceName": "ListedLink", 
  "contentDefinitionTypeID": 1,
  "fields": [
    {
      "name": "Article",
      "label": "Article", 
      "type": "Content",
      "settings": {
        "ContentDefinition": "DocArticle",
        "Required": ""
      },
      "fieldID": "1a08b12d-31e0-4886-ba13-fe17cba4a479",
      "itemOrder": 0
    }
  ]
}
```

**✅ payload.md Accuracy:**
- **ID Management**: Correctly documented `id: 0` for creation
- **Field Cleaning**: Correctly identified need to remove `fieldID`, `itemOrder`, `lastModifiedDate`
- **Settings Cleaning**: Correctly identified need to remove empty string values
- **Field Types**: Correctly documented field type patterns

---

### **2. Content Item Structures - MOSTLY ACCURATE**

**Real Content Example** (from `item/264.json`):
```json
{
  "contentID": 264,
  "properties": {
    "state": 2,
    "modified": "2025-05-26T09:31:28.91",
    "versionID": 9104,
    "referenceName": "developerarticles",
    "definitionName": "DocArticle", 
    "itemOrder": 14
  },
  "fields": {
    "title": "Content Management API",
    "metaTitle": "Content Management API Features & Cases- Agility CMS",
    "content": "{\"blocks\":[...]}",
    "section": {
      "contentid": 255,
      "fulllist": false
    }
  },
  "seo": {
    "metaDescription": "The Content Management API...",
    "metaKeywords": null,
    "metaHTML": null,
    "menuVisible": null,
    "sitemapVisible": false
  }
}
```

**✅ payload.md Accuracy:**
- **contentID**: Correctly documented `-1` for creation
- **properties structure**: Accurately documented
- **fields**: Correctly identified dynamic structure based on model
- **seo**: Correctly documented structure and defaults
- **scripts**: Missing from this example but correctly documented

**🔧 Identified Issues:**
- **Missing properties**: Real data has `state`, `modified`, `versionID` that should be stripped for creation

---

### **3. Container Structures - NEEDS UPDATES** 

**Real Container Example** (from `containers/javascript_RightOrLeftAligne3131CD.json`):
```json
{
  "contentViewID": 120,
  "contentDefinitionID": 20,
  "referenceName": "javascript_RightOrLeftAligne3131CD",
  "contentViewName": "javascript_RightOrLeftAlignedLinks118_ListedLink",
  "contentDefinitionType": 1,
  "requiresApproval": true,
  "lastModifiedDate": "09/22/2021 01:52PM",
  "lastModifiedBy": "James Vidler",
  "isShared": false,
  "isDynamicPageList": false,
  "disablePublishFromList": false,
  "isPublished": true,
  "contentDefinitionTypeID": 1,
  "defaultSortColumn": "itemOrder",
  "defaultSortDirection": "ASC",
  "columns": [...]
}
```

**❌ payload.md Issues:**
- **Missing Fields**: Real containers have many more fields than documented
- **Required Fields**: Need to identify which fields are required vs optional
- **Default Values**: Need to document proper defaults for boolean fields

**🔧 Required Updates:**
```typescript
interface ContainerPayload {
  contentViewID: number;           // -1 for new
  contentDefinitionID: number;     // Model ID reference
  referenceName: string;           // Unique identifier
  contentViewName?: string;        // Display name
  contentDefinitionType?: number;  // Should match model type
  contentDefinitionTypeID?: number; // Should match model type  
  requiresApproval?: boolean;      // Default: true
  isShared?: boolean;              // Default: false
  isDynamicPageList?: boolean;     // Default: false
  disablePublishFromList?: boolean; // Default: false
  isPublished?: boolean;           // Default: true
  defaultSortColumn?: string;      // Default: "itemOrder"
  defaultSortDirection?: string;   // Default: "ASC"
  // Remove for creation: lastModifiedDate, lastModifiedBy
}
```

---

### **4. Template Structures - ACCURATE**

**Real Template Example** (from `templates/3.json`):
```json
{
  "pageTemplateID": 3,
  "pageTemplateName": "With Sidebar Nav Template",
  "contentSectionDefinitions": [
    {
      "pageItemTemplateID": 4,
      "pageTemplateID": 3,
      "pageItemTemplateName": "Sidebar Content Zone",
      "pageItemTemplateReferenceName": "SidebarContentZone",
      "pageItemTemplateType": 0,
      "itemOrder": 1,
      "contentViewID": null,
      "contentReferenceName": null,
      "contentDefinitionID": null
    }
  ]
}
```

**✅ payload.md Accuracy:**
- **Template Structure**: Correctly documented
- **Content Section Definitions**: Accurately captured structure
- **ID Management**: Correctly documented `-1` for creation
- **Zone Structure**: Correctly identified zone-based organization

---

### **5. Page Structures - NEEDS UPDATES**

**Real Page Example** (from `page/2.json`):
```json
{
  "pageID": 2,
  "name": "home",
  "path": null,
  "title": "Docs",
  "menuText": "Docs",
  "pageType": "static",
  "templateName": "Main Template",
  "redirectUrl": "",
  "securePage": false,
  "excludeFromOutputCache": false,
  "visible": {
    "menu": false,
    "sitemap": true
  },
  "seo": {
    "metaDescription": "Use this Agility CMS Docs site...",
    "metaKeywords": "",
    "metaHTML": "",
    "menuVisible": null,
    "sitemapVisible": null
  },
  "scripts": {
    "excludedFromGlobal": false,
    "top": null,
    "bottom": null
  },
  "properties": {
    "state": 1,
    "modified": "2025-01-24T12:27:50.213",
    "versionID": 463
  },
  "zones": {
    "MainContentZone": [
      {
        "module": "HeroCategories",
        "item": {
          "contentid": 80,
          "fulllist": false
        }
      }
    ]
  }
}
```

**🔧 Required Updates:**
```typescript
interface PagePayload {
  pageID: number;                  // -1 for new
  name: string;                    // Page name
  path?: string;                   // URL path (null for auto-generation)
  title?: string;                  // Page title
  menuText?: string;               // Menu display text
  pageType?: string;               // "static" | "folder" | etc.
  templateName?: string;           // Template reference
  redirectUrl?: string;            // Redirect URL (empty for none)
  securePage?: boolean;            // Default: false
  excludeFromOutputCache?: boolean; // Default: false
  visible?: {
    menu: boolean;                 // Show in menu
    sitemap: boolean;              // Show in sitemap
  };
  seo?: SeoProperties;             // SEO metadata
  scripts?: {
    excludedFromGlobal: boolean;   // Default: false
    top: string | null;            // Custom top scripts
    bottom: string | null;         // Custom bottom scripts
  };
  zones?: { [zoneName: string]: ZoneContent[] }; // Zone content
  // Remove for creation: properties (state, modified, versionID)
}

 interface ZoneContent {
   module?: string;                 // Module name (Model+Container combination)
   item?: {
     contentid: number;             // Content reference (lowercase!)
     fulllist?: boolean;            // Default: false (single item vs full list)
   };
 }
```

---

### **6. Gallery Structures - ACCURATE** 

**Real Gallery Example** (from `assets/galleries/1.json`):
```json
{
  "totalCount": 4,
  "assetMediaGroupings": [
    {
      "mediaGroupingID": 5,
      "groupingTypeID": 1,
      "name": "ChangeLog/Screenshots/Fixed Bug...",
      "description": "Gallery for Change Log, Screenshots",
      "modifiedBy": 6,
      "modifiedOn": "2021-09-21T13:05:36.61",
      "isDeleted": false,
      "isFolder": false,
      "metaData": {}
    }
  ]
}
```

**✅ payload.md Accuracy:**
- **Gallery Structure**: Correctly documented basic structure
- **ID Management**: Correctly documented `-1` for creation

**🔧 Additional Context:**
- Real galleries are stored as `assetMediaGroupings` arrays
- Individual gallery items have additional metadata fields

---

## 🚨 **Critical Findings**

### **1. Container Payload Gaps**
The most significant gap is in container payloads - real containers have many more fields than documented.

### **2. Page Payload Complexity**
Real pages have more complex structures with additional fields for navigation, caching, and security.

### **3. Property Stripping Requirements**
Real entities have `properties`, `state`, `modified`, `versionID` fields that must be stripped for creation.

### **4. Zone Content Structure** 
Real zone content uses `module` + `item` structure, where **Module = Model+Container combination** used as page components.

---

## 📋 **Required payload.md Updates**

### **Priority 1: Container Payload Extension**
Add complete container payload structure with all required fields and defaults.

### **Priority 2: Page Payload Extension** 
Add complete page payload structure with navigation, security, and caching options.

### **Priority 3: Property Stripping Documentation**
Document all metadata fields that must be removed during payload preparation.

### **Priority 4: Zone Content Structure**
Update zone content structure to include `module` field alongside `item`.

---

## ✅ **Validation Confidence**

**High Confidence (Accurate):**
- ✅ Model payloads and field structures
- ✅ Content item basic structure and field mapping
- ✅ Template basic structure and content section definitions
- ✅ Gallery basic structure and ID management
- ✅ Asset upload patterns

**Medium Confidence (Minor Updates Needed):**
- 🔧 Content item property stripping
- 🔧 SEO and scripts default values

**Low Confidence (Major Updates Required):**
- ❌ Container payload completeness
- ❌ Page payload completeness  
- ❌ Property stripping comprehensive list

---

## 🎯 **Next Steps**

1. **Update payload.md** with complete container and page structures
2. **Add comprehensive property stripping section**
3. **Test updated payloads** against real API calls
4. **Validate with hybrid test** using corrected structures

This validation confirms that `payload.md` captures the essential patterns correctly but needs extension for complete API compatibility. 