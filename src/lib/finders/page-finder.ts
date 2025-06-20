import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../utilities/reference-mapper";

/**
 * Get target sitemap for page lookups (cached for performance)
 */
let _targetSitemapCache: { [guid: string]: any } = {};

/**
 * Flatten nested sitemap structure to get all pages at all levels
 */
function flattenSitemapPages(pages: any[]): any[] {
    const flatPages: any[] = [];
    
    function addPagesRecursively(pageArray: any[]) {
        for (const page of pageArray) {
            flatPages.push(page);
            if (page.childPages && Array.isArray(page.childPages)) {
                addPagesRecursively(page.childPages);
            }
        }
    }
    
    addPagesRecursively(pages);
    return flatPages;
}

async function getTargetSitemap(apiClient: mgmtApi.ApiClient, targetGuid: string, locale: string): Promise<any> {
    const cacheKey = `${targetGuid}-${locale}`;
    
    if (!_targetSitemapCache[cacheKey]) {
        const sitemap = await apiClient.pageMethods.getSitemap(targetGuid, locale);
        _targetSitemapCache[cacheKey] = sitemap;
        
        const websiteChannel = sitemap?.find(channel => channel.digitalChannelTypeName === 'Website');
        if (websiteChannel && websiteChannel.pages) {
            const flatPages = flattenSitemapPages(websiteChannel.pages);
            (websiteChannel as any).flatPages = flatPages;
        }
    }
    
    return _targetSitemapCache[cacheKey];
}

/**
 * Clear the sitemap cache (useful for testing or when target instance changes)
 */
export function clearSitemapCache(targetGuid?: string, locale?: string): void {
    if (targetGuid && locale) {
        const cacheKey = `${targetGuid}-${locale}`;
        delete _targetSitemapCache[cacheKey];
    } else {
        _targetSitemapCache = {};
    }
}

/**
 * Find if a page already exists in the target instance using sitemap data
 */
export async function findPageInTargetInstance(
    sourcePage: mgmtApi.PageItem,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    locale: string,
    referenceMapper: ReferenceMapper,
    sitemapPath?: string
): Promise<mgmtApi.PageItem | null> {
    
    try {
        // Check reference mappings first (fastest)
        const existingMapping = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', sourcePage.pageID);
        if (existingMapping?.target) {
            // Found in mappings (silent)
            return existingMapping.target;
        }

        // Get target sitemap and flatten nested pages
        const sitemap = await getTargetSitemap(apiClient, targetGuid, locale);
        const websiteChannel = sitemap?.find(channel => channel.digitalChannelTypeName === 'Website');
        
        if (!websiteChannel || !(websiteChannel as any).flatPages) {
            return null;
        }

        const targetPages = (websiteChannel as any).flatPages;

        // Find pages with matching names
        const nameMatches = targetPages.filter((targetPage: any) => {
            const targetPageName = targetPage.pageName || targetPage.name || targetPage.title;
            return targetPageName === sourcePage.name;
        });

        if (nameMatches.length === 0) {
            return null;
        }

        if (nameMatches.length === 1) {
            // Single match - return it
            const match = nameMatches[0];
            const fullPage = await apiClient.pageMethods.getPage(match.pageID, targetGuid, locale);
            return fullPage;
        }

        // Multiple matches - use parent hierarchy to disambiguate
        const sourceParentId = sourcePage.parentPageID || (sourcePage as any).parentID || -1;
        let targetParentId = -1;
        
        if (sourceParentId > 0) {
            const parentMapping = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', sourceParentId);
            if (parentMapping?.target) {
                targetParentId = parentMapping.target.pageID;
            }
        }

        const hierarchyMatch = nameMatches.find((targetPage: any) => {
            const targetPageParentId = targetPage.parentPageID || targetPage.parentID || -1;
            return (targetParentId === -1 && targetPageParentId <= 0) || 
                   (targetParentId === targetPageParentId);
        });
        
        if (hierarchyMatch) {
            const fullPage = await apiClient.pageMethods.getPage(hierarchyMatch.pageID, targetGuid, locale);
            return fullPage;
        }

        return null;

    } catch (error: any) {
        return null;
    }
} 