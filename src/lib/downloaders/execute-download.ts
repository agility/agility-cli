import { SyncDeltaTracker } from "lib/shared";
import { DownloadResults } from "./orchestrate-downloaders";
import { getState } from "core";

/**
 * Execute downloads for guid level items (Assets, Models, Containers, URLredirects, Templates)
 * This method can be overridden to customize the download sequence
 */
export async function executeDownloads(
  guid: string,
  results: DownloadResults,
  syncDeltaTracker?: SyncDeltaTracker,
  type: "guid" | "locale" = "guid"
): Promise<void> {
  // Use isolated state if provided, otherwise use global state
  const state = getState();

  // Get operations based on elements filter
  const operations = this.getOperationsForElements(state.elements, true);

  // Execute each operation
  for (const operation of operations) {
    try {
      this.config.onOperationStart?.(operation.name, guid);

      await operation.execute(guid, state, syncDeltaTracker);

      results.successful.push(`${operation.name} (${guid})`);
      this.config.onOperationComplete?.(operation.name, guid, true);
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error";
      results.failed.push({ operation: operation.name, error: errorMessage });

      this.config.onOperationComplete?.(operation.name, guid, false);
      console.error(`❌ ${guid}: ${operation.name} failed - ${errorMessage}`);
    }
  }
}
