/**
 * Model Dependency Tree Builder Service
 * 
 * Builds comprehensive dependency trees for selective model-based sync operations.
 * Analyzes all entity relationships to ensure complete synchronization of specified models.
 * 
 * Task 104: Create Model Dependency Tree Builder
 * Phase 21: Selective Model-Based Sync Implementation
 */

import { SourceData } from '../../types/sourceData';
import ansiColors from 'ansi-colors';
import { SitemapHierarchy } from '../shared/sitemap-hierarchy';

export interface ModelDependencyTree {
  models: Set<string>;        // Model reference names
  containers: Set<number>; 
  lists: Set<number>;   // Container IDs using these models
  content: Set<number>;       // Content item IDs of these models
  templates: Set<number>;     // Template IDs using these containers
  pages: Set<number>;         // Page IDs using these templates/content
  assets: Set<string>;        // Asset URLs referenced in content/pages
  galleries: Set<number>;     // Gallery IDs referenced in content/pages
}

export class ModelDependencyTreeBuilder {
  constructor(private sourceData: SourceData) {}
  
  /**
   * Build comprehensive dependency tree from specified model names
   */
  buildDependencyTree(modelNames: string[]): ModelDependencyTree {
    if (!modelNames || modelNames.length === 0) {
      throw new Error('Model names are required for dependency tree building');
    }

    // console.log(ansiColors.cyan(`🌳 Building dependency tree for models: ${modelNames.join(', ')}`));
    
    const tree: ModelDependencyTree = {
      models: new Set(modelNames),
      containers: new Set(),
      lists: new Set(),
      content: new Set(),
      templates: new Set(),
      pages: new Set(),
      assets: new Set(),
      galleries: new Set()
    };
    
    // Build dependency tree in CORRECTED logical order
    this.findContainersForModels(modelNames, tree);
    this.findContentForModels(modelNames, tree);
    this.findTemplatesForContainers(tree);
    this.findPagesForTemplatesAndContent(tree);
    // 🎯 NEW: After finding pages, discover templates used by those pages
    this.findTemplatesUsedByPages(tree);
    // 🎯 NEW: Include ALL content referenced by discovered pages for complete renderability
    this.findAllContentReferencedByPages(tree);
    // 🎯 NEW: Include parent pages for proper hierarchy and security
    this.findParentPagesForDiscoveredPages(tree);
    // 🎯 NEW: Second template discovery pass for parent pages
    this.findTemplatesUsedByPages(tree);
    // 🎯 NEW: Include models for the newly discovered content
    this.findModelsForDiscoveredContent(tree);
    // 🎯 NEW: Include containers for the newly discovered models  
    this.findContainersForDiscoveredModels(tree);
    // 🎯 NEW: Include containers that contain discovered content items
    this.findContainersForDiscoveredContent(tree);
    this.findAssetsInContent(tree);
    this.findGalleriesInContent(tree);
    
    // console.log(ansiColors.green(`✅ Dependency tree built - ${this.getTreeSummary(tree)}`));
    
    return tree;
  }
  
  /**
   * Find containers that use the specified models
   */
  private findContainersForModels(modelNames: string[], tree: ModelDependencyTree): void {
    if (!this.sourceData.containers || !this.sourceData.models) return;
    
    // Create model reference name to ID mapping
    const modelMap = new Map<string, number>();
    this.sourceData.models.forEach(model => {
      modelMap.set(model.referenceName, model.id);
    });
    
    // Find containers that use these models
    modelNames.forEach(modelName => {
      const modelId = modelMap.get(modelName);
      if (modelId) {
        const containers = this.sourceData.containers.filter(c => 
          c.contentDefinitionID === modelId
        );
        containers.forEach(container => {
          tree.containers.add(container.contentViewID);
        });
      }
    });
    
    // console.log(ansiColors.gray(`  📦 Found ${tree.containers.size} containers using specified models`));
  }
  
  /**
   * Find content items of the specified models
   */
  private findContentForModels(modelNames: string[], tree: ModelDependencyTree): void {
    if (!this.sourceData.content) return;
    
    modelNames.forEach(modelName => {
      const contentItems = this.sourceData.content.filter(c => 
        c.properties?.definitionName === modelName
      );
      contentItems.forEach(content => {
        tree.content.add(content.contentID);
      });
    });
    
    // console.log(ansiColors.gray(`  📄 Found ${tree.content.size} content items of specified models`));
  }
  
  /**
   * Find templates that use the discovered containers
   */
  private findTemplatesForContainers(tree: ModelDependencyTree): void {
    if (!this.sourceData.templates) return;
    
    // Find templates that use discovered containers through contentSectionDefinitions
    this.sourceData.templates.forEach(template => {
      if (template.contentSectionDefinitions) {
        template.contentSectionDefinitions.forEach((section: any) => {
          // Check if section references discovered containers
          if (section.contentViewID && tree.containers.has(section.contentViewID)) {
            tree.templates.add(template.pageTemplateID);
          }
          // Also check itemContainerID for container references
          if (section.itemContainerID && tree.containers.has(section.itemContainerID)) {
            tree.templates.add(template.pageTemplateID);
          }
        });
      }
    });
    
    // console.log(ansiColors.gray(`  🎨 Found ${tree.templates.size} templates using discovered containers`));
  }
  
  /**
   * Find pages that use the discovered templates or reference discovered content
   */
  private findPagesForTemplatesAndContent(tree: ModelDependencyTree): void {
    if (!this.sourceData.pages) return;
    
    this.sourceData.pages.forEach(page => {
      let shouldIncludePage = false;
      const pageAny = page as any; // Use defensive typing for complex Agility CMS structures
      
      // Check if page uses discovered templates (check multiple possible property names)
      const templateId = pageAny.pageTemplateID || pageAny.templateID || pageAny.templateId;
      if (templateId && tree.templates.has(templateId)) {
        shouldIncludePage = true;
      }
      
      // Check if page content references discovered content (page zones/content areas)
      if (pageAny.zones) {
        const zones = pageAny.zones;
        if (zones && typeof zones === 'object') {
          // Zones is an object with zone names as keys
          Object.values(zones).forEach((zoneModules: any) => {
            if (Array.isArray(zoneModules)) {
              zoneModules.forEach((module: any) => {
                if (module.item && (module.item.contentid || module.item.contentID)) {
                  const contentId = module.item.contentid || module.item.contentID;
                  if (tree.content.has(contentId)) {
                    shouldIncludePage = true;
                  }
                }
              });
            }
          });
        }
      }
      
      if (shouldIncludePage) {
        tree.pages.add(page.pageID);
      }
    });
    
    // console.log(ansiColors.gray(`  📑 Found ${tree.pages.size} pages using discovered templates/content`));
  }
  
  /**
   * Find templates used by pages that reference discovered content
   */
  private findTemplatesUsedByPages(tree: ModelDependencyTree): void {
    if (!this.sourceData.pages) return;
    
    this.sourceData.pages.forEach(page => {
      if (tree.pages.has(page.pageID)) {
        const templateIds = this.extractTemplateIdsFromPage(page);
        templateIds.forEach(id => tree.templates.add(id));
      }
    });
    
    // console.log(ansiColors.gray(`  🎨 Found ${tree.templates.size} templates used by pages`));
  }
  
  /**
   * Extract template IDs from a page
   */
  private extractTemplateIdsFromPage(page: any): number[] {
    const templateIds: number[] = [];
    
    // Check multiple possible property names for template reference
    const templateId = page.pageTemplateID || page.templateID || page.templateId;
    if (templateId && typeof templateId === 'number') {
      templateIds.push(templateId);
    }
    
    // Also check if templateName exists and try to resolve to ID
    if (page.templateName && this.sourceData.templates) {
      const template = this.sourceData.templates.find(t => 
        t.pageTemplateName === page.templateName
      );
      if (template && template.pageTemplateID) {
        templateIds.push(template.pageTemplateID);
      }
    }
    
    return templateIds;
  }
  
  /**
   * Find ALL content referenced by discovered pages for complete renderability
   * This ensures pages can render completely even if they reference content from other models
   */
  private findAllContentReferencedByPages(tree: ModelDependencyTree): void {
    if (!this.sourceData.pages) return;
    
    const initialContentSize = tree.content.size;
    
    this.sourceData.pages.forEach(page => {
      if (tree.pages.has(page.pageID)) {
        // Extract all content IDs from page zones
        const contentIds = this.extractContentIdsFromPage(page);
        contentIds.forEach(id => tree.content.add(id));
      }
    });
    
    const newContentCount = tree.content.size - initialContentSize;
    // console.log(ansiColors.gray(`  📄 Added ${newContentCount} additional content items for page renderability`));
  }
  
  /**
   * Find ALL ancestor pages for discovered pages to ensure proper hierarchy and security
   * Recursively walks up the hierarchy to find all parents, grandparents, etc.
   */
  private findParentPagesForDiscoveredPages(tree: ModelDependencyTree): void {
    if (!this.sourceData.pages) return;
    
    const initialPageCount = tree.pages.size;
    
    // Keep track of pages we need to process for parent discovery
    const pagesToProcess = new Set<number>();
    
    // Start with all currently discovered pages
    tree.pages.forEach(pageId => pagesToProcess.add(pageId));
    
    // Process each page and find all its ancestors
    pagesToProcess.forEach(pageId => {
      const page = this.sourceData.pages!.find(p => p.pageID === pageId);
      if (page) {
        this.findAllAncestorPages(page, tree);
      }
    });
    
    const newPageCount = tree.pages.size - initialPageCount;
    // console.log(ansiColors.gray(`  📑 Added ${newPageCount} ancestor pages for proper hierarchy`));
  }
  
  /**
   * Recursively find all ancestor pages (parents, grandparents, etc.) for a given page
   */
  private findAllAncestorPages(page: any, tree: ModelDependencyTree): void {
    const parentPage = this.findParentPage(page);
    if (parentPage && !tree.pages.has(parentPage.pageID)) {
      // Add this parent to the tree
      tree.pages.add(parentPage.pageID);
      console.log(ansiColors.gray(`    📑 [ANCESTOR] Added parent page ${parentPage.name} (ID:${parentPage.pageID}) for child ${page.name} (ID:${page.pageID})`));
      
      // Recursively find this parent's ancestors
      this.findAllAncestorPages(parentPage, tree);
    }
  }
  
  /**
   * Find the direct parent page for a given page
   * Returns null if no parent exists (root level page)
   */
  private findParentPage(page: any): any | null {
    if (!this.sourceData.pages) return null;
    
    // Use existing SitemapHierarchy utility to find parent
    const sitemapHierarchy = new SitemapHierarchy();
    
    const parentResult = sitemapHierarchy.findPageParentInSourceSitemap(page.pageID, page.name);
    if (!parentResult.parentId) return null;
    
    // Find the actual page object by ID
    const parentPage = this.sourceData.pages.find(p => p.pageID === parentResult.parentId);
    return parentPage || null;
  }
  
  /**
   * Find models for all discovered content to ensure complete model coverage
   */
  private findModelsForDiscoveredContent(tree: ModelDependencyTree): void {
    if (!this.sourceData.content || !this.sourceData.models) return;
    
    const initialModelSize = tree.models.size;
    
    // Find models for all content in the tree
    this.sourceData.content.forEach(contentItem => {
      if (tree.content.has(contentItem.contentID)) {
        // Find the model for this content item
        const modelName = contentItem.properties?.definitionName;
        if (modelName) {
          tree.models.add(modelName);
        }
      }
    });
    
    const newModelCount = tree.models.size - initialModelSize;
    // console.log(ansiColors.gray(`  📋 Added ${newModelCount} additional models for content dependencies`));
  }
  
  /**
   * Find containers for newly discovered models
   */
  private findContainersForDiscoveredModels(tree: ModelDependencyTree): void {
    if (!this.sourceData.containers || !this.sourceData.models) return;
    
    const initialContainerSize = tree.containers.size;
    
    // Create model reference name to ID mapping
    const modelMap = new Map<string, number>();
    this.sourceData.models.forEach(model => {
      modelMap.set(model.referenceName, model.id);
    });
    
    // Find containers for all models in the tree
    tree.models.forEach(modelName => {
      const modelId = modelMap.get(modelName);
      if (modelId) {
        const containers = this.sourceData.containers.filter(c => 
          c.contentDefinitionID === modelId
        );
        containers.forEach(container => {
          tree.containers.add(container.contentViewID);
        });
      }
    });
    
    const newContainerCount = tree.containers.size - initialContainerSize;
    // console.log(ansiColors.gray(`  📦 Added ${newContainerCount} additional containers for model dependencies`));
  }
  
  /**
   * Find containers that contain discovered content items
   * Uses case-insensitive matching to handle Agility CMS pattern:
   * - Containers: "news1_RichTextArea" (PascalCase)
   * - Content: "news1_richtextarea" (lowercase)
   */
  private findContainersForDiscoveredContent(tree: ModelDependencyTree): void {
    if (!this.sourceData.containers || !this.sourceData.content) return;
    
    const initialContainerSize = tree.containers.size;
    
    // Create a map of content reference names (lowercase) to content IDs
    const contentReferenceMap = new Map<string, number>();
    this.sourceData.content.forEach(contentItem => {
      if (tree.content.has(contentItem.contentID)) {
        const referenceName = contentItem.properties?.referenceName;
        if (referenceName) {
          contentReferenceMap.set(referenceName.toLowerCase(), contentItem.contentID);
        }
      }
    });
    
    // Find containers with case-insensitive matching
    this.sourceData.containers.forEach(container => {
      const containerRefLower = container.referenceName?.toLowerCase();
      if (containerRefLower && contentReferenceMap.has(containerRefLower)) {
        tree.containers.add(container.contentViewID);
        // console.log(ansiColors.gray(`    📦 [CASE MATCH] Found container ${container.referenceName} (ID:${container.contentViewID}) for content ${contentReferenceMap.get(containerRefLower)}`));
      }
    });
    
    const newContainerCount = tree.containers.size - initialContainerSize;
    // console.log(ansiColors.gray(`  📦 Added ${newContainerCount} additional containers for discovered content`));
  }
  
  /**
   * Extract all content IDs referenced in a page's zones
   */
  private extractContentIdsFromPage(page: any): number[] {
    const contentIds: number[] = [];
    
    if (page.zones) {
      const zones = page.zones;
      if (zones && typeof zones === 'object') {
        // Zones is an object with zone names as keys
        Object.values(zones).forEach((zoneModules: any) => {
          if (Array.isArray(zoneModules)) {
            zoneModules.forEach((module: any) => {
              if (module.item && (module.item.contentid || module.item.contentID)) {
                const contentId = module.item.contentid || module.item.contentID;
                if (typeof contentId === 'number') {
                  contentIds.push(contentId);
                }
              }
            });
          }
        });
      }
    }
    
    return contentIds;
  }
  
  /**
   * Find assets referenced in discovered content and pages
   */
  private findAssetsInContent(tree: ModelDependencyTree): void {
    if (!this.sourceData.content || !this.sourceData.assets) return;
    
    // Extract asset URLs from content items in the tree
    this.sourceData.content.forEach(contentItem => {
      if (tree.content.has(contentItem.contentID)) {
        const assetUrls = this.extractAssetUrlsFromContent(contentItem);
        assetUrls.forEach(url => tree.assets.add(url));
      }
    });
    
    // Also check pages for asset references
    if (this.sourceData.pages) {
      this.sourceData.pages.forEach(page => {
        if (tree.pages.has(page.pageID)) {
          const assetUrls = this.extractAssetUrlsFromPage(page);
          assetUrls.forEach(url => tree.assets.add(url));
        }
      });
    }
    
    // console.log(ansiColors.gray(`  🖼️  Found ${tree.assets.size} assets referenced in content/pages`));
  }
  
  /**
   * Find galleries referenced in discovered content
   */
  private findGalleriesInContent(tree: ModelDependencyTree): void {
    if (!this.sourceData.content || !this.sourceData.galleries) return;
    
    this.sourceData.content.forEach(contentItem => {
      if (tree.content.has(contentItem.contentID)) {
        const galleryIds = this.extractGalleryIdsFromContent(contentItem);
        galleryIds.forEach(id => tree.galleries.add(id));
      }
    });
    
    // console.log(ansiColors.gray(`  📸 Found ${tree.galleries.size} galleries referenced in content`));
  }
  
  /**
   * Extract asset URLs from content item fields
   */
  private extractAssetUrlsFromContent(contentItem: any): string[] {
    const urls: string[] = [];
    
    if (contentItem.fields) {
      this.scanObjectForAssetUrls(contentItem.fields, urls);
    }
    
    return urls;
  }
  
  /**
   * Extract asset URLs from page content
   */
  private extractAssetUrlsFromPage(page: any): string[] {
    const urls: string[] = [];
    
    // Scan page zones for asset references
    if (page.zones) {
      this.scanObjectForAssetUrls(page.zones, urls);
    }
    
    // Scan page content if it exists
    if (page.content) {
      this.scanObjectForAssetUrls(page.content, urls);
    }
    
    return urls;
  }
  
  /**
   * Extract gallery IDs from content item fields
   */
  private extractGalleryIdsFromContent(contentItem: any): number[] {
    const galleryIds: number[] = [];
    
    if (contentItem.fields) {
      this.scanObjectForGalleryIds(contentItem.fields, galleryIds);
    }
    
    return galleryIds;
  }
  
  /**
   * Recursively scan object for asset URLs (cdn.aglty.io references)
   */
  private scanObjectForAssetUrls(obj: any, urls: string[], path: string = ''): void {
    if (typeof obj === 'string' && obj.includes('cdn.aglty.io')) {
      urls.push(obj);
    } else if (obj && typeof obj === 'object') {
      if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          this.scanObjectForAssetUrls(item, urls, `${path}[${index}]`);
        });
      } else {
        Object.keys(obj).forEach(key => {
          this.scanObjectForAssetUrls(obj[key], urls, `${path}.${key}`);
        });
      }
    }
  }
  
  /**
   * Recursively scan object for gallery ID references
   */
  private scanObjectForGalleryIds(obj: any, galleryIds: number[], path: string = ''): void {
    if (typeof obj === 'object' && obj !== null) {
      // Look for gallery field patterns
      if (obj.mediaGroupingID && typeof obj.mediaGroupingID === 'number') {
        galleryIds.push(obj.mediaGroupingID);
      }
      
      // Look for gallery reference patterns in field values
      if (obj.galleryID && typeof obj.galleryID === 'number') {
        galleryIds.push(obj.galleryID);
      }
      
      // Recursively scan nested objects
      if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          this.scanObjectForGalleryIds(item, galleryIds, `${path}[${index}]`);
        });
      } else {
        Object.keys(obj).forEach(key => {
          this.scanObjectForGalleryIds(obj[key], galleryIds, `${path}.${key}`);
        });
      }
    }
  }
  
  /**
   * Get a summary string of the dependency tree
   */
  private getTreeSummary(tree: ModelDependencyTree): string {
    const total = tree.models.size + tree.containers.size + tree.content.size + 
                 tree.templates.size + tree.pages.size + tree.assets.size + tree.galleries.size;
    
    return `${total} total entities across 7 types`;
  }
  
  /**
   * Validate that specified models exist in source data
   */
  validateModels(modelNames: string[]): { valid: string[]; invalid: string[] } {
    const valid: string[] = [];
    const invalid: string[] = [];
    
    if (!this.sourceData.models || this.sourceData.models.length === 0) {
      return { valid: [], invalid: modelNames };
    }
    
    const availableModels = new Set(this.sourceData.models.map(m => m.referenceName));
    
    modelNames.forEach(modelName => {
      if (availableModels.has(modelName)) {
        valid.push(modelName);
      } else {
        invalid.push(modelName);
      }
    });
    
    return { valid, invalid };
  }
} 