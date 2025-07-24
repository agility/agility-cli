/**
 * Publishing Service for Agility CLI
 * Uses simple publisher functions that mirror the SDK patterns
 */

import * as mgmtApi from '@agility/management-sdk';
import { getState, getApiClient } from './state';
import { 
  publishContentItem
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
  private options: PublishOptions;

  constructor(options: PublishOptions = {}) {
    const state = getState();
    
    if (!state.targetGuid) {
      throw new Error('PublishService requires targetGuid to be set in state');
    }
    
    this.apiClient = getApiClient();
    this.targetGuid = state.targetGuid[0];
    this.options = { verbose: false, ...options };
  }

  /**
   * Publish a batch of content items using simple publisher functions
   */
  async publishContentBatch(contentIds: number[], locale: string): Promise<PublishResult['contentItems']> {
    const result: PublishResult['contentItems'] = {
      successful: [],
      failed: []
    };

    if (contentIds.length === 0) {
      return result;
    }

    if (this.options.verbose) {
      // console.log(ansiColors.cyan(`📝 Publishing ${contentIds.length} content items...`));
    }

    // Use simple publisher functions
    for (const contentId of contentIds) {
      try {
        const publishResult = await publishContentItem(contentId, locale);
        
        if (publishResult.success) {
          result.successful.push(contentId);
          if (this.options.verbose) {
            console.log(`✓ Content item ${ansiColors.cyan.underline(contentId)} published.`);
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
}
