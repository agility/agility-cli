import * as fs from 'fs';
import * as path from 'path';
import { SitemapNode, PageHierarchy, HierarchicalPageGroup, SourceEntities } from '../../../types/syncAnalysis';

/**
 * Load and parse sitemap hierarchy for hierarchical page chain analysis
 */
export class SitemapHierarchy {
    private rootPath: string;
    private sourceGuid: string;
    private locale: string;
    private isPreview: boolean;

    constructor(rootPath: string, sourceGuid: string, locale: string, isPreview: boolean) {
        // Ensure rootPath points to agility-files directory (same pattern as chain-data-loader.ts)
        this.rootPath = rootPath.endsWith('agility-files') 
            ? rootPath 
            : path.join(rootPath, 'agility-files');
        this.sourceGuid = sourceGuid;
        this.locale = locale;
        this.isPreview = isPreview;
    }

    /**
     * Load nested sitemap from the file system
     */
    loadNestedSitemap(): SitemapNode[] | null {
        try {
            const sitemapPath = path.join(
                this.rootPath,
                this.sourceGuid,
                this.locale,
                this.isPreview ? 'preview' : 'live',
                'nestedsitemap',
                'website.json'
            );

            if (!fs.existsSync(sitemapPath)) {
                console.warn(`Nested sitemap not found at: ${sitemapPath}`);
                return null;
            }

            const sitemapData = fs.readFileSync(sitemapPath, 'utf8');
            const sitemap: SitemapNode[] = JSON.parse(sitemapData);
            
            console.log(`✅ Loaded nested sitemap with ${sitemap.length} top-level nodes`);
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
            if (childIds.includes(pageId)) {
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
        
        directChildIds.forEach(childId => {
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
        console.log('\n🔍 DEBUG: Page Hierarchy Structure');
        Object.entries(hierarchy).forEach(([parentId, childIds]) => {
            console.log(`  Parent ${parentId} has children: ${childIds.join(', ')}`);
        });
    }
} 