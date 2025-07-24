/**
 * Simple Content List Publisher Function
 * 
 * Mirrors the SDK pattern: apiClient.contentMethods.publishContent(id) for content lists
 */

import { state } from '../../core/state';

/**
 * Simple content list publisher function - mirrors apiClient.contentMethods.publishContent for lists
 * 
 * @param contentListId - Target content list ID to publish
 * @returns Promise with publish result
 */
export async function publishContentList(
    contentListId: number,
    locale: string
): Promise<{ success: boolean; contentListId: number; error?: string }> {
    try {
        // Get state values instead of parameters
        const { getApiClient } = await import('../../core/state');
const apiClient = getApiClient();
        const { targetGuid } = state;

        if (!apiClient) {
            throw new Error('API client not available in state');
        }
        if (!targetGuid) {
            throw new Error('Target GUID not available in state');
        }
        if (!locale) {
            throw new Error('Locale not available in state');
        }

        // Content lists use the same publish API as content items
        await apiClient.contentMethods.publishContent(contentListId, targetGuid[0], locale);
        
        return {
            success: true,
            contentListId: contentListId
        };
    } catch (error: any) {
        return {
            success: false,
            contentListId: contentListId,
            error: error.message || 'Unknown publishing error'
        };
    }
} 
