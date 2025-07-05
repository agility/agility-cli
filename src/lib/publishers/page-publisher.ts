import { state } from '../../core/state';

/**
 * Simple page publisher function - mirrors apiClient.pageMethods.publishPage
 * 
 * @param pageId - Target page ID to publish
 * @returns Promise with publish result
 */
export async function publishPage(
    pageId: number
): Promise<{ success: boolean; pageId: number; error?: string }> {
    try {
        // Get state values instead of parameters
        const apiClient = state.apiClient;
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

        const result = await apiClient.pageMethods.publishPage(pageId, targetGuid, locale);
        
        return {
            success: true,
            pageId: pageId
        };
    } catch (error: any) {
        return {
            success: false,
            pageId: pageId,
            error: error.message || 'Unknown publishing error'
        };
    }
} 