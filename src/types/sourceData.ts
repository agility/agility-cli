import * as mgmtApi from "@agility/management-sdk";

/**
 * Standardized source data structure for all pusher operations
 * Replaces 'any' type usage with proper TypeScript interfaces
 */
export interface SourceData {
    pages: mgmtApi.PageItem[];
    content: mgmtApi.ContentItem[];
    models: mgmtApi.Model[];
    templates: mgmtApi.PageModel[];
    containers: any[]; // TODO: Find proper container type from management SDK
    assets: mgmtApi.Media[];
    galleries: mgmtApi.assetMediaGrouping[];
}

/**
 * Standardized progress callback for all pusher operations
 * Consolidates tracking into single callback pattern
 */
export type PusherProgressCallback = (
    processed: number,
    total: number,
    status: 'success' | 'error' | 'skipped',
    itemName?: string
) => void;

/**
 * Standardized pusher result interface for all pusher operations
 * Replaces inline type definitions with consistent response structure
 */
export interface PusherResult {
    successful: number;
    failed: number;
    skipped: number;
    status: 'success' | 'error';
    publishableIds?: number[]; // Optional: target instance IDs for auto-publishing (content items and pages only)
}

/**
 * Pusher function signature with standardized types
 */
export type PusherFunction = (
    sourceData: SourceData,
    referenceMapper: any, // TODO: Import proper ReferenceMapper type
    onProgress?: PusherProgressCallback
) => Promise<PusherResult>; 