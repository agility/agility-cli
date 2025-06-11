import { CONTENT_STATES } from './types';

/**
 * State-Based Validation Engine
 * 
 * Detects problematic entities using only source data properties (no SDK calls required)
 * Based on patterns discovered in content state analysis and push_legacy.ts error handling
 */
export class StateValidator {
    
    /**
     * Validate if content item is syncable based on its state properties
     */
    public isContentSyncable(contentItem: any): { syncable: boolean; reason?: string; state?: string } {
        if (!contentItem.properties) {
            return { syncable: false, reason: 'Missing properties object' };
        }
        
        const state = contentItem.properties.state;
        const published = contentItem.properties.published;
        
        // Check for deleted content (state 3)
        if (state === 3) {
            return { 
                syncable: false, 
                reason: 'Content marked as deleted', 
                state: CONTENT_STATES[state]?.label || 'Unknown'
            };
        }
        
        // Check for unpublished content (state 7)
        if (state === 7) {
            return { 
                syncable: false, 
                reason: 'Content marked as unpublished', 
                state: CONTENT_STATES[state]?.label || 'Unknown'
            };
        }
        
        // Check published flag
        if (published === false) {
            return { 
                syncable: false, 
                reason: 'Content not published (published: false)', 
                state: CONTENT_STATES[state]?.label || 'Unknown'
            };
        }
        
        // Content is syncable
        return { 
            syncable: true, 
            state: CONTENT_STATES[state]?.label || 'Unknown'
        };
    }
    
    /**
     * Validate if container is syncable based on its properties
     */
    public isContainerSyncable(container: any): { syncable: boolean; reason?: string } {
        if (!container) {
            return { syncable: false, reason: 'Container is null or undefined' };
        }
        
        // Check for deleted containers (contentViewID = -1)
        if (container.contentViewID === -1) {
            return { 
                syncable: false, 
                reason: 'Container marked as deleted (contentViewID: -1)' 
            };
        }
        
        // Check for missing essential properties
        if (!container.referenceName) {
            return { 
                syncable: false, 
                reason: 'Container missing referenceName' 
            };
        }
        
        if (!container.contentDefinitionID || container.contentDefinitionID <= 0) {
            return { 
                syncable: false, 
                reason: 'Container missing or invalid contentDefinitionID' 
            };
        }
        
        // Container is syncable
        return { syncable: true };
    }
    
    /**
     * Validate if model is syncable based on its properties
     */
    public isModelSyncable(model: any): { syncable: boolean; reason?: string } {
        if (!model) {
            return { syncable: false, reason: 'Model is null or undefined' };
        }
        
        // Check for missing essential properties
        if (!model.referenceName) {
            return { 
                syncable: false, 
                reason: 'Model missing referenceName' 
            };
        }
        
        if (!model.displayName) {
            return { 
                syncable: false, 
                reason: 'Model missing displayName' 
            };
        }
        
        // Check if model was unpublished (based on legacy patterns)
        if (model.wasUnpublished === true) {
            return { 
                syncable: false, 
                reason: 'Model was unpublished' 
            };
        }
        
        // Model is syncable
        return { syncable: true };
    }
    
    /**
     * Validate if asset is syncable based on its properties
     */
    public isAssetSyncable(asset: any): { syncable: boolean; reason?: string } {
        if (!asset) {
            return { syncable: false, reason: 'Asset is null or undefined' };
        }
        
        // Check for missing essential properties
        if (!asset.fileName) {
            return { 
                syncable: false, 
                reason: 'Asset missing fileName' 
            };
        }
        
        // Check for missing URLs (asset needs at least one URL)
        if (!asset.originUrl && !asset.url && !asset.edgeUrl) {
            return { 
                syncable: false, 
                reason: 'Asset missing all URL properties (originUrl, url, edgeUrl)' 
            };
        }
        
        // Asset is syncable
        return { syncable: true };
    }
    
    /**
     * Validate if gallery is syncable based on its properties
     */
    public isGallerySyncable(gallery: any): { syncable: boolean; reason?: string } {
        if (!gallery) {
            return { syncable: false, reason: 'Gallery is null or undefined' };
        }
        
        // Check for missing essential properties
        if (!gallery.name) {
            return { 
                syncable: false, 
                reason: 'Gallery missing name' 
            };
        }
        
        if (!gallery.mediaGroupingID || gallery.mediaGroupingID <= 0) {
            return { 
                syncable: false, 
                reason: 'Gallery missing or invalid mediaGroupingID' 
            };
        }
        
        // Gallery is syncable
        return { syncable: true };
    }
    
    /**
     * Validate if template is syncable based on its properties
     */
    public isTemplateSyncable(template: any): { syncable: boolean; reason?: string } {
        if (!template) {
            return { syncable: false, reason: 'Template is null or undefined' };
        }
        
        // Check for missing essential properties
        if (!template.pageTemplateName) {
            return { 
                syncable: false, 
                reason: 'Template missing pageTemplateName' 
            };
        }
        
        // Template is syncable
        return { syncable: true };
    }
    
    /**
     * Validate if page is syncable based on its properties
     */
    public isPageSyncable(page: any): { syncable: boolean; reason?: string } {
        if (!page) {
            return { syncable: false, reason: 'Page is null or undefined' };
        }
        
        // Check for missing essential properties
        if (!page.name) {
            return { 
                syncable: false, 
                reason: 'Page missing name' 
            };
        }
        
        // Folder pages don't need templates - they are structural
        if (page.pageType === 'folder') {
            return { syncable: true };
        }
        
        // Check if non-folder page has template reference
        if (!page.templateName && !page.pageTemplateName) {
            return { 
                syncable: false, 
                reason: 'Page missing template reference' 
            };
        }
        
        // Page is syncable
        return { syncable: true };
    }
    
    /**
     * Check if an entity reference exists in the source data (orphan detection)
     */
    public isReferenceOrphan(
        referenceType: string, 
        referenceId: string | number, 
        sourceEntities: any
    ): { isOrphan: boolean; reason?: string } {
        
        switch (referenceType) {
            case 'content':
                const contentExists = sourceEntities.content?.find((c: any) => 
                    c.contentID === referenceId
                );
                return { 
                    isOrphan: !contentExists, 
                    reason: contentExists ? undefined : `Referenced content ID ${referenceId} not found in source data`
                };
                
            case 'container':
                const containerExists = sourceEntities.containers?.find((c: any) => 
                    c.contentViewID === referenceId || c.referenceName === referenceId
                );
                return { 
                    isOrphan: !containerExists, 
                    reason: containerExists ? undefined : `Referenced container ${referenceId} not found in source data`
                };
                
            case 'model':
                const modelExists = sourceEntities.models?.find((m: any) => 
                    m.id === referenceId || m.referenceName === referenceId
                );
                return { 
                    isOrphan: !modelExists, 
                    reason: modelExists ? undefined : `Referenced model ${referenceId} not found in source data`
                };
                
            case 'asset':
                const assetExists = sourceEntities.assets?.find((a: any) => 
                    a.mediaID === referenceId || 
                    a.originUrl === referenceId ||
                    a.url === referenceId ||
                    a.edgeUrl === referenceId
                );
                return { 
                    isOrphan: !assetExists, 
                    reason: assetExists ? undefined : `Referenced asset ${referenceId} not found in source data`
                };
                
            case 'gallery':
                const galleryExists = sourceEntities.galleries?.find((g: any) => 
                    g.mediaGroupingID === referenceId || g.name === referenceId
                );
                return { 
                    isOrphan: !galleryExists, 
                    reason: galleryExists ? undefined : `Referenced gallery ${referenceId} not found in source data`
                };
                
            case 'template':
                const templateExists = sourceEntities.templates?.find((t: any) => 
                    t.pageTemplateID === referenceId || t.pageTemplateName === referenceId
                );
                return { 
                    isOrphan: !templateExists, 
                    reason: templateExists ? undefined : `Referenced template ${referenceId} not found in source data`
                };
                
            default:
                return { 
                    isOrphan: true, 
                    reason: `Unknown reference type: ${referenceType}`
                };
        }
    }
    
    /**
     * Comprehensive validation of an entity and all its references
     */
    public validateEntityCompletely(
        entity: any, 
        entityType: string, 
        sourceEntities: any,
        entityReferences?: any[]
    ): { 
        syncable: boolean; 
        reasons: string[]; 
        orphanReferences: string[];
        state?: string;
    } {
        const reasons: string[] = [];
        const orphanReferences: string[] = [];
        
        // Validate the entity itself
        let entityValidation: { syncable: boolean; reason?: string; state?: string };
        
        switch (entityType) {
            case 'content':
                entityValidation = this.isContentSyncable(entity);
                break;
            case 'container':
                entityValidation = this.isContainerSyncable(entity);
                break;
            case 'model':
                entityValidation = this.isModelSyncable(entity);
                break;
            case 'asset':
                entityValidation = this.isAssetSyncable(entity);
                break;
            case 'gallery':
                entityValidation = this.isGallerySyncable(entity);
                break;
            case 'template':
                entityValidation = this.isTemplateSyncable(entity);
                break;
            case 'page':
                entityValidation = this.isPageSyncable(entity);
                break;
            default:
                entityValidation = { syncable: false, reason: `Unknown entity type: ${entityType}` };
        }
        
        if (!entityValidation.syncable && entityValidation.reason) {
            reasons.push(entityValidation.reason);
        }
        
        // Validate all references if provided
        if (entityReferences) {
            entityReferences.forEach(ref => {
                const orphanCheck = this.isReferenceOrphan(ref.targetType, ref.targetId, sourceEntities);
                if (orphanCheck.isOrphan && orphanCheck.reason) {
                    orphanReferences.push(`${ref.fieldPath}: ${orphanCheck.reason}`);
                }
            });
        }
        
        const allValid = entityValidation.syncable && orphanReferences.length === 0;
        
        return {
            syncable: allValid,
            reasons,
            orphanReferences,
            state: entityValidation.state
        };
    }
    
    /**
     * Filter entities based on state validation
     */
    public filterSyncableEntities<T>(
        entities: T[], 
        entityType: string,
        sourceEntities?: any
    ): { 
        syncable: T[]; 
        problematic: T[]; 
        stats: { total: number; syncable: number; problematic: number; }
    } {
        const syncable: T[] = [];
        const problematic: T[] = [];
        
        entities.forEach(entity => {
            const validation = this.validateEntityCompletely(entity, entityType, sourceEntities);
            if (validation.syncable) {
                syncable.push(entity);
            } else {
                problematic.push(entity);
            }
        });
        
        return {
            syncable,
            problematic,
            stats: {
                total: entities.length,
                syncable: syncable.length,
                problematic: problematic.length
            }
        };
    }
} 