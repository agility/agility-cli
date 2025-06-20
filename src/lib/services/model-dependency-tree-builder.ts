/**
 * Model Dependency Tree Builder Service
 * 
 * Builds comprehensive dependency trees for selective model-based sync operations.
 * Analyzes all entity relationships to ensure complete synchronization of specified models.
 * 
 * Task 104: Create Model Dependency Tree Builder
 * Phase 21: Selective Model-Based Sync Implementation
 */

import { SourceData } from '../../types';
import ansiColors from 'ansi-colors';

export interface ModelDependencyTree {
  models: Set<string>;        // Model reference names
  containers: Set<number>;    // Container IDs using these models
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

    console.log(ansiColors.cyan(`🌳 Building dependency tree for models: ${modelNames.join(', ')}`));
    
    const tree: ModelDependencyTree = {
      models: new Set(modelNames),
      containers: new Set(),
      content: new Set(),
      templates: new Set(),
      pages: new Set(),
      assets: new Set(),
      galleries: new Set()
    };
    
    // Build dependency tree in logical order
    this.findContainersForModels(modelNames, tree);
    this.findContentForModels(modelNames, tree);
    this.findTemplatesForContainers(tree);
    this.findPagesForTemplatesAndContent(tree);
    this.findAssetsInContent(tree);
    this.findGalleriesInContent(tree);
    
    console.log(ansiColors.green(`✅ Dependency tree built - ${this.getTreeSummary(tree)}`));
    
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
    
    console.log(ansiColors.gray(`  📦 Found ${tree.containers.size} containers using specified models`));
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
    
    console.log(ansiColors.gray(`  📄 Found ${tree.content.size} content items of specified models`));
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
    
    console.log(ansiColors.gray(`  🎨 Found ${tree.templates.size} templates using discovered containers`));
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
    
    console.log(ansiColors.gray(`  📑 Found ${tree.pages.size} pages using discovered templates/content`));
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
    
    console.log(ansiColors.gray(`  🖼️  Found ${tree.assets.size} assets referenced in content/pages`));
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
    
    console.log(ansiColors.gray(`  📸 Found ${tree.galleries.size} galleries referenced in content`));
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