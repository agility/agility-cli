import inquirer from "inquirer";
import colors from "ansi-colors";
import { instanceSelector } from "./instance-selector-prompt";
import { Auth } from "../services/auth";
// import { createMultibar } from "../services/multibar"; // Multibar no longer used
import * as mgmtApi from "@agility/management-sdk";
import { fileOperations } from "../services/fileOperations";
import { localePrompt } from "./locale-prompt";
import { isPreviewPrompt } from "./isPreview-prompt";
import { AgilityInstance } from "../../types/agilityInstance";
import { state } from "../services/state";
import { elementsPrompt } from "./elements-prompt";
// import { push } from "../services/push"; // Push service no longer exists - using individual pushers
import rootPathPrompt from "./root-path-prompt";
inquirer.registerPrompt("fuzzypath", require("inquirer-fuzzy-path"));

const FormData = require("form-data");

let auth: Auth;
let options: mgmtApi.Options;

// Accept useBlessedUI flag
export async function pushFiles(instance: any, useBlessedUI: boolean) {
  const { guid } = instance;

  const selectedInstance: AgilityInstance = await instanceSelector();
  const locale = await localePrompt(selectedInstance);
  const preview = await isPreviewPrompt();
  const elements: any = await elementsPrompt('push');
  const rootPath = await rootPathPrompt();

  const basePath = `${rootPath}/${guid}/${locale}/${preview ? 'preview' : 'live'}`;
  let code = new fileOperations(basePath, guid, locale, preview);
  auth = new Auth();

  let agilityFolder = code.cliFolderExists();
  if (agilityFolder) {
    // Push service also needs headless/verbose flags if it's going to manage UI/output
    // Assuming for now pushFiles just uses the passed useBlessedUI flag.
    // Multibar creation depends on mode, push service constructor should handle this.
    let multibar = null; // createMultibar({ name: "Push" });

    // Initialize options with token
    options = new mgmtApi.Options();
    let token = await auth.getToken();
    options.token = token;
    // options.baseUrl = auth.determineBaseUrl(guid); // Let push service determine if needed

    const rootPath = 'agility-files';
    const legacyFolders = false;
    const dryRun = false; // Assuming not a dry run from here
    const contentFolder = null; // Assuming default content folder

    // Assuming push service constructor will also be updated for headless/verbose
    // For now, passing flags based on useBlessedUI
    const isHeadless = !useBlessedUI;
    const isVerbose = false; // Assume not verbose unless flag is explicitly passed down

    console.log(colors.yellow("Push functionality has been replaced with the new sync system."));
    console.log(colors.cyan("Please use the 'sync' command instead of push."));
    
    // TODO: Integrate with new sync system
    // Push service has been removed in favor of the new topological sync system
    // This prompt needs to be updated to use the sync command instead
  } else {
    console.log(colors.red("Please pull an instance first to push an instance."));
  }
}