import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapperV2 } from "../refMapper/reference-mapper-v2";
import { getState } from '../../core/state';
import { SyncDeltaReader } from "../shared/sync-delta-tracker";
import { FinderDecisionEngine, FinderDecision } from "../shared/target-safety-detector";

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
    referenceMapper: ReferenceMapperV2,
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

        // Find pages with matching names - try multiple name variations
        const nameMatches = targetPages.filter((targetPage: any) => {
            const targetPageName = targetPage.pageName || targetPage.name || targetPage.title;
            const targetMenuText = targetPage.menuText;
            
            // Try exact name match first
            if (targetPageName === sourcePage.name) return true;
            
            // Try matching against menu text
            if (targetMenuText && targetMenuText === sourcePage.name) return true;
            
            // Try matching against source page's title and menuText
            if (targetPageName === sourcePage.title || targetPageName === sourcePage.menuText) return true;
            
            return false;
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

        // Find best match based on hierarchy
        const hierarchyMatch = nameMatches.find((targetPage: any) => {
            const targetPageParentId = targetPage.parentPageID || targetPage.parentID || -1;
            return (targetParentId === -1 && targetPageParentId <= 0) || 
                   (targetParentId === targetPageParentId);
        });
        
        if (hierarchyMatch) {
            const fullPage = await apiClient.pageMethods.getPage(hierarchyMatch.pageID, targetGuid, locale);
            return fullPage;
        }

        // If no hierarchy match, check for exact path match
        const pathMatch = nameMatches.find((targetPage: any) => {
            const targetPath = targetPage.path || '';
            const sourcePath = sourcePage.path || '';
            return targetPath === sourcePath;
        });
        
        if (pathMatch) {
            const fullPage = await apiClient.pageMethods.getPage(pathMatch.pageID, targetGuid, locale);
            return fullPage;
        }

        // If still multiple matches, return the first one but log a warning
        if (nameMatches.length > 1) {
            console.warn(`⚠️ Multiple pages found with name "${sourcePage.name}" in target instance. Using first match (ID: ${nameMatches[0].pageID})`);
        }
        
        const firstMatch = nameMatches[0];
        const fullPage = await apiClient.pageMethods.getPage(firstMatch.pageID, targetGuid, locale);
        return fullPage;

    } catch (error: any) {
        return null;
    }
} 

export async function findPageInTargetInstanceEnhanced(
    sourcePage: mgmtApi.PageItem,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    locale: string,
    targetData: any,
    referenceMapper: ReferenceMapperV2
): Promise<{ page: mgmtApi.PageItem | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean; decision?: FinderDecision }> {
    const state = getState();

    // STEP 1: Find existing mapping
    const existingMapping = referenceMapper.getMappingByKey<mgmtApi.PageItem>('page', 'pageID', sourcePage.pageID);
    let targetPageFromMapping: mgmtApi.PageItem | null = existingMapping?.target || null;

    // STEP 2: Find target instance data
    const targetInstanceData = targetData.pages?.find((p: any) => 
        p.pageID === targetPageFromMapping?.pageID || p.name === sourcePage.name || p.path === sourcePage.path
    );

    // STEP 3: Fallback to API search if not found in data
    let finalTargetPage: mgmtApi.PageItem | null = targetInstanceData || targetPageFromMapping;
    if (!finalTargetPage) {
        finalTargetPage = await findPageInTargetInstance(sourcePage, apiClient, targetGuid, locale, referenceMapper);
    }

    // STEP 4: Use FinderDecisionEngine for proper conflict resolution
    const decision = FinderDecisionEngine.makeDecision(
        'page',
        sourcePage.pageID,
        sourcePage.name || `Page-${sourcePage.pageID}`,
        sourcePage,
        targetPageFromMapping,
        targetInstanceData
    );

    return { 
        page: finalTargetPage, 
        shouldUpdate: decision.shouldUpdate, 
        shouldCreate: decision.shouldCreate, 
        shouldSkip: decision.shouldSkip,
        decision: decision
    };
} 