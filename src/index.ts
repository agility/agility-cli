#!/usr/bin/env node
// Only disable SSL verification for development/local environments
// if (process.env.NODE_ENV === 'development' || process.env.LOCAL) {
//     process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// }

import * as yargs from "yargs";
import { Auth } from "./lib/services/auth";
import { fileOperations } from "./lib/services/fileOperations";
import { push } from "./lib/services/push";

import * as mgmtApi from "@agility/management-sdk";
const FormData = require("form-data");
const colors = require("ansi-colors");
const inquirer = require("inquirer");
inquirer.registerPrompt("search-list", require("inquirer-search-list"));
import { createMultibar } from "./lib/services/multibar";
import { homePrompt } from "./lib/prompts/home-prompt";
import { generateEnv } from "./lib/utilities/generate-env";
import { exit } from "process";
import { instancesPrompt } from "./lib/prompts/instance-prompt";
import { AgilityInstance } from "./types/agilityInstance";
import { websiteListing } from "types/websiteListing";
import Clean from "./lib/services/clean";
import { instanceSelector } from "./lib/instances/instance-list";
import { localePrompt } from "./lib/prompts/locale-prompt";
import { content } from "./lib/services/content";
import { Pull } from "./lib/services/pull";
import { channel } from "diagnostics_channel";


// declare module "@agility/management-sdk" {
//   interface PageItem {
//     pageTemplateID?: number;
//   }
// }

let auth: Auth;
export let forceDevMode: boolean = false; // QA
export let forceLocalMode: boolean = false;
export let forcePreProdMode: boolean = false;
export let localServer: string;
export let token: string = null;
export let blessedUIEnabled: boolean = true;
export let isAgilityDev: boolean = false;
export let forceNGROK: boolean = false;
export let modelDiffsEnabled: boolean = false;

// Configure SSL verification based on CLI mode
function configureSSL() {
  if (forceLocalMode) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    console.warn("\nWarning: SSL certificate verification is disabled for development/local mode");
  }
}

let options = new mgmtApi.Options();

yargs.version("0.0.1_beta").demand(1).exitProcess(false);

console.log(colors.yellow("Welcome to Agility CLI."));
yargs.command({
  command: "$0",
  describe: "Default command",
  builder: {
    dev: {
      describe: "Enable developer mode", // for development only
      type: "boolean",
      default: false,
    },
    local: {
      describe: "Enable local mode", // for development only
      type: "boolean",
      default: false,
    },
    preprod: {
      describe: "Enable preprod mode", // for development only
      type: "boolean",
      default: false,
    },
    headless: {
      describe: "Turn off the experimental Blessed UI for push/sync operations.",
      type: "boolean",
      default: false,
    },
    verbose: {
      describe: "Run in verbose mode: all logs to console, no UI elements. Overridden by headless.",
      type: "boolean",
      default: false
    },
    modelDiffs: {
      describe: "Enable detailed logging of model differences during push operations.",
      type: "boolean",
      default: false,
    }
  },
  handler: async function (argv) {
    const useHeadless = argv.headless as boolean;
    const useVerbose = !useHeadless && (argv.verbose as boolean);
    const useBlessed = !useHeadless && !useVerbose;
    blessedUIEnabled = useBlessed;

    forceDevMode = argv.dev as boolean;
    forceLocalMode = argv.local as boolean;
    forcePreProdMode = argv.preprod as boolean;
    modelDiffsEnabled = argv.modelDiffs as boolean;
    configureSSL();

    let auth = new Auth();
    const isAuthorized = await auth.checkAuthorization();
    if (!isAuthorized) {
      // If auth fails, it should have already logged a message.
      return;
    }

    const envCheck = auth.checkForEnvFile();
    if (envCheck.hasEnvFile && envCheck.guid && !forceLocalMode && !forceDevMode && !forcePreProdMode) {
      try {
        let user = await auth.getUser(envCheck.guid);
        let currentWebsite = user.websiteAccess.find((website: websiteListing) => website.guid === envCheck.guid);

        if (!currentWebsite) {
          console.error("No matching website found for the provided GUID");
          return;
        }

        const instance: AgilityInstance = {
          guid: envCheck.guid,
          previewKey: "",
          fetchKey: "",
          websiteDetails: currentWebsite,
        };

        console.log("------------------------------------------------");
        console.log(colors.green("●"), colors.green(`${currentWebsite.displayName}`), colors.white(`${instance.guid}`));
        console.log("------------------------------------------------");

        await instancesPrompt(instance, null, useBlessed);
      } catch (error: any) {
        console.error("Error:", error.message);
        console.log("Please try logging in again with: agility login");
      }
    } else {
      homePrompt(useBlessed);
    }
  },
});

yargs.command({
  command: "login",
  describe: "Login to Agility.",
  builder: {
    dev: {
      describe: "Enable developer mode",
      type: "boolean",
      default: false,
    },
  },
  handler: async function (argv) {
    auth = new Auth();
    await auth.authorize();
  },
});

yargs.command({
  command: "logout",
  describe: "Log out of Agility.",
  builder: {
    dev: {
      describe: "Logout from developer mode",
      type: "boolean",
      default: false,
    },
    local: {
      describe: "Logout from local mode",
      type: "boolean",
      default: false,
    },
  },
  handler: async function (argv) {
    let auth = new Auth();
    if (argv.dev) {
      forceDevMode = true;
    }
    if (argv.local) {
      forceLocalMode = true;
    }
    await auth.logout();
  },
});

yargs.command({
  command: "clean",
  describe: "Scrub all the data out of an instance",
  builder: {
    headless: {
      describe: "Use experimental Blessed UI for push/sync operations.",
      type: "boolean",
      default: false,
    },
  },
  handler: async function (argv) {
    blessedUIEnabled = !argv.headless as boolean;
    forceLocalMode = true;
    configureSSL();
    let auth = new Auth();
    const isAuthorized = await auth.checkAuthorization();
    if (isAuthorized) {
      const selectedInstance = await instanceSelector();
      const locale = await localePrompt(selectedInstance);
      const clean = new Clean(selectedInstance, locale);
      await clean.cleanAll();
    }
  },
});

yargs.command({
  command: "genenv",
  describe: "Generate an env file for your instance.",
  builder: {
    headless: {
      describe: "Turn off the experimental Blessed UI for push/sync operations.",
      type: "boolean",
      default: false,
    },
  },
  handler: async function (argv) {
    blessedUIEnabled = !argv.headless as boolean;
    let auth = new Auth();
    const isAuthorized = await auth.checkAuthorization();
    if (isAuthorized) {
      const result = await generateEnv();
      if (result) {
        process.exit(0);
      }
    } else {
      console.log(colors.red("You are not authorized to generate an env file."));
      return;
    }
  },
});

// yargs.command({
//   command: "sync-models",
//   describe: "Sync Models locally.",
//   builder: {
//     sourceGuid: {
//       describe: "Provide the source guid to pull models from your source instance.",
//       demandOption: false,
//       type: "string",
//     },
//     targetGuid: {
//       describe: "Provide the target guid to push models to your destination instance.",
//       demandOption: false,
//       type: "string",
//     },
//     pull: {
//       describe: "Provide the value as true or false to perform an instance pull to sync models.",
//       demandOption: false,
//       type: "boolean",
//     },
//     folder: {
//       describe:
//         "Specify the path of the folder where models and template folders are present for model sync. If no value provided, the default folder will be agility-files.",
//       demandOption: false,
//       type: "string",
//     },
//     dryRun: {
//       describe: "Provide the value as true or false to perform a dry run for model sync.",
//       demandOption: false,
//       type: "boolean",
//     },
//     filter: {
//       describe: "Specify the path of the filter file. Ex: C:AgilitymyFilter.json.",
//       demandOption: false,
//       type: "string",
//     },
//   },
//   handler: async function (argv) {
//     blessedUIEnabled = argv.blessed as boolean;
//     auth = new Auth();
//     let code = new fileOperations();
//     let codeFileStatus = code.codeFileExists();
//     if (codeFileStatus) {
//       let data = JSON.parse(code.readTempFile("code.json"));

//       const form = new FormData();
//       form.append("cliCode", data.code);
//       let guid: string = argv.sourceGuid as string;
//       let targetGuid: string = argv.targetGuid as string;
//       let instancePull: boolean = argv.pull as boolean;
//       let dryRun: boolean = argv.dryRun as boolean;
//       let filterSync: string = argv.filter as string;
//       let folder: string = argv.folder as string;

//       if (guid === undefined && targetGuid === undefined) {
//         console.log(colors.red("Please provide a source guid or target guid to perform the operation."));
//         return;
//       }

//       let authGuid: string = "";

//       if (guid !== undefined) {
//         authGuid = guid;
//       } else {
//         authGuid = targetGuid;
//       }

//       let models: mgmtApi.Model[] = [];

//       let templates: mgmtApi.PageModel[] = [];

//       let multibar = createMultibar({ name: "Sync Models" });

//       if (dryRun === undefined) {
//         dryRun = false;
//       }
//       if (instancePull === undefined) {
//         instancePull = false;
//       }
//       if (filterSync === undefined) {
//         filterSync = "";
//       }
//       if (folder === undefined) {
//         folder = "agility-files";
//       }
//       let user = await auth.getUser(authGuid);

//       if (!instancePull) {
//         if (!code.checkBaseFolderExists(folder)) {
//           console.log(colors.red(`To proceed with the command the folder ${folder} should exist.`));
//           return;
//         }
//       }

//       if (user) {
//         if (guid === undefined) {
//           guid = "";
//         }
//         if (targetGuid === undefined) {
//           targetGuid = "";
//         }
//         let sourcePermitted = await auth.checkUserRole(guid);
//         let targetPermitted = await auth.checkUserRole(targetGuid);
//         if (guid === "") {
//           sourcePermitted = true;
//         }
//         if (targetGuid === "") {
//           targetPermitted = true;
//         }
//         let modelPush = new modelSync(options, multibar);
//         if (sourcePermitted && targetPermitted) {
//           if (instancePull) {
//             if (guid === "") {
//               console.log(colors.red("Please provide the sourceGuid of the instance for pull operation."));
//               return;
//             }
//             console.log(colors.yellow("Pulling models from your instance. Please wait..."));
//             code.cleanup(folder);
//             code.createBaseFolder(folder);
//             code.createLogFile("logs", "instancelog", folder);
//             let modelPull = new model(options, multibar);

//             let templatesPull = new sync(guid, "syncKey", "locale", "channel", options, multibar);

//             await modelPull.getModels(guid, folder);
//             await templatesPull.getPageTemplates(folder);
//             multibar.stop();

//             if (targetGuid === "") {
//               return;
//             }
//           }
//           if (filterSync) {
//             if (!code.checkFileExists(filterSync)) {
//               console.log(colors.red(`Please check the filter file is present at ${filterSync}.`));
//               return;
//             } else {
//               let file = code.readFile(`${filterSync}`);
//               const jsonData: FilterData = JSON.parse(file);
//               const modelFilter = new ModelFilter(jsonData);
//               models = await modelPush.validateAndCreateFilterModels(modelFilter.filter.Models, folder);
//               templates = await modelPush.validateAndCreateFilterTemplates(
//                 modelFilter.filter.Templates,
//                 "locale",
//                 folder
//               );
//             }
//           }
//           if (dryRun) {
//             if (targetGuid === "") {
//               console.log(
//                 colors.red(
//                   "Please provide the targetGuid parameter a valid instance guid to perform the dry run operation."
//                 )
//               );
//               return;
//             }
//             console.log(colors.yellow("Running a dry run on models, please wait..."));
//             if (code.folderExists("models-sync")) {
//               code.cleanup(`${folder}/models-sync`);
//             }

//             let containerRefs = await modelPush.logContainers(models);
//             if (containerRefs) {
//               if (containerRefs.length > 0) {
//                 console.log(
//                   colors.yellow(
//                     "Please review the content containers in the containerReferenceNames.json file in the logs folder. They should be present in the target instance."
//                   )
//                 );
//               }
//             }
//             await modelPush.dryRun(guid, "locale", targetGuid, models, templates, folder);
//           } else {
//             if (targetGuid === "") {
//               console.log(
//                 colors.red(
//                   "Please provide the targetGuid parameter a valid instance guid to perform the model sync operation."
//                 )
//               );
//               return;
//             }
//             console.log(colors.yellow("Syncing Models from your instance..."));
//             multibar = createMultibar({ name: "Sync Models" });
//             let containerRefs = await modelPush.logContainers(models);
//             if (containerRefs) {
//               if (containerRefs.length > 0) {
//                 console.log(
//                   colors.yellow(
//                     "Please review the content containers in the containerReferenceNames.json file in the logs folder. They should be present in the target instance."
//                   )
//                 );
//               }
//             }
//             await modelPush.syncProcess(targetGuid, "locale", models, templates, folder);
//           }
//         } else {
//           console.log(colors.red("You do not have the required permissions to perform the model sync operation."));
//         }
//       } else {
//         console.log(colors.red("Please authenticate first to perform the sync models operation."));
//       }
//     } else {
//       console.log(colors.red("Please authenticate first to perform the sync models operation."));
//     }
//   },
// });

// yargs.command({
//   command: "model-pull",
//   describe: "Pull models locally.",
//   builder: {
//     sourceGuid: {
//       describe: "Provide the source guid to pull models from your source instance.",
//       demandOption: true,
//       type: "string",
//     },
//     folder: {
//       describe: "Specify the path of the folder where models and template folders are present for model pull.",
//       demandOption: false,
//       type: "string",
//     },
//   },
//   handler: async function (argv) {
//     blessedUIEnabled = argv.blessed as boolean;
//     auth = new Auth();
//     let code = new fileOperations();
//     let codeFileStatus = code.codeFileExists();
//     if (codeFileStatus) {
//       let guid: string = argv.sourceGuid as string;
//       let folder: string = argv.folder as string;
//       let multibar = createMultibar({ name: "Model Pull" });

//       if (folder === undefined) {
//         folder = "agility-files";
//       }

//       let user = await auth.getUser(guid);

//       if (user) {
//         let sourcePermitted = await auth.checkUserRole(guid);

//         if (sourcePermitted) {
//           code.cleanup(folder);
//           code.createBaseFolder(folder);
//           code.createLogFile("logs", "instancelog", folder);
//           console.log(colors.yellow("Pulling Models from your instance..."));
//           let modelPull = new model(options, multibar);

//           let templatesPull = new sync(guid, "syncKey", "locale", "channel", options, multibar);

//           await modelPull.getModels(guid, folder);
//           await templatesPull.getPageTemplates(folder);
//           multibar.stop();
//         } else {
//           console.log(colors.red("You do not have the required permissions to perform the model pull operation."));
//         }
//       } else {
//         console.log(colors.red("Please authenticate first to perform the pull operation."));
//       }
//     } else {
//       console.log(colors.red("Please authenticate first to perform the pull operation."));
//     }
//   },
// });

yargs.command({
  command: "pull",
  describe: "Pull your Agility instance locally.",
  builder: {
    guid: {
      describe: "Provide the guid to pull from. If not provided, will use AGILITY_GUID from .env file if available.",
      demandOption: false,
      type: "string",
    },
    locale: {
      describe: "Provide the locale to pull your instance. If not provided, will use AGILITY_LOCALES from .env file if available.",
      demandOption: false,
      type: "string",
      default: "en-us"

    },
    dev: {
      describe: "Run in dev mode. This will use the dev instance for the pull operation.",
      demandOption: false,
      type: "boolean",
      default: false
    },
    channel: {
      describe: "Provide the channel to pull your instance from.",
      demandOption: true,
      type: "string",
      default: "website"
    },
    preview: {
      describe: "Whether to pull from preview or live environment data.",
      demandOption: false,
      type: "boolean",
      default: true,
    },
    elements: {
      describe: "Comma-separated list of elements to pull (Pages,Models,Content,Assets,Galleries). Note: Currently, the pull operation attempts to download all types; individual types will be skipped if their folders are already populated.",
      demandOption: false,
      type: "string",
      default: "Galleries,Assets,,Models,Containers,Content,Templates,Pages",
    },
    legacyFolders: {
      describe: "Use legacy folder structure (all files in root agility-files folder).",
      demandOption: false,
      type: "boolean",
      default: false,
    },
    baseUrl: {
      describe: "(Optional) Specify a base URL for the Agility API, if different from default.",
      type: "string"
    },
    blessed: {
      describe: "Use Blessed UI for rich terminal output. (Deprecated in favor of default behavior)",
      type: "boolean",
      default: false
    },
    headless: {
      describe: "Run in headless mode: no console output, logs to file. Overrides verbose and Blessed UI.",
      type: "boolean",
      default: false
    },
    verbose: {
      describe: "Run in verbose mode: all logs to console, no UI elements. Overridden by headless.",
      type: "boolean",
      default: true
    },
    overwrite: {
      describe: "Force overwrite existing local files and metadata.",
      type: "boolean",
      default: false
    }
  },
  handler: async function (argv) {
    let auth = new Auth();
    const isAuthorized = await auth.checkAuthorization();
    if (!isAuthorized) {
      console.log(colors.red("Authentication failed or not authorized."));
      return;
    }

    let guid: string = argv.guid as string;
    let locale: string = argv.locale as string;
    forceDevMode = argv.dev as boolean;

    const channel: string = argv.channel as string;
    const isPreview: boolean = argv.preview as boolean;
    const elements: string[] = (argv.elements as string).split(",");
    const instanceMainDirName: string = "agility-files";
    const userBaseUrl: string = argv.baseUrl as string;
    const legacyFolders: boolean = argv.legacyFolders as boolean;
    const rootPath: string = instanceMainDirName;
    const { blessed, headless, verbose, overwrite } = argv;

    const envCheck = auth.checkForEnvFile();
    if (envCheck.hasEnvFile) {
      if (!guid && envCheck.guid) {
        guid = envCheck.guid;
      }
      if (!locale && envCheck.locales && envCheck.locales.length > 0) {
        locale = envCheck.locales[0];
      }
    }

    if (!guid) {
      console.log(colors.red("Please provide a GUID for the instance or ensure AGILITY_GUID is in your .env file."));
      return;
    }
    if (!locale) {
      console.log(colors.red("Please provide a locale or ensure AGILITY_LOCALES is in your .env file."));
      return;
    }
    if (!channel) {
      console.log(colors.red("Please provide a channel name."));
      return;
    }

    // Determine UI/output mode
    const useHeadless = headless; // headless takes precedence
    const useVerbose = !useHeadless && verbose;
    const useBlessed = !useHeadless && !useVerbose && blessed; // blessed is true by default or from arg

    let multibarInstance = null;
    if (useBlessed) {
      // screen, multibar setup as before for Blessed UI
      // ... (this part might need to be inside Pull or passed differently)
    } else if (!useHeadless && !useVerbose) {
      // Potentially setup cli-progress multibar for a basic non-Blessed, non-headless, non-verbose mode
      // multibarInstance = new cliProgress.MultiBar({ ... });
    }

    let mgmtApiOptions = new mgmtApi.Options();
    mgmtApiOptions.token = await auth.getToken();

    try {
      const user = await auth.getUser(guid);
      if (!user) {
        console.log(colors.red(`Could not retrieve user details for instance ${guid}. Please ensure it's a valid GUID and you have access.`));
        return;
      }


      const determinedMgmtBaseUrl = auth.determineBaseUrl(guid);
      mgmtApiOptions.baseUrl = userBaseUrl || determinedMgmtBaseUrl;

      let previewKey = await auth.getPreviewKey(guid, mgmtApiOptions.baseUrl);
      let fetchKey = await auth.getFetchKey(guid, mgmtApiOptions.baseUrl);
      let apiKeyForPull = isPreview ? previewKey : fetchKey;

      if (!apiKeyForPull) {
        console.log(colors.red(`Could not retrieve the required API key (preview: ${isPreview}) for instance ${guid}. Check API key configuration in Agility and --baseUrl if used.`));
        return;
      }

      console.log(
        colors.yellow(
          `\nPulling instance ${guid} (${locale}) [${channel}] ${isPreview ? 'Preview' : 'Live'} into ./${instanceMainDirName}`
        )
      );

      const pullOperation = new Pull(
        guid,
        apiKeyForPull,
        locale,
        channel,
        isPreview,
        mgmtApiOptions,
        multibarInstance,
        elements,
        rootPath,
        legacyFolders,
        useBlessed,
        useHeadless,
        useVerbose,
        overwrite // Add the overwrite flag
      );

      await pullOperation.pullInstance();

    } catch (error) {
      console.error(colors.red("\n❌ An error occurred during the pull command:"), error);
      if (multibarInstance) {
        multibarInstance.stop();
      }
      process.exit(1);
    }

    if (useHeadless) {
      console.log(`Pull operation complete. Log file: ${rootPath}/logs/instancelog.txt`);
    }
  },
});

// push an instance
// agility push --sourceGuid="1234567890" --targetGuid="9876543210" --locale="en-us" --preview="true" --elements="Pages,Models,Content,Assets,Galleries"

// sync a model
// agility push --sourceGuid="1234567890" --targetGuid="9876543210" --locale="en-us" --preview="true" --elements="Models"
yargs.command({
  command: "push",
  describe: "Push your Instance.",
  builder: {
    sourceGuid: {
      describe: "Provide the source guid to push from. If not provided, will use AGILITY_GUID from .env file if available.",
      demandOption: false,
      type: "string",
    },
    targetGuid: {
      describe: "Provide the target guid to push your instance to.",
      demandOption: true,
      type: "string",
    },
    locale: {
      describe: "Provide the locale to push your instance. If not provided, will use AGILITY_LOCALES from .env file if available.",
      demandOption: false,
      type: "string",
    },
    preview: {
      describe: "Whether to push to preview or live environment data from source.",
      demandOption: false,
      type: "boolean",
      default: true,
    },
    elements: {
      describe: "Comma-separated list of elements to push (Galleries,Assets,Models,Containers,Content,Templates,Pages)",
      demandOption: false,
      type: "string",
      default: "Galleries,Assets,,Models,Containers,Content,Templates,Pages",
    },
    local: {
      describe: "Switch to local management API mode..",
      demandOption: false,
      type: "boolean",
      default: false,
    },
    headless: {
      describe: "Turn off the experimental Blessed UI for push/sync operations.",
      type: "boolean",
      default: false,
    },
    verbose: {
      describe: "Run in verbose mode: all logs to console, no UI elements. Overridden by headless.",
      type: "boolean",
      default: false,
    },
    rootPath: {
      describe: "Specify the root path for the pull operation.",
      demandOption: false,
      default: "agility-files",
      type: "string",
    },
    legacyFolders: {
      describe: "Use a flat folder structure directly under the root path (or 'agility-files' if rootPath is not specified) for local files.",
      demandOption: false,
      type: "boolean",
      default: false,
    },
    dryRun: {
      describe: "Dry run the push operation if able.",
      demandOption: false,
      type: "boolean",
      default: false,
    },
    contentFolder: {
      describe: "Specify the override content folder to push. This will override the default content folder. Use content.json to specify the content to push.",
      demandOption: false,
      type: "string",
      default: "",
    },
    modelDiffs: {
      describe: "Enable detailed logging of model differences.",
      type: "boolean",
      default: false,
    }
  },
  handler: async function (argv) {
    const { headless, verbose, local } = argv;
    const useBlessed = !headless && !verbose;
    blessedUIEnabled = useBlessed;

    if (local) {
      forceLocalMode = true;
    }

    configureSSL();

    let auth = new Auth();

    const isAuthorized = await auth.checkAuthorization();
    if (!isAuthorized) {
      return;
    }

    // Get token and set up options
    const token = await auth.getToken();
    options = new mgmtApi.Options();
    options.token = token;

    let sourceGuid: string = argv.sourceGuid as string;
    const targetGuid: string = argv.targetGuid as string;
    let locale: string = argv.locale as string;
    const isPreview: boolean = argv.preview as boolean;
    const elements: string[] = (argv.elements as string).split(",");
    const rootPath: string = argv.rootPath as string;
    const legacyFolders: boolean = argv.legacyFolders as boolean;
    const dryRun: boolean = argv.dryRun as boolean;
    const contentFolder: string = argv.contentFolder as string;
    const logModelDiffs = argv.modelDiffs as boolean;
    // Check for .env file values
    const envCheck = auth.checkForEnvFile();
    if (envCheck.hasEnvFile) {
      if (!sourceGuid && envCheck.guid) {
        sourceGuid = envCheck.guid;
      }
      if (!locale && envCheck.locales) {
        locale = envCheck.locales[0];
      }
    }

    // Validate required parameters
    if (!sourceGuid) {
      console.log(
        colors.red("Please provide a sourceGuid or ensure you are in a directory with a valid .env file containing a GUID.")
      );
      return;
    }

    if (!targetGuid) {
      console.log(colors.red("Please provide a targetGuid."));
      return;
    }

    if (!locale) {
      console.log(
        colors.red("Please provide a locale or ensure AGILITY_LOCALES is in your .env file.")
      );
      return;
    }

    let multibar = createMultibar({ name: "Push" });

    try {
      const userOnSource = await auth.getUser(sourceGuid);
      const userOnTarget = await auth.getUser(targetGuid);

      if (!userOnSource) {
        console.log(colors.red(`Could not retrieve user details for source instance ${sourceGuid}. Please ensure it's a valid GUID and you have access.`));
        return;
      }
      if (!userOnTarget) {
        console.log(colors.red(`Could not retrieve user details for target instance ${targetGuid}. Please ensure it's a valid GUID and you have access.`));
        return;
      }

      const sourcePermitted = await auth.checkUserRole(sourceGuid);
      const targetPermitted = await auth.checkUserRole(targetGuid);

      if (!sourcePermitted) {
        console.log(colors.red(`You do not have the required permissions on the source instance ${sourceGuid}.`));
        return;
      }
      if (!targetPermitted) {
        console.log(colors.red(`You do not have the required permissions on the target instance ${targetGuid}.`));
        return;
      }

      console.log(colors.yellow(`
Pushing elements from ${sourceGuid} (${isPreview ? "preview" : "live"}) to ${targetGuid} for locale ${locale}...`));
      console.log(colors.cyan(`Elements to push: ${elements.join(', ')}`));

      const pusher = new push(options, multibar, sourceGuid, targetGuid, locale, isPreview, blessedUIEnabled, elements, rootPath, legacyFolders, dryRun, contentFolder, logModelDiffs);
      await pusher.pushInstance();

    } catch (error) {
      multibar.stop();
      console.error(colors.red(`An error occurred during the push operation: ${error.message}`));
      console.error(error);
      process.exit(1);
    }
  }
})


// New 2-Pass Sync Command using the enhanced dependency system
yargs.command({
  command: "sync",
  describe: "Sync your instance using the new 2-pass dependency system.",
  builder: {
    sourceGuid: {
      describe: "Provide the source guid to sync from. If not provided, will use AGILITY_GUID from .env file if available.",
      demandOption: false,
      type: "string",
    },
    targetGuid: {
      describe: "Provide the target guid to sync your instance to.",
      demandOption: true,
      type: "string",
    },
    dev: {
      describe: "Run in dev mode. This will use the dev instance for the sync operation.",
      demandOption: false,
      type: "boolean",
      default: false
    },
    locale: {
      describe: "Provide the locale to sync your instance. If not provided, will use AGILITY_LOCALES from .env file if available.",
      demandOption: false,
      type: "string",
      default: "en-us"
    },
    channel: {
      describe: "Provide the channel to sync your instance. If not provided, will use AGILITY_WEBSITE from .env file if available.",
      demandOption: false,
      type: "string",
      default: "website"
    },
    preview: {
      describe: "Whether to sync to preview or live environment data from source.",
      demandOption: false,
      type: "boolean",
      default: true,
    },
    elements: {
      describe: "Comma-separated list of elements to sync (Models,Galleries,Assets,Containers,Content,Templates,Pages)",
      demandOption: false,
      type: "string",
      default: "Models,Galleries,Assets,Containers,Content,Templates,Pages",
    },
    local: {
      describe: "Switch to local management API mode.",
      demandOption: false,
      type: "boolean",
      default: false,
    },
    headless: {
      describe: "Turn off the experimental Blessed UI for sync operations.",
      type: "boolean",
      default: false,
    },
    blessed: {
      describe: "Use the experimental Blessed UI for sync operations.",
      type: "boolean",
      default: false,
    },
    verbose: {
      describe: "Run in verbose mode: all logs to console, no UI elements. Overridden by headless.",
      type: "boolean",
      default: true,
    },
    rootPath: {
      describe: "Specify the root path for the sync operation.",
      demandOption: false,
      default: "agility-files",
      type: "string",
    },
    legacyFolders: {
      describe: "Use a flat folder structure directly under the root path for local files.",
      demandOption: false,
      type: "boolean",
      default: false,
    },
    debug: {
      describe: "Show detailed dependency analysis and exit without syncing.",
      demandOption: false,
      type: "boolean",
      default: false,
    },
    maxDepth: {
      describe: "Maximum recursion depth for dependency analysis (prevents infinite loops).",
      demandOption: false,
      type: "number",
      default: 10,
    },
    forceUpdate: {
      describe: "Force update all items regardless of existing mappings. Updates existing items instead of skipping them. When false (default), only processes unmapped items for much faster syncs.",
      demandOption: false,
      type: "boolean",
      default: false,
    }
  },
  handler: async function (argv) {
    const { headless, verbose, local, debug, maxDepth, forceUpdate, dev } = argv;
    const useBlessed = !headless && !verbose;
    blessedUIEnabled = useBlessed;

    forceLocalMode = local ? true : false;
    forceDevMode = dev ? true : false;

    configureSSL();

    let auth = new Auth();
    
    const isAuthorized = await auth.checkAuthorization();
    if (!isAuthorized) {
      return;
    }

    // Get token and set up options
    const token = await auth.getToken();
    options = new mgmtApi.Options();
    options.token = token;
   

    let sourceGuid: string = argv.sourceGuid as string;
    const targetGuid: string = argv.targetGuid as string;
    let locale: string = argv.locale as string;
    const isPreview: boolean = argv.preview as boolean;
    const elements: string[] = (argv.elements as string).split(",");
    const rootPath: string = argv.rootPath as string;
    const legacyFolders: boolean = argv.legacyFolders as boolean;

    // 🔒 SAFETY CHECK: Validate target instance (bypass in debug mode for testing)
    if (!debug) {
      const { TargetInstanceValidator } = await import('./lib/services/target-instance-validator');
      const validator = new TargetInstanceValidator();
      const validation = validator.validateTargetInstance(targetGuid);

      if (!validation.isValid) {
        console.log(colors.red(validation.message));
        console.log(colors.yellow(validator.getSuggestions(targetGuid)));
        return;
      }

      console.log(colors.green(validation.message));
    }

    // Check for .env file values
    const envCheck = auth.checkForEnvFile();
    if (envCheck.hasEnvFile) {
      if (!sourceGuid && envCheck.guid) {
        sourceGuid = envCheck.guid;
      }
      if (!locale && envCheck.locales) {
        locale = envCheck.locales[0];
      }
    }

    // Validate required parameters
    if (!sourceGuid) {
      console.log(
        colors.red("Please provide a sourceGuid or ensure you are in a directory with a valid .env file containing a GUID.")
      );
      return;
    }

    if (!targetGuid) {
      console.log(colors.red("Please provide a targetGuid."));
      return;
    }

    if (!locale) {
      console.log(
        colors.red("Please provide a locale or ensure AGILITY_LOCALES is in your .env file.")
      );
      return;
    }

    let multibar = createMultibar({ name: "Sync (2-Pass)" });

    try {
      if (!debug) {
        const userOnSource = await auth.getUser(sourceGuid);
        const userOnTarget = await auth.getUser(targetGuid);

        if (!userOnSource) {
          console.log(colors.red(`Could not retrieve user details for source instance ${sourceGuid}. Please ensure it's a valid GUID and you have access.`));
          return;
        }
        if (!userOnTarget) {
          console.log(colors.red(`Could not retrieve user details for target instance ${targetGuid}. Please ensure it's a valid GUID and you have access.`));
          return;
        }

        const sourcePermitted = await auth.checkUserRole(sourceGuid);
        const targetPermitted = await auth.checkUserRole(targetGuid);

        if (!sourcePermitted) {
          console.log(colors.red(`You do not have the required permissions on the source instance ${sourceGuid}.`));
          return;
        }
        if (!targetPermitted) {
          console.log(colors.red(`You do not have the required permissions on the target instance ${targetGuid}.`));
          return;
        }
      } else {
        console.log(colors.yellow("🔍 DEBUG MODE: Bypassing permission checks..."));
      }

      // Import and use the new 2-pass sync system
      const { TopologicalContentSync } = await import('./lib/services/topological-content-sync');

      const syncOperation = new TopologicalContentSync(options, multibar, sourceGuid, targetGuid, locale, isPreview, blessedUIEnabled, elements, rootPath, legacyFolders, false, {
        debug,
        maxDepth: maxDepth,
        forceUpdate: forceUpdate
      });

      await syncOperation.syncInstance();

      // Clean up and exit successfully
      multibar.stop();

      // Show success message for completed syncs
      if (!debug) {
        console.log(colors.green('\n✅ Sync operation completed successfully!'));
      }

    } catch (error) {
      multibar.stop();
      console.error(colors.red(`An error occurred during the sync operation: ${error.message}`));
      console.error(error);
      process.exit(1);
    }
  }
})


yargs.command({
  command: "updatecontent",
  describe: "Update a specific content ID or list of content IDs.",
  builder: {
    guid: {
      describe: "Provide the target guid to update your instance.",
      demandOption: true,
      type: "string",
    },
    locale: {
      describe: "Provide the locale to update your instance.",
      demandOption: true,
      type: "string",
    },
    rootPath: {
      describe: "Specify the root path for the pull operation.",
      demandOption: false,
      default: "agility-files",
      type: "string",
    },
    contentItems: {
      describe: "What content items to update",
      demandOption: false,
      type: "string",
      default: "all",
    },
  },
  handler: async function (argv) {
    const guid: string = argv.guid as string;
    const locale: string = argv.locale as string;
    const contentItems: string = argv.contentItems as string;
    const rootPath: string = argv.rootPath as string;

    const code = new fileOperations(rootPath, guid, locale, true);
    auth = new Auth();
    const codeFileStatus = code.codeFileExists();

    if (codeFileStatus) {
      const agilityFolder = code.cliFolderExists();
      if (agilityFolder) {
        const data = JSON.parse(code.readTempFile("code.json"));

        const multibar = createMultibar({ name: "Push" });

        const form = new FormData();
        form.append("cliCode", data.code);

        const token = await auth.cliPoll(form, guid);

        options = new mgmtApi.Options();
        options.token = token.access_token;

        const user = await auth.getUser(guid);
        if (user) {
          const permitted = await auth.checkUserRole(guid);
          if (permitted) {
            console.log("-----------------------------------------------");
            console.log(colors.yellow("Updating your content items..."));
            console.log("Content items will be in preview state and changes will need to be published.");
            console.log("-----------------------------------------------");

            const pushSync = new content(options, multibar, guid, locale);
            const action = await pushSync.updateContentItems(contentItems);
            multibar.stop();

            const total = contentItems.split(",").length;
            const successful = action.successfulItems.length;

            if (successful < total) {
              console.log(colors.yellow(`${successful} out of ${total} content items were successfully updated.`));
              if (action.notOnDestination.length > 0) {
                console.log(colors.yellow("Not found on destination instance"), action.notOnDestination);
              }

              if (action.notOnSource.length > 0) {
                console.log(colors.yellow("Not found in local files"), action.notOnSource);
              }

              if (action.modelMismatch.length > 0) {
                console.log(colors.yellow("Model mismatch on destination instance"), action.modelMismatch);
              }
            } else {
              console.log(colors.green(`${successful} out of ${total} content items were successfully updated.`));
            }
          } else {
            console.log(
              colors.red("You do not have required permissions on the instance to perform the push operation.")
            );
          }
        } else {
          console.log(colors.red("Please authenticate first to perform the push operation."));
        }
      } else {
        console.log(colors.red("Please pull an instance first to push an instance."));
      }
    } else {
      console.log(colors.red("Please authenticate first to perform the push operation."));
    }
  },
});

yargs.command({
  command: "publishcontent",
  describe: "Publish a specific content ID or list of content IDs.",
  builder: {
    guid: {
      describe: "Provide the target guid to update your instance.",
      demandOption: true,
      type: "string",
    },
    locale: {
      describe: "Provide the locale to update your instance.",
      demandOption: true,
      type: "string",
    },
    contentItems: {
      describe: "What content items to update",
      demandOption: false,
      type: "string",
      default: "",
    },
  },
  handler: async function (argv) {
    const guid: string = argv.guid as string;
    const locale: string = argv.locale as string;
    const contentItems: number[] = (argv.contentItems as string).split(",").map(Number);

    const code = new fileOperations(process.cwd(), guid, locale, true);
    auth = new Auth();
    const codeFileStatus = code.codeFileExists();

    if (codeFileStatus) {
      const agilityFolder = code.cliFolderExists();
      if (agilityFolder) {
        const data = JSON.parse(code.readTempFile("code.json"));

        const multibar = createMultibar({ name: "Publish" });
        const bar = await multibar.create(contentItems.length, 0, { name: "Publishing" });

        const form = new FormData();
        form.append("cliCode", data.code);

        const token = await auth.cliPoll(form, guid);

        options = new mgmtApi.Options();
        options.token = token.access_token;

        const user = await auth.getUser(guid);
        if (user) {
          const permitted = await auth.checkUserRole(guid);
          if (permitted) {
            console.log("-----------------------------------------------");
            console.log(colors.yellow("Publishing your content items..."));
            console.log("-----------------------------------------------");
            const apiClient = new mgmtApi.ApiClient(options);

            for (const contentItem of contentItems) {
              try {
                await apiClient.contentMethods.publishContent(contentItem, guid, locale);
                await bar.increment();
              } catch (error) {
                console.error(`Failed to publish content item ${contentItem}:`, error);
              }
            }

            await bar.update(contentItems.length, { name: "Published!" });

            await bar.stop();

            setTimeout(() => {
              console.log(colors.green("Content items have been published."));
              exit(1);
            }, 1000);
          } else {
            console.log(
              colors.red("You do not have required permissions on the instance to perform the push operation.")
            );
            exit(1);
          }
        } else {
          console.log(colors.red("Please authenticate first to perform the push operation."));
          exit(1);
        }
      } else {
        console.log(colors.red("Please pull an instance first to push an instance."));
        exit(1);
      }
    } else {
      console.log(colors.red("Please authenticate first to perform the push operation."));
      exit(1);
    }
  },
});

// yargs.command({
//   command: "clone",
//   describe: "Clone your Instance.",
//   builder: {
//     sourceGuid: {
//       describe: "Provide the source guid to clone your instance.",
//       demandOption: true,
//       type: "string",
//     },
//     targetGuid: {
//       describe: "Provide the target guid to clone your instance.",
//       demandOption: true,
//       type: "string",
//     },
//     locale: {
//       describe: "Provide the locale to clone your instance.",
//       demandOption: true,
//       type: "string",
//     },
//     channel: {
//       describe: "Provide the channel to pull your instance.",
//       demandOption: true,
//       type: "string",
//     },
//   },
//   handler: async function (argv) {
//     let sourceGuid: string = argv.sourceGuid as string;
//     let targetGuid: string = argv.targetGuid as string;
//     let locale: string = argv.locale as string;
//     let channel: string = argv.channel as string;
//     let code = new fileOperations();
//     auth = new Auth();
//     let codeFileStatus = code.codeFileExists();
//     if (codeFileStatus) {
//       code.cleanup("agility-files");
//       let data = JSON.parse(code.readTempFile("code.json"));
//       const form = new FormData();
//       form.append("cliCode", data.code);

//       let token = await auth.cliPoll(form, sourceGuid);

//       let user = await auth.getUser(sourceGuid);

//       if (user) {
//         let sourcePermitted = await auth.checkUserRole(sourceGuid);
//         let targetPermitted = await auth.checkUserRole(targetGuid);

//         if (sourcePermitted && targetPermitted) {
//           console.log(colors.yellow("Cloning your instance..."));
//           let cloneSync = new clone(sourceGuid, targetGuid, locale, channel);

//           console.log(colors.yellow("Pulling your instance..."));
//           await cloneSync.pull();

//           let agilityFolder = code.cliFolderExists();
//           if (agilityFolder) {
//             console.log(colors.yellow("Pushing your instance..."));
//             await cloneSync.push();
//           } else {
//             console.log(colors.red("Please pull an instance first to push an instance."));
//           }
//         } else {
//           console.log(colors.red("You do not have the required permissions to perform the clone operation."));
//         }
//       } else {
//         console.log(colors.red("Please authenticate first to perform the clone operation."));
//       }
//     } else {
//       console.log(colors.red("Please authenticate first to perform the clone operation."));
//     }
//   },
// });

yargs.parse();

// Note: Removed setInterval that was preventing script exit
// Individual commands should handle their own lifecycle

