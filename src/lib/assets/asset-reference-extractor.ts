/**
 * Asset Reference Extractor Service
 *
 * Handles extraction of asset references from content fields and display
 * of asset dependencies in the sync analysis output.
 */

import ansiColors from "ansi-colors";
import {
  SourceEntities,
  SyncAnalysisContext,
  AssetReference,
  ReferenceExtractionService,
} from "../../types/syncAnalysis";
import { AssetMapper } from "../mappers/asset-mapper";

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
  extractReferences(fields: any, assetMapper?: AssetMapper): AssetReference[] {
    return this.extractAssetReferences(fields, assetMapper);
  }

  /**
   * Extract asset references from content fields
   */
  extractAssetReferences(fields: any, assetMapper?: AssetMapper): AssetReference[] {
    const references: AssetReference[] = [];

    if (!fields || typeof fields !== "object") {
      return references;
    }

    // Helper to check if a string is an asset URL. Matches:
    //  - any Agility-managed CDN subdomain (cdn.aglty.io, cdn-usa2.aglty.io, *.agilitycms.com, etc.)
    //  - any URL whose prefix matches a container URL loaded into the asset mapper (supports custom CDN hosts)
    const isAssetUrl = (url: string): boolean => {
      if (typeof url !== "string") return false;
      return (
        url.includes(".aglty.io") ||
        url.includes(".agilitycms.com") ||
        assetMapper?.isKnownAssetUrl(url) === true
      );
    };

    const scanForAssets = (obj: any, path: string) => {
      // Handle primitive values (strings, numbers, etc.)
      if (obj === null || obj === undefined) return;

      // Check for asset URL references in strings
      if (typeof obj === "string" && isAssetUrl(obj)) {
        references.push({
          url: obj,
          fieldPath: path,
        });
        return; // Don't recurse into strings
      }

      // Only process objects and arrays
      if (typeof obj !== "object") return;

      if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          scanForAssets(item, `${path}[${index}]`);
        });
      } else {
        // Check common asset fields in objects (url, originUrl, edgeUrl)
        const urlFields = ["url", "originUrl", "edgeUrl"];
        for (const fieldName of urlFields) {
          if (obj[fieldName] && typeof obj[fieldName] === "string" && isAssetUrl(obj[fieldName])) {
            references.push({
              url: obj[fieldName],
              fieldPath: `${path}.${fieldName}`,
            });
          }
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
      const asset = sourceEntities.assets?.find(
        (a: any) => a.originUrl === assetRef.url || a.url === assetRef.url || a.edgeUrl === assetRef.url
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
      const asset = sourceEntities.assets?.find(
        (a: any) => a.originUrl === assetRef.url || a.url === assetRef.url || a.edgeUrl === assetRef.url
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
