import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2"; 
import { AssetReferenceExtractor } from "../assets/asset-reference-extractor";
import * as mgmtApi from '@agility/management-sdk';
import { ContentItemMapper } from "lib/mappers/content-item-mapper";

export function createContentFieldMapper() { 
  return new ContentFieldMapper(); 
}

export interface ContentFieldMappingContext {
  referenceMapper: ContentItemMapper;
  sourceAssets?: any[];
  targetAssets?: any[];
  apiClient?: mgmtApi.ApiClient;
  targetGuid?: string;
}

export interface ContentFieldMappingResult {
  mappedFields: any;
  validationWarnings: number;
  validationErrors: number;
}

export class ContentFieldMapper {
  private assetExtractor: AssetReferenceExtractor;

  constructor() {
    this.assetExtractor = new AssetReferenceExtractor();
  }

  mapContentFields(fields: any, context?: ContentFieldMappingContext): ContentFieldMappingResult {
    if (!fields || typeof fields !== 'object') {
      return {
        mappedFields: fields,
        validationWarnings: 0,
        validationErrors: 0
      };
    }

    let validationWarnings = 0;
    let validationErrors = 0;
    const mappedFields = { ...fields };

    // Process each field for asset URL mapping and other transformations
    for (const [fieldName, fieldValue] of Object.entries(mappedFields)) {
      try {
        const mappingResult = this.mapSingleField(fieldName, fieldValue, context);
        mappedFields[fieldName] = mappingResult.mappedValue;
        validationWarnings += mappingResult.warnings;
        validationErrors += mappingResult.errors;
      } catch (error: any) {
        console.warn(`⚠️ Error mapping field ${fieldName}: ${error.message}`);
        validationErrors++;
        // Keep original value on error
      }
    }

    return {
      mappedFields,
      validationWarnings,
      validationErrors
    };
  }

  private mapSingleField(fieldName: string, fieldValue: any, context?: ContentFieldMappingContext): {
    mappedValue: any;
    warnings: number;
    errors: number;
  } {
    let warnings = 0;
    let errors = 0;
    let mappedValue = fieldValue;

    // Handle null/undefined values
    if (fieldValue === null || fieldValue === undefined) {
      return { mappedValue, warnings, errors };
    }

    // Handle asset attachment fields (ImageAttachment, FileAttachment, AttachmentList)
    if (this.isAssetAttachmentField(fieldValue)) {
      const assetMappingResult = this.mapAssetAttachmentField(fieldValue, context);
      mappedValue = assetMappingResult.mappedValue;
      warnings += assetMappingResult.warnings;
      errors += assetMappingResult.errors;
    }
    // Handle content reference fields (contentID, sortids, etc.)
    else if (this.isContentReferenceField(fieldValue)) {
      const contentMappingResult = this.mapContentReferenceField(fieldValue, context);
      mappedValue = contentMappingResult.mappedValue;
      warnings += contentMappingResult.warnings;
      errors += contentMappingResult.errors;
    }
    // Handle URL fields with potential asset references
    else if (typeof fieldValue === 'string' && fieldValue.includes('cdn.aglty.io')) {
      const urlMappingResult = this.mapAssetUrlString(fieldValue, context);
      mappedValue = urlMappingResult.mappedValue;
      warnings += urlMappingResult.warnings;
      errors += urlMappingResult.errors;
    }
    // Handle nested objects recursively
    else if (typeof fieldValue === 'object' && fieldValue !== null) {
      if (Array.isArray(fieldValue)) {
        mappedValue = fieldValue.map((item, index) => {
          const itemResult = this.mapSingleField(`${fieldName}[${index}]`, item, context);
          warnings += itemResult.warnings;
          errors += itemResult.errors;
          return itemResult.mappedValue;
        });
      } else {
        mappedValue = {};
        for (const [key, value] of Object.entries(fieldValue)) {
          const nestedResult = this.mapSingleField(`${fieldName}.${key}`, value, context);
          mappedValue[key] = nestedResult.mappedValue;
          warnings += nestedResult.warnings;
          errors += nestedResult.errors;
        }
      }
    }

    return { mappedValue, warnings, errors };
  }

  private isAssetAttachmentField(fieldValue: any): boolean {
    if (!fieldValue || typeof fieldValue !== 'object') return false;
    
    // Check for asset attachment patterns
    if (Array.isArray(fieldValue)) {
      return fieldValue.some(item => item && typeof item === 'object' && 'url' in item);
    } else {
      return 'url' in fieldValue && typeof fieldValue.url === 'string';
    }
  }

  private isContentReferenceField(fieldValue: any): boolean {
    if (!fieldValue || typeof fieldValue !== 'object') return false;
    
    // Check for content reference patterns
    return 'contentid' in fieldValue || 'contentID' in fieldValue || 'sortids' in fieldValue;
  }

  private mapAssetAttachmentField(fieldValue: any, context?: ContentFieldMappingContext): {
    mappedValue: any;
    warnings: number;
    errors: number;
  } {
    let warnings = 0;
    let errors = 0;

    if (!context?.referenceMapper) {
      return { mappedValue: fieldValue, warnings: 1, errors: 0 };
    }

    if (Array.isArray(fieldValue)) {
      // AttachmentList - array of asset objects
      const mappedArray = fieldValue.map(assetObj => {
        if (assetObj && typeof assetObj === 'object' && assetObj.url) {
          const mappedUrl = this.mapAssetUrl(assetObj.url, context);
          if (mappedUrl !== assetObj.url) {
            return { ...assetObj, url: mappedUrl };
          }
        }
        return assetObj;
      });
      return { mappedValue: mappedArray, warnings, errors };
    } else {
      // Single asset object (ImageAttachment/FileAttachment)
      if (fieldValue.url) {
        const mappedUrl = this.mapAssetUrl(fieldValue.url, context);
        if (mappedUrl !== fieldValue.url) {
          return { mappedValue: { ...fieldValue, url: mappedUrl }, warnings, errors };
        }
      }
      return { mappedValue: fieldValue, warnings, errors };
    }
  }

  private mapContentReferenceField(fieldValue: any, context?: ContentFieldMappingContext): {
    mappedValue: any;
    warnings: number;
    errors: number;
  } {
    let warnings = 0;
    let errors = 0;
    const mappedValue = { ...fieldValue };

    if (!context?.referenceMapper) {
      return { mappedValue: fieldValue, warnings: 1, errors: 0 };
    }

    // Map contentid/contentID references
    if (fieldValue.contentid || fieldValue.contentID) {
      const sourceContentId = fieldValue.contentid || fieldValue.contentID;
      const contentMapping = context.referenceMapper.getContentItemMappingByContentID(sourceContentId, 'source');
      if (contentMapping && (contentMapping as any).contentID) {
        if (fieldValue.contentid !== undefined) {
          mappedValue.contentid = (contentMapping as any).contentID;
        }
        if (fieldValue.contentID !== undefined) {
          mappedValue.contentID = (contentMapping as any).contentID;
        }
      } else {
        warnings++;
      }
    }

    // Map sortids (comma-separated content IDs)
    if (fieldValue.sortids) {
      const sourceIds = fieldValue.sortids.toString().split(',').map(id => parseInt(id.trim()));
      const mappedIds = sourceIds.map(sourceId => {
        const mapping = context.referenceMapper.getContentItemMappingByContentID(sourceId, 'source');
        return mapping ? (mapping as any).contentID : sourceId;
      });
      mappedValue.sortids = mappedIds.join(',');
    }

    return { mappedValue, warnings, errors };
  }

  private mapAssetUrlString(url: string, context?: ContentFieldMappingContext): {
    mappedValue: string;
    warnings: number;
    errors: number;
  } {
    const mappedUrl = this.mapAssetUrl(url, context);
    return {
      mappedValue: mappedUrl,
      warnings: mappedUrl === url ? 1 : 0, // Warning if no mapping found
      errors: 0
    };
  }

  private mapAssetUrl(sourceUrl: string, context?: ContentFieldMappingContext): string {
    if (!context?.referenceMapper) {
      return sourceUrl;
    }

    // Try to find the asset by URL in the reference mapper
    const assetMapping = context.referenceMapper.getAssetMapping(sourceUrl, 'source');
    if (assetMapping) {
      const asset = assetMapping as any;
      return asset.originUrl || asset.url || asset.edgeUrl || sourceUrl;
    }

    // Fallback: check if we have source assets to match against
    if (context.sourceAssets) {
      const sourceAsset = context.sourceAssets.find(asset => 
        asset.originUrl === sourceUrl || 
        asset.url === sourceUrl || 
        asset.edgeUrl === sourceUrl
      );
      
      if (sourceAsset) {
        // Try to find corresponding target asset
        const targetAssetMapping = context.referenceMapper.getAssetMapping(sourceAsset.mediaID, 'target');
        if (targetAssetMapping) {
          const targetAsset = targetAssetMapping as any;
          return targetAsset.originUrl || targetAsset.url || targetAsset.edgeUrl || sourceUrl;
        }
      }
    }

    // Return original URL if no mapping found
    return sourceUrl;
  }
}
