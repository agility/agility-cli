/**
 * Central exports for all utility functions and classes
 * Enables clean single-line imports: import { ChainDataLoader, ContentFieldValidator, ... } from './lib/utilities'
 */

// Data loading and validation utilities
export { 
  ChainDataLoader, 
  type SourceEntities, 
  type ChainDataLoaderOptions 
} from './chain-data-loader';

export { 
  ContentFieldValidator,
  createContentFieldValidator,
  validateField,
  type FieldValidationResult,
  type ContentValidationOptions
} from './content-field-validation';

// Content analysis utilities
export { SitemapHierarchy } from './sitemap-hierarchy';
export { 
  LinkTypeDetector, 
  type LinkTypeDetection, 
  type ContentFieldAnalysis 
} from './link-type-detector';
export { AssetReferenceExtractor } from './asset-reference-extractor';

// Content processing utilities
export { ContentFieldMapper } from './content-field-mapper';
export { 
  ContentBatchProcessor,
  type ContentBatchConfig,
  type BatchProcessingResult,
  type BatchSuccessItem,
  type BatchFailedItem,
  type BatchProgressCallback
} from './content-batch-processor';
export { 
  ContentClassifier,
  type ContentClassification
} from './content-classifier';
export { MappingDependencyEnforcer } from './mapping-dependency-enforcer';
export { 
  bulkFilterByExistingMappings,
  bulkFilterByExistingMappingsGeneric,
  type BulkFilterResult
} from './bulk-mapping-filter';

// Instance utilities
export { instanceSelector } from './instance-selector';
export { listInstances } from './instance-lister';

// Asset utilities
export { getAssetFilePath } from './asset-utils';

// Batch processing utilities
export { 
  pollBatchUntilComplete,
  extractBatchResults,
  prettyException,
  logBatchError
} from './batch-polling';

// Generation utilities
export { default as generateTypes } from './generate-typescript-models';
export { default as generateReactComponents } from './generate-components';
export { generateEnv } from './generate-env';
export { generateSitemap } from './generate-sitemap'; 