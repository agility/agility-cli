/**
 * Shared TypeScript interfaces and types for sync analysis system
 */

/**
 * Model tracking to prevent duplicates across all chain displays
 */
export interface ModelTracker {
  displayedModels: Set<string>;
  isModelDisplayed(modelName: string): boolean;
  markModelDisplayed(modelName: string): void;
  reset(): void;
}

/**
 * Context for sync analysis operations
 */
export interface SyncAnalysisContext {
  sourceGuid: string;
  locale: string;
  isPreview: boolean;
  rootPath: string;
  legacyFolders?: boolean;
  debug: boolean;
  elements: string[];
  modelTracker?: ModelTracker; // Optional model tracking for duplicate detection
}

/**
 * Base interface for all sync analysis services
 */
export interface SyncAnalysisService {
  /**
   * Initialize the service with context
   */
  initialize(context: SyncAnalysisContext): void;
}

/**
 * Interface for services that analyze specific entity chains
 */
export interface ChainAnalysisService extends SyncAnalysisService {
  /**
   * Analyze and display the chains for this service's domain
   */
  analyzeChains(sourceEntities: SourceEntities): void;
}

/**
 * Interface for utility services that extract references
 */
export interface ReferenceExtractionService extends SyncAnalysisService {
  /**
   * Extract references from the given data structure
   */
  extractReferences(data: any): any[];
}

/**
 * Interface for services that validate dependencies
 */
export interface DependencyValidationService extends SyncAnalysisService {
  /**
   * Validate dependencies for a given entity
   */
  validateDependencies(entity: any, sourceEntities: SourceEntities): DependencyValidationResult;
}

/**
 * Result of dependency validation
 */
export interface DependencyValidationResult {
  missing: string[];
  isBroken: boolean;
}

export interface SitemapNode {
  title: string | null;
  name: string;
  pageID: number;
  menuText: string;
  visible: {
    menu: boolean;
    sitemap: boolean;
  };
  path: string;
  redirect: { url: string; target: string } | null;
  isFolder: boolean;
  contentID?: number;
  children?: SitemapNode[];
}

export interface PageHierarchy {
  [parentPageID: number]: number[]; // parent ID → array of child IDs
}

export interface HierarchicalPageGroup {
  rootPage: any;
  childPages: any[];
  allPageIds: Set<number>;
}

export interface SourceEntities {
  pages?: any[];
  content?: any[];
  models?: any[];
  templates?: any[];
  containers?: any[];
  assets?: any[];
  galleries?: any[];
}

export interface MissingDependency {
  type: string;
  id: string | number;
  name?: string;
}

export interface BrokenChain {
  entity: any;
  missing: string[];
  type: 'page' | 'container' | 'model';
}

export interface EntityCounts {
  pages: number;
  content: number;
  models: number;
  templates: number;
  containers: number;
  assets: number;
  galleries: number;
}

export interface EntitiesInChains {
  pages: Set<number>;
  content: Set<number>;
  models: Set<string>;
  templates: Set<string>;
  containers: Set<number>;
  assets: Set<string>;
  galleries: Set<number>;
}

export interface AssetReference {
  url: string;
  fieldPath: string;
}

export interface ContainerReference {
  contentID: number;
  fieldPath: string;
  referenceName?: string; // Optional: container reference name for lookup
}
