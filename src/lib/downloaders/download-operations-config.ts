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
}

export const DOWNLOAD_OPERATIONS: Record<string, OperationConfig> = {
  syncSDK: {
    name: 'downloadAllSyncSDK',
    description: 'Download content items, pages, sitemaps via Content Sync SDK',
    handler: async (guid) => {
      // Sync SDK will handle locales internally via guidLocaleMap (user will update this)
      // For now, use default locale - this will be converted to use guidLocaleMap internally
      await downloadAllSyncSDK(guid);
    },
    elements: ['Content', 'Pages', 'Sitemaps']
  },
  galleries: {
    name: 'downloadAllGalleries',
    description: 'Download asset galleries and media groupings', 
    handler: async (guid) => {
      await downloadAllGalleries(guid);
    },
    elements: ['Galleries']
  },
  assets: {
    name: 'downloadAllAssets',
    description: 'Download media files and asset metadata',
    handler: async (guid) => {
      await downloadAllAssets(guid);
    },
    elements: ['Assets']
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
    elements: ['Templates']
  },
  containers: {
    name: 'downloadAllContainers',
    description: 'Download content containers and views',
    handler: async (guid) => {
      await downloadAllContainers(guid);
    },
    elements: ['Containers']
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
   * Get operations based on elements filter
   */
  static getOperationsForElements(): OperationConfig[] {
    const { elements } = getState()
    const elementList = elements ? elements.split(",") : 
      ['Galleries', 'Assets', 'Models', 'Containers', 'Content', 'Templates', 'Pages', 'Sitemaps', 'Redirections'];
    
    // Filter operations based on elements
    const relevantOperations = Object.values(DOWNLOAD_OPERATIONS).filter(operation => {
      // Check if any of the operation's elements are in the requested element list
      return operation.elements.some(element => elementList.includes(element));
    });
    
    return relevantOperations;
  }

  /**
   * Get all available operations
   */
  static getAllOperations(): OperationConfig[] {
    return Object.values(DOWNLOAD_OPERATIONS);
  }

  /**
   * Get operation by name
   */
  static getOperationByName(name: string): OperationConfig | undefined {
    return Object.values(DOWNLOAD_OPERATIONS).find(op => op.name === name);
  }

  /**
   * Get operations by element type
   */
  static getOperationsByElement(element: string): OperationConfig[] {
    return Object.values(DOWNLOAD_OPERATIONS).filter(operation => 
      operation.elements.includes(element)
    );
  }
} 
