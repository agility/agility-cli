import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import * as agilitySync from "@agility/content-sync";
import * as path from "path";
import * as fs from 'fs';
import { overwritePrompt } from '../prompts'; // Import the new prompt
import { getState } from './state';
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
import { generateLogHeader } from '../utilities';
import ansiColors from "ansi-colors";
import {
  markPullStart,
  clearTimestamps,
  updateEntityTypeTimestamp,
  getIncrementalPullDecision,
  INCREMENTAL_SUPPORTED_TYPES,
  FULL_REFRESH_REQUIRED_TYPES
} from '../utilities/incremental';

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
      private _forceUpdate: boolean; // Controls whether to update existing local files (controlled by --update flag)
  private _reset: boolean; // Controls whether to completely delete GUID folder and start fresh

  constructor() {
    const state = getState();
    
    this._guid = state.sourceGuid;
    this._apiKey = state.apiKeyForPull;
    this._locale = state.locale;
    this._channel = state.channel;
    this._isPreview = state.preview;
    this._options = state.mgmtApiOptions;
    this._multibar = null; // We'll create our own if needed
    this._elements = state.elements.split(",");
    this._rootPath = state.rootPath;
    this._legacyFolders = state.legacyFolders;
            this._forceUpdate = state.update;
    this._reset = state.reset;

    this.isHeadless = state.useHeadless;
    this.isVerbose = state.useVerbose;
            this._useBlessedUI = state.useBlessed;
    this.fileOps = new fileOperations(this._rootPath, this._guid, this._locale, this._isPreview);
  }

  /**
   * Log pull operation header with version info
   */
  private logPullHeader(): void {
    const headerInfo = generateLogHeader('Pull', {
      'Source GUID': this._guid,
      'Elements': this._elements.join(', '),
      'Locale': this._locale,
      'Channel': this._channel,
      'Preview Mode': this._isPreview,
      'Force Update': this._forceUpdate,
      'Reset Mode': this._reset,
      'Mode': this.isHeadless ? 'Headless' : this.isVerbose ? 'Verbose' : this._useBlessedUI ? 'Blessed UI' : 'Standard'
    });

    this._logToFile(headerInfo);
  }

  // Add a helper for logging to file in headless mode
  private _logToFile(message: string, isError: boolean = false): void {
    const timestamp = new Date().toISOString();
    const level = isError ? 'ERROR' : 'INFO';
    // fileOperations.appendLogFile will handle ANSI stripping automatically
    this.fileOps.appendLogFile(`[${timestamp}] [${level}] ${message}\n`);
  }

  async pullInstance(): Promise<void> {
    const colors = require("ansi-colors");
    
    console.log(
      colors.yellow(
        `\nPulling instance ${this._guid} (${this._locale}) [${this._channel}] ${this._isPreview ? 'Preview' : 'Live'} into ./agility-files`
      )
    );

    // Handle --reset flag: completely delete GUID folder and start fresh
    if (this._reset) {
      const guidFolderPath = path.join(process.cwd(), this._rootPath, this._guid);
      
      if (fs.existsSync(guidFolderPath)) {
        console.log(colors.red(`🔄 --reset flag detected: Deleting entire instance folder ${guidFolderPath}`));
        
        try {
          fs.rmSync(guidFolderPath, { recursive: true, force: true });
          console.log(colors.green(`✓ Successfully deleted instance folder: ${guidFolderPath}`));
        } catch (resetError: any) {
          console.error(colors.red(`✗ Error deleting instance folder: ${resetError.message}`));
          throw resetError;
        }
      } else {
        console.log(colors.yellow(`⚠️ Instance folder ${guidFolderPath} does not exist (already clean)`));
      }
      
      // Clear timestamp tracking for this instance
      clearTimestamps(this._guid, this._rootPath);
    }

    // Mark the start of this pull operation for incremental tracking
    const pullStartTime = markPullStart();

    try {

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
            title: 'Agility CLI - Pull Progress',
            dockBorders: true,
            fullUnicode: true,
            autoPadding: true
        });

        const grid = new contrib.grid({
            rows: 12,
            cols: 12,
            screen: screen
        });

        progressContainerBox = grid.set(0, 0, 12, 4, blessed.box, {
            label: ' Progress ',
            border: { type: 'line' },
            style: { border: { fg: 'blue' } },
            padding: { left: 1, right: 1, top: 0, bottom: 0 } // Remove top/bottom padding
        });
        // pullSteps needs to be defined before creating progress bars for them
        // This part of UI setup must come after pullSteps is defined

        // Create log container with memory-efficient settings  
        logContainer = grid.set(0, 4, 12, 8, blessed.log, {
            label: ' Logs ',
            border: { type: 'line' },
            style: { border: { fg: 'green' } },
            padding: { left: 1, right: 1, top: 0, bottom: 0 }, // Remove top/bottom padding
            // MEMORY OPTIMIZATION: Enable scrolling but limit buffer
            scrollable: true,
            alwaysScroll: true, // This should keep the view pinned to the bottom
            mouse: false, // Disable mouse to reduce overhead
            keys: false, // Disable keys to reduce overhead
            vi: false,
            // MEMORY FIX: Limit buffer to 200 lines to prevent memory bloat
            bufferLength: 200  // Keep only last 200 log entries
        });

        // Memory-efficient console override with small circular buffer
        let logBuffer: string[] = [];
        const MAX_LOG_BUFFER = 200; // Reduced from 1000 to 200
        
        console.log = (...args: any[]) => {
            const message = args.map(arg => String(arg)).join(' ');
            
            // Add to circular buffer (remove oldest if over limit)
            if (logBuffer.length >= MAX_LOG_BUFFER) {
                logBuffer.shift(); // Remove oldest entry
            }
            logBuffer.push(message);
            
            // Only show in blessed UI with explicit scroll to bottom
            if (logContainer) {
                logContainer.log(message);
                // Force scroll to bottom after each log entry
                logContainer.setScrollPerc(100);
                screen.render();
            }
            
            // Always log to file
            this._logToFile(message);
        };
        
        console.error = (...args: any[]) => {
            const rawMessage = args.map(arg => String(arg)).join(' ');
            const errorMessage = `ERROR: ${rawMessage}`;
            
            // Add to circular buffer (remove oldest if over limit)
            if (logBuffer.length >= MAX_LOG_BUFFER) {
                logBuffer.shift(); // Remove oldest entry
            }
            logBuffer.push(errorMessage);
            
            if (logContainer) {
                logContainer.log(errorMessage);
                // Force scroll to bottom after each log entry
                logContainer.setScrollPerc(100);
                screen.render();
            }
            this._logToFile(rawMessage, true);
        };
        
        console.log("Pull operation started with Blessed UI."); // Log this initial message to the Blessed log & file
        // Screen render and focus will happen after progress bars are added

        screen.key(['C-c'], (ch: any, key: any) => {
            if (screen && !screen.destroyed) screen.destroy();
            restoreConsole();
            
            // Finalize and print log file path before exiting
            const finalizedLogPath = this.fileOps.finalizeLogFile('pull');
            process.stdout.write('\nPull operation exited via Ctrl+C.\n');
            process.stdout.write(`Log file written to: ${finalizedLogPath}\n`);
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

    // Log pull header with version info after console logging setup is complete
    this.logPullHeader();

    // basePath calculation (moved slightly down, after initial console setup)
    let resolvedRootPathForInstances: string;
    const currentWorkingDir = process.cwd();
    // this._rootPath is from constructor (e.g. "agility-files" or user-provided --rootPath)
    
    // SIMPLIFIED PATH RESOLUTION: Always use relative paths
    // No more complex conditional logic that creates absolute paths
    resolvedRootPathForInstances = this._rootPath; // Keep it relative (e.g., "agility-files")
    console.log(`Using relative directory as root for Agility instances: ${resolvedRootPathForInstances}`);


    
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
               width: '95%', height: 3, top: 1 + (index * 3), left: 'center', filled: 0,
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
                          forceUpdate: this._forceUpdate
        },
      }
    });

    // Enhanced progress tracking setup
    if (this._useBlessedUI) {
        // Initialize progress tracking
        storeInterfaceFileSystem.initializeProgress();
        
        // Set up throttled progress callback for BlessedUI to prevent memory issues
        let lastProgressUpdate = 0;
        let lastLogUpdate = 0;
        let lastCleanup = 0;
        const PROGRESS_UPDATE_INTERVAL = 500; // Update progress every 500ms (was 100ms)
        const LOG_UPDATE_INTERVAL = 5000; // Log every 5 seconds (was 2 seconds)
        const CLEANUP_INTERVAL = 15000; // Cleanup every 15 seconds (was 30 seconds)
        
        storeInterfaceFileSystem.setProgressCallback((stats: any) => {
            const now = Date.now();
            const contentStepIndex = pullSteps.indexOf('Content');
            
            if (contentStepIndex >= 0) {
                // Throttle progress bar updates to prevent UI lag
                if (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL) {
                    const totalProgress = Math.min(95, Math.floor(stats.totalItems / 20)); // More conservative progress calculation (was /10)
                    updateProgress(contentStepIndex, 'progress', totalProgress);
                    lastProgressUpdate = now;
                }
                
                // Throttle log updates to reduce memory pressure
                if (now - lastLogUpdate > LOG_UPDATE_INTERVAL) {
                    // Simplified type breakdown to reduce string operations
                    const totalItems = stats.totalItems || 0;
                    const itemsPerSec = stats.itemsPerSecond || 0;
                    
                    console.log(`Progress: ${totalItems} items - ${itemsPerSec.toFixed(1)}/sec`);
                    lastLogUpdate = now;
                }
                
                // More frequent memory cleanup for long-running operations
                if (now - lastCleanup > CLEANUP_INTERVAL) {
                    if (storeInterfaceFileSystem.cleanupProgressData) {
                        storeInterfaceFileSystem.cleanupProgressData();
                    }
                    lastCleanup = now;
                }
            }
        });
    }

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

                if (this._forceUpdate) { 
                    const updateMessage = "Update selected: Local content files will be updated with fresh data from source instance.";
                                      // if (this.isVerbose) originalConsoleLog(updateMessage);
                  // else if (this._useBlessedUI || this.isHeadless) console.log(updateMessage);


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
                    // Logic for non-update: if sync token exists, it implies incremental. If not, it's a full sync naturally.
                    if (fs.existsSync(syncTokenPath)) {
                        if (this.isVerbose) originalConsoleLog("Update not selected. Existing content sync token found. Performing incremental content sync.");
                        else if (this.isHeadless) console.log("Update not selected. Existing content sync token found. Performing incremental content sync.");
                    } else {
                        if (this.isVerbose) originalConsoleLog("Update not selected. No existing content sync token. Performing full content sync by default.");
                        else if (this.isHeadless) console.log("Update not selected. No existing content sync token. Performing full content sync by default.");
                    }
                }
                
                if(this._useBlessedUI) updateProgress(currentStepIndex, 'progress', 0); // Initial progress for Content
                else if (!this.isHeadless && !this.isVerbose) updateProgress(currentStepIndex, 'progress', 0);


                try {
                    // Content Sync SDK handles pages, containers, content, sitemaps, redirections
                    await syncClient.runSync();
                    
                    // Get enhanced sync stats
                    if (storeInterfaceFileSystem.getAndClearSavedItemStats && typeof storeInterfaceFileSystem.getAndClearSavedItemStats === 'function') {
                        const syncResults = storeInterfaceFileSystem.getAndClearSavedItemStats();
                        
                        // Log summary by item type
                        const typeBreakdown = Object.entries(syncResults.itemsByType)
                            .map(([type, count]) => `${type}: ${count}`)
                            .join(', ');
                        
                        const summary = syncResults.summary;
                        console.log(`✓ Content Sync completed: ${summary.totalItems} items in ${(summary.elapsedTime / 1000).toFixed(1)}s`);
                        console.log(`  Breakdown: ${typeBreakdown}`);
                        console.log(`  Performance: ${summary.itemsPerSecond.toFixed(1)} items/sec`);
                        
                        // Detailed logging for verbose mode
                        if (this.isVerbose) {
                            console.log("--- Detailed Sync Results ---");
                            Object.entries(syncResults.itemsByType).forEach(([itemType, count]) => {
                                console.log(`  ${ansiColors.cyan(itemType)}: ${count} items`);
                            });
                        }
                    }

                    // After sync, count the items in the 'item' folder for verification
                    const itemsPath = path.join(instanceSpecificPath, "item");
                    let itemCount = 0;
                    let itemsFoundMessage = "Content items sync attempted.";
                    try {
                        if (fs.existsSync(itemsPath)) {
                            const files = fs.readdirSync(itemsPath);
                            itemCount = files.filter(file => path.extname(file).toLowerCase() === '.json').length;
                            itemsFoundMessage = `Verified ${itemCount} content item(s) on disk.`;
                        }
                    } catch (countError: any) { itemsFoundMessage = `Error counting items: ${countError.message}`; }

                    console.log(itemsFoundMessage);
                    updateProgress(currentStepIndex, 'success', 100);

                } catch (syncError: any) {
                    
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

            // Call the appropriate downloader with fileOperations instance instead of instanceSpecificPath
            switch (stepName) {
                case 'Galleries': await downloadAllGalleries(this._guid, this._locale, this._isPreview, this._options, this._multibar!, this.fileOps, this._forceUpdate, stepProgressCallback); break;
                case 'Assets': await downloadAllAssets(this._guid, this._locale, this._isPreview, this._options, this._multibar!, this.fileOps, this._forceUpdate, stepProgressCallback); break;
                case 'Models': await downloadAllModels(this._guid, this._locale, this._isPreview, this._options, this._multibar!, this.fileOps, this._forceUpdate, stepProgressCallback); break;
                case 'Templates': await downloadAllTemplates(this._guid, this._locale, this._isPreview, this._options, this._multibar!, this.fileOps, this._forceUpdate, stepProgressCallback); break;
                // Note: Containers, Sitemaps, Redirections, and Pages are now handled by Content Sync SDK in the 'Content' step
                case 'Containers':
                    await downloadAllContainers(this._guid, this._locale, this._isPreview, this._options, this._multibar!, this.fileOps, this._forceUpdate, stepProgressCallback);
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

    // Update timestamps for successful entity types (incremental pull tracking)
    if (overallSuccess) {
        console.log(colors.cyan("\n🕒 Updating incremental pull timestamps..."));
        
        // Update timestamp for each successful entity type
        for (let i = 0; i < pullSteps.length; i++) {
            if (stepStatuses[i] === 1) { // Successful step
                const stepName = pullSteps[i];
                
                // Map step names to entity types for timestamp tracking
                let entityType: string | null = null;
                switch (stepName) {
                    case 'Models': entityType = 'models'; break;
                    case 'Containers': entityType = 'containers'; break;
                    case 'Content': entityType = 'content'; break;
                    case 'Assets': entityType = 'assets'; break;
                    case 'Galleries': entityType = 'galleries'; break;
                    case 'Templates': entityType = 'templates'; break;
                    case 'Pages': entityType = 'pages'; break;
                    // Skip Sitemaps, Redirections - they're handled by Content step
                }
                
                if (entityType) {
                    try {
                        updateEntityTypeTimestamp(this._guid, this._rootPath, entityType, pullStartTime);
                        console.log(colors.green(`  ✓ Updated timestamp for ${entityType}`));
                    } catch (timestampError: any) {
                        console.warn(colors.yellow(`  ⚠️ Failed to update timestamp for ${entityType}: ${timestampError.message}`));
                    }
                }
            }
        }
        console.log(colors.green("✓ Incremental pull timestamps updated successfully"));
    }

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

    // Final summary and cleanup
    const finalSuccessCount = stepStatuses.filter(status => status === 1).length;
    const finalErrorCount = stepStatuses.filter(status => status === 2).length;
    const finalTotalSteps = stepStatuses.length;

    if (this._useBlessedUI && screen) {
        // Show completion summary in blessed UI
        const summaryMessage = `Pull completed: ${finalSuccessCount}/${finalTotalSteps} steps successful, ${finalErrorCount} errors`;
        console.log(ansiColors.green(summaryMessage));
        
        // Auto-exit countdown for Blessed UI
        let countdown = 5;
        const countdownInterval = setInterval(() => {
            console.log(ansiColors.yellow(`Auto-exit in ${countdown} seconds... (Press any key to exit now)`));
            countdown--;
            
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                if (screen && !screen.destroyed) screen.destroy();
                restoreConsole();
                
                const finalizedLogPath = this.fileOps.finalizeLogFile('pull');
                process.stdout.write('\nPull operation completed.\n');
                process.stdout.write(`Log file written to: ${finalizedLogPath}\n`);
                process.exit(0);
            }
        }, 1000);
        
        // Allow immediate exit on any key press
        screen.onceKey(['escape', 'q', 'C-c', 'enter', 'space'], () => {
            clearInterval(countdownInterval);
            if (screen && !screen.destroyed) screen.destroy();
            restoreConsole();
            
            const finalizedLogPath = this.fileOps.finalizeLogFile('pull');
            process.stdout.write('\nPull operation completed.\n');
            process.stdout.write(`Log file written to: ${finalizedLogPath}\n`);
            process.exit(0);
        });
        
        // Keep the process alive during countdown
        return;
    } else {
        // For non-blessed UI modes, just show summary and exit normally
        const summaryMessage = `Pull operation completed: ${finalSuccessCount}/${finalTotalSteps} steps successful, ${finalErrorCount} errors`;
        console.log(ansiColors.green(summaryMessage));
        
        const finalizedLogPath = this.fileOps.finalizeLogFile('pull');
        console.log(`Log file written to: ${finalizedLogPath}`);
    }

    } catch (error: any) {
      const colors = require("ansi-colors");
      console.error(colors.red("\n❌ An error occurred during the pull command:"), error);
      process.exit(1);
    }
  }
}
