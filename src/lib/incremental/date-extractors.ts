/**
 * Entity-specific modified date extractors for incremental pull operations
 *
 * Based on analysis of all 7 entity types from Task 26.3:
 * - Models: lastModifiedDate (ISO 8601)
 * - Containers: lastModifiedDate (Human-readable: "03/05/2025 08:11AM")
 * - Content Items: properties.modified (ISO 8601)
 * - Assets: dateModified (ISO 8601)
 * - Pages: properties.modified (ISO 8601)
 * - Galleries: modifiedOn (ISO 8601)
 * - Templates: NO MODIFIED DATE FIELDS - always requires full refresh
 */

/**
 * Extract modified date from Model entity
 * @param model Model entity object
 * @returns ISO 8601 date string or null if not found
 */
export function extractModelModifiedDate(model: any): string | null {
  try {
    if (model?.lastModifiedDate && typeof model.lastModifiedDate === 'string') {
      // Already in ISO 8601 format: "2025-06-24T15:23:26.07"
      return normalizeToISO8601(model.lastModifiedDate);
    }
    return null;
  } catch (error) {
    console.warn(`Error extracting model modified date:`, error);
    return null;
  }
}

/**
 * Extract modified date from Container entity
 * @param container Container entity object
 * @returns ISO 8601 date string or null if not found
 */
export function extractContainerModifiedDate(container: any): string | null {
  try {
    if (container?.lastModifiedDate && typeof container.lastModifiedDate === 'string') {
      // Human-readable format: "03/05/2025 08:11AM" - needs parsing
      return parseHumanReadableDate(container.lastModifiedDate);
    }
    return null;
  } catch (error) {
    console.warn(`Error extracting container modified date:`, error);
    return null;
  }
}

/**
 * Extract modified date from Content Item entity
 * @param contentItem Content item entity object
 * @returns ISO 8601 date string or null if not found
 */
export function extractContentItemModifiedDate(contentItem: any): string | null {
  try {
    if (contentItem?.properties?.modified && typeof contentItem.properties.modified === 'string') {
      // Already in ISO 8601 format: "2025-06-20T06:45:38.203"
      return normalizeToISO8601(contentItem.properties.modified);
    }
    return null;
  } catch (error) {
    console.warn(`Error extracting content item modified date:`, error);
    return null;
  }
}

/**
 * Extract modified date from Asset entity
 * @param asset Asset entity object
 * @returns ISO 8601 date string or null if not found
 */
export function extractAssetModifiedDate(asset: any): string | null {
  try {
    if (asset?.dateModified && typeof asset.dateModified === 'string') {
      // Already in ISO 8601 format: "2025-03-06T03:38:21.25"
      return normalizeToISO8601(asset.dateModified);
    }
    return null;
  } catch (error) {
    console.warn(`Error extracting asset modified date:`, error);
    return null;
  }
}

/**
 * Extract modified date from Page entity
 * @param page Page entity object
 * @returns ISO 8601 date string or null if not found
 */
export function extractPageModifiedDate(page: any): string | null {
  try {
    if (page?.properties?.modified && typeof page.properties.modified === 'string') {
      // Already in ISO 8601 format: "2025-06-19T09:09:45.413"
      return normalizeToISO8601(page.properties.modified);
    }
    return null;
  } catch (error) {
    console.warn(`Error extracting page modified date:`, error);
    return null;
  }
}

/**
 * Extract modified date from Gallery entity
 * @param gallery Gallery entity object (from assetMediaGroupings array)
 * @returns ISO 8601 date string or null if not found
 */
export function extractGalleryModifiedDate(gallery: any): string | null {
  try {
    if (gallery?.modifiedOn && typeof gallery.modifiedOn === 'string') {
      // Already in ISO 8601 format: "2025-04-28T08:54:50.773"
      return normalizeToISO8601(gallery.modifiedOn);
    }
    return null;
  } catch (error) {
    console.warn(`Error extracting gallery modified date:`, error);
    return null;
  }
}

/**
 * Templates have NO modified date fields - always return null
 * @param template Template entity object
 * @returns Always null - templates require full refresh
 */
export function extractTemplateModifiedDate(template: any): string | null {
  // Templates have no modified date fields based on analysis
  // Always return null to force full refresh
  return null;
}

/**
 * Parse human-readable date format to ISO 8601
 * Handles format: "03/05/2025 08:11AM"
 * @param humanDate Human-readable date string
 * @returns ISO 8601 date string or null if parsing fails
 */
function parseHumanReadableDate(humanDate: string): string | null {
  try {
    // Format: "03/05/2025 08:11AM"
    // Parse using Date constructor which handles MM/DD/YYYY format
    const parsed = new Date(humanDate);

    if (isNaN(parsed.getTime())) {
      console.warn(`Failed to parse human date format: ${humanDate}`);
      return null;
    }

    return parsed.toISOString();
  } catch (error) {
    console.warn(`Error parsing human date format "${humanDate}":`, error);
    return null;
  }
}

/**
 * Normalize various ISO 8601 formats to consistent format
 * @param isoDate ISO 8601 date string (may have different precision)
 * @returns Normalized ISO 8601 date string or null if invalid
 */
function normalizeToISO8601(isoDate: string): string | null {
  try {
    const parsed = new Date(isoDate);

    if (isNaN(parsed.getTime())) {
      console.warn(`Failed to parse ISO date: ${isoDate}`);
      return null;
    }

    return parsed.toISOString();
  } catch (error) {
    console.warn(`Error normalizing ISO date "${isoDate}":`, error);
    return null;
  }
}

/**
 * Get the appropriate date extractor function for an entity type
 * @param entityType The entity type name
 * @returns Date extractor function or null if no dates available
 */
export function getDateExtractorForEntityType(
  entityType: string
): ((entity: any) => string | null) | null {
  switch (entityType.toLowerCase()) {
    case 'models':
      return extractModelModifiedDate;
    case 'containers':
      return extractContainerModifiedDate;
    case 'content':
    case 'items':
      return extractContentItemModifiedDate;
    case 'assets':
      return extractAssetModifiedDate;
    case 'pages':
      return extractPageModifiedDate;
    case 'galleries':
      return extractGalleryModifiedDate;
    case 'templates':
      return extractTemplateModifiedDate; // Always returns null
    default:
      console.warn(`Unknown entity type for date extraction: ${entityType}`);
      return null;
  }
}

/**
 * Entity types that support incremental pulling (have modified dates)
 */
export const INCREMENTAL_SUPPORTED_TYPES = [
  'models',
  'containers',
  'content',
  'assets',
  'pages',
  'galleries',
];

/**
 * Entity types that require full refresh (no modified dates)
 */
export const FULL_REFRESH_REQUIRED_TYPES = ['templates'];
