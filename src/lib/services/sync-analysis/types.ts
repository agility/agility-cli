/**
 * Shared Types and Interfaces for Sync Analysis Services
 * 
 * This file contains all shared type definitions used across the sync analysis
 * service modules to ensure consistency and type safety.
 */

export interface TwoPassSyncOptions {
    debug: boolean;
    maxDepth?: number;
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

export interface AssetReference {
    url: string;
    fieldPath: string;
}

export interface ContainerReference {
    contentID: number;
    fieldPath: string;
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

export interface BrokenChain {
    entity: any;
    missing: string[];
}

export interface EntityType {
    name: string;
    total: number;
    inChains: number;
    note: string;
}

export interface SyncAnalysisContext {
    rootPath: string;
    sourceGuid: string;
    locale: string;
    isPreview: boolean;
    debug: boolean;
    elements: string[];
}

export interface DependencyValidationResult {
    missing: string[];
    isBroken: boolean;
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