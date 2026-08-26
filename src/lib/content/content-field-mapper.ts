import { AssetReferenceExtractor } from "../assets/asset-reference-extractor";
import * as mgmtApi from "@agility/management-sdk";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { AssetMapper } from "lib/mappers/asset-mapper";

export function createContentFieldMapper() {
  return new ContentFieldMapper();
}

export interface ContentFieldMappingContext {
  referenceMapper: ContentItemMapper;
  assetMapper: AssetMapper;
  apiClient?: mgmtApi.ApiClient;
  targetGuid?: string;
  // PROD-2431/PROD-2435: the source model for the content item being mapped. Content-typed
  // dropdown fields declare a `LinkeContentDropdownValueField` setting naming a companion field
  // that separately carries the raw selected content ID(s) — the model is the only place that
  // name is recorded, and it varies per field (no fixed naming convention), so it must be read
  // from here rather than guessed.
  model?: mgmtApi.Model | { fields?: mgmtApi.ModelField[] | any[] };
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
    if (!fields || typeof fields !== "object") {
      return {
        mappedFields: fields,
        validationWarnings: 0,
        validationErrors: 0,
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

    // PROD-2431/PROD-2435: a Content-typed dropdown field (single-select OR checkbox/multi-select)
    // can store its actual selection in a companion field, separate from the field the designer
    // sees — named by that field's own model setting, LinkeContentDropdownValueField. That
    // companion is declared as plain text in the schema, so it's a bare string (or comma-separated
    // string for multi-select) rather than the {contentid}/{sortids} object shape the passes above
    // remap — it's invisible to isContentReferenceField() and passes through untouched, shipping
    // raw SOURCE content ID(s) into the target instance.
    //
    // The companion's *name* has no fixed convention — sampling this codebase's own target schema,
    // only 4 of 14 dropdown fields name it "<field>_ValueField"; the rest (e.g. PlayslipSection's
    // "linkedContentId", HotAndColdNumbersSection's "LinkedContentValue") don't. The model schema is
    // the only reliable source for the real name, so remap by reading it from context.model instead
    // of guessing a suffix.
    for (const [mainFieldName, valueFieldName] of this.getContentDropdownValueFieldNames(context)) {
      // Self-pointing setting (e.g. GameBanner's own field name): nothing separate to remap —
      // the mainFieldName pass above (or the sortids/contentid handling) already covers it.
      if (valueFieldName.toLowerCase() === mainFieldName.toLowerCase()) continue;

      const valueFieldKey = this.findFieldKey(fields, valueFieldName);
      if (!valueFieldKey) continue; // e.g. a sentinel setting like "CREATENEW" that names no real field

      const rawValue = fields[valueFieldKey];
      if (typeof rawValue !== "string" || !rawValue.trim()) continue;

      const valueFieldResult = this.mapContentIdListString(rawValue, context);
      mappedFields[valueFieldKey] = valueFieldResult.mappedValue;
      validationWarnings += valueFieldResult.warnings;
    }

    return {
      mappedFields,
      validationWarnings,
      validationErrors,
    };
  }

  private mapSingleField(
    fieldName: string,
    fieldValue: any,
    context?: ContentFieldMappingContext
  ): {
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

    // Handle list reference fields (referencename + fulllist) - preserve unchanged
    // These are list references by name, not content ID references that need mapping
    if (this.isListReferenceField(fieldValue)) {
      // List references by name should pass through unchanged
      return { mappedValue: fieldValue, warnings: 0, errors: 0 };
    }
    // Handle asset attachment fields (ImageAttachment, FileAttachment, AttachmentList)
    else if (this.isAssetAttachmentField(fieldValue)) {
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
    else if (typeof fieldValue === "string" && this.isAssetUrl(fieldValue, context)) {
      const urlMappingResult = this.mapAssetUrlString(fieldValue, context);
      mappedValue = urlMappingResult.mappedValue;
      warnings += urlMappingResult.warnings;
      errors += urlMappingResult.errors;
    }
    // Handle nested objects recursively
    else if (typeof fieldValue === "object" && fieldValue !== null) {
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

  /**
   *    Domain check for asset URL strings. Matches:
   *  - any Agility-managed CDN subdomain (cdn.aglty.io, cdn-usa2.aglty.io, *.agilitycms.com, etc.)
   *  - any URL whose prefix matches a container URL loaded into the asset mapper
   */
  private isAssetUrl(value: string, context?: ContentFieldMappingContext): boolean {
    return (
      value.includes(".aglty.io") ||
      value.includes(".agilitycms.com") ||
      context?.assetMapper?.isKnownAssetUrl(value) === true
    );
  }

  private isAssetAttachmentField(fieldValue: any): boolean {
    if (!fieldValue || typeof fieldValue !== "object") return false;

    // Check for asset attachment patterns
    if (Array.isArray(fieldValue)) {
      return fieldValue.some((item) => item && typeof item === "object" && "url" in item);
    } else {
      return "url" in fieldValue && typeof fieldValue.url === "string";
    }
  }

  private isContentReferenceField(fieldValue: any): boolean {
    if (!fieldValue || typeof fieldValue !== "object") return false;

    // Check for content reference patterns
    return "contentid" in fieldValue || "contentID" in fieldValue || "sortids" in fieldValue;
  }

  private isListReferenceField(fieldValue: any): boolean {
    if (!fieldValue || typeof fieldValue !== "object") return false;

    // Check for list reference patterns (referencename with fulllist)
    const hasReferencename = "referencename" in fieldValue || "referenceName" in fieldValue;
    const hasFulllist = fieldValue.fulllist === true || fieldValue.fullList === true;
    // PROD-2442: a full-list "grid" Linked Content field carries referencename+fulllist:true
    // exactly like a bare list-by-name reference, but it can ALSO have a populated sortids (a
    // custom sort order, via the model's SortIDFieldName setting — the grid analogue of
    // LinkeContentDropdownValueField). Treating every referencename+fulllist object as an inert
    // list reference short-circuited mapSingleField() before mapContentReferenceField() ever ran,
    // so that sortids shipped to the target with raw SOURCE content IDs. Only fields with no
    // populated sortids are genuinely "reference by name only" — fall through to the
    // content-reference path (which already knows how to remap sortids) otherwise.
    const hasSortIds = typeof fieldValue.sortids === "string" && fieldValue.sortids.trim().length > 0;
    return hasReferencename && hasFulllist && !hasSortIds;
  }

  private mapAssetAttachmentField(
    fieldValue: any,
    context?: ContentFieldMappingContext
  ): {
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
      const mappedArray = fieldValue.map((assetObj) => {
        if (assetObj && typeof assetObj === "object" && assetObj.url) {
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

  private mapContentReferenceField(
    fieldValue: any,
    context?: ContentFieldMappingContext
  ): {
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

    // PROD-2341: a single-item linked-content selection must be emitted as the SCALAR remapped
    // contentID string, not the { contentid, fulllist } object. The server-side batch engine reads
    // a linked-content field value with `row[col] as string` (Agility.Shared BatchProcessing_
    // InsertContentItem.cs); an object cast yields null → the selection is stored EMPTY (the GET API
    // then renders it as the SharedContent list's reference name), which is the "Draw Game arrives
    // empty / component can't be edited" symptom. Emit "<targetContentID>" when the referenced item
    // is mapped; otherwise leave it untouched and warn (the PROD-2309 pre-push guard normally catches
    // the unmapped case first).
    if (this.isSingleItemContentSelection(fieldValue)) {
      const sourceContentId = fieldValue.contentid ?? fieldValue.contentID;
      const contentMapping = context.referenceMapper.getContentItemMappingByContentID(sourceContentId, "source");
      const targetContentID = this.resolveTargetContentID(contentMapping);
      if (targetContentID) {
        return { mappedValue: String(targetContentID), warnings, errors };
      }
      return { mappedValue: fieldValue, warnings: warnings + 1, errors };
    }

    // Map contentid/contentID references
    if (fieldValue.contentid || fieldValue.contentID) {
      const sourceContentId = fieldValue.contentid || fieldValue.contentID;
      const contentMapping = context.referenceMapper.getContentItemMappingByContentID(sourceContentId, "source");
      const targetContentID = this.resolveTargetContentID(contentMapping);
      if (targetContentID) {
        if (fieldValue.contentid !== undefined) {
          mappedValue.contentid = targetContentID;
        }
        if (fieldValue.contentID !== undefined) {
          mappedValue.contentID = targetContentID;
        }
      } else {
        warnings++;
      }
    }

    // Map sortids (comma-separated content IDs)
    if (fieldValue.sortids) {
      const sortidsResult = this.mapContentIdListString(fieldValue.sortids.toString(), context);
      mappedValue.sortids = sortidsResult.mappedValue;
      warnings += sortidsResult.warnings;
    }

    return { mappedValue, warnings, errors };
  }

  /**
   * PROD-2431/PROD-2435: read [mainFieldName, companionFieldName] pairs off the model schema's
   * Content-typed fields. `settings.LinkeContentDropdownValueField` (Agility's own spelling) names
   * the field that actually carries the raw content ID(s) for a linked-content dropdown. Only
   * non-empty settings are returned; the caller still has to handle the value naming a field that
   * doesn't exist in the payload (a sentinel like "CREATENEW") or naming itself (no separate
   * companion to remap).
   */
  private getContentDropdownValueFieldNames(context?: ContentFieldMappingContext): Array<[string, string]> {
    const modelFields = context?.model?.fields;
    if (!Array.isArray(modelFields)) return [];

    const pairs: Array<[string, string]> = [];
    for (const field of modelFields) {
      // PROD-2442: a "grid" (full-list) Linked Content field's companion selection column is named
      // by SortIDFieldName instead of LinkeContentDropdownValueField — the same per-field, no-fixed-
      // convention naming problem PROD-2431/2435 already solved for dropdown/checkbox, just under a
      // different setting. Fall back to it so that companion also gets remapped.
      const valueFieldName: string | undefined =
        field?.settings?.LinkeContentDropdownValueField || field?.settings?.SortIDFieldName;
      if (field?.name && valueFieldName) {
        pairs.push([field.name, valueFieldName]);
      }
    }
    return pairs;
  }

  /**
   * Look up a field by name in a fields object, case-insensitively — the model schema's field
   * name and the payload's actual field key can differ in casing (e.g. schema "LinkedContentValue"
   * vs. a payload key camelCased to "linkedContentValue").
   */
  private findFieldKey(fields: any, fieldName: string): string | undefined {
    if (fieldName in fields) return fieldName;
    const lowerTarget = fieldName.toLowerCase();
    return Object.keys(fields).find((key) => key.toLowerCase() === lowerTarget);
  }

  /**
   * PROD-2431: shared remap for a comma-separated list of SOURCE content IDs, used both for a
   * content-reference field's "sortids" and for a linked-content dropdown's companion selection
   * field (named by the model's LinkeContentDropdownValueField setting). Unresolvable IDs are left
   * as-is and counted as warnings rather than dropped, matching the existing sortids behavior.
   */
  private mapContentIdListString(
    value: string,
    context?: ContentFieldMappingContext
  ): { mappedValue: string; warnings: number } {
    if (!context?.referenceMapper) {
      return { mappedValue: value, warnings: 1 };
    }

    let warnings = 0;
    const mappedIds = value
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .map((id) => {
        const sourceId = parseInt(id, 10);
        const mapping = context.referenceMapper.getContentItemMappingByContentID(sourceId, "source");
        const targetId = this.resolveTargetContentID(mapping);
        if (targetId == null) {
          warnings++;
          return id;
        }
        return String(targetId);
      });

    return { mappedValue: mappedIds.join(","), warnings };
  }

  /**
   * PROD-2341: read the target contentID off a content-item mapping record. The mapper returns
   * records whose target id is `targetContentID`; earlier code here read `.contentID`, which is
   * always undefined on those records — so content references were never remapped and shipped with
   * the SOURCE id (a dangling reference that the target stores as an empty selection). The
   * `contentID` fallback keeps compatibility with any caller/test that passes that shape.
   */
  private resolveTargetContentID(mapping: any): number | null {
    if (!mapping) return null;
    return mapping.targetContentID ?? mapping.contentID ?? null;
  }

  /**
   * PROD-2341: a single-item linked-content SELECTION — a linked-content dropdown where one item is
   * picked. The pulled shape is `{ contentid: N, fulllist: false }` with a positive contentID, no
   * `referencename`, and no `sortids`. The presence of a `fulllist` flag marks this as a linked-
   * content field value (list/dropdown), distinguishing it from a bare nested `{ contentid }`
   * reference (which keeps its object-form remap). This shape must be serialized as the scalar
   * contentID string — see the batch-engine note in mapContentReferenceField.
   */
  private isSingleItemContentSelection(fieldValue: any): boolean {
    if (!fieldValue || typeof fieldValue !== "object" || Array.isArray(fieldValue)) return false;
    const hasFullListKey = "fulllist" in fieldValue || "fullList" in fieldValue;
    if (!hasFullListKey) return false;
    const isFullList = fieldValue.fulllist === true || fieldValue.fullList === true;
    if (isFullList) return false; // whole-list link — not a single-item selection
    const contentId = fieldValue.contentid ?? fieldValue.contentID;
    const hasPositiveContentId = typeof contentId === "number" && contentId > 0;
    const hasReferenceName = "referencename" in fieldValue || "referenceName" in fieldValue;
    const hasSortIds = "sortids" in fieldValue;
    return hasPositiveContentId && !hasReferenceName && !hasSortIds;
  }

  private mapAssetUrlString(
    url: string,
    context?: ContentFieldMappingContext
  ): {
    mappedValue: string;
    warnings: number;
    errors: number;
  } {
    const mappedUrl = this.mapAssetUrl(url, context);
    return {
      mappedValue: mappedUrl,
      warnings: mappedUrl === url ? 1 : 0, // Warning if no mapping found
      errors: 0,
    };
  }

  private mapAssetUrl(sourceUrl: string, context?: ContentFieldMappingContext): string {
    // Try exact URL match first
    const assetMapping = context.assetMapper.getAssetMappingByMediaUrl(sourceUrl, "source");
    if (assetMapping) {
      // If exact match, use the target URL directly
      if (assetMapping.sourceUrl === sourceUrl) {
        return assetMapping.targetUrl || sourceUrl;
      }

      // Container prefix match — swap source container for target, preserving subfolder path
      const remapped = context.assetMapper.remapUrlByContainer(sourceUrl, "source");
      if (remapped) return remapped;

      return assetMapping.targetUrl || sourceUrl;
    }

    // Return original URL if no mapping found
    return sourceUrl;
  }
}
