import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import * as agilitySync from "@agility/content-sync";
import * as path from "path";
import * as fs from 'fs';
import { overwritePrompt } from '../prompts/overwrite-prompt'; // Import the new prompt
const storeInterfaceFileSystem = require("./store-interface-filesystem"); 
const blessed = require('blessed');
const contrib = require('blessed-contrib');
const ora = require('ora'); // Use require for ora v5
import { fileOperations } from "./fileOperations"; // Added import

// Path relative to services folder
import { downloadAllGalleries, 
    downloadAllAssets, 
    downloadAllModels, 
    downloadAllTemplates,
    downloadAllContainers
} from "../downloaders/index";
import ansiColors from "ansi-colors";

// Define a type for the progress callback
type ProgressCallbackType = (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void;

export class Pull {
  private _guid: string;
  private _apiKey: string;
  private _locale: string;
  private _channel: string;
  private _isPreview: boolean;
  private _options: mgmtApi.Options;
  private _multibar: cliProgress.MultiBar | null; // Can be null if not used
  private _elements: any;
  private _rootPath: string;
  private _legacyFolders: boolean;
  private _useBlessedUI: boolean; // This will be determined by the new flags
  private isHeadless: boolean;
  private isVerbose: boolean;
  private fileOps: fileOperations; // For logging to file in headless mode
  private _forceOverwrite: boolean; // Renamed and will be used globally

  constructor(
    guid: string,
    apiKey: string,
    locale: string,
    channel: string,
    isPreview: boolean,
    options: mgmtApi.Options,
    multibar: cliProgress.MultiBar | null, // Updated to allow null
    elements: any,
    rootPath: string = "agility-files",
    legacyFolders: boolean = false,
    // New flags controlling UI and output behavior
    useBlessedArgument: boolean = true, // Default to true if not specified, aligns with old blessed flag
    isHeadlessMode: boolean = false,
    isVerboseMode: boolean = false,
    forceOverwrite: boolean = false // Updated parameter name
  ) {
    this._guid = guid;
    this._apiKey = apiKey;
    this._locale = locale;
    this._channel = channel;
    this._isPreview = isPreview;
    this._options = options;
    this._multibar = multibar; // Store it, might be null
    this._elements = elements;
    this._rootPath = rootPath;
    this._legacyFolders = legacyFolders;
    this._forceOverwrite = forceOverwrite; // Store the global overwrite flag

    this.isHeadless = isHeadlessMode;
    this.isVerbose = !this.isHeadless && isVerboseMode; // verbose is overridden by headless
    // _useBlessedUI is true if the blessed argument is true, AND we are not in headless or verbose mode.
    this._useBlessedUI = useBlessedArgument && !this.isHeadless && !this.isVerbose;
    this.fileOps = new fileOperations(rootPath, guid, locale, isPreview); // Initialize for potential file logging
  }

  // Add a helper for logging to file in headless mode
  private _logToFile(message: string, isError: boolean = false): void {
    const timestamp = new Date().toISOString();
    const level = isError ? 'ERROR' : 'INFO';
    // Ensure fileOperations.appendLogFile handles newline if needed or add it here.
    // Assuming appendLogFile needs the full string including newline.
    this.fileOps.appendLogFile(`${timestamp} [${level}] ${message}\n`);
  }

  async pullInstance(): Promise<void> {
    let screen: any | null = null;
    let logContainer: any | null = null;
    let progressContainerBox: any | null = null;
    let stepProgressBars: any[] = [];

    // Store original console methods AT THE START
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    // Function to restore console, now defined early and used carefully
    const restoreConsole = () => {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
    };

    // Setup based on mode
    if (this.isHeadless) {
        console.log = (...args: any[]) => this._logToFile(args.map(arg => String(arg)).join(' '));
        console.error = (...args: any[]) => this._logToFile(args.map(arg => String(arg)).join(' '), true);
        // For headless, no spinners or Blessed UI setup is needed.
        // Initial messages will go to the log file.
        console.log("Pull operation started in headless mode.");
    } else if (this.isVerbose) {
        // In verbose mode, log to original console AND to file.
        console.log = (...args: any[]) => {
            originalConsoleLog(...args);
            this._logToFile(args.map(arg => String(arg)).join(' '));
        };
        console.error = (...args: any[]) => {
            originalConsoleError(...args);
            this._logToFile(args.map(arg => String(arg)).join(' '), true);
        };
        console.log("Pull operation started in verbose mode."); // This now uses the override
    } else if (this._useBlessedUI) {
        // Blessed UI Mode setup
        screen = blessed.screen({
            smartCSR: true,
            title: 'Agility CLI - Pull Operation'
        });

        const grid = new contrib.grid({
            rows: 12,
            cols: 12,
            screen: screen
        });
        
        progressContainerBox = grid.set(0, 0, 11, 4, blessed.box, {
            label: ' Progress ',
            border: { type: 'line' },
            style: { border: { fg: 'cyan' } }
        });

        // pullSteps needs to be defined before creating progress bars for them
        // This part of UI setup must come after pullSteps is defined

        logContainer = grid.set(0, 4, 11, 8, blessed.log, {
            label: ' Logs ',
            border: { type: 'line' },
            style: { border: { fg: 'green' } },
            padding: { left: 1, right: 1, top: 1, bottom: 1 },
            scrollable: true,
            alwaysScroll: true,
            scrollbar: { ch: ' ', inverse: true },
            keys: true,
            vi: true
        });

        console.log = (...args: any[]) => {
            const message = args.map(arg => String(arg)).join(' ');
            if (logContainer) logContainer.log(message);
            this._logToFile(message);
        };
        console.error = (...args: any[]) => {
            const rawMessage = args.map(arg => String(arg)).join(' ');
            if (logContainer) logContainer.log(`ERROR: ${rawMessage}`);
            this._logToFile(rawMessage, true);
        };
        
        console.log("Pull operation started with Blessed UI."); // Log this initial message to the Blessed log & file
        // Screen render and focus will happen after progress bars are added

        screen.key(['C-c'], (ch: any, key: any) => {
            if (screen && !screen.destroyed) screen.destroy();
            restoreConsole();
            process.stdout.write('\nPull operation exited via Ctrl+C.\n');
            process.exit(0);
        });
    } else {
        // Fallback: Plain console. Log to original console AND to file.
        console.log = (...args: any[]) => {
            originalConsoleLog(...args);
            this._logToFile(args.map(arg => String(arg)).join(' '));
        };
        console.error = (...args: any[]) => {
            originalConsoleError(...args);
            this._logToFile(args.map(arg => String(arg)).join(' '), true);
        };
        console.log("Pull operation started (basic console output)."); // This now uses the override
    }

    // basePath calculation (moved slightly down, after initial console setup)
    let resolvedRootPathForInstances: string;
    const currentWorkingDir = process.cwd();
    // this._rootPath is from constructor (e.g. "agility-files" or user-provided --rootPath)
    const rootPathName = this._legacyFolders ? this._rootPath : path.basename(this._rootPath);


    if (!this._legacyFolders && path.basename(currentWorkingDir) === rootPathName && this._rootPath === rootPathName) {
        // We are in a directory that has the same name as the intended root directory (e.g. cwd is /some/path/agility-files and rootPathName is "agility-files")
        // And we are not using legacy folders, and the _rootPath was just a name (not a path like ../agility-files)
        resolvedRootPathForInstances = currentWorkingDir;
        console.log(`Operating within current directory as root for Agility instances: ${resolvedRootPathForInstances}`);
    } else {
        // Default behavior: use or create a directory named rootPathName in the current working directory,
        // or use this._rootPath if it's a more complex path or for legacy mode.
        const baseForRootPath = this._legacyFolders ? "" : currentWorkingDir; // For legacy, _rootPath might be absolute or already structured
        resolvedRootPathForInstances = path.resolve(baseForRootPath, this._rootPath);
        console.log(`Using directory as root for Agility instances: ${resolvedRootPathForInstances}`);
    }
    
    // Ensure the resolvedRootPathForInstances itself exists (e.g. ./agility-files or ./custom-root)
    // This is the folder that will contain the GUID folders.
    if (!fs.existsSync(resolvedRootPathForInstances)) {
        fs.mkdirSync(resolvedRootPathForInstances, { recursive: true });
        // console.log(`Created base instance directory: ${resolvedRootPathForInstances}`);
    }
    
    // This is the path like /path/to/cwd/agility-files/guid/locale/mode
    // OR /path/to/cwd (if cwd is agility-files)/guid/locale/mode
    // For legacy mode, if _rootPath was just 'agility-files', instanceSpecificPath becomes 'agility-files'
    // and guid/locale/mode will be appended by downstream services or sync SDK.
    // If not legacy, it's resolvedRootPathForInstances/guid/locale/mode
    let instanceSpecificPath: string;
    if (this._legacyFolders) {
        instanceSpecificPath = resolvedRootPathForInstances; // In legacy, this is likely just 'agility-files', subdirs handled later.
    } else {
        instanceSpecificPath = path.join(resolvedRootPathForInstances, this._guid, this._locale, this._isPreview ? "preview" : "live");
    }
    
    console.log(`Effective path for instance files: ${instanceSpecificPath}\n`);
 
    try {
        // For non-legacy, this creates the guid/locale/mode folder.
        // For legacy, if instanceSpecificPath is just "agility-files", this ensures "agility-files" exists.
        if (!fs.existsSync(instanceSpecificPath)) {
            fs.mkdirSync(instanceSpecificPath, { recursive: true });
            // console.log(`Created instance-specific directory: ${instanceSpecificPath}`);
        }
    } catch (dirError: any) {
        console.error(`Error creating base directory ${instanceSpecificPath}: ${dirError.message}`);
        if (this.isHeadless || this.isVerbose || !this._useBlessedUI) restoreConsole(); // Restore if not using Blessed managed exit
        // No screen to destroy here if it failed this early.
        return; // Exit if base directory can't be created
    }

    // Define pullSteps and updateProgress function (essential for all modes for status tracking)
    const availableSteps = [ 'Galleries', 'Assets','Models','Containers', 'Content', 'Templates', 'Sitemaps', 'Redirections', 'Pages'];
    const pullSteps = availableSteps.filter(step => this._elements.includes(step));
    const totalSteps = pullSteps.length;
    let stepStatuses = new Array(totalSteps).fill(0); // 0: pending, 1: success, 2: error

    // updateProgress function needs to be robust for different modes
    const updateProgress = (currentStepIndex: number, status: 'success' | 'error' | 'progress', percentage?: number) => {
        if (this._useBlessedUI && screen && currentStepIndex >= 0 && currentStepIndex < totalSteps) {
            const targetBar = stepProgressBars[currentStepIndex];
            if (targetBar) {
                const fillPercentage = percentage !== undefined ? percentage : (status === 'success' || status === 'error' ? 100 : targetBar.filled);
                targetBar.setProgress(fillPercentage);
                let barColor = 'blue';
                if (status === 'error') stepStatuses[currentStepIndex] = 2;
                else if (status === 'success' && fillPercentage === 100) stepStatuses[currentStepIndex] = 1;
                
                if (stepStatuses[currentStepIndex] === 2) barColor = 'red';
                else if (stepStatuses[currentStepIndex] === 1) barColor = 'green';
                
                targetBar.style.bar.bg = barColor;
                const labelStatus = status === 'progress' ? (stepStatuses[currentStepIndex] === 1 ? 'success' : (stepStatuses[currentStepIndex] === 2 ? 'error' : 'done')) : status;
                targetBar.setLabel(` ${pullSteps[currentStepIndex]} (${fillPercentage === 100 ? labelStatus : `${fillPercentage}%`}) `);
            }
            screen.render(); 
        } else {
            // For non-Blessed UI (headless, verbose, or plain), still update internal status for final summary
            if (currentStepIndex >= 0 && currentStepIndex < totalSteps) {
                if (status === 'error') stepStatuses[currentStepIndex] = 2;
                else if (status === 'success') stepStatuses[currentStepIndex] = 1;
            }
        }
    };

    // Now, if using Blessed UI, create the progress bars (needs pullSteps and progressContainerBox)
    if (this._useBlessedUI && progressContainerBox) {
        pullSteps.forEach((stepName, index) => {
            const bar = blessed.progressbar({
               parent: progressContainerBox,
               border: 'line',
               pch: ' ', 
               style: { fg: 'white', bg: 'black', bar: { bg: 'blue', fg: 'white' }, border: { fg: '#f0f0f0' } },
               width: '90%', height: 3, top: 1 + (index * 3), left: 'center', filled: 0,
               label: ` ${stepName} (0%) `
            });
            stepProgressBars.push(bar);
        });
        // Initial render of screen with bars and focus log container
        screen.render();
        if (logContainer) logContainer.focus();
    }

   const syncClient = agilitySync.getSyncClient({
      guid: this._guid,
      apiKey: this._apiKey,
      languages: [`${this._locale}`],
      channels: [`${this._channel}`],
      isPreview: this._isPreview,
      store: {
        interface: storeInterfaceFileSystem,
        options: {
          rootPath: instanceSpecificPath,
          forceOverwrite: this._forceOverwrite
        },
      }
    });

    // console.log(ansiColors.green("Syncing content..."));
    // Main loop for processing steps
    for (let i = 0; i < pullSteps.length; i++) {
        const stepName = pullSteps[i];
        const currentStepIndex = i;

        // Simplified start of step logging
        if (this.isVerbose) {
            originalConsoleLog(`Starting ${stepName}...`);
        } else if (this._useBlessedUI) {
            console.log(`Starting ${stepName}...`); // Goes to Blessed log
        } // Headless logs its own start via its console.log override if services log at start
          // Plain console (neither verbose, blessed, nor headless) will not log step starts here explicitly.

        if(this._useBlessedUI) updateProgress(currentStepIndex, 'progress', 0);

        try {
            let stepProgressCallback: ProgressCallbackType | undefined = undefined;
            if (this._useBlessedUI) {
                stepProgressCallback = (processed, total, status = 'progress') => {
                    const percentage = total > 0 ? Math.floor((processed / total) * 100) : (status === 'success' || status === 'error' ? 100 : 0);
                    updateProgress(currentStepIndex, status, percentage);
                };
            } else if (this.isVerbose) { // Only verbose needs the minimal callback now
                stepProgressCallback = (processed, total, status = 'progress') => {
                    if (status === 'error') stepStatuses[currentStepIndex] = 2;
                    else if (status === 'success') stepStatuses[currentStepIndex] = 1;
                };
            }
            // In headless mode, or plain console (no verbose, no blessed), stepProgressCallback remains undefined.

            if (stepName === 'Content') {
                
                const syncTokenPath = path.join(instanceSpecificPath, "state", "sync.json");
                const contentItemsPath = path.join(instanceSpecificPath, "item");
                const contentListsPath = path.join(instanceSpecificPath, "list");

                if (this._forceOverwrite) { 
                    const refreshMessage = "Overwrite selected: Local content files will be refreshed by the sync process.";
                    // if (this.isVerbose) originalConsoleLog(refreshMessage);
                    // else if (this._useBlessedUI || this.isHeadless) console.log(refreshMessage);

                    // REMOVE: Deletion of sync token, items, and lists
                    if (fs.existsSync(syncTokenPath)) {
                        fs.rmSync(syncTokenPath);
                        const deletedTokenMsg = `  Deleted sync token: ${syncTokenPath}`;
                        if (this.isVerbose) originalConsoleLog(deletedTokenMsg);
                        else if (this._useBlessedUI || this.isHeadless) console.log(deletedTokenMsg);
                    }
                    if (fs.existsSync(contentItemsPath)) {
                        fs.rmSync(contentItemsPath, { recursive: true, force: true });
                        const deletedItemsMsg = `  Deleted content items folder: ${contentItemsPath}`;
                        if (this.isVerbose) originalConsoleLog(deletedItemsMsg);
                        else if (this._useBlessedUI || this.isHeadless) console.log(deletedItemsMsg);
                    }
                    if (fs.existsSync(contentListsPath)) {
                        fs.rmSync(contentListsPath, { recursive: true, force: true });
                        const deletedListsMsg = `  Deleted content lists folder: ${contentListsPath}`;
                        if (this.isVerbose) originalConsoleLog(deletedListsMsg);
                        else if (this._useBlessedUI || this.isHeadless) console.log(deletedListsMsg);
                    }
                } else {
                    // Logic for non-overwrite: if sync token exists, it implies incremental. If not, it's a full sync naturally.
                    if (fs.existsSync(syncTokenPath)) {
                        if (this.isVerbose) originalConsoleLog("Overwrite not selected. Existing content sync token found. Performing incremental content sync.");
                        else if (this.isHeadless) console.log("Overwrite not selected. Existing content sync token found. Performing incremental content sync.");
                    } else {
                        if (this.isVerbose) originalConsoleLog("Overwrite not selected. No existing content sync token. Performing full content sync by default.");
                        else if (this.isHeadless) console.log("Overwrite not selected. No existing content sync token. Performing full content sync by default.");
                    }
                }
                
                if(this._useBlessedUI) updateProgress(currentStepIndex, 'progress', 0); // Initial progress for Content
                else if (!this.isHeadless && !this.isVerbose) updateProgress(currentStepIndex, 'progress', 0);


                try {
                    // Content Sync SDK handles pages, containers, content, sitemaps, redirections
                    await syncClient.runSync();
                    
                    // MODIFICATION: Group stats by itemType before logging individually
                    if (storeInterfaceFileSystem.getAndClearSavedItemStats && typeof storeInterfaceFileSystem.getAndClearSavedItemStats === 'function') {
                        const savedItemsStats = storeInterfaceFileSystem.getAndClearSavedItemStats();
                        if (savedItemsStats.length > 0) {
                            // console.log("--- Items processed by Content Sync ---");

                            // Group stats by itemType
                            const groupedByType: { [key: string]: Array<{ itemType: string, itemID: string | number, languageCode: string }> } = {};
                            savedItemsStats.forEach(stat => {
                                if (!groupedByType[stat.itemType]) {
                                    groupedByType[stat.itemType] = [];
                                }
                                groupedByType[stat.itemType].push(stat);
                            });

                            // Log items, grouped by type
                            // You might want to define a specific order for itemTypes if needed, e.g., ['item', 'list', 'page', ...]
                            // For now, it will log based on the order types were encountered or Object.keys order.
                            for (const itemType in groupedByType) {
                                groupedByType[itemType].forEach(stat => {
                                    console.log(`✓ Downloaded ${ansiColors.cyan(stat.itemType)} (ID: ${stat.itemID})`);
                                });
                            }
                            // console.log("-------------------------------------");
                        }
                    }
                    // END MODIFICATION

                    // After sync, count the items in the 'item' folder
                    const itemsPath = path.join(instanceSpecificPath, "item");
                    let itemCount = 0;
                    let itemsFoundMessage = "Content items sync attempted.";
                    try {
                        if (fs.existsSync(itemsPath)) {
                            const files = fs.readdirSync(itemsPath);
                            itemCount = files.filter(file => path.extname(file).toLowerCase() === '.json').length;
                            itemsFoundMessage = `Found ${itemCount} content item(s).`;
                        }
                    } catch (countError: any) { itemsFoundMessage = `Error counting items: ${countError.message}`; }

                    
                    const contentSyncMessage = `${stepName} synchronized. ${itemsFoundMessage}`;
                    // this._forceOverwrite ? console.log(`✓ ${contentSyncMessage}`) : ''; 
                    updateProgress(currentStepIndex, 'success', 100);

                } catch (syncError: any) {
                    // console.error(`!!!!!! SYNC CLIENT ERROR in pull.ts for Content step !!!!!!`);
                    // console.error(`Error Name: ${syncError.name}`);
                    // console.error(`Error Message: ${syncError.message}`);
                    if (syncError.stack) {
                        console.error(`Error Stack: ${syncError.stack}`);
                    }
                    // Check for Agility SDK specific error properties if known, or generic ones
                    if (syncError.response && syncError.response.data) { 
                        console.error(`Response Data: ${JSON.stringify(syncError.response.data)}`);
                    }
                    if (syncError.details) { // Example for a hypothetical details property
                        console.error(`Error Details: ${JSON.stringify(syncError.details)}`);
                    }
                    updateProgress(currentStepIndex, 'error', this._useBlessedUI ? (stepProgressBars[currentStepIndex]?.filled || 0) : 0);
                    // Continue to the next step, error is logged and progress bar updated.
                }
                continue; 
            }

            // Call the appropriate downloader with the mode-specific stepProgressCallback
            switch (stepName) {
                case 'Galleries': await downloadAllGalleries(this._guid, this._locale, this._isPreview, this._options, this._multibar!, instanceSpecificPath, this._forceOverwrite, stepProgressCallback); break;
                case 'Assets': await downloadAllAssets(this._guid, this._locale, this._isPreview, this._options, this._multibar!, instanceSpecificPath, this._forceOverwrite, stepProgressCallback); break;
                case 'Models': await downloadAllModels(this._guid, this._locale, this._isPreview, this._options, this._multibar!, instanceSpecificPath, this._forceOverwrite, stepProgressCallback); break;
                case 'Templates': await downloadAllTemplates(this._guid, this._locale, this._isPreview, this._options, this._multibar!, instanceSpecificPath, this._forceOverwrite, stepProgressCallback); break;
                // Note: Containers, Sitemaps, Redirections, and Pages are now handled by Content Sync SDK in the 'Content' step
                case 'Containers':
                    await downloadAllContainers(this._guid, this._locale, this._isPreview, this._options, this._multibar!, instanceSpecificPath, this._forceOverwrite, stepProgressCallback);
                    break;
                case 'Sitemaps': 
                    console.log(`${stepName} are now handled by Content Sync SDK in the 'Content' step`);
                    updateProgress(currentStepIndex, 'success', 100);
                    break;
                case 'Redirections': 
                    console.log(`${stepName} are now handled by Content Sync SDK in the 'Content' step`);
                    updateProgress(currentStepIndex, 'success', 100);
                    break;
                case 'Pages': 
                    console.log(`${stepName} are now handled by Content Sync SDK in the 'Content' step`);
                    updateProgress(currentStepIndex, 'success', 100);
                    break;
            }
            
            if (stepStatuses[currentStepIndex] === 0) { 
                updateProgress(currentStepIndex, 'success', 100);
            }

            // For Verbose, services log their own summaries. Blessed UI also.

        } catch (error: any) {
            console.error(`✗ ${stepName} failed: ${error.message}`); 
            updateProgress(currentStepIndex, 'error', this._useBlessedUI ? (stepProgressBars[currentStepIndex]?.filled || 0) : 0); 
        }
    }

    // After all steps, check statuses for overall completion message
    const overallSuccess = stepStatuses.every(s => s === 1);

    if (this._useBlessedUI) {
        if (logContainer) {
            logContainer.log("----------------------------------------------------------------------");
            if (overallSuccess) {
                logContainer.log("All selected pull operations completed successfully.");
            } else {
                logContainer.log("One or more pull operations encountered errors. Please check logs.");
            }
            logContainer.log("Press Ctrl+C to exit.");
        }
        screen?.render(); // Final render for Blessed UI
        // Don't restore console here, Ctrl+C handler does it.
    } else if (this.isVerbose) {
        if (overallSuccess) {
            originalConsoleLog("\nAll selected pull operations completed successfully.");
        } else {
            originalConsoleError("\nOne or more pull operations encountered errors. Please check logs.");
        }
        // No console restore needed as we used original console directly.
    } else if (this.isHeadless) {
        // Headless mode gets its final summary message via the handler in index.ts
        // This logs a final status *into the log file itself*.
        const finalLogMessage = overallSuccess 
            ? "All selected pull operations completed successfully (headless mode)."
            : "One or more pull operations encountered errors (headless mode). Please check log.";
        console.log(finalLogMessage); // This will use _logToFile due to override
    } else {
        // Plain console mode (useOraSpinners was true, or fallback)
        if (overallSuccess) {
            originalConsoleLog("\nAll selected pull operations completed successfully.");
        } else {
            originalConsoleError("\nOne or more pull operations encountered errors. Please check logs.");
        }
        // No console restore needed as we used original console directly.
    }

    // restoreConsole(); // Generally handled by Ctrl+C for Blessed, or not needed for others unless errors occurred early.
    const finalizedLogPath = this.fileOps.finalizeLogFile('pull');
    originalConsoleLog(`
Log file written to: ${finalizedLogPath}`);
  }
}
