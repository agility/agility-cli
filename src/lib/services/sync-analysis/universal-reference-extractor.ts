import { EntityReference, SourceEntities } from './types';

/**
 * Universal Reference Extractor
 * 
 * Extracts ALL relationship types from ANY entity based on proven patterns from push_legacy.ts
 * Covers: Content→Content, Content→Asset, Content→Gallery, Model→Model, Asset→Gallery
 */
export class UniversalReferenceExtractor {
    
    /**
     * Extract ALL reference types from a single entity
     */
    public extractAllReferences(entity: any, entityType: string, entityId: string | number): EntityReference[] {
        const references: EntityReference[] = [];
        
        switch (entityType) {
            case 'content':
                references.push(...this.extractContentReferences(entity, entityId));
                break;
            case 'model':
                references.push(...this.extractModelReferences(entity, entityId));
                break;
            case 'asset':
                references.push(...this.extractAssetReferences(entity, entityId));
                break;
            case 'container':
                references.push(...this.extractContainerReferences(entity, entityId));
                break;
            case 'template':
                references.push(...this.extractTemplateReferences(entity, entityId));
                break;
            case 'page':
                references.push(...this.extractPageReferences(entity, entityId));
                break;
            case 'gallery':
                references.push(...this.extractGalleryReferences(entity, entityId));
                break;
        }
        
        return references;
    }
    
    /**
     * Extract Content→Content, Content→Asset, Content→Gallery references
     * Based on push_legacy.ts field processing patterns
     */
    private extractContentReferences(contentItem: any, contentId: string | number): EntityReference[] {
        const references: EntityReference[] = [];
        
        if (!contentItem.fields) return references;
        
        // Track what models we need to check for LinkedContentDropdown patterns
        const modelName = contentItem.properties?.definitionName;
        
        // Standard reference scanning (existing patterns)
        this.scanObjectForReferences(contentItem.fields, '', (key, value, path) => {
            // Basic content→content patterns
            if ((key === 'contentid' || key === 'contentID') && typeof value === 'number') {
                references.push({
                    sourceType: 'content',
                    sourceId: contentId,
                    targetType: 'content',
                    targetId: value,
                    fieldPath: path,
                    relationshipType: 'content-to-content-basic'
                });
            }
            
            // Asset references
            if (key === 'url' && typeof value === 'string' && value.includes('cdn.aglty.io')) {
                references.push({
                    sourceType: 'content',
                    sourceId: contentId,
                    targetType: 'asset',
                    targetId: value,
                    fieldPath: path,
                    relationshipType: 'content-to-asset'
                });
            }
        });
        
        // Enhanced: Detect LinkedContentDropdown patterns from legacy push logic
        this.extractLinkedContentDropdownRefs(contentItem.fields, contentId, references);
        
        // CRITICAL: Extract LinkeContentDropdownValueField references from model definitions
        // This requires cross-referencing with model field settings to find the actual field names
        this.extractLinkeContentDropdownValueFieldRefs(contentItem, contentId, references);
        
        return references;
    }
    
    /**
     * CRITICAL: Extract LinkeContentDropdownValueField references
     * Based on push_legacy.ts lines 550-580 - this looks at model field settings
     * to find field names, then extracts content IDs from those fields
     */
    private extractLinkeContentDropdownValueFieldRefs(contentItem: any, contentId: string | number, references: EntityReference[]): void {
        // This pattern requires model metadata to determine which fields contain content IDs
        // For now, we detect common patterns based on field names that match ValueField patterns
        
        if (!contentItem.fields) return;
        
        Object.entries(contentItem.fields).forEach(([fieldName, fieldValue]: [string, any]) => {
            // Pattern: Fields that end with _ValueField often contain content IDs from LinkeContentDropdownValueField settings
            if (fieldName.endsWith('_ValueField') && fieldValue) {
                const valueStr = fieldValue.toString();
                
                // Check if it contains comma-separated content IDs (from LinkeContentDropdownValueField)
                if (valueStr.includes(',')) {
                    const contentIds = valueStr.split(',').filter(id => id.trim());
                    contentIds.forEach(contentIdStr => {
                        const numericId = parseInt(contentIdStr.trim());
                        if (!isNaN(numericId)) {
                            references.push({
                                sourceType: 'content',
                                sourceId: contentId,
                                targetType: 'content',
                                targetId: numericId,
                                fieldPath: `fields.${fieldName}`,
                                relationshipType: 'content-linke-dropdown-value-field'
                            });
                        }
                    });
                } else {
                    // Single content ID in ValueField
                    const numericId = parseInt(valueStr);
                    if (!isNaN(numericId)) {
                        references.push({
                            sourceType: 'content',
                            sourceId: contentId,
                            targetType: 'content',
                            targetId: numericId,
                            fieldPath: `fields.${fieldName}`,
                            relationshipType: 'content-linke-dropdown-value-field'
                        });
                    }
                }
            }
            
            // Additional pattern: CategoryID, Tags_ValueField, etc. field names from logs
            if ((fieldName === 'CategoryID' || fieldName.includes('Tags') || fieldName.includes('Links')) && 
                typeof fieldValue === 'string' && fieldValue) {
                
                if (fieldValue.includes(',')) {
                    const contentIds = fieldValue.split(',').filter(id => id.trim());
                    contentIds.forEach(contentIdStr => {
                        const numericId = parseInt(contentIdStr.trim());
                        if (!isNaN(numericId)) {
                            references.push({
                                sourceType: 'content',
                                sourceId: contentId,
                                targetType: 'content',
                                targetId: numericId,
                                fieldPath: `fields.${fieldName}`,
                                relationshipType: 'content-linke-dropdown-category-field'
                            });
                        }
                    });
                } else {
                    const numericId = parseInt(fieldValue);
                    if (!isNaN(numericId)) {
                        references.push({
                            sourceType: 'content',
                            sourceId: contentId,
                            targetType: 'content',
                            targetId: numericId,
                            fieldPath: `fields.${fieldName}`,
                            relationshipType: 'content-linke-dropdown-category-field'
                        });
                    }
                }
            }
        });
    }

    /**
     * NEW: Extract LinkedContentDropdown and SortIDField references
     * Based on push_legacy.ts lines 550-700 logic
     */
    private extractLinkedContentDropdownRefs(fields: any, contentId: string | number, references: EntityReference[]): void {
        if (!fields || typeof fields !== 'object') return;
        
        Object.entries(fields).forEach(([fieldName, fieldValue]: [string, any]) => {
            if (!fieldValue || typeof fieldValue !== 'object') return;
            
            // Pattern 1: LinkedContentDropdown with sortids
            // Example: "tags":{"referencename":"changelogtags","sortids":"735,734","fulllist":false}
            if (fieldValue.referencename && fieldValue.sortids) {
                const sortIds = fieldValue.sortids.toString().split(',').filter(id => id.trim());
                sortIds.forEach(sortId => {
                    const numericId = parseInt(sortId.trim());
                    if (!isNaN(numericId)) {
                        references.push({
                            sourceType: 'content',
                            sourceId: contentId,
                            targetType: 'content',
                            targetId: numericId,
                            fieldPath: `fields.${fieldName}.sortids`,
                            relationshipType: 'content-linked-dropdown-sortable'
                        });
                    }
                });
                
                // Also track the container reference
                references.push({
                    sourceType: 'content',
                    sourceId: contentId,
                    targetType: 'container',
                    targetId: fieldValue.referencename,
                    fieldPath: `fields.${fieldName}.referencename`,
                    relationshipType: 'content-to-container-reference'
                });
            }
            
            // Pattern 2: Direct content reference
            // Example: "article":{"contentid":281,"fulllist":false}
            if (fieldValue.contentid && typeof fieldValue.contentid === 'number') {
                references.push({
                    sourceType: 'content',
                    sourceId: contentId,
                    targetType: 'content',
                    targetId: fieldValue.contentid,
                    fieldPath: `fields.${fieldName}.contentid`,
                    relationshipType: 'content-direct-reference'
                });
            }
            
            // Pattern 3: TextField/ValueField dual pattern
            // Example: "tags_TextField":"Platform,Improvement","tags_ValueField":"735,734"
            if (fieldName.endsWith('_ValueField')) {
                const baseFieldName = fieldName.replace('_ValueField', '');
                const valueFieldContent = fieldValue.toString();
                
                if (valueFieldContent && valueFieldContent.includes(',')) {
                    // Multiple content IDs in comma-separated format
                    const contentIds = valueFieldContent.split(',').filter(id => id.trim());
                    contentIds.forEach(contentIdStr => {
                        const numericId = parseInt(contentIdStr.trim());
                        if (!isNaN(numericId)) {
                            references.push({
                                sourceType: 'content',
                                sourceId: contentId,
                                targetType: 'content',
                                targetId: numericId,
                                fieldPath: `fields.${fieldName}`,
                                relationshipType: 'content-value-field-reference'
                            });
                        }
                    });
                } else {
                    // Single content ID
                    const numericId = parseInt(valueFieldContent);
                    if (!isNaN(numericId)) {
                        references.push({
                            sourceType: 'content',
                            sourceId: contentId,
                            targetType: 'content',
                            targetId: numericId,
                            fieldPath: `fields.${fieldName}`,
                            relationshipType: 'content-value-field-reference'
                        });
                    }
                }
            }
            
            // Pattern 4: Section content references (from the data sample)
            // Example: "section":{"contentid":433,"fulllist":false}
            if (fieldName === 'section' && fieldValue.contentid) {
                references.push({
                    sourceType: 'content',
                    sourceId: contentId,
                    targetType: 'content',
                    targetId: fieldValue.contentid,
                    fieldPath: `fields.${fieldName}.contentid`,
                    relationshipType: 'content-section-reference'
                });
            }
            
            // Pattern 5: Concept content references
            // Example: "concept":{"contentid":435,"fulllist":false}
            if (fieldName === 'concept' && fieldValue.contentid) {
                references.push({
                    sourceType: 'content',
                    sourceId: contentId,
                    targetType: 'content',
                    targetId: fieldValue.contentid,
                    fieldPath: `fields.${fieldName}.contentid`,
                    relationshipType: 'content-concept-reference'
                });
            }
            
            // Recursive scan for nested patterns
            if (typeof fieldValue === 'object' && fieldValue !== null) {
                this.extractLinkedContentDropdownRefs(fieldValue, contentId, references);
            }
        });
    }
    
    /**
     * Extract Model→Model references
     * Based on push_legacy.ts ContentDefinition settings patterns
     */
    private extractModelReferences(model: any, modelId: string | number): EntityReference[] {
        const references: EntityReference[] = [];
        
        if (!model.fields) return references;
        
        model.fields.forEach((field: any, fieldIndex: number) => {
            if (field.settings && field.settings['ContentDefinition']) {
                const referencedModelName = field.settings['ContentDefinition'];
                references.push({
                    sourceType: 'model',
                    sourceId: modelId,
                    targetType: 'model',
                    targetId: referencedModelName, // Reference name as identifier
                    fieldPath: `fields[${fieldIndex}].settings.ContentDefinition`,
                    relationshipType: 'model-to-model'
                });
            }
            
            // Handle other model field dependencies
            if (field.type === 'Content' && field.settings) {
                // LinkeContentDropdownValueField (from push_legacy.ts lines 550+)
                if (field.settings['LinkeContentDropdownValueField'] && 
                    field.settings['LinkeContentDropdownValueField'] !== 'CREATENEW') {
                    references.push({
                        sourceType: 'model',
                        sourceId: modelId,
                        targetType: 'content',
                        targetId: field.settings['LinkeContentDropdownValueField'],
                        fieldPath: `fields[${fieldIndex}].settings.LinkeContentDropdownValueField`,
                        relationshipType: 'model-to-content-dropdown'
                    });
                }
                
                // SortIDFieldName (from push_legacy.ts lines 580+)
                if (field.settings['SortIDFieldName'] && 
                    field.settings['SortIDFieldName'] !== 'CREATENEW') {
                    references.push({
                        sourceType: 'model',
                        sourceId: modelId,
                        targetType: 'content',
                        targetId: field.settings['SortIDFieldName'],
                        fieldPath: `fields[${fieldIndex}].settings.SortIDFieldName`,
                        relationshipType: 'model-to-content-sortable'
                    });
                }
            }
        });
        
        return references;
    }
    
    /**
     * Extract Asset→Gallery references
     * Based on push_legacy.ts asset grouping patterns
     */
    private extractAssetReferences(asset: any, assetId: string | number): EntityReference[] {
        const references: EntityReference[] = [];
        
        // Asset belongs to gallery (from push_legacy.ts mediaGroupingID patterns)
        if (asset.mediaGroupingID && asset.mediaGroupingID > 0) {
            references.push({
                sourceType: 'asset',
                sourceId: assetId,
                targetType: 'gallery',
                targetId: asset.mediaGroupingID,
                fieldPath: 'mediaGroupingID',
                relationshipType: 'asset-to-gallery'
            });
        }
        
        // Gallery name reference
        if (asset.mediaGroupingName && typeof asset.mediaGroupingName === 'string') {
            references.push({
                sourceType: 'asset',
                sourceId: assetId,
                targetType: 'gallery',
                targetId: asset.mediaGroupingName,
                fieldPath: 'mediaGroupingName',
                relationshipType: 'asset-to-gallery-name'
            });
        }
        
        return references;
    }
    
    /**
     * Extract Container→Model and Container→Container references
     */
    private extractContainerReferences(container: any, containerId: string | number): EntityReference[] {
        const references: EntityReference[] = [];
        
        // Container→Model
        if (container.contentDefinitionID) {
            references.push({
                sourceType: 'container',
                sourceId: containerId,
                targetType: 'model',
                targetId: container.contentDefinitionID,
                fieldPath: 'contentDefinitionID',
                relationshipType: 'container-to-model'
            });
        }
        
        // Container→Container (nested container relationships - critical missing pattern!)
        // These are discovered through content items that belong to this container but reference other containers
        if (container.nestedContainerReferences) {
            container.nestedContainerReferences.forEach((nestedRef: string, index: number) => {
                references.push({
                    sourceType: 'container',
                    sourceId: containerId,
                    targetType: 'container',
                    targetId: nestedRef,
                    fieldPath: `nestedContainerReferences[${index}]`,
                    relationshipType: 'container-to-container'
                });
            });
        }
        
        return references;
    }
    
    /**
     * Extract Template→Container references
     */
    private extractTemplateReferences(template: any, templateId: string | number): EntityReference[] {
        const references: EntityReference[] = [];
        
        if (template.contentSectionDefinitions) {
            template.contentSectionDefinitions.forEach((csd: any, csdIndex: number) => {
                if (csd.contentReferenceName) {
                    references.push({
                        sourceType: 'template',
                        sourceId: templateId,
                        targetType: 'container',
                        targetId: csd.contentReferenceName,
                        fieldPath: `contentSectionDefinitions[${csdIndex}].contentReferenceName`,
                        relationshipType: 'template-to-container'
                    });
                }
            });
        }
        
        return references;
    }
    
    /**
     * Extract Page→Template, Page→Content, Page→Container, and Page→Page (Sitemap) references
     */
    private extractPageReferences(page: any, pageId: string | number): EntityReference[] {
        const references: EntityReference[] = [];
        
        // Page→Template
        if (page.templateName || page.pageTemplateName) {
            references.push({
                sourceType: 'page',
                sourceId: pageId,
                targetType: 'template',
                targetId: page.templateName || page.pageTemplateName,
                fieldPath: 'templateName',
                relationshipType: 'page-to-template'
            });
        }
        
        // Page→Page (Sitemap hierarchy - CRITICAL for proper page sync ordering!)
        if (page.parentID && page.parentID > 0) {
            references.push({
                sourceType: 'page',
                sourceId: pageId,
                targetType: 'page',
                targetId: page.parentID,
                fieldPath: 'parentID',
                relationshipType: 'page-to-page-parent'
            });
        }
        
        // Page→Page (Master page relationships)
        if (page.masterPageID && page.masterPageID > 0) {
            references.push({
                sourceType: 'page',
                sourceId: pageId,
                targetType: 'page',
                targetId: page.masterPageID,
                fieldPath: 'masterPageID',
                relationshipType: 'page-to-page-master'
            });
        }
        
        // Page→Content (zones) - Enhanced deep analysis
        if (page.zones) {
            Object.keys(page.zones).forEach(zoneName => {
                const zone = page.zones[zoneName];
                if (Array.isArray(zone)) {
                    zone.forEach((zoneItem: any, zoneIndex: number) => {
                        // Direct content references
                        if (zoneItem.item && zoneItem.item.contentId) {
                            references.push({
                                sourceType: 'page',
                                sourceId: pageId,
                                targetType: 'content',
                                targetId: zoneItem.item.contentId,
                                fieldPath: `zones.${zoneName}[${zoneIndex}].item.contentId`,
                                relationshipType: 'page-to-content'
                            });
                        }
                        
                        // Page→Container (direct container references in zones)
                        if (zoneItem.referenceName) {
                            references.push({
                                sourceType: 'page',
                                sourceId: pageId,
                                targetType: 'container',
                                targetId: zoneItem.referenceName,
                                fieldPath: `zones.${zoneName}[${zoneIndex}].referenceName`,
                                relationshipType: 'page-to-container'
                            });
                        }
                        
                        // Page→Module (if zone items reference modules)
                        if (zoneItem.module && zoneItem.module.referenceName) {
                            references.push({
                                sourceType: 'page',
                                sourceId: pageId,
                                targetType: 'container',
                                targetId: zoneItem.module.referenceName,
                                fieldPath: `zones.${zoneName}[${zoneIndex}].module.referenceName`,
                                relationshipType: 'page-to-container-module'
                            });
                        }
                    });
                }
            });
        }
        
        // Page→Container (dynamic page container references for URL patterns)
        if (page.path && page.path.includes('{')) {
            // Extract dynamic path patterns like /{category}/{slug}
            const dynamicSegments = page.path.match(/\{([^}]+)\}/g);
            if (dynamicSegments) {
                dynamicSegments.forEach((segment, index) => {
                    const containerName = segment.replace(/[{}]/g, '');
                    references.push({
                        sourceType: 'page',
                        sourceId: pageId,
                        targetType: 'container',
                        targetId: containerName,
                        fieldPath: `path.dynamicSegment[${index}]`,
                        relationshipType: 'page-to-container-dynamic'
                    });
                });
            }
        }
        
        // Page→Container (sitemap-based container dependencies for dynamic URLs)
        if (page.dynamicPageContentViewReferenceName) {
            references.push({
                sourceType: 'page',
                sourceId: pageId,
                targetType: 'container',
                targetId: page.dynamicPageContentViewReferenceName,
                fieldPath: 'dynamicPageContentViewReferenceName',
                relationshipType: 'page-to-container-sitemap'
            });
        }
        
        return references;
    }
    
    /**
     * Extract Gallery→Asset references and Gallery→Gallery relationships
     */
    private extractGalleryReferences(gallery: any, galleryId: string | number): EntityReference[] {
        const references: EntityReference[] = [];
        
        // Gallery→Asset (galleries can explicitly list their assets)
        if (gallery.mediaItems && Array.isArray(gallery.mediaItems)) {
            gallery.mediaItems.forEach((mediaItem: any, index: number) => {
                if (mediaItem.mediaID) {
                    references.push({
                        sourceType: 'gallery',
                        sourceId: galleryId,
                        targetType: 'asset',
                        targetId: mediaItem.mediaID,
                        fieldPath: `mediaItems[${index}].mediaID`,
                        relationshipType: 'gallery-to-asset'
                    });
                }
            });
        }
        
        // Gallery→Gallery (nested gallery relationships - subcategories)
        if (gallery.parentMediaGroupingID && gallery.parentMediaGroupingID > 0) {
            references.push({
                sourceType: 'gallery',
                sourceId: galleryId,
                targetType: 'gallery',
                targetId: gallery.parentMediaGroupingID,
                fieldPath: 'parentMediaGroupingID',
                relationshipType: 'gallery-to-gallery-parent'
            });
        }
        
        return references;
    }
    
    /**
     * Recursively scan an object for reference patterns
     */
    private scanObjectForReferences(
        obj: any, 
        basePath: string, 
        callback: (key: string, value: any, path: string) => void
    ): void {
        if (!obj || typeof obj !== 'object') return;
        
        for (const [key, value] of Object.entries(obj)) {
            const currentPath = basePath ? `${basePath}.${key}` : key;
            
            // Call callback for this key-value pair
            callback(key, value, currentPath);
            
            // Recurse into objects and arrays
            if (typeof value === 'object' && value !== null) {
                if (Array.isArray(value)) {
                    value.forEach((item, index) => {
                        this.scanObjectForReferences(item, `${currentPath}[${index}]`, callback);
                    });
                } else {
                    this.scanObjectForReferences(value, currentPath, callback);
                }
            }
        }
    }
    
    /**
     * Extract references from ALL entities in SourceEntities
     */
    public extractAllEntityReferences(sourceEntities: SourceEntities): EntityReference[] {
        const allReferences: EntityReference[] = [];
        
        // Extract from all content items
        sourceEntities.content?.forEach(content => {
            allReferences.push(...this.extractAllReferences(content, 'content', content.contentID));
        });
        
        // Extract from all models
        sourceEntities.models?.forEach(model => {
            allReferences.push(...this.extractAllReferences(model, 'model', model.id));
        });
        
        // Extract from all assets
        sourceEntities.assets?.forEach(asset => {
            allReferences.push(...this.extractAllReferences(asset, 'asset', asset.mediaID));
        });
        
        // Extract from all containers
        sourceEntities.containers?.forEach(container => {
            allReferences.push(...this.extractAllReferences(container, 'container', container.contentViewID));
        });
        
        // Extract from all templates
        sourceEntities.templates?.forEach(template => {
            allReferences.push(...this.extractAllReferences(template, 'template', template.pageTemplateID));
        });
        
        // Extract from all pages
        sourceEntities.pages?.forEach(page => {
            allReferences.push(...this.extractAllReferences(page, 'page', page.pageID));
        });
        
        // Extract from all galleries  
        sourceEntities.galleries?.forEach(gallery => {
            allReferences.push(...this.extractAllReferences(gallery, 'gallery', gallery.mediaGroupingID));
        });
        
        return allReferences;
    }
} 