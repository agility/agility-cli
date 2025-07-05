/**
 * Asset Reference Extractor Service
 * 
 * Handles extraction of asset references from content fields and display
 * of asset dependencies in the sync analysis output.
 */

import ansiColors from 'ansi-colors';
import { 
    SourceEntities, 
    SyncAnalysisContext,
    AssetReference,
    ReferenceExtractionService
} from '../../types/syncAnalysis';

export class AssetReferenceExtractor implements ReferenceExtractionService {
    private context?: SyncAnalysisContext;

    /**
     * Initialize the service with context
     */
    initialize(context: SyncAnalysisContext): void {
        this.context = context;
    }

    /**
     * Extract asset references from content fields
     */
    extractReferences(fields: any): AssetReference[] {
        return this.extractAssetReferences(fields);
    }

    /**
     * Extract asset references from content fields
     */
    extractAssetReferences(fields: any): AssetReference[] {
        const references: AssetReference[] = [];
        
        if (!fields || typeof fields !== 'object') {
            return references;
        }
        
        const scanForAssets = (obj: any, path: string) => {
            if (typeof obj !== 'object' || obj === null) return;
            
            if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    scanForAssets(item, `${path}[${index}]`);
                });
            } else {
                // Check for asset URL references
                if (typeof obj === 'string' && obj.includes('cdn.aglty.io')) {
                    references.push({
                        url: obj,
                        fieldPath: path
                    });
                }
                
                // Check common asset fields
                if (obj.url && typeof obj.url === 'string' && obj.url.includes('cdn.aglty.io')) {
                    references.push({
                        url: obj.url,
                        fieldPath: `${path}.url`
                    });
                }
                
                // Recursively scan nested objects
                for (const [key, value] of Object.entries(obj)) {
                    scanForAssets(value, path ? `${path}.${key}` : key);
                }
            }
        };
        
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            scanForAssets(fieldValue, fieldName);
        }
        
        return references;
    }

    /**
     * Show content asset dependencies with proper formatting
     */
    showContentAssetDependencies(content: any, sourceEntities: SourceEntities, indent: string): void {
        if (!content.fields) return;

        const assetRefs = this.extractAssetReferences(content.fields);
        assetRefs.forEach((assetRef: AssetReference) => {
            const asset = sourceEntities.assets?.find((a: any) => 
                a.originUrl === assetRef.url || 
                a.url === assetRef.url ||
                a.edgeUrl === assetRef.url
            );
            if (asset) {
                console.log(`${indent}├─ ${ansiColors.yellow(`Asset:${asset.fileName || assetRef.url}`)}`);
                // Check gallery dependency if asset has one  
                if (asset.mediaGroupingID) {
                    const gallery = sourceEntities.galleries?.find((g: any) => g.mediaGroupingID === asset.mediaGroupingID);
                    if (gallery) {
                        console.log(`${indent}│  ├─ ${ansiColors.magenta(`Gallery:${gallery.name || gallery.mediaGroupingID}`)}`);
                    }
                }
            } else {
                console.log(`${indent}├─ ${ansiColors.red(`Asset:${assetRef.url} - MISSING IN SOURCE DATA`)}`);
            }
        });
    }

    /**
     * Find missing assets for content
     */
    findMissingAssetsForContent(content: any, sourceEntities: SourceEntities): string[] {
        const missing: string[] = [];

        if (!content.fields) return missing;

        const assetRefs = this.extractAssetReferences(content.fields);
        assetRefs.forEach((assetRef: AssetReference) => {
            const asset = sourceEntities.assets?.find((a: any) => 
                a.originUrl === assetRef.url || 
                a.url === assetRef.url || 
                a.edgeUrl === assetRef.url
            );
            if (!asset) {
                missing.push(`Asset:${assetRef.url}`);
            } else {
                // Check gallery dependency if asset has one
                if (asset.mediaGroupingID) {
                    const gallery = sourceEntities.galleries?.find((g: any) => g.mediaGroupingID === asset.mediaGroupingID);
                    if (!gallery) {
                        missing.push(`Gallery:${asset.mediaGroupingID}`);
                    }
                }
            }
        });

        return missing;
    }
} 