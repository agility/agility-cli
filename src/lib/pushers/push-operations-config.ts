// Import existing pushers
import { GuidEntities } from './guid-data-loader';
import { PusherResult } from 'types/sourceData';
import { getState, setState } from 'core/state';


// Central configuration for all push operations
export interface PushOperationConfig {
  name: string;
  description: string;
  handler: (sourceData: GuidEntities, targetData: GuidEntities) => Promise<PusherResult>;
  elements: string[];
  dataKey: string;
  dependencies?: string[]; // Auto-include these elements when this operation is requested
}

export const PUSH_OPERATIONS: Record<string, PushOperationConfig> = {
  galleries: {
    name: 'pushGalleries',
    description: 'Push asset galleries and media groupings',
    handler: async (sourceData, targetData) => {
      const { pushGalleries } = await import('./gallery-pusher');
      return await pushGalleries(sourceData['galleries'], targetData['galleries']);
    },
    elements: ['Galleries'],
    dependencies: ['Assets'], // Galleries require Assets to be meaningful
    dataKey: 'galleries'
  },
  assets: {
    name: 'pushAssets',
    description: 'Push media files and asset metadata',
    handler: async (sourceData, targetData) => {
      const { pushAssets } = await import('./asset-pusher');
      return await pushAssets(sourceData['assets'], targetData['assets']);
    },
    elements: ['Assets'],
    dependencies: ['Galleries'], // Assets require Galleries to be meaningful
    dataKey: 'assets'
  },
  models: {
    name: 'pushModels',
    description: 'Push content models and field definitions',
    handler: async (sourceData, targetData) => {
      const { pushModels } = await import('./model-pusher');
      return await pushModels(sourceData['models'], targetData['models']);
    },
    elements: ['Models'],
    dataKey: 'models'
  },
  containers: {
    name: 'pushContainers',
    description: 'Push content containers and views',
    handler: async (sourceData, targetData) => {
      const { pushContainers } = await import('./container-pusher');
      return await pushContainers(sourceData['containers'], targetData['containers']);
    },
    elements: ['Containers'],
    dataKey: 'containers',
    dependencies: ['Models'] // Containers require Models to be meaningful
  },
  content: {
    name: 'pushContent',
    description: 'Push content items',
    handler: async (sourceData, targetData, locale) => {
      const { pushContent } = await import('./content-pusher/content-pusher');
      return await pushContent(sourceData['content'], targetData['content'], locale);
    },
    elements: ['Content'],
    dataKey: 'content',
    dependencies: ['Models', 'Containers', 'Assets', 'Galleries', 'Templates'] // Content requires Models and Containers
  },
  templates: {
    name: 'pushTemplates',
    description: 'Push page templates and layouts',
    handler: async (sourceData, targetData, locale) => {
      const { pushTemplates } = await import('./template-pusher');
      return await pushTemplates(sourceData['templates'], targetData['templates'], locale);
    },
    elements: ['Templates'],
    dataKey: 'templates',
    dependencies: ['Models', 'Containers', 'Pages', 'Content'] // Templates reference Models for container definitions
  },
  pages: {
    name: 'pushPages',
    description: 'Push pages and page hierarchy',
    handler: async (sourceData, targetData, locale) => {
      const { pushPages } = await import('./page-pusher/push-pages');
      return await pushPages(sourceData['pages'], locale);
    },
    elements: ['Pages'],
    dataKey: 'pages',
    dependencies: ['Templates', 'Models', 'Containers', 'Content', 'Galleries', 'Assets'] // Pages require Templates, Models, and Containers
  }
};

export class PushOperationsRegistry {
  /**
   * Get operations based on elements filter with dependency resolution
   */
  static getOperationsForElements(): PushOperationConfig[] {
    const state = getState();
    const elementList = state.elements ? state.elements.split(",") : 
      ['Galleries', 'Assets', 'Models', 'Containers', 'Content', 'Templates', 'Pages'];
    
    // Resolve dependencies and update state
    const { resolvedElements, autoIncluded } = this.resolveDependencies(elementList);
    
    // Update state.elements with resolved dependencies if any were auto-included
    if (autoIncluded.length > 0) {
      // Update the state with resolved elements
      setState({ elements: resolvedElements.join(',') });
    }
    
    // Filter operations based on resolved elements
    const relevantOperations = Object.values(PUSH_OPERATIONS).filter(operation => {
      // Check if any of the operation's elements are in the resolved element list
      return operation.elements.some(element => resolvedElements.includes(element));
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
      const operations = Object.values(PUSH_OPERATIONS).filter(op => 
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
