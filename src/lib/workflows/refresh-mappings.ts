/**
 * Refresh Mappings
 * 
 * Refresh target instance data and update mappings after publishing.
 */

import ansiColors from 'ansi-colors';
import * as fs from 'fs';
import * as path from 'path';
import { Pull } from '../../core/pull';
import { getAllApiKeys, getState } from '../../core/state';
import { updateMappingsAfterPublish } from '../mappers/mapping-version-updater';
import { waitForFetchApiSync } from '../shared/get-fetch-api-status';
import { generateLogHeader } from '../shared';

/**
 * Check if we have valid API keys for the target GUID
 */
function hasValidTargetKeys(targetGuid: string): boolean {
    const apiKeys = getAllApiKeys();
    return apiKeys.some(key => key.guid === targetGuid);
}

/**
 * Write log lines to a file
 */
function writeLogFile(logLines: string[], targetGuid: string, locale: string): string | null {
    try {
        const state = getState();
        const logDir = path.join(process.cwd(), state.rootPath, targetGuid, 'logs');
        
        // Create logs directory if it doesn't exist
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFileName = `publish-${locale}-${timestamp}.log`;
        const logFilePath = path.join(logDir, logFileName);
        
        // Add header
        const header = generateLogHeader('Publish', {
            'Target GUID': targetGuid,
            'Locale': locale
        });
        
        // Strip ANSI colors for file output
        const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[mK]/g, '');
        const cleanLines = logLines.map(line => stripAnsi(line));
        
        const content = header + cleanLines.join('\n') + '\n';
        fs.writeFileSync(logFilePath, content, 'utf8');
        
        return logFilePath;
    } catch (error) {
        return null;
    }
}

/**
 * Refresh target instance data and update mappings with new versionIDs after publishing
 * 
 * @param publishedContentIds - Content IDs that were published
 * @param publishedPageIds - Page IDs that were published
 * @param sourceGuid - Source instance GUID
 * @param targetGuid - Target instance GUID
 * @param locale - Locale code
 * @param publishLogLines - Log lines from the publish operation to include in log file
 */
export async function refreshAndUpdateMappings(
    publishedContentIds: number[],
    publishedPageIds: number[],
    sourceGuid: string,
    targetGuid: string,
    locale: string,
    publishLogLines: string[] = []
): Promise<void> {
    // Start with publish log lines if provided
    const logLines: string[] = [...publishLogLines];
    
    const headerLine = ansiColors.cyan('\nRefreshing target instance data...');
    logLines.push(headerLine);
    console.log(headerLine);
    
    // Check if we have API keys for the target - if not, key fetch failed earlier
    if (!hasValidTargetKeys(targetGuid)) {
        const warnLine = ansiColors.yellow(`  ⚠️ No API keys available for target ${targetGuid} - skipping refresh and mapping updates`);
        const infoLine1 = ansiColors.gray('     This typically indicates an API connection issue (503, timeout, etc.)');
        const infoLine2 = ansiColors.gray('     Mappings will be updated on next successful sync');
        logLines.push(warnLine, infoLine1, infoLine2);
        console.log(warnLine);
        console.log(infoLine1);
        console.log(infoLine2);
        
        // Still write log file even if we can't refresh
        const logFilePath = writeLogFile(logLines, targetGuid, locale);
        if (logFilePath) {
            console.log(ansiColors.gray(`\n📄 Log file: ${logFilePath}`));
        }
        return;
    }
    
    try {
        // Wait for Fetch API sync to complete before refreshing
        // This ensures we're pulling the latest published data from the CDN
        try {
            const syncResult = await waitForFetchApiSync(targetGuid, 'fetch', false);
            logLines.push(...syncResult.logLines);
        } catch (error: any) {
            const warnLine = ansiColors.yellow(`  ⚠️ Could not check Fetch API status: ${error.message}`);
            logLines.push(warnLine);
            console.log(warnLine);
            // Continue with refresh anyway - the status check is best-effort
        }
        
        const pull = new Pull();
        
        // Run an incremental pull on the target instance
        const pullResult = await pull.pullInstances(true);
        
        // Check if the pull was successful before updating mappings
        if (!pullResult.success) {
            const warnLine = ansiColors.yellow('  ⚠️ Target refresh failed - skipping mapping version updates');
            const infoLine = ansiColors.gray('     Run a manual pull to refresh data and update mappings');
            logLines.push(warnLine, infoLine);
            console.log(warnLine);
            console.log(infoLine);
            
            // Still write log file on failure
            const logFilePath = writeLogFile(logLines, targetGuid, locale);
            if (logFilePath) {
                console.log(ansiColors.gray(`\n📄 Log file: ${logFilePath}`));
            }
            return;
        }
        
        const successLine = ansiColors.green('✓ Target instance data refreshed');
        logLines.push(successLine);
        console.log(successLine);
        
        // Update the mappings with the new versionIDs
        const mappingResult = await updateMappingsAfterPublish(
            publishedContentIds,
            publishedPageIds,
            sourceGuid,
            targetGuid,
            locale
        );
        
        // Add mapping update log lines
        logLines.push(...mappingResult.logLines);
        
        // Write log file
        const logFilePath = writeLogFile(logLines, targetGuid, locale);
        if (logFilePath) {
            const logPathLine = ansiColors.gray(`\n📄 Log file: ${logFilePath}`);
            console.log(logPathLine);
        }
        
    } catch (error: any) {
        const errorLine = ansiColors.yellow(`  ⚠️ Warning: Could not refresh/update mappings after publish: ${error.message}`);
        const infoLine = ansiColors.gray('     Mappings may be stale until next sync');
        logLines.push(errorLine, infoLine);
        console.error(errorLine);
        console.log(infoLine);
        
        // Still write log file on error
        const logFilePath = writeLogFile(logLines, targetGuid, locale);
        if (logFilePath) {
            console.log(ansiColors.gray(`\n📄 Log file: ${logFilePath}`));
        }
    }
}
