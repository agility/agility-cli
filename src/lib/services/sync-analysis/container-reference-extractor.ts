/**
 * Container Reference Extractor Service
 * 
 * Handles extraction of container references from content fields and page zones.
 * Used for analyzing container dependencies in the sync analysis.
 */

import { 
    ContainerReference, 
    SourceEntities, 
    SyncAnalysisContext, 
    ReferenceExtractionService 
} from './types';

export class ContainerReferenceExtractor implements ReferenceExtractionService {
    private context?: SyncAnalysisContext;

    /**
     * Initialize the service with context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
    }

    /**
     * Extract container references from content fields
     */
    extractReferences(fields: any): ContainerReference[] {
        return this.extractNestedContainerReferences(fields);
    }

    /**
     * Extract nested container references from container fields
     */
    extractNestedContainerReferences(fields: any): ContainerReference[] {
        const references: ContainerReference[] = [];
        
        if (!fields || typeof fields !== 'object') {
            return references;
        }
        
        const scanForContainerRefs = (obj: any, path: string) => {
            if (typeof obj !== 'object' || obj === null) return;
            
            if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    scanForContainerRefs(item, `${path}[${index}]`);
                });
            } else {
                // Check for container ID references
                if (obj.contentID && typeof obj.contentID === 'number' && obj.contentID > 0) {
                    references.push({
                        contentID: obj.contentID,
                        fieldPath: `${path}.contentID`
                    });
                }
                
                if (obj.contentid && typeof obj.contentid === 'number' && obj.contentid > 0) {
                    references.push({
                        contentID: obj.contentid,
                        fieldPath: `${path}.contentid`
                    });
                }
                
                // Recursively scan nested objects
                for (const [key, value] of Object.entries(obj)) {
                    scanForContainerRefs(value, path ? `${path}.${key}` : key);
                }
            }
        };
        
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            scanForContainerRefs(fieldValue, fieldName);
        }
        
        return references;
    }

    /**
     * Collect container IDs from page zones
     */
    collectContainersFromPageZones(zones: any, containerIds: Set<number>): void {
        if (!zones || typeof zones !== 'object') return;

        for (const [zoneName, zoneModules] of Object.entries(zones)) {
            if (Array.isArray(zoneModules)) {
                zoneModules.forEach((module: any) => {
                    if (module?.item?.contentid || module?.item?.contentId) {
                        const contentId = module.item.contentid || module.item.contentId;
                        containerIds.add(contentId);
                    }
                });
            }
        }
    }
} 