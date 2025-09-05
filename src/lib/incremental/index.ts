/**
 * Incremental Pull Utilities
 *
 * Exports all utilities needed for incremental pull operations:
 * - Entity-specific modified date extractors
 * - Timestamp tracking system
 * - Incremental vs full pull decision logic
 */

// Date extractors for each entity type
export {
  extractModelModifiedDate,
  extractContainerModifiedDate,
  extractContentItemModifiedDate,
  extractAssetModifiedDate,
  extractPageModifiedDate,
  extractGalleryModifiedDate,
  extractTemplateModifiedDate,
  getDateExtractorForEntityType,
  INCREMENTAL_SUPPORTED_TYPES,
  FULL_REFRESH_REQUIRED_TYPES,
} from './date-extractors';

// Timestamp tracking system
export {
  LastPullTimestamps,
  loadLastPullTimestamps,
  saveLastPullTimestamps,
  updateEntityTypeTimestamp,
  getLastPullTimestamp,
  isEntityModifiedSinceLastPull,
  markPullStart,
  markPushStart,
  clearTimestamps,
  getIncrementalPullDecision,
} from './timestamp-tracker';
