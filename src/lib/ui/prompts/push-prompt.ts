import inquirer from "inquirer";
import colors from "ansi-colors";
import { instanceSelector } from "./instance-selector-prompt";
import { setState } from "../../../core/state";
import { localePrompt } from "./locale-prompt";
import { isPreviewPrompt } from "./isPreview-prompt";
import { AgilityInstance } from "../../../types/agilityInstance";
import { elementsPrompt } from "./elements-prompt";
// import { Sync } from "../../../core/sync_bak";
import rootPathPrompt from "./root-path-prompt";

/**
 * Modern push functionality using the sync system - replaces legacy push
 */
export async function pushFiles(sourceInstance: AgilityInstance) {
    const { guid } = sourceInstance;

    // Select target instance for sync operation
    const targetInstance: AgilityInstance = await instanceSelector();
    if (!targetInstance) {
        console.log(colors.red('No target instance selected.'));
        return false;
    }

    console.log(colors.cyan(`✔ Source instance: ${sourceInstance.websiteDetails?.displayName} (${sourceInstance.guid})`));
    console.log(colors.cyan(`✔ Target instance: ${targetInstance.websiteDetails?.displayName} (${targetInstance.guid})`));

    // Configure state from interactive prompts using refined flag architecture
    await configureStateFromSyncPrompts(sourceInstance, targetInstance);

    // Use standard Sync service (authentication already handled by calling command)
    // const syncOperation = new Sync();
    try {
        // await syncOperation.pushInstance(sourceInstance, targetInstance);
        return true;
    } catch (syncError) {
        console.error(colors.red('Sync operation failed:'), syncError);
        return false;
    }
}

/**
 * Configure state from interactive prompts for sync operations - modern state-based approach
 */
async function configureStateFromSyncPrompts(sourceInstance: AgilityInstance, targetInstance: AgilityInstance) {
    // Gather configuration through prompts
    const locale = await localePrompt(sourceInstance);
    console.log(colors.cyan(`✔ Locale: ${locale}`));

    const preview = await isPreviewPrompt();
    const elements = await elementsPrompt('push'); // Elements prompt for sync operation
    const rootPath = await rootPathPrompt();

    // Add prompts for refined flag architecture options
    const updateChoice = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'update',
            message: 'Download fresh source data before sync?',
            default: true // Default: --update=true
        }
    ]);

    const overwriteChoice = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'overwrite',
            message: 'Force update existing items in target instance instead of creating new versions?',
            default: false // Default: --overwrite=false (safer)
        }
    ]);



    // Configure state using setState() - same pattern as CLI commands
    setState({
        sourceGuid: sourceInstance.guid,
        targetGuid: targetInstance.guid,
        locale: locale,
        channel: 'website', // Default channel
        preview: preview,
        rootPath: rootPath,
        elements: elements.join(','),
        // Remove blessed: no longer supported
        headless: false,
        verbose: false,
        update: updateChoice.update,
        overwrite: overwriteChoice.overwrite,
        // Set other defaults
        reset: false,
        legacyFolders: false,
        test: false,
        dev: false,
        local: false,
        preprod: false
    });
}