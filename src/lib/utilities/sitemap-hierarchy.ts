import * as fs from 'fs';
import * as path from 'path';
import { SitemapNode, PageHierarchy, HierarchicalPageGroup, SourceEntities } from '../../types/syncAnalysis';
import { getState } from '../services/state';

/**
 * Load and parse sitemap hierarchy for hierarchical page chain analysis
 */
export class SitemapHierarchy {
    constructor() {
        // Configuration now comes from state internally
    }

    /**
     * Load nested sitemap from the file system
     */
    loadNestedSitemap(): SitemapNode[] | null {
        try {
            const state = getState();
            let sitemapPath: string;
            
            if (state.legacyFolders) {
                // Legacy mode: flat structure {rootPath}/nestedsitemap/website.json
                sitemapPath = path.join(state.rootPath, 'nestedsitemap', 'website.json');
            } else {
                // Normal mode: nested structure {rootPath}/{guid}/{locale}/{mode}/nestedsitemap/website.json
                sitemapPath = path.join(
                    state.rootPath,
                    state.sourceGuid,
                    state.locale,
                    state.preview ? 'preview' : 'live',
                    'nestedsitemap',
                    'website.json'
                );
            }

            if (!fs.existsSync(sitemapPath)) {
                console.warn(`Nested sitemap not found at: ${sitemapPath}`);
                return null;
            }

            const sitemapData = fs.readFileSync(sitemapPath, 'utf8');
            const sitemap: SitemapNode[] = JSON.parse(sitemapData);
            
            // Loaded nested sitemap (silent)
            return sitemap;
        } catch (error) {
            console.error(`Error loading nested sitemap: ${error.message}`);
            return null;
        }
    }

    /**
     * Build page hierarchy map from nested sitemap
     */
    buildPageHierarchy(sitemap: SitemapNode[]): PageHierarchy {
        const hierarchy: PageHierarchy = {};

        const processNode = (node: SitemapNode) => {
            if (node.children && node.children.length > 0) {
                // This node has children
                hierarchy[node.pageID] = node.children.map(child => child.pageID);
                
                // Recursively process children
                node.children.forEach(child => processNode(child));
            }
        };

        sitemap.forEach(node => processNode(node));
        return hierarchy;
    }

    /**
     * Group pages hierarchically based on sitemap structure
     */
    groupPagesHierarchically(pages: any[], hierarchy: PageHierarchy): HierarchicalPageGroup[] {
        const processedPages = new Set<number>();
        const hierarchicalGroups: HierarchicalPageGroup[] = [];

        // Process each page that has children
        pages.forEach(page => {
            if (!processedPages.has(page.pageID) && hierarchy[page.pageID]) {
                // This page has children, create a group for it
                const group = this.buildHierarchicalGroup(page, pages, hierarchy, processedPages);
                hierarchicalGroups.push(group);
            }
        });

        // Process remaining pages that don't have children and aren't children of processed pages
        pages.forEach(page => {
            if (!processedPages.has(page.pageID)) {
                // This is an orphaned page (no children, not a child of any processed page)
                const group: HierarchicalPageGroup = {
                    rootPage: page,
                    childPages: [],
                    allPageIds: new Set([page.pageID])
                };
                hierarchicalGroups.push(group);
                processedPages.add(page.pageID);
            }
        });

        return hierarchicalGroups;
    }

    /**
     * Find the parent page ID for a given page (only if parent exists in our page list)
     */
    private findParentPageId(pageId: number, hierarchy: PageHierarchy, pages: any[]): number | null {
        for (const [parentId, childIds] of Object.entries(hierarchy)) {
            if ((childIds as number[]).includes(pageId)) {
                // Check if the parent exists in our page list
                const parentExists = pages.some(p => p.pageID === parseInt(parentId));
                if (parentExists) {
                    return parseInt(parentId);
                }
            }
        }
        return null;
    }

    /**
     * Build a hierarchical group starting from a root page
     */
    private buildHierarchicalGroup(
        rootPage: any, 
        allPages: any[], 
        hierarchy: PageHierarchy, 
        processedPages: Set<number>
    ): HierarchicalPageGroup {
        const group: HierarchicalPageGroup = {
            rootPage,
            childPages: [],
            allPageIds: new Set([rootPage.pageID])
        };

        // Mark root as processed
        processedPages.add(rootPage.pageID);

        // Collect ALL descendants with unlimited nesting levels
        this.collectAllDescendants(rootPage.pageID, allPages, hierarchy, group, processedPages);

        return group;
    }

    /**
     * Collect all descendants with unlimited nesting levels (not just direct children)
     * This enables proper display of deep hierarchies like PageID:A → PageID:B → PageID:C
     */
    private collectAllDescendants(
        parentPageId: number,
        allPages: any[],
        hierarchy: PageHierarchy,
        group: HierarchicalPageGroup,
        processedPages: Set<number>
    ): void {
        const directChildIds = hierarchy[parentPageId] || [];
        
        (directChildIds as number[]).forEach(childId => {
            const childPage = allPages.find(p => p.pageID === childId);
            if (childPage && !processedPages.has(childId)) {
                // Add this child to the current level
                group.childPages.push(childPage);
                group.allPageIds.add(childId);
                processedPages.add(childId);
                
                // Recursively collect ALL descendants (grandchildren, great-grandchildren, etc.)
                this.collectAllDescendants(childId, allPages, hierarchy, group, processedPages);
            }
        });
    }

    /**
     * Get orphaned pages (pages not in any hierarchical group)
     */
    getOrphanedPages(pages: any[], hierarchicalGroups: HierarchicalPageGroup[]): any[] {
        const allProcessedIds = new Set<number>();
        
        hierarchicalGroups.forEach(group => {
            group.allPageIds.forEach(id => allProcessedIds.add(id));
        });

        return pages.filter(page => !allProcessedIds.has(page.pageID));
    }

    /**
     * Debug: Log hierarchy structure
     */
    debugLogHierarchy(hierarchy: PageHierarchy): void {
        console.log(`🔧 [DEBUG] Page hierarchy structure:`);
        Object.entries(hierarchy).forEach(([parentId, childIds]) => {
            console.log(`  Parent ${parentId} has children: ${(childIds as number[]).join(', ')}`);
        });
    }

    /**
     * Calculate depth level for each page in the hierarchy
     * Depth 0 = root pages (no parents), Depth 1 = direct children, etc.
     */
    calculatePageDepths(pages: any[], hierarchy: PageHierarchy): Map<number, number> {
        const pageDepths = new Map<number, number>();
        const visited = new Set<number>();
        
        // Build reverse lookup: child → parent
        const childToParent = new Map<number, number>();
        Object.entries(hierarchy).forEach(([parentIdStr, childIds]) => {
            const parentId = parseInt(parentIdStr);
            (childIds as number[]).forEach(childId => {
                childToParent.set(childId, parentId);
            });
        });
        
        // Calculate depth recursively for each page
        const calculateDepth = (pageId: number): number => {
            if (visited.has(pageId)) {
                // Circular reference detected - return high depth to process early
                console.warn(`Circular reference detected for page ${pageId}`);
                return 999;
            }
            
            if (pageDepths.has(pageId)) {
                return pageDepths.get(pageId)!;
            }
            
            visited.add(pageId);
            
            const parentId = childToParent.get(pageId);
            if (!parentId) {
                // Root page (no parent)
                pageDepths.set(pageId, 0);
                visited.delete(pageId);
                return 0;
            }
            
            // Parent exists - depth is parent's depth + 1
            const parentDepth = calculateDepth(parentId);
            const depth = parentDepth + 1;
            pageDepths.set(pageId, depth);
            visited.delete(pageId);
            return depth;
        };
        
        // Calculate depth for all pages
        pages.forEach(page => {
            calculateDepth(page.pageID);
        });
        
        return pageDepths;
    }
    
    /**
     * Get pages grouped by depth level
     * Returns map of depth → pages at that depth
     */
    getPagesByDepth(pages: any[], pageDepths: Map<number, number>): Map<number, any[]> {
        const pagesByDepth = new Map<number, any[]>();
        
        pages.forEach(page => {
            const depth = pageDepths.get(page.pageID) || 0;
            if (!pagesByDepth.has(depth)) {
                pagesByDepth.set(depth, []);
            }
            pagesByDepth.get(depth)!.push(page);
        });
        
        return pagesByDepth;
    }
    
    /**
     * Generate dependency-safe page processing order
     * Returns pages ordered by depth (shallowest first) so parents are processed before children
     */
    getProcessingOrder(pages: any[], hierarchy: PageHierarchy): { orderedPages: any[]; depthInfo: Map<number, number> } {
        // Calculate page depths
        const pageDepths = this.calculatePageDepths(pages, hierarchy);
        
        // Group pages by depth
        const pagesByDepth = this.getPagesByDepth(pages, pageDepths);
        
        // Sort depth levels in ascending order (shallowest first = parents before children)
        const sortedDepths = Array.from(pagesByDepth.keys()).sort((a, b) => a - b);
        
        // Build ordered array with shallowest pages first (parents before children)
        const orderedPages: any[] = [];
        sortedDepths.forEach(depth => {
            const pagesAtDepth = pagesByDepth.get(depth) || [];
            // Sort pages within same depth by pageID for consistency
            pagesAtDepth.sort((a, b) => a.pageID - b.pageID);
            orderedPages.push(...pagesAtDepth);
        });
        
        // Page processing order calculated (silent)
        
        return { orderedPages, depthInfo: pageDepths };
    }
    
    /**
     * Validate page processing order is dependency-safe
     * Ensures no page is processed before its parent
     */
    validateProcessingOrder(orderedPages: any[], hierarchy: PageHierarchy): boolean {
        const processedPageIds = new Set<number>();
        
        // Build reverse lookup: child → parent
        const childToParent = new Map<number, number>();
        Object.entries(hierarchy).forEach(([parentIdStr, childIds]) => {
            const parentId = parseInt(parentIdStr);
            childIds.forEach(childId => {
                childToParent.set(childId, parentId);
            });
        });
        
        for (const page of orderedPages) {
            const parentId = childToParent.get(page.pageID);
            
            if (parentId && !processedPageIds.has(parentId)) {
                // This page's parent hasn't been processed yet - order is invalid
                console.error(`❌ Invalid processing order: Page ${page.pageID} scheduled before parent ${parentId}`);
                return false;
            }
            
            processedPageIds.add(page.pageID);
        }
        
        // Processing order validation passed (silent)
        return true;
    }
} 