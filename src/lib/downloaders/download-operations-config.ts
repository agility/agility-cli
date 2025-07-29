// Import existing downloaders
import { downloadAllGalleries } from './download-galleries';
import { downloadAllAssets } from './download-assets';
import { downloadAllModels } from './download-models';
import { downloadAllTemplates } from './download-templates';
import { downloadAllContainers } from './download-containers';
import { downloadAllSyncSDK } from './download-sync-sdk';
import { downloadAllSitemaps } from './download-sitemaps';
import { getState } from '../../core/state';

// Central configuration for all download operations
export interface OperationConfig {
  name: string;
  description: string;
  handler: (guid: string) => Promise<void>;
  elements: string[];
  dependencies?: string[]; // Auto-include these elements when this operation is requested
}

export const DOWNLOAD_OPERATIONS: Record<string, OperationConfig> = {
  syncSDK: {
    name: 'downloadAllSyncSDK',
    description: 'Download content items and sitemaps via Content Sync SDK',
    handler: async (guid) => {
      // Sync SDK will handle locales internally via guidLocaleMap (user will update this)
      // For now, use default locale - this will be converted to use guidLocaleMap internally
      await downloadAllSyncSDK(guid);
    },
    elements: ['Content', 'Sitemaps'], // NOTE: Content Sync SDK doesn't download page structures - only content items
    dependencies: ['Models', 'Containers', 'Assets', 'Galleries', 'Templates'] // Content requires Models and Containers
  },
  galleries: {
    name: 'downloadAllGalleries',
    description: 'Download asset galleries and media groupings', 
    handler: async (guid) => {
      await downloadAllGalleries(guid);
    },
    elements: ['Galleries'],
    // dependencies: ['Assets'] // Galleries require Assets to be meaningful
  },
  assets: {
    name: 'downloadAllAssets',
    description: 'Download media files and asset metadata',
    handler: async (guid) => {
      await downloadAllAssets(guid);
    },
    elements: ['Assets'],
    dependencies: ['Galleries'] // Assets require Galleries to be meaningful
  },
  models: {
    name: 'downloadAllModels', 
    description: 'Download content models and field definitions',
    handler: async (guid) => {
      await downloadAllModels(guid);
    },
    elements: ['Models']
  },
  templates: {
    name: 'downloadAllTemplates',
    description: 'Download page templates and layouts',
    handler: async (guid) => {
      await downloadAllTemplates(guid);
    },
    elements: ['Templates'],
    // dependencies: ['Models', 'Containers', 'Pages', 'Content'] // Templates reference Models for container definitions
  },
  containers: {
    name: 'downloadAllContainers',
    description: 'Download content containers and views',
    handler: async (guid) => {
      await downloadAllContainers(guid);
    },
    elements: ['Containers'],
    dependencies: ['Models'] // Containers require Models to be meaningful
  },
  sitemaps: {
    name: 'downloadAllSitemaps',
    description: 'Download sitemaps',
    handler: async (guid) => {
      await downloadAllSitemaps(guid);
    },
    elements: ['Sitemaps']
  }
};

export class DownloadOperationsRegistry {
  /*
   * Get operations based on elements filter with dependency resolution
   */
  static getOperationsForElements(): OperationConfig[] {
    const state = getState();
    const elementList = state.elements ? state.elements.split(",") : 
      ['Galleries', 'Assets', 'Models', 'Containers', 'Content', 'Templates', 'Pages', 'Sitemaps', 'Redirections'];
    
    // Resolve dependencies and update state
    const { resolvedElements, autoIncluded } = this.resolveDependencies(elementList);
    
    // Update state.elements with resolved dependencies if any were auto-included
    if (autoIncluded.length > 0) {
      // Update the state with resolved elements
      const { setState } = require('../../core/state');
      setState({ elements: resolvedElements.join(',') });
    }
    
    // Filter operations based on resolved elements
    const relevantOperations = Object.values(DOWNLOAD_OPERATIONS).filter(operation => {
      // Check if any of the operation's elements are in the resolved element list
      return operation.elements.some(element => resolvedElements.includes(element));
    });
    
    return relevantOperations;
  }

  /**
   * Resolve element dependencies
   */
  private static resolveDependencies(requestedElements: string[]): { 
    resolvedElements: string[], 
    autoIncluded: string[] 
  } {
    const resolvedElements = new Set(requestedElements);
    const autoIncluded: string[] = [];
    
    // Check each requested element for dependencies
    for (const element of requestedElements) {
      // Find operations that provide this element
      const operations = Object.values(DOWNLOAD_OPERATIONS).filter(op => 
        op.elements.includes(element)
      );
      
      // Add dependencies for each operation
      operations.forEach(operation => {
        if (operation.dependencies) {
          operation.dependencies.forEach(dep => {
            if (!resolvedElements.has(dep)) {
              resolvedElements.add(dep);
              autoIncluded.push(dep);
            }
          });
        }
      });
    }
    
    return {
      resolvedElements: Array.from(resolvedElements),
      autoIncluded
    };
  }

} 
