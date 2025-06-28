import inquirer from "inquirer";
import colors from "ansi-colors";
import { setState } from "../services/state";
import { localePrompt } from "./locale-prompt";
import { channelPrompt } from "./channel-prompt";
import { isPreviewPrompt } from "./isPreview-prompt";
import { elementsPrompt } from "./elements-prompt";
import { AgilityInstance } from "../../types/agilityInstance";
import { Pull } from "../services/pull";
import rootPathPrompt from "./root-path-prompt";


export async function pullFiles(selectedInstance: AgilityInstance, useBlessedUI: boolean) {
    // Configure state from interactive prompts using refined flag architecture
    await configureStateFromPrompts(selectedInstance, useBlessedUI);

    // Use standard Pull service (authentication already handled by calling command)
    const pullOperation = new Pull();
    try {
        await pullOperation.pullInstance();
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
        // Set other defaults
        legacyFolders: false,
        test: false,
        overwrite: false, // Not applicable for pull
        dev: false,
        local: false,
        preprod: false
    });
}


