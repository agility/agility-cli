import inquirer from "inquirer";
import colors from "ansi-colors";
import { Auth } from "../services/auth";
// import { createMultibar } from "../services/multibar"; // Multibar service removed

import * as mgmtApi from "@agility/management-sdk";
import { fileOperations } from "../services/fileOperations";
import { localePrompt } from "./locale-prompt";
import { channelPrompt } from "./channel-prompt";
import { getBaseURLfromGUID } from "./base-url-prompt";
import { isPreviewPrompt } from "./isPreview-prompt";
import { elementsPrompt } from "./elements-prompt";
import { AgilityInstance } from "../../types/agilityInstance";
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { Pull } from "../services/pull";
import * as path from 'path';
import rootPathPrompt from "./root-path-prompt";
import { overwritePrompt } from './overwrite-prompt';

inquirer.registerPrompt('fuzzypath', require('inquirer-fuzzy-path'))

const FormData = require("form-data");

let auth: Auth;
let options: mgmtApi.Options;


export async function pullFiles(selectedInstance: AgilityInstance, useBlessedUI: boolean) {
    const { guid } = selectedInstance;
    const baseUrl = await getBaseURLfromGUID(guid);
    const locale = await localePrompt(selectedInstance);
    const channel = await channelPrompt();
    const preview = await isPreviewPrompt();
    const rootPath = await rootPathPrompt();
    const elements: any = await elementsPrompt();

    // central configuration for where you download files to
    const fullPath = path.join(rootPath, guid, locale, preview ? 'preview' : 'live');
    let userWantsToOverwrite = await overwritePrompt(fullPath);

    return await downloadFiles(guid, locale, channel, baseUrl, preview, elements, rootPath, useBlessedUI, userWantsToOverwrite, fullPath);
}


async function downloadFiles(guid: string, locale: any, channel: any, baseUrl: any | null, isPreview: any, elements: any, rootPath: string, useBlessedUI: boolean, forceOverwrite: boolean, fullPath: string) {
    auth = new Auth();
    let userBaseUrl: string = baseUrl as string;

    let multibar = null;

    options = new mgmtApi.Options();
    options.token = await auth.getToken();

    let user = await auth.getUser(guid);

    const instanceFilesParentPath = '.';

    try {
        const rootDir = path.join(instanceFilesParentPath, rootPath);
        if (!fs.existsSync(rootDir)) {
            await fsPromises.mkdir(rootDir);
            console.log(`Created directory: ${rootDir}`);
        }
        await fsPromises.mkdir(fullPath, { recursive: true });

    } catch (error) {
        console.error('Error creating directories:', error);
        throw error;
    }

    if (user) {
        const apiBaseUrl = userBaseUrl || auth.determineBaseUrl(guid);
        let previewKey = await auth.getPreviewKey(guid, apiBaseUrl);
        let fetchKey = await auth.getFetchKey(guid, apiBaseUrl);
        let apiKeyForPull = isPreview ? previewKey : fetchKey;

        if (apiKeyForPull) {
            // Log user choices before starting the pull
            try {
                const logOps = new fileOperations(rootPath, guid, locale, isPreview);
                const choicesToLog = {
                    guid,
                    locale,
                    channel,
                    isPreview,
                    elements,
                    rootPath,
                    fullPath, // The actual full path where files will be downloaded
                    forceOverwrite,
                    useBlessedUI,
                    // Assuming headless/verbose are determined within Pull class for now
                    // If they were passed to downloadFiles, they'd be here too.
                    timestamp: new Date().toISOString()
                };
                const logMessage = `User Pull Configuration:\n${JSON.stringify(choicesToLog, null, 2)}\n\n`;
                logOps.appendLogFile(logMessage);
            } catch (logError: any) {
                // Log to console if file logging fails, so we don't silently lose this info
                console.error("Failed to write pull configuration to log file:", logError.message);
            }

            const pullOperation = new Pull();

            try {
                await pullOperation.pullInstance();
                return true;
            } catch (pullError) {
                return false;
            }

        } else {
            console.log(colors.red('Either the preview key is not present in your instance or you need to specify the baseUrl parameter as an input based on the location. Please refer the docs for the Base Url.'));
            return false;
        }
    } else {
        console.log(colors.red('Please authenticate first to perform the pull operation.'));
        return false;
    }
}

async function pullPrompt(guid: string) {
    const instanceOptions = await inquirer.prompt([
        {
            type: "list",
            name: "action",
            message: "What would you like to do with this instance?",
            choices: ["Download", "Push to another instance", new inquirer.Separator(), "< Back to Home"],
        },

    ]);

    return instanceOptions.action;
}
