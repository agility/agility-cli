# Agility CMS Management SDK - Payload Structure Documentation

This document provides comprehensive payload structure requirements for the Agility Management SDK based on analysis of working pusher implementations and the official SDK.

---

## 🔑 **Key Principles**

### **ID Management Rules**
- **New Entity Creation**: Always use `id: -1` or `id: 0` 
- **Entity Updates**: Use existing entity ID from target instance
- **Field IDs**: Remove `fieldID` and `itemOrder` from field definitions

### **Payload Preparation**
- **Remove Metadata**: Strip `lastModifiedDate`, `lastModifiedBy`, `lastModifiedAuthorID`
- **Clean Settings**: Remove empty string values from field settings
- **Normalize Fields**: Sort fields by name for consistent comparison

---

## 📋 **Entity Payload Structures**

## **1. Model Payloads**

### **Create Model Payload**
```typescript
interface ModelCreatePayload {
  id: 0;                           // ALWAYS 0 for creation
  referenceName: string;           // Unique identifier
  displayName: string;             // Human readable name
  contentDefinitionTypeID: 0 | 1;  // 0=Module, 1=Page
  fields: ModelField[];            // Field definitions (see below)
  // Remove these properties for creation:
  // lastModifiedDate, lastModifiedBy, lastModifiedAuthorID
}
```

### **Update Model Payload**
```typescript
interface ModelUpdatePayload {
  id: number;                      // Existing target model ID
  referenceName: string;           // Keep original reference name
  displayName: string;             
  contentDefinitionTypeID: 0 | 1;  
  fields: ModelField[];
  // Remove metadata properties
}
```

### **Model Field Structure**
```typescript
interface ModelField {
  name: string;                    // Field identifier
  label?: string;                  // Display label
  type: string;                    // 'Text' | 'Content' | 'Boolean' | 'ImageAttachment' | etc.
  settings: { [key: string]: any }; // Field-specific settings (cleaned)
  // Remove these for creation/update:
  // fieldID, itemOrder
}
```

### **Field Settings Cleaning**
```typescript
// Remove empty string values from settings
function cleanFieldSettings(fields: ModelField[]): ModelField[] {
  return fields.map(field => ({
    ...field,
    settings: Object.fromEntries(
      Object.entries(field.settings || {}).filter(([, value]) => value !== "")
    )
  }));
}
```

---

## **2. Content Item Payloads**

### **Content Item Payload Structure**
```typescript
interface ContentItemPayload {
  contentID: number;               // -1 for new, existing ID for update
  properties: {
    definitionName: string;        // References Model.referenceName
    referenceName: string;         // References Container.referenceName
    itemOrder?: number;            // Order within container
  };
  fields: { [key: string]: any };  // Dynamic fields based on model
  seo?: SeoProperties;             // SEO metadata
  scripts?: ContentScripts;        // Custom scripts
}
```

### **Default SEO and Scripts**
```typescript
const defaultSeo: mgmtApi.SeoProperties = { 
  metaDescription: null, 
  metaKeywords: null, 
  metaHTML: null, 
  menuVisible: null, 
  sitemapVisible: null 
};

const defaultScripts: mgmtApi.ContentScripts = { 
  top: null, 
  bottom: null 
};
```

### **Content Field Mapping**
- Content fields must match the model's field definitions
- Asset references use URLs that need mapping between instances
- Nested content references use `contentid` (lowercase)
- All field values must match the expected type from the model

---

## **3. Container Payloads**

### **Container Payload Structure**
```typescript
interface ContainerPayload {
  contentViewID: number;           // -1 for new, existing ID for update
  referenceName: string;           // Unique identifier
  contentDefinitionID: number;     // References Model.id (target instance)
  contentViewName?: string;        // Display name
  contentDefinitionType?: number;
  contentDefinitionTypeID?: number;
}
```

### **Container Creation Requirements**
- Must reference a valid model ID in the target instance
- Model must exist before container creation
- Container reference names may be modified by Agility (hash suffix)

---

## **4. Template Payloads**

### **Template Payload Structure**
```typescript
interface TemplatePayload {
  pageTemplateID: number;          // -1 for new, existing ID for update
  pageTemplateName: string;        // Template identifier
  contentSectionDefinitions: ContentSectionDefinition[];
}

interface ContentSectionDefinition {
  pageItemTemplateID: -1;          // Always -1 for creation
  pageTemplateID: -1;              // Always -1 for creation
  contentViewID: 0;                // Default value
  contentReferenceName?: string;   // Container reference
  contentDefinitionID?: number;    // Model ID reference
  itemContainerID?: number;        // Container ID reference
  publishContentItemID?: number;   // Content reference
}
```

### **Template Creation Flow**
1. **Pass 1**: Create template shell with basic metadata
2. **Pass 2**: Update with full content section definitions after containers exist

---

## **5. Page Payloads**

### **Page Payload Structure**
```typescript
interface PagePayload {
  pageID: number;                  // -1 for new, existing ID for update
  name: string;                    // Page display name
  pageTemplateID?: number;         // Template reference (null for folder pages)
  channelID: number;               // Channel identifier
  parentPageID?: number;           // Parent page (-1 for root)
  zones?: { [zoneName: string]: ZoneContent[] }; // Zone content
  scripts?: {
    top: string;
    bottom: string;
    excludedFromGlobal: boolean;
  };
  visible?: {
    menu: boolean;
    sitemap: boolean;
  };
}

interface ZoneContent {
  item?: {
    contentid: number;             // Content reference (lowercase!)
  };
}
```

### **Page Creation Dependencies**
- Templates must exist before page creation
- Content must exist before zone population
- Parent pages must be created before child pages

---

## **6. Asset Payloads**

### **Asset Upload Structure**
```typescript
// For file upload
const FormData = require("form-data");
const form = new FormData();
form.append('files', fileBuffer, fileName);

const uploadResponse = await apiClient.assetMethods.upload(
  form, 
  folderPath, 
  targetGuid, 
  galleryId  // -1 for no gallery
);
```

### **Asset URL-Based Creation**
```typescript
interface AssetPayload {
  mediaID: number;                 // -1 for new
  fileName: string;                // File name
  originUrl: string;               // Source URL
  mediaGroupingID?: number;        // Gallery reference
  uploadMethod: 'url-reference';   // For URL-based assets
}
```

---

## **7. Gallery Payloads**

### **Gallery Payload Structure**
```typescript
interface GalleryPayload {
  mediaGroupingID: number;         // -1 for new
  name: string;                    // Gallery name
  desc?: string;                   // Description
}
```

---

## 🔧 **Common API Call Patterns**

### **Model Operations**
```typescript
// Get existing model
const existingModel = await apiClient.modelMethods.getModelByReferenceName(
  modelReferenceName, 
  targetGuid
);

// Create/Update model
const savedModel = await apiClient.modelMethods.saveModel(
  modelPayload, 
  targetGuid
);
```

### **Content Operations**
```typescript
// Save content item
const contentId = await apiClient.contentMethods.saveContentItem(
  contentPayload, 
  targetGuid, 
  locale
);
```

### **Container Operations**
```typescript
// Get container by reference name
const existingContainer = await apiClient.containerMethods.getContainerByReferenceName(
  containerReferenceName, 
  targetGuid
);

// Save container
const savedContainer = await apiClient.containerMethods.saveContainer(
  containerPayload, 
  targetGuid, 
  forceReferenceName  // Optional: force specific reference name
);
```

### **Template Operations**
```typescript
// Get template by name
const existingTemplate = await apiClient.pageMethods.getPageTemplateName(
  targetGuid, 
  locale, 
  templateName
);

// Save template
const savedTemplate = await apiClient.pageMethods.savePageTemplate(
  targetGuid, 
  locale, 
  templatePayload
);
```

### **Page Operations**
```typescript
// Save page
const pageResponse = await apiClient.pageMethods.savePage(
  pagePayload, 
  targetGuid, 
  locale, 
  parentPageId,      // Parent page ID
  placeBeforePageId  // Sibling positioning
);
```

---

## ⚠️ **Common Validation Failures**

### **Model Creation Failures**
- Missing required field definitions
- Invalid field types or settings
- Circular references without proper 2-pass handling
- Non-unique reference names

### **Content Creation Failures**
- Fields don't match model definition
- Invalid asset URL references
- Missing required fields based on model
- Content references that don't exist

### **Template Creation Failures**
- Invalid content section definitions
- References to non-existent containers or models
- Missing zone definitions

### **Container Creation Failures**
- References to non-existent models
- Invalid content definition IDs

---

## 🎯 **Best Practices**

### **Dependency Order**
1. **Models** (content definitions)
2. **Galleries** (if assets need them)
3. **Assets** (files and media)
4. **Containers** (content lists)
5. **Content Items** (actual content)
6. **Templates** (page layouts)
7. **Pages** (site structure)

### **2-Pass Strategy**
- **Pass 1**: Create entity stubs with minimal data
- **Pass 2**: Update entities with full relationships after dependencies exist

### **Error Handling**
- Always check for 404 errors (entity not found) vs validation errors
- Log detailed API response data for debugging
- Implement retry logic for transient failures

### **ID Mapping**
- Track source → target ID mappings for reference resolution
- Use ReferenceMapper or similar mapping system
- Update references during Pass 2 with mapped IDs

---

## 📚 **Reference Examples**

### **Working Model Creation**
```typescript
const modelPayload = {
  id: 0,
  referenceName: "ArticleModel",
  displayName: "Article Model",
  contentDefinitionTypeID: 0,
  fields: [
    {
      name: "title",
      label: "Title",
      type: "Text",
      settings: {
        DefaultValue: "",
        Required: true
      }
    },
    {
      name: "content",
      label: "Content",
      type: "HTML",
      settings: {
        DefaultValue: "",
        Required: false
      }
    }
  ]
};
```

### **Working Content Creation**
```typescript
const contentPayload = {
  contentID: -1,
  properties: {
    definitionName: "ArticleModel",
    referenceName: "articles-container",
    itemOrder: 1
  },
  fields: {
    title: "Sample Article Title",
    content: "<p>Sample article content</p>"
  },
  seo: defaultSeo,
  scripts: defaultScripts
};
```

This documentation provides the foundation for creating valid payloads that the Management SDK will accept, based on analysis of working pusher implementations. 