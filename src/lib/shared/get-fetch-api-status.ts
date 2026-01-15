/**
 * Fetch API Status Checker
 * 
 * Checks if the Fetch API CDN sync is complete for an instance.
 * Used before pull operations and after publishing to ensure
 * changes have propagated to the CDN.
 */

import * as mgmtApi from '@agility/management-sdk';
import { getApiClient } from '../../core/state';
import ansiColors from 'ansi-colors';

export type FetchApiSyncMode = 'fetch' | 'preview';

export interface FetchApiStatus {
    timestamp?: string;
    completionTime?: string;
    errorMessage?: string;
    inProgress: boolean;
    itemsAffected: number;
    lastContentVersionID: number;
    lastDeletedContentVersionID: number;
    lastDeletedPageVersionID: number;
    leaseID?: string;
    maxChangeDate?: string;
    maxContentModelDate?: string;
    pushType: number;
    startTime?: string;
    websiteName?: string;
}

/**
 * Get the Fetch API sync status for an instance
 * 
 * @param guid - The instance GUID
 * @param mode - Sync mode: 'fetch' (live) or 'preview'. Defaults to 'fetch'.
 * @param waitForCompletion - If true, polls until sync is complete. Defaults to false.
 * @returns The sync status
 */
export async function getFetchApiStatus(
    guid: string,
    mode: FetchApiSyncMode = 'fetch',
    waitForCompletion: boolean = false
): Promise<FetchApiStatus> {
    const apiClient = getApiClient();
    return apiClient.instanceMethods.getFetchApiStatus(guid, mode, waitForCompletion);
}

/**
 * Wait for Fetch API sync to complete with progress messaging
 * Returns log lines for capturing in logger
 * 
 * @param guid - The instance GUID
 * @param mode - Sync mode: 'fetch' (live) or 'preview'. Defaults to 'fetch'.
 * @param silent - If true, suppresses console output. Defaults to false.
 * @returns Object containing final status and log lines
 */
export async function waitForFetchApiSync(
    guid: string,
    mode: FetchApiSyncMode = 'fetch',
    silent: boolean = false
): Promise<{ status: FetchApiStatus; logLines: string[] }> {
    const logLines: string[] = [];
    
    // First check if sync is in progress
    const initialStatus = await getFetchApiStatus(guid, mode, false);
    
    if (!initialStatus.inProgress) {
        return { status: initialStatus, logLines };
    }
    
    // Sync is in progress, wait for completion
    const waitingMsg = ansiColors.gray(`Waiting for Fetch API sync to complete...`);
    logLines.push(waitingMsg);
    if (!silent) {
        console.log(waitingMsg);
    }
    
    const finalStatus = await getFetchApiStatus(guid, mode, true);
    
    const completeMsg = ansiColors.green(`✓ Fetch API sync complete \n`);
    logLines.push(completeMsg);
    if (!silent) {
        console.log(completeMsg);
    }
    
    return { status: finalStatus, logLines };
}
