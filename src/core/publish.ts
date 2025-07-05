/**
 * Publishing Service for Agility CLI
 * Uses simple publisher functions that mirror the SDK patterns
 */

import * as mgmtApi from '@agility/management-sdk';
import { getState, getApiClient } from './state';
import { 
  publishContentItem, 
  publishPage, 
  publishContentList, 
  publishBatch 
} from '../lib/publishers';

const ansiColors = require("ansi-colors");

/**
 * Result interface for publishing operations
 */
export interface PublishResult {
  contentItems: {
    successful: number[];
    failed: Array<{ id: number; error: string }>;
  };
  pages: {
    successful: number[];
    failed: Array<{ id: number; error: string }>;
  };
}

/**
 * Options for publishing operations
 */
export interface PublishOptions {
  verbose?: boolean;
}

/**
 * Simple publishing service using publisher functions
 */
export class PublishService {
  private apiClient: mgmtApi.ApiClient;
  private targetGuid: string;
  private locale: string;
  private options: PublishOptions;

  constructor(options: PublishOptions = {}) {
    const state = getState();
    
    if (!state.targetGuid) {
      throw new Error('PublishService requires targetGuid to be set in state');
    }
    
    this.apiClient = getApiClient();
    this.targetGuid = state.targetGuid;
    this.locale = state.locale;
    this.options = { verbose: false, ...options };
  }

  /**
   * Publish a batch of content items using simple publisher functions
   */
  async publishContentBatch(contentIds: number[]): Promise<PublishResult['contentItems']> {
    const result: PublishResult['contentItems'] = {
      successful: [],
      failed: []
    };

    if (contentIds.length === 0) {
      return result;
    }

    if (this.options.verbose) {
      console.log(ansiColors.cyan(`📝 Publishing ${contentIds.length} content items...`));
    }

    // Use simple publisher functions
    for (const contentId of contentIds) {
      try {
        const publishResult = await publishContentItem(contentId);
        
        if (publishResult.success) {
          result.successful.push(contentId);
          if (this.options.verbose) {
            console.log(ansiColors.green(`✅ Published content item ${contentId}`));
          }
        } else {
          result.failed.push({ id: contentId, error: publishResult.error || 'Unknown error' });
          if (this.options.verbose) {
            console.error(ansiColors.red(`❌ Failed to publish content item ${contentId}: ${publishResult.error}`));
          }
        }
      } catch (error: any) {
        result.failed.push({ id: contentId, error: error.message });
        if (this.options.verbose) {
          console.error(ansiColors.red(`❌ Failed to publish content item ${contentId}: ${error.message}`));
        }
      }
    }

    if (this.options.verbose) {
      console.log(ansiColors.gray(`Content publishing: ${result.successful.length}/${contentIds.length} successful`));
    }

    return result;
  }

  /**
   * Publish a batch of pages using simple publisher functions
   */
  async publishPageBatch(pageIds: number[]): Promise<PublishResult['pages']> {
    const result: PublishResult['pages'] = {
      successful: [],
      failed: []
    };

    if (pageIds.length === 0) {
      return result;
    }

    if (this.options.verbose) {
      console.log(ansiColors.cyan(`📄 Publishing ${pageIds.length} pages...`));
    }

    // Use simple publisher functions
    for (const pageId of pageIds) {
      try {
        const publishResult = await publishPage(pageId);
        
        if (publishResult.success) {
          result.successful.push(pageId);
          if (this.options.verbose) {
            console.log(ansiColors.green(`✅ Published page ${pageId}`));
          }
        } else {
          result.failed.push({ id: pageId, error: publishResult.error || 'Unknown error' });
          if (this.options.verbose) {
            console.error(ansiColors.red(`❌ Failed to publish page ${pageId}: ${publishResult.error}`));
          }
        }
      } catch (error: any) {
        result.failed.push({ id: pageId, error: error.message });
        if (this.options.verbose) {
          console.error(ansiColors.red(`❌ Failed to publish page ${pageId}: ${error.message}`));
        }
      }
    }

    if (this.options.verbose) {
      console.log(ansiColors.gray(`Page publishing: ${result.successful.length}/${pageIds.length} successful`));
    }

    return result;
  }

  /**
   * Publish both content items and pages
   */
  async publishAll(contentIds: number[], pageIds: number[], listIds?: number[]): Promise<PublishResult> {
    if (this.options.verbose) {
      console.log(ansiColors.cyan(`\n🚀 Starting publishing operation...`));
      console.log(ansiColors.gray(`Target instance: ${this.targetGuid}`));
      console.log(ansiColors.gray(`Locale: ${this.locale}`));
      
      const totalItems = contentIds.length + pageIds.length + (listIds?.length || 0);
      console.log(ansiColors.gray(`Items: ${contentIds.length} content, ${pageIds.length} pages${listIds ? `, ${listIds.length} lists` : ''} (${totalItems} total)`));
    }

    // Publish content and pages in parallel
    const [contentResult, pageResult] = await Promise.all([
      this.publishContentBatch(contentIds),
      this.publishPageBatch(pageIds)
    ]);

    // Publish content lists if provided
    if (listIds && listIds.length > 0) {
      // Content lists use the same publishContentItem function
      for (const listId of listIds) {
        try {
          const publishResult = await publishContentList(listId);
          
          if (publishResult.success) {
            if (this.options.verbose) {
              console.log(ansiColors.green(`✅ Published content list ${listId}`));
            }
          } else {
            if (this.options.verbose) {
              console.error(ansiColors.red(`❌ Failed to publish content list ${listId}: ${publishResult.error}`));
            }
          }
        } catch (error: any) {
          if (this.options.verbose) {
            console.error(ansiColors.red(`❌ Failed to publish content list ${listId}: ${error.message}`));
          }
        }
      }
    }

    if (this.options.verbose) {
      const contentSuccess = contentResult.successful.length;
      const pageSuccess = pageResult.successful.length;
      const totalSuccess = contentSuccess + pageSuccess;
      const totalItems = contentIds.length + pageIds.length;
      
      console.log(ansiColors.green(`✅ Publishing completed: ${totalSuccess}/${totalItems} items successful`));
      console.log(ansiColors.gray(`   Content: ${contentSuccess}/${contentIds.length}, Pages: ${pageSuccess}/${pageIds.length}`));
    }

    return {
      contentItems: contentResult,
      pages: pageResult
    };
  }
}

/**
 * Factory function to create a PublishService instance
 */
export function createPublishService(options?: PublishOptions): PublishService {
  return new PublishService(options);
} 