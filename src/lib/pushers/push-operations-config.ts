// Import existing pushers
import { ReferenceMapperV2 } from '../refMapper/reference-mapper-v2';
import { GuidEntities } from './guid-data-loader';
import { PusherResult } from '../../types/sourceData';
import { getState } from '../../core/state';
import { fileOperations } from 'core/fileOperations';
import { ChangeDelta } from 'lib/shared/change-delta-tracker';
import { ChangeDeltaFileWorker } from 'lib/shared/change-delta-file-worker';

// Central configuration for all push operations
export interface PushOperationConfig {
  name: string;
  description: string;
  handler: (sourceData: GuidEntities, targetData: GuidEntities, referenceMapper: ReferenceMapperV2, changeDeltaWorker: ChangeDeltaFileWorker) => Promise<PusherResult>;
  elements: string[];
  dataKey: string;
}

export const PUSH_OPERATIONS: Record<string, PushOperationConfig> = {
  galleries: {
    name: 'pushGalleries',
    description: 'Push asset galleries and media groupings',
    handler: async (sourceData, targetData, referenceMapper, changeDeltaWorker) => {
      const { pushGalleries } = await import('./gallery-pusher');
      return await pushGalleries(sourceData, targetData, referenceMapper, changeDeltaWorker);
    },
    elements: ['Galleries'],
    dataKey: 'galleries'
  },
  assets: {
    name: 'pushAssets',
    description: 'Push media files and asset metadata',
    handler: async (sourceData, targetData, referenceMapper, changeDeltaWorker) => {
      const { pushAssets } = await import('./asset-pusher');
      return await pushAssets(sourceData, targetData, referenceMapper, changeDeltaWorker);
    },
    elements: ['Assets'],
    dataKey: 'assets'
  },
  models: {
    name: 'pushModels',
    description: 'Push content models and field definitions',
    handler: async (sourceData, targetData, referenceMapper, changeDeltaWorker) => {
      const { pushModels } = await import('./model-pusher');
      return await pushModels(sourceData, targetData, referenceMapper, changeDeltaWorker);
    },
    elements: ['Models'],
    dataKey: 'models'
  },
  containers: {
    name: 'pushContainers',
    description: 'Push content containers and views',
    handler: async (sourceData, targetData, referenceMapper, changeDeltaWorker) => {
      const { pushContainers } = await import('./container-pusher');
      return await pushContainers(sourceData, targetData, referenceMapper, changeDeltaWorker);
    },
    elements: ['Containers'],
    dataKey: 'containers'
  },
  content: {
    name: 'pushContent',
    description: 'Push content items',
    handler: async (sourceData, targetData, referenceMapper, changeDeltaWorker) => {
      const { pushContentSmart } = await import('./content-item-pusher');
      return await pushContentSmart(sourceData, targetData, referenceMapper, changeDeltaWorker);
    },
    elements: ['Content'],
    dataKey: 'content'
  },
  templates: {
    name: 'pushTemplates',
    description: 'Push page templates and layouts',
    handler: async (sourceData, targetData, referenceMapper, changeDeltaWorker) => {
      const { pushTemplates } = await import('./template-pusher');
      return await pushTemplates(sourceData, targetData, referenceMapper, changeDeltaWorker);
    },
    elements: ['Templates'],
    dataKey: 'templates'
  },
  pages: {
    name: 'pushPages',
    description: 'Push pages and page hierarchy',
    handler: async (sourceData, targetData, referenceMapper, changeDeltaWorker) => {
      const { pushPages } = await import('./page-pusher');
      return await pushPages(sourceData, targetData, referenceMapper, changeDeltaWorker);
    },
    elements: ['Pages'],
    dataKey: 'pages'
  }
};

export class PushOperationsRegistry {
  /**
   * Get operations based on elements filter
   */
  static getOperationsForElements(): PushOperationConfig[] {
    const { elements } = getState();
    const elementList = elements ? elements.split(",") : 
      ['Galleries', 'Assets', 'Models', 'Containers', 'Content', 'Templates', 'Pages'];
    
    // Filter operations based on elements
    const relevantOperations = Object.values(PUSH_OPERATIONS).filter(operation => {
      // Check if any of the operation's elements are in the requested element list
      return operation.elements.some(element => elementList.includes(element));
    });
    
    return relevantOperations;
  }

  /**
   * Get all available operations
   */
  static getAllOperations(): PushOperationConfig[] {
    return Object.values(PUSH_OPERATIONS);
  }

  /**
   * Get operation by name
   */
  static getOperationByName(name: string): PushOperationConfig | undefined {
    return Object.values(PUSH_OPERATIONS).find(op => op.name === name);
  }

  /**
   * Get operations by element type
   */
  static getOperationsByElement(element: string): PushOperationConfig[] {
    return Object.values(PUSH_OPERATIONS).filter(operation => 
      operation.elements.includes(element)
    );
  }
} 