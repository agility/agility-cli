/**
 * Simple Content Item Publisher Function
 * 
 * Mirrors the SDK pattern: apiClient.contentMethods.publishContent(id)
 */

import { state } from '../../core/state';

/**
 * Simple content item publisher function - mirrors apiClient.contentMethods.publishContent
 * 
 * @param contentId - Target content ID to publish
 * @returns Promise with publish result
 */
export async function publishContentItem(
    contentId: number
): Promise<{ success: boolean; contentId: number; error?: string }> {
    try {
        // Get state values instead of parameters
        const { getApiClient } = await import('../../core/state');
const apiClient = getApiClient();
        const targetGuid = state.targetGuid;
        const locale = state.locale;

        if (!apiClient) {
            throw new Error('API client not available in state');
        }
        if (!targetGuid) {
            throw new Error('Target GUID not available in state');
        }
        if (!locale) {
            throw new Error('Locale not available in state');
        }

        const result = await apiClient.contentMethods.publishContent(contentId, targetGuid, locale);
        
        return {
            success: true,
            contentId: contentId
        };
    } catch (error: any) {
        return {
            success: false,
            contentId: contentId,
            error: error.message || 'Unknown publishing error'
        };
    }
} 