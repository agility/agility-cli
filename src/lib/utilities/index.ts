/**
 * Central exports for all utility functions and classes
 */

// Data loading utilities
export { 
  SourceDataLoader, 
  type SourceEntities 
} from './source-data-loader';

// Reference mapping utilities
export { ReferenceMapper } from './reference-mapper';

// Content field validation
export { 
  ContentFieldValidator,
  createContentFieldValidator,
  validateField,
  type FieldValidationResult,
  type ContentValidationOptions
} from './content-field-validation';

// Content analysis utilities
export { SitemapHierarchy } from './sitemap-hierarchy';
export { LinkTypeDetector } from './link-type-detector';
export { AssetReferenceExtractor } from './asset-reference-extractor';

// Content processing utilities
export { ContentFieldMapper } from './content-field-mapper';
export { 
  ContentClassifier,
  type ContentClassification
} from './content-classifier';
export { 
  ContentBatchProcessor,
  type ContentBatchConfig
} from './content-batch-processor';

// Asset utilities
export { getAssetFilePath } from './asset-utils';

// Generation utilities
export { generateEnv } from './generate-env';
export { generateSitemap } from './generate-sitemap';
export { default as generateTypescriptModels } from './generate-typescript-models';
export { default as generateComponents } from './generate-components';

// Legacy aliases for backward compatibility
export { default as generateTypes } from './generate-typescript-models';
export { default as generateReactComponents } from './generate-components'; 