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
    lists: mgmtApi.Container[];
    containers: mgmtApi.Container[];
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
 * Individual failure detail with optional link metadata
 */
export interface FailureDetail {
    name: string;
    error: string;
    type?: 'content' | 'page';  // For generating appropriate link
    pageID?: number;            // Source page ID for page links
    contentID?: number;         // Source content ID for content links
    guid?: string;              // Source instance GUID
    locale?: string;            // Locale code
}

/**
 * Standardized pusher result interface for all pusher operations
 * Replaces inline type definitions with consistent response structure
 */
export interface PusherResult {
    successful: number;
    failed: number;
    skipped: number;
    status: 'success' | 'error';
    publishableIds?: number[]; // Optional: target instance IDs for workflow operations (content items and pages only)
    failureDetails?: FailureDetail[]; // Individual failure details for error summary
}

/**
 * Pusher function signature with standardized types
 */
export type PusherFunction = (
    sourceData: SourceData,
    referenceMapper: any, // TODO: Import proper ReferenceMapper type
    onProgress?: PusherProgressCallback
) => Promise<PusherResult>; 