/**
 * Shared TypeScript interfaces and types for dependency analysis system
 */

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
} 