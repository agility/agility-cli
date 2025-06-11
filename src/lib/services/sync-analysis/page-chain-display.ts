import ansiColors from 'ansi-colors';
import { SitemapHierarchy } from './sitemap-hierarchy';
import { 
    SourceEntities, 
    SitemapNode, 
    PageHierarchy, 
    HierarchicalPageGroup, 
    AssetReference,
    SyncAnalysisContext
} from '../../../types/syncAnalysis';

/**
 * Display hierarchical page chains with proper nesting
 */
export class PageChainDisplay {
    private rootPath: string;
    private sourceGuid: string;
    private locale: string;
    private isPreview: boolean;
    private debug: boolean;
    private context?: SyncAnalysisContext; // Optional context for model tracking

    constructor(rootPath: string, sourceGuid: string, locale: string, isPreview: boolean, debug: boolean = false, context?: SyncAnalysisContext) {
        this.rootPath = rootPath;
        this.sourceGuid = sourceGuid;
        this.locale = locale;
        this.isPreview = isPreview;
        this.debug = debug;
        this.context = context;
    }

    /**
     * Show all page chains with hierarchical structure
     */
    showAllPageChains(sourceEntities: SourceEntities): void {
        if (!sourceEntities.pages || sourceEntities.pages.length === 0) {
            console.log(ansiColors.gray('  No pages found in source data'));
            return;
        }

        // Load sitemap hierarchy
        const legacyFolders = this.context?.legacyFolders ?? false;
        const sitemapHierarchy = new SitemapHierarchy(this.rootPath, this.sourceGuid, this.locale, this.isPreview, legacyFolders);
        const sitemap = sitemapHierarchy.loadNestedSitemap();
        
        if (!sitemap) {
            // Fallback to flat display if no sitemap
            this.showFlatPageChains(sourceEntities);
            return;
        }

        // Build hierarchy and group pages
        const hierarchy = sitemapHierarchy.buildPageHierarchy(sitemap);
        const hierarchicalGroups = sitemapHierarchy.groupPagesHierarchically(sourceEntities.pages, hierarchy);
        const orphanedPages = sitemapHierarchy.getOrphanedPages(sourceEntities.pages, hierarchicalGroups);

        const totalPages = sourceEntities.pages.length;
        const totalGroups = hierarchicalGroups.length + orphanedPages.length;
        console.log(ansiColors.yellow(`Found ${totalPages} pages in ${totalGroups} hierarchical groups:`));

        // Display hierarchical groups
        hierarchicalGroups.forEach(group => {
            this.displayHierarchicalGroup(group, sourceEntities, hierarchy);
        });

        // Display orphaned pages (pages not in sitemap hierarchy)
        orphanedPages.forEach(page => {
            this.displaySinglePage(page, sourceEntities);
        });
    }

    /**
     * Display a hierarchical page group with proper unlimited nesting
     */
    private displayHierarchicalGroup(group: HierarchicalPageGroup, sourceEntities: SourceEntities, hierarchy: any): void {
        // Display root page
        const hasChildren = group.childPages.length > 0;
        const childIndicator = hasChildren ? ansiColors.blue(` [Parent: ${group.childPages.length} child page${group.childPages.length > 1 ? 's' : ''}]`) : '';
        
        const missing = this.findMissingDependenciesForPage(group.rootPage, sourceEntities);
        const isBroken = missing.length > 0;
        const brokenIndicator = isBroken ? ansiColors.red(' [BROKEN]') : '';
        
        console.log(ansiColors.white(`\n  PageID:${group.rootPage.pageID} (${group.rootPage.name || 'No Name'})${childIndicator}${brokenIndicator}`));
        
        // Show root page dependencies
        this.showPageDependencyHierarchy(group.rootPage, sourceEntities, '    ');

        // Display nested hierarchy with unlimited levels
        this.displayNestedChildren(group.rootPage.pageID, group.childPages, sourceEntities, hierarchy, '    ');
    }

    /**
     * Display nested children with unlimited hierarchy levels (recursive)
     * This properly shows PageID:A → PageID:B → PageID:C structure
     */
    private displayNestedChildren(
        parentPageId: number, 
        allChildPages: any[], 
        sourceEntities: SourceEntities, 
        hierarchy: any, 
        baseIndent: string
    ): void {
        // Find direct children of this parent
        const directChildIds = hierarchy[parentPageId] || [];
        const directChildren = allChildPages.filter(page => directChildIds.includes(page.pageID));

        directChildren.forEach((childPage, index) => {
            const isLast = index === directChildren.length - 1;
            const prefix = isLast ? '└─' : '├─';
            
            const childMissing = this.findMissingDependenciesForPage(childPage, sourceEntities);
            const childBroken = childMissing.length > 0;
            const childBrokenIndicator = childBroken ? ansiColors.red(' [BROKEN]') : '';
            
            // Handle folder pages differently - show as "Folder PageID:X (name)" 
            if (childPage.pageType === 'folder') {
                console.log(ansiColors.white(`${baseIndent}${prefix} Folder PageID:${childPage.pageID} (${childPage.name || 'No Name'})${childBrokenIndicator}`));
            } else {
                // Regular child pages - hierarchy makes parent-child relationship clear, no need for "Child:" prefix
                console.log(ansiColors.white(`${baseIndent}${prefix} PageID:${childPage.pageID} (${childPage.name || 'No Name'})${childBrokenIndicator}`));
            }
            
            // Show child page dependencies (only for non-folder pages)
            const childIndent = isLast ? `${baseIndent}    ` : `${baseIndent}│   `;
            if (childPage.pageType !== 'folder') {
                this.showPageDependencyHierarchy(childPage, sourceEntities, childIndent);
            }

            // Recursively display this child's children (unlimited nesting)
            this.displayNestedChildren(childPage.pageID, allChildPages, sourceEntities, hierarchy, childIndent);
        });
    }

    /**
     * Display a single page (not part of hierarchy)
     */
    private displaySinglePage(page: any, sourceEntities: SourceEntities): void {
        const missing = this.findMissingDependenciesForPage(page, sourceEntities);
        const isBroken = missing.length > 0;
        const brokenIndicator = isBroken ? ansiColors.red(' [BROKEN]') : '';
        
        // Handle folder pages differently - show as "Folder PageID:X (name)" without dependencies
        if (page.pageType === 'folder') {
            console.log(ansiColors.white(`\n  Folder PageID:${page.pageID} (${page.name || 'No Name'})${brokenIndicator}`));
            return; // No dependencies to show for folder pages
        }
        
        // Regular pages
        console.log(ansiColors.white(`\n  PageID:${page.pageID} (${page.name || 'No Name'})${brokenIndicator}`));
        this.showPageDependencyHierarchy(page, sourceEntities, '    ');
    }

    /**
     * Fallback to flat page display if no sitemap hierarchy available
     */
    private showFlatPageChains(sourceEntities: SourceEntities): void {
        const totalPages = sourceEntities.pages!.length;
        console.log(ansiColors.yellow(`Found ${totalPages} pages (flat display - no hierarchy available):`));
        
        sourceEntities.pages!.forEach(page => {
            this.displaySinglePage(page, sourceEntities);
        });
    }

    /**
     * Show complete dependency hierarchy for a single page
     * Enhanced to include all dependency details like the main system
     */
    private showPageDependencyHierarchy(page: any, sourceEntities: SourceEntities, indent: string): void {
        // Handle folder pages - don't show dependencies since they're now displayed as "Folder PageID:X"
        if (page.pageType === 'folder') {
            return; // No dependencies to show for folder pages
        }

        // Handle null template
        if (!page.templateName || page.templateName === null) {
            console.log(ansiColors.yellow(`${indent}├─ ${ansiColors.yellow('No template assigned')} (page.templateName is null)`));
            return;
        }

        // Find template
        const template = sourceEntities.templates?.find((t: any) => t.pageTemplateName === page.templateName);
        if (!template) {
            console.log(ansiColors.red(`${indent}├─ ${ansiColors.red(`Template:${page.templateName}`)} - MISSING IN SOURCE DATA`));
            return;
        }

        // Show template dependency
        console.log(ansiColors.magenta(`${indent}├─ Template:${template.pageTemplateName}`));
        
        // Show template's dependencies (containers, models, etc.)
        if (template.contentSectionDefinitions) {
            template.contentSectionDefinitions.forEach((section: any, sectionIndex: number) => {
                this.showTemplateSectionDependencies(section, sourceEntities, `${indent}│  `);
            });
        }

        // Show page zones (content in containers)
        if (page.zones) {
            this.showPageZoneDependencies(page.zones, sourceEntities, `${indent}│  `);
        }
    }

    /**
     * Show dependencies for a template section
     */
    private showTemplateSectionDependencies(section: any, sourceEntities: SourceEntities, indent: string): void {
        // Show container dependency
        if (section.itemContainerID) {
            const container = sourceEntities.containers?.find((c: any) => c.contentViewID === section.itemContainerID);
            if (container) {
                console.log(ansiColors.white(`${indent}├─ ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'})`));
                
                // Show container's model dependency with duplicate checking
                if (container.contentDefinitionID) {
                    const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
                    if (model) {
                        // Check if this model was already displayed
                        const isAlreadyDisplayed = this.context?.modelTracker?.isModelDisplayed(model.referenceName) ?? false;
                        
                        if (isAlreadyDisplayed) {
                            console.log(ansiColors.gray(`${indent}│  ├─ Model:${model.referenceName} (${model.displayName || 'No Name'}) [DUPLICATE]`));
                        } else {
                            console.log(ansiColors.green(`${indent}│  ├─ Model:${model.referenceName} (${model.displayName || 'No Name'})`));
                            // Mark as displayed if we have a tracker
                            this.context?.modelTracker?.markModelDisplayed(model.referenceName);
                        }
                    } else {
                        console.log(ansiColors.red(`${indent}│  ├─ Model:ID_${container.contentDefinitionID} - MISSING IN SOURCE DATA`));
                    }
                }
            } else {
                console.log(ansiColors.red(`${indent}├─ ContainerID:${section.itemContainerID} - MISSING IN SOURCE DATA`));
            }
        }
    }

    /**
     * Show dependencies for page zones
     */
    private showPageZoneDependencies(zones: any, sourceEntities: SourceEntities, indent: string): void {
        for (const [zoneName, zoneModules] of Object.entries(zones)) {
            if (Array.isArray(zoneModules) && zoneModules.length > 0) {
                console.log(ansiColors.gray(`${indent}├─ Zone: ${zoneName}`));
                
                zoneModules.forEach((module: any, moduleIndex: number) => {
                    // Find the container that matches the content in this module
                    if (module?.item?.contentid || module?.item?.contentId) {
                        const contentId = module.item.contentid || module.item.contentId;
                        const content = sourceEntities.content?.find((c: any) => c.contentID === contentId);
                        
                        if (content && content.properties?.referenceName) {
                            // Find the container that this content belongs to (case-insensitive match)
                            const container = sourceEntities.containers?.find((c: any) => 
                                c.referenceName && c.referenceName.toLowerCase() === content.properties.referenceName.toLowerCase()
                            );
                            
                            if (container) {
                                // Show container properly like template sections do
                                console.log(ansiColors.white(`${indent}│  ├─ ContainerID:${container.contentViewID} (${container.referenceName || 'No Name'})`));
                                
                                // Show container's model dependency
                                if (container.contentDefinitionID) {
                                    const model = sourceEntities.models?.find((m: any) => m.id === container.contentDefinitionID);
                                    if (model) {
                                        // Check if this model was already displayed
                                        const isAlreadyDisplayed = this.context?.modelTracker?.isModelDisplayed(model.referenceName) ?? false;
                                        
                                        if (isAlreadyDisplayed) {
                                            console.log(ansiColors.gray(`${indent}│  │  ├─ Model:${model.referenceName} (${model.displayName || 'No Name'}) [DUPLICATE]`));
                                        } else {
                                            console.log(ansiColors.green(`${indent}│  │  ├─ Model:${model.referenceName} (${model.displayName || 'No Name'})`));
                                            // Mark as displayed if we have a tracker
                                            this.context?.modelTracker?.markModelDisplayed(model.referenceName);
                                        }
                                    } else {
                                        console.log(ansiColors.red(`${indent}│  │  ├─ Model:ID_${container.contentDefinitionID} - MISSING IN SOURCE DATA`));
                                    }
                                }
                                
                                // Show the content
                                console.log(ansiColors.blue(`${indent}│  │  ├─ ContentID:${content.contentID} (${content.properties?.referenceName || 'No Name'})`));
                                
                                // Show content's asset dependencies
                                this.showContentAssetDependencies(content, sourceEntities, `${indent}│  │  │  `);
                                
                            } else {
                                // Fallback: show content with module name (old behavior for content without containers)
                                const moduleName = module?.module;
                                console.log(ansiColors.green(`${indent}│  ├─ Page Component Model:${moduleName || 'Unknown'}`));
                                console.log(ansiColors.blue(`${indent}│  │  ├─ ContentID:${content.contentID} (${content.properties?.referenceName || 'No Name'})`));
                                this.showContentAssetDependencies(content, sourceEntities, `${indent}│  │  `);
                            }
                        } else if (content) {
                            // Content exists but no referenceName
                            const moduleName = module?.module;
                            console.log(ansiColors.green(`${indent}│  ├─ Page Component Model:${moduleName || 'Unknown'}`));
                            console.log(ansiColors.blue(`${indent}│  │  ├─ ContentID:${content.contentID} (${content.properties?.referenceName || 'No Name'})`));
                            this.showContentAssetDependencies(content, sourceEntities, `${indent}│  │  `);
                        } else {
                            // Content not found
                            const moduleName = module?.module;
                            console.log(ansiColors.green(`${indent}│  ├─ Page Component Model:${moduleName || 'Unknown'}`));
                            console.log(ansiColors.red(`${indent}│  │  ├─ ContentID:${contentId} - MISSING IN SOURCE DATA`));
                        }
                    } else {
                        // Empty module - no content
                        const moduleName = module?.module;
                        console.log(ansiColors.green(`${indent}│  ├─ Page Component Model:${moduleName || 'Unknown'}`));
                        console.log(ansiColors.gray(`${indent}│  │  └─ (Empty component - no content assigned)`));
                    }
                });
            }
        }
    }

    /**
     * Show content asset dependencies
     */
    private showContentAssetDependencies(content: any, sourceEntities: SourceEntities, indent: string): void {
        if (!content.fields) return;

        const assetRefs = this.extractAssetReferences(content.fields);
        assetRefs.forEach((assetRef: AssetReference) => {
            const asset = sourceEntities.assets?.find((a: any) => 
                a.originUrl === assetRef.url || 
                a.url === assetRef.url ||
                a.edgeUrl === assetRef.url
            );
            if (asset) {
                console.log(`${indent}├─ ${ansiColors.yellow(`Asset:${asset.fileName || assetRef.url}`)}`);
                // Check gallery dependency if asset has one  
                if (asset.mediaGroupingID) {
                    const gallery = sourceEntities.galleries?.find((g: any) => g.mediaGroupingID === asset.mediaGroupingID);
                    if (gallery) {
                        console.log(`${indent}│  ├─ ${ansiColors.magenta(`Gallery:${gallery.name || gallery.mediaGroupingID}`)}`);
                    }
                }
            } else {
                console.log(`${indent}├─ ${ansiColors.red(`Asset:${assetRef.url} - MISSING IN SOURCE DATA`)}`);
            }
        });
    }

    /**
     * Extract asset references from content fields
     */
    private extractAssetReferences(fields: any): AssetReference[] {
        const references: AssetReference[] = [];
        
        if (!fields || typeof fields !== 'object') {
            return references;
        }
        
        const scanForAssets = (obj: any, path: string) => {
            if (typeof obj !== 'object' || obj === null) return;
            
            if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    scanForAssets(item, `${path}[${index}]`);
                });
            } else {
                // Check for asset URL references
                if (typeof obj === 'string' && obj.includes('cdn.aglty.io')) {
                    references.push({
                        url: obj,
                        fieldPath: path
                    });
                }
                
                // Check common asset fields
                if (obj.url && typeof obj.url === 'string' && obj.url.includes('cdn.aglty.io')) {
                    references.push({
                        url: obj.url,
                        fieldPath: `${path}.url`
                    });
                }
                
                // Recursively scan nested objects
                for (const [key, value] of Object.entries(obj)) {
                    scanForAssets(value, path ? `${path}.${key}` : key);
                }
            }
        };
        
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            scanForAssets(fieldValue, fieldName);
        }
        
        return references;
    }

    /**
     * Find missing dependencies for a page
     * This method would need to be extracted from the main dependency analyzer
     */
    private findMissingDependenciesForPage(page: any, sourceEntities: SourceEntities): string[] {
        const missing: string[] = [];
        
        // Basic template check
        if (page.templateName) {
            const template = sourceEntities.templates?.find((t: any) => t.pageTemplateName === page.templateName);
            if (!template) {
                missing.push(`Template:${page.templateName}`);
            }
        }
        
        // TODO: Add comprehensive dependency checking
        // This will be extracted from the main dependency analyzer in the next step
        
        return missing;
    }
} 