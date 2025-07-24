import * as fs from 'fs';
import * as path from 'path';
import { SitemapNode, PageHierarchy, HierarchicalPageGroup, SourceEntities } from '../../types/syncAnalysis';
import { getState } from '../../core/state';

/**
 * Load and parse sitemap hierarchy for hierarchical page chain analysis
 */
export class SitemapHierarchy {
    constructor() {
        // Configuration now comes from state internally
    }

    loadAllSitemaps() {
        const state = getState();

        const sitemapDir = path.join(
            state.rootPath,
            state.sourceGuid[0],
            state.locale[0],
            'nestedsitemap'
        );

        const sitemaps: { [key: string]: SitemapNode[] | null } = {};

        fs.readdirSync(sitemapDir).forEach(fileName => {
            if (!fileName.endsWith('.json')) {
                return; // Skip non-JSON files
            }
            const channel = path.basename(fileName, '.json');

            sitemaps[channel] = this.loadNestedSitemap(channel);
        });

        return sitemaps;
    }

    /**
     * Load nested sitemap from the file system
     */
    loadNestedSitemap(channel: string): SitemapNode[] | null {
        try {
            const state = getState();
            let sitemapPath: string;

            if (state.legacyFolders) {
                // Legacy mode: flat structure {rootPath}/nestedsitemap/website.json
                sitemapPath = path.join(state.rootPath, 'nestedsitemap', `${channel.toLowerCase()}.json`);
            } else {
                // Normal mode: nested structure {rootPath}/{guid}/{locale}/nestedsitemap/website.json
                sitemapPath = path.join(
                    state.rootPath,
                    state.sourceGuid[0],
                    state.locale[0],
                    'nestedsitemap',
                    `${channel.toLowerCase()}.json`
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
     * ✅ NEW: Find page parent from source sitemap with comprehensive lookup
     * Handles both template pages and dynamic page instances
     */
    findPageParentInSourceSitemap(pageId: number, pageName: string, channelName: string): { parentId: number | null; parentName: string | null; foundIn: string } {
        try {
            const sitemap = this.loadNestedSitemap(channelName);
            if (!sitemap || sitemap.length === 0) {
                return { parentId: null, parentName: null, foundIn: 'no-sitemap' };
            }



            // Recursive function to search through sitemap
            const searchSitemap = (nodes: SitemapNode[], parentNode: SitemapNode | null = null): { parentId: number | null; parentName: string | null; foundIn: string } => {
                for (const node of nodes) {
                    // Check if this node is our target page
                    if (node.pageID === pageId || node.name === pageName) {
                        if (parentNode) {
                            console.log(`🎯 [DEBUG] Found ${pageName} (ID:${pageId}) under parent ${parentNode.name} (ID:${parentNode.pageID})`);
                            return {
                                parentId: parentNode.pageID,
                                parentName: parentNode.name,
                                foundIn: 'direct-match'
                            };
                        } else {
                            console.log(`🏠 [DEBUG] Found ${pageName} (ID:${pageId}) at root level`);
                            return { parentId: null, parentName: null, foundIn: 'root-level' };
                        }
                    }

                    // Check if this node has children (dynamic page instances)
                    if (node.children && node.children.length > 0) {
                        // For dynamic pages: check if any child has same pageID as template
                        const dynamicMatch = node.children.find(child => child.pageID === pageId);
                        if (dynamicMatch) {
                            console.log(`🎯 [DEBUG] Found dynamic page ${pageName} (ID:${pageId}) under parent ${node.name} (ID:${node.pageID})`);
                            return {
                                parentId: node.pageID,
                                parentName: node.name,
                                foundIn: 'dynamic-child'
                            };
                        }

                        // Recursively search children
                        const childResult = searchSitemap(node.children, node);
                        if (childResult.parentId !== null) {
                            return childResult;
                        }
                    }
                }
                return { parentId: null, parentName: null, foundIn: 'not-found' };
            };

            const result = searchSitemap(sitemap);
            console.log(`📍 [DEBUG] Parent lookup result for ${pageName}:`, result);
            return result;

        } catch (error) {
            console.error(`❌ [DEBUG] Error looking up parent for ${pageName}:`, error.message);
            return { parentId: null, parentName: null, foundIn: 'error' };
        }
    }

    /**
     * ✅ NEW: Enhanced hierarchy build that handles dynamic pages correctly
     */
    buildPageHierarchyWithDynamicSupport(sitemap: SitemapNode[]): PageHierarchy {
        const hierarchy: PageHierarchy = {};

        const processNode = (node: SitemapNode, parentNode: SitemapNode | null = null) => {
            // If this node has children, add them to hierarchy
            if (node.children && node.children.length > 0) {
                hierarchy[node.pageID] = node.children.map(child => child.pageID);

                // Process children recursively
                node.children.forEach(child => processNode(child, node));
            }

            // Special handling for dynamic pages
            // If this node has dynamic children (contentID present), also map those
            if (node.children) {
                node.children.forEach(child => {
                    if (child.contentID) {
                        // This is a dynamic page instance - ensure it knows its parent
                        if (!hierarchy[node.pageID]) {
                            hierarchy[node.pageID] = [];
                        }
                        if (!hierarchy[node.pageID].includes(child.pageID)) {
                            hierarchy[node.pageID].push(child.pageID);
                        }
                    }
                });
            }
        };

        sitemap.forEach(node => processNode(node));
        return hierarchy;
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

    /**
     * Extract sibling ordering information from source sitemap
     * Returns a map of pageID → nextSiblingPageID for proper insertion order
     */
    extractSiblingOrderFromSitemap(sitemap: SitemapNode[]): Map<number, number | null> {
        const siblingOrderMap = new Map<number, number | null>();

        const processSiblings = (siblings: SitemapNode[], depth: number = 0) => {
            for (let i = 0; i < siblings.length; i++) {
                const currentPage = siblings[i];
                const nextSibling = i < siblings.length - 1 ? siblings[i + 1] : null;

                // Map current page to its next sibling (or null if last)
                siblingOrderMap.set(currentPage.pageID, nextSibling?.pageID || null);

                // Process child pages recursively
                if (currentPage.children && currentPage.children.length > 0) {
                    processSiblings(currentPage.children, depth + 1);
                }
            }
        };

        processSiblings(sitemap, 0);

        return siblingOrderMap;
    }

    /**
     * Get the pageID that should come BEFORE the specified page (for insertBefore parameter)
     * FIXED: Returns the NEXT sibling (what this page should go before), not the previous sibling
     */
    getInsertBeforePageId(pageId: number, siblingOrder: Map<number, number | null>): number | null {

        // FIXED: Return the next sibling directly - this page should go BEFORE its next sibling
        const nextSiblingId = siblingOrder.get(pageId) || null;

        if (nextSiblingId) {
            return nextSiblingId;
        } else {
            return null; // No next sibling found (page is last in its group, will place at end)
        }
    }

    /**
     * Build comprehensive page ordering data including parent-child and sibling relationships
     */
    buildPageOrderingData(sitemap: SitemapNode[]): {
        hierarchy: PageHierarchy;
        siblingOrder: Map<number, number | null>;
        parentToChildrenMap: Map<number, number[]>;
    } {
        const hierarchy = this.buildPageHierarchyWithDynamicSupport(sitemap);
        const siblingOrder = this.extractSiblingOrderFromSitemap(sitemap);

        // Build parent-to-children mapping for quick lookup
        const parentToChildrenMap = new Map<number, number[]>();
        Object.entries(hierarchy).forEach(([parentIdStr, childIds]) => {
            const parentId = parseInt(parentIdStr);
            parentToChildrenMap.set(parentId, childIds as number[]);
        });

        return {
            hierarchy,
            siblingOrder,
            parentToChildrenMap
        };
    }

    /**
     * Get processing order that preserves both parent-child dependencies AND sibling order
     */
    getOrderedProcessingSequence(pages: any[], sitemap: SitemapNode[]): {
        orderedPages: any[];
        orderingData: {
            hierarchy: PageHierarchy;
            siblingOrder: Map<number, number | null>;
            parentToChildrenMap: Map<number, number[]>;
        };
    } {
        const orderingData = this.buildPageOrderingData(sitemap);
        const { hierarchy } = orderingData;

        // Get dependency-safe order (parents before children)
        const { orderedPages } = this.getProcessingOrder(pages, hierarchy);

        // Within each depth level, sort by sibling order
        const pageDepths = this.calculatePageDepths(pages, hierarchy);
        const pagesByDepth = this.getPagesByDepth(pages, pageDepths);

        // Rebuild ordered pages respecting sibling order within each depth
        const finalOrderedPages: any[] = [];
        const sortedDepths = Array.from(pagesByDepth.keys()).sort((a, b) => a - b);

        sortedDepths.forEach(depth => {
            const pagesAtDepth = pagesByDepth.get(depth) || [];

            // Group pages by parent for sibling ordering
            const pagesByParent = new Map<number, any[]>();
            pagesAtDepth.forEach(page => {
                const parentId = this.getParentPageId(page.pageID, hierarchy) || -1;
                if (!pagesByParent.has(parentId)) {
                    pagesByParent.set(parentId, []);
                }
                pagesByParent.get(parentId)!.push(page);
            });

            // Sort each parent group by sibling order
            pagesByParent.forEach((siblings, parentId) => {
                const sortedSiblings = this.sortPagesBySiblingOrder(siblings, orderingData.siblingOrder);
                finalOrderedPages.push(...sortedSiblings);
            });
        });

        return {
            orderedPages: finalOrderedPages,
            orderingData
        };
    }

    /**
     * Sort pages by their sibling order from the sitemap
     */
    private sortPagesBySiblingOrder(pages: any[], siblingOrder: Map<number, number | null>): any[] {
        // Create a map to track the position of each page in the sibling order
        const pagePositions = new Map<number, number>();

        // Build position map by following the sibling chain
        let position = 0;
        let currentPageId: number | null = null;

        // Find the first page (one that is not a next sibling of any other page)
        const allNextSiblings = new Set(Array.from(siblingOrder.values()).filter(id => id !== null));
        const firstPage = pages.find(page => !allNextSiblings.has(page.pageID));

        if (firstPage) {
            currentPageId = firstPage.pageID;

            // Follow the sibling chain to assign positions
            while (currentPageId !== null) {
                pagePositions.set(currentPageId, position++);
                currentPageId = siblingOrder.get(currentPageId) || null;
            }
        }

        // Sort pages by their positions (pages without positions go to end)
        return pages.sort((a, b) => {
            const posA = pagePositions.get(a.pageID) ?? 9999;
            const posB = pagePositions.get(b.pageID) ?? 9999;
            return posA - posB;
        });
    }

    /**
     * Get parent page ID for a given page
     */
    private getParentPageId(pageId: number, hierarchy: PageHierarchy): number | null {
        for (const [parentIdStr, childIds] of Object.entries(hierarchy)) {
            if ((childIds as number[]).includes(pageId)) {
                return parseInt(parentIdStr);
            }
        }
        return null;
    }
}
