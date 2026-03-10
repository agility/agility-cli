/**
 * Integration tests for batch workflow operations
 * Tests workflow operations (publish, unpublish, etc.) on content and pages using a REAL API client
 * 
 * Setup:
 * 1. Copy src/tests/env.test.example to src/tests/.env.test
 * 2. Fill in your test credentials
 * 
 * Required env vars in src/tests/.env.test:
 * - AGILITY_TOKEN - Valid authentication token
 * - AGILITY_TARGET_GUID or AGILITY_GUID - Target instance GUID
 * - AGILITY_LOCALE or AGILITY_LOCALES - Locale(s) for testing
 * - CONTENTIDS_TO_BATCH_PUBLISH - Comma-separated content IDs
 * - PAGES_TO_BATCH_PUBLISH - Comma-separated page IDs
 * 
 * Run with: npm test -- --testPathPattern="integration"
 */

// Disable SSL certificate verification for local development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { batchWorkflow } from '../../core/batch-workflows';
import { WorkflowOperationType } from '@agility/management-sdk';
import { state } from '../../core/state';
import * as mgmtApi from '@agility/management-sdk';
import { primeFromEnv } from '../../core/state';

// Helper function to parse comma-separated IDs from environment variable
function parseIDs(envVar: string | undefined, fallback: number[]): number[] {
  if (!envVar) return fallback;
  return envVar
    .split(',')
    .map(id => parseInt(id.trim(), 10))
    .filter(id => !isNaN(id));
}

// Get test data from environment variables
const TEST_CONTENT_IDS = parseIDs(process.env.CONTENTIDS_TO_BATCH_PUBLISH, []);
const TEST_PAGE_IDS = parseIDs(process.env.PAGES_TO_BATCH_PUBLISH, []);
const TEST_LOCALE = process.env.AGILITY_LOCALE || process.env.AGILITY_LOCALES?.split(',')[0] || 'en-us';
const BASE_URL = process.env.AGILITY_BASE_URL || process.env.BASE_URL || 'https://api.agilitycms.com';

describe('Batch Workflow Operations - Integration Tests', () => {
  let apiClient: mgmtApi.ApiClient;

  beforeAll(async () => {
    // Prime state from .env
    primeFromEnv();
    
    // Get required environment variables
    const token = process.env.AGILITY_TOKEN2 || process.env.AGILITY_TOKEN;
    const targetGuid = process.env.AGILITY_TARGET_GUID || process.env.AGILITY_GUID;
    
    if (!token) {
      throw new Error('AGILITY_TOKEN is required in .env for integration tests');
    }
    if (!targetGuid) {
      throw new Error('AGILITY_TARGET_GUID or AGILITY_GUID is required in .env for integration tests');
    }

    // Initialize API client with real credentials
    const options: mgmtApi.Options = {
      token: token,
      baseUrl: BASE_URL,
      refresh_token: null,
      duration: 3000,
      retryCount: 500,
    };
    
    apiClient = new mgmtApi.ApiClient(options);
    
    // Set state for the workflow functions
    state.targetGuid = [targetGuid];
    state.mgmtApiOptions = options;
    state.cachedApiClient = apiClient;
  });

  // ============================================================================
  // Content Workflow Operations
  // ============================================================================
  
  describe('Content Workflow Operations', () => {
    beforeAll(() => {
      if (TEST_CONTENT_IDS.length === 0) {
        console.warn('CONTENTIDS_TO_BATCH_PUBLISH not set - content tests will be skipped');
      }
    });

    it('should run publish workflow operation on content items', async () => {
      if (TEST_CONTENT_IDS.length === 0) return;
      
      const result = await batchWorkflow(TEST_CONTENT_IDS, TEST_LOCALE, WorkflowOperationType.Publish, 'content');
      expect(result.success).toBe(true);
      expect(result.processedIds).toBeDefined();
      expect(result.processedIds.length).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    }, 30000);

    it('should run unpublish workflow operation on content items', async () => {
      if (TEST_CONTENT_IDS.length === 0) return;
      
      const result = await batchWorkflow(TEST_CONTENT_IDS, TEST_LOCALE, WorkflowOperationType.Unpublish, 'content');
      expect(result.success).toBe(true);
      expect(result.processedIds).toBeDefined();
      expect(result.processedIds.length).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    }, 30000);

    it('should handle workflow operation on invalid content IDs gracefully', async () => {
      const invalidContentIDs = [999999, 999998];
      const result = await batchWorkflow(invalidContentIDs, TEST_LOCALE, WorkflowOperationType.Publish, 'content');
      expect(result).toBeDefined();
      expect(result.success !== undefined).toBe(true);
    }, 30000);
  });

  // ============================================================================
  // Page Workflow Operations
  // ============================================================================
  
  describe('Page Workflow Operations', () => {
    beforeAll(() => {
      if (TEST_PAGE_IDS.length === 0) {
        console.warn('PAGES_TO_BATCH_PUBLISH not set - page tests will be skipped');
      }
    });

    it('should run publish workflow operation on pages', async () => {
      if (TEST_PAGE_IDS.length === 0) return;
      
      const result = await batchWorkflow(TEST_PAGE_IDS, TEST_LOCALE, WorkflowOperationType.Publish, 'pages');
      expect(result.success).toBe(true);
      expect(result.processedIds).toBeDefined();
      expect(result.processedIds.length).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    }, 30000);

    it('should run unpublish workflow operation on pages', async () => {
      if (TEST_PAGE_IDS.length === 0) return;
      
      const result = await batchWorkflow(TEST_PAGE_IDS, TEST_LOCALE, WorkflowOperationType.Unpublish, 'pages');
      expect(result.success).toBe(true);
      expect(result.processedIds).toBeDefined();
      expect(result.processedIds.length).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    }, 30000);

    it('should handle workflow operation on invalid page IDs gracefully', async () => {
      const invalidPageIDs = [999999, 999998];
      const result = await batchWorkflow(invalidPageIDs, TEST_LOCALE, WorkflowOperationType.Publish, 'pages');
      expect(result).toBeDefined();
      expect(result.success !== undefined).toBe(true);
    }, 30000);
  });
});
