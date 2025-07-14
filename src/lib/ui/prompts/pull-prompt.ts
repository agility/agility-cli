import inquirer from "inquirer";
import colors from "ansi-colors";
import { setState } from "../../../core/state";
import { localePrompt } from "./locale-prompt";
import { channelPrompt } from "./channel-prompt";
import { isPreviewPrompt } from "./isPreview-prompt";
import { elementsPrompt } from "./elements-prompt";
import { AgilityInstance } from "../../../types/agilityInstance";
import { PullUICoordinator } from "../../../core/pull-ui-coordinator";
import rootPathPrompt from "./root-path-prompt";


export async function pullFiles(selectedInstance: AgilityInstance, useBlessedUI: boolean) {
    // Configure state from interactive prompts using refined flag architecture
    await configureStateFromPrompts(selectedInstance, useBlessedUI);

    // Use standard Pull UI coordinator (authentication already handled by calling command)
    const pullOperation = new PullUICoordinator();
    try {
        await pullOperation.execute();
        return true;
    } catch (pullError) {
        console.error(colors.red('Pull operation failed:'), pullError);
        return false;
    }
}

/**
 * Configure state from interactive prompts - modern state-based approach
 */
async function configureStateFromPrompts(selectedInstance: AgilityInstance, useBlessedUI: boolean) {
    const { guid } = selectedInstance;
    
    // Gather configuration through prompts
    const locale = await localePrompt(selectedInstance);
    const channel = await channelPrompt();
    const preview = await isPreviewPrompt();
    const rootPath = await rootPathPrompt();
    const elements: any = await elementsPrompt();

    // Add prompts for refined flag architecture options
    const updateChoice = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'update',
            message: 'Download fresh data from source instance?',
            default: true // Default: --update=true
        }
    ]);

    const resetChoice = await inquirer.prompt([
        {
            type: 'confirm', 
            name: 'reset',
            message: 'Nuclear option: completely delete instance folder and start fresh?',
            default: false // Default: --reset=false
        }
    ]);

    // Pull operations don't need batch processing prompts

    // Configure state using setState() - same pattern as CLI commands
    setState({
        sourceGuid: guid,
        locale: locale,
        channel: channel,
        preview: preview,
        rootPath: rootPath,
        elements: elements.join(','),
        blessed: useBlessedUI,
        headless: false,
        verbose: false,
        update: updateChoice.update,
        reset: resetChoice.reset,
        noBatch: false, // Pull operations don't use batch processing
        // Set other defaults
        legacyFolders: false,
        test: false,
        overwrite: false, // Not applicable for pull
        dev: false,
        local: false,
        preprod: false
    });
}


