import { state } from "../../core/state";

/**
 * Simple batch publisher function - mirrors apiClient.batchMethods.publish(batchID)
 *
 * @param batchId - Target batch ID to publish
 * @returns Promise with batch publish result
 */
export async function publishBatch(
  batchId: number
): Promise<{ success: boolean; batchId: string; error?: string }> {
  try {
    // Get state values instead of parameters
    const { getApiClient } = await import('../../core/state');
const apiClient = getApiClient();
    const targetGuid = state.targetGuid;

    if (!apiClient) {
      throw new Error('API client not available in state');
    }
    if (!targetGuid) {
      throw new Error('Target GUID not available in state');
    }

    // Try different batch publishing API methods depending on SDK version
    let result;

    result = await apiClient.batchMethods.publishBatch(batchId, targetGuid[0], true);

    return {
      success: true,
      batchId: batchId.toString()
    };

  } catch (error: any) {
    return {
      success: false,
      batchId: batchId.toString(),
      error: error.message || "Unknown batch publishing error",
    };
  }
}
