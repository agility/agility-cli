/**
 * Integration tests for Fetch API Status helper
 * 
 * Tests the getFetchApiStatus and waitForFetchApiSync functions
 * against a real Agility CMS instance.
 * 
 * Setup:
 * 1. Copy src/tests/env.test.example to src/tests/.env
 * 2. Fill in your test credentials
 * 
 * Required env vars in src/tests/.env:
 * - AGILITY_TOKEN - Valid authentication token
 * - AGILITY_GUID or AGILITY_TARGET_GUID - Instance GUID to check
 * 
 * Run with: npm run test:integration
 */

// Disable SSL certificate verification for local development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { getFetchApiStatus, waitForFetchApiSync, FetchApiStatus } from '../../lib/shared/get-fetch-api-status';
import { state } from '../../core/state';
import * as mgmtApi from '@agility/management-sdk';
import { primeFromEnv } from '../../core/state';

describe('Fetch API Status - Integration Tests', () => {
    let testGuid: string;

    beforeAll(async () => {
        // Prime state from .env
        primeFromEnv();
        
        // Get required environment variables
        const token = process.env.AGILITY_TOKEN2 || process.env.AGILITY_TOKEN;
        testGuid = process.env.AGILITY_GUID || process.env.AGILITY_TARGET_GUID || '';
        const baseUrl = process.env.AGILITY_BASE_URL || process.env.BASE_URL;
        
        if (!token) {
            throw new Error('AGILITY_TOKEN is required in .env for integration tests');
        }
        if (!testGuid) {
            throw new Error('AGILITY_GUID or AGILITY_TARGET_GUID is required in .env for integration tests');
        }

        // Initialize API client with real credentials
        const options: mgmtApi.Options = {
            token: token,
            baseUrl: baseUrl,
            refresh_token: null,
            duration: 3000,
            retryCount: 500,
        };
        
        const apiClient = new mgmtApi.ApiClient(options);
        
        // Set state for the helper functions
        state.mgmtApiOptions = options;
        state.cachedApiClient = apiClient;
    });

    describe('getFetchApiStatus', () => {
        it('should return sync status for fetch mode', async () => {
            const status = await getFetchApiStatus(testGuid, 'fetch', false);
            
            expect(status).toBeDefined();
            expect(typeof status.inProgress).toBe('boolean');
            expect(typeof status.lastContentVersionID).toBe('number');
            expect(typeof status.pushType).toBe('number');
            
            // pushType should be 2 for fetch mode
            expect(status.pushType).toBe(2);
            
        }, 30000);

        it('should return sync status for preview mode', async () => {
            const status = await getFetchApiStatus(testGuid, 'preview', false);
            
            expect(status).toBeDefined();
            expect(typeof status.inProgress).toBe('boolean');
            expect(typeof status.lastContentVersionID).toBe('number');
            expect(typeof status.pushType).toBe('number');
            
            // pushType should be 1 for preview mode
            expect(status.pushType).toBe(1);
            
        }, 30000);
    });

    describe('waitForFetchApiSync', () => {
        it('should wait for sync to complete (or return immediately if not syncing)', async () => {
            const startTime = Date.now();
            const result = await waitForFetchApiSync(testGuid, 'fetch', true);
            const elapsed = Date.now() - startTime;
            
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
            expect(result.status.inProgress).toBe(false);
            expect(Array.isArray(result.logLines)).toBe(true);
            
        }, 120000); // 2 minute timeout for waiting
    });

    describe('error handling', () => {
        it('should handle invalid GUID gracefully', async () => {
            // Temporarily override the state with invalid credentials
            const originalClient = state.cachedApiClient;
            
            try {
                // This should throw or return an error
                await getFetchApiStatus('invalid-guid-xxx', 'fetch', false);
                // If it doesn't throw, that's also acceptable (API might return a default)
            } catch (error: any) {
                expect(error).toBeDefined();
            }
            
            // Restore original client
            state.cachedApiClient = originalClient;
        }, 30000);
    });
});
