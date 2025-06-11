import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';
import * as fs from 'fs';
const blessed = require('blessed');
const contrib = require('blessed-contrib');
import * as cliProgress from 'cli-progress';
import ansiColors from 'ansi-colors';
import { homePrompt } from '../prompts/home-prompt';
import { Auth } from './auth';
import { ReferenceMapper } from '../reference-mapper';
import {
    pushContainers,
    pushContent,
    pushAssets,
    pushGalleries,
    pushModels,
    pushTemplates,
    pushPages
} from '../pushers';
import { getModelsFromFileSystem } from '../getters/filesystem/get-models';
import { getGalleriesFromFileSystem } from '../getters/filesystem/get-galleries';
import { getAssetsFromFileSystem } from '../getters/filesystem/get-assets';
import { getContainersFromFileSystem } from '../getters/filesystem/get-containers';
import { getTemplatesFromFileSystem } from '../getters/filesystem/get-templates';
import { getPagesFromFileSystem } from '../getters/filesystem/get-pages';
import { getContentItemsFromFileSystem } from '../getters/filesystem/get-content-items';
// declare module '@agility/management-sdk' {
//     interface PageItem {
//         pageTemplateID?: number;
//     }
// }

export class push {
    _options : mgmtApi.Options;
    _multibar: cliProgress.MultiBar;
    _guid: string;
    _targetGuid: string;
    _locale: string;
    _isPreview: boolean;
    _token: string;
    processedModels: { [key: string]: number; };
    processedDefinitionIds: { [key: number]: number; };
    processedContentIds : {[key: number]: number}; //format Key -> Old ContentId, Value New ContentId.
    skippedContentItems: {[key: number]: string}; //format Key -> ContentId, Value ReferenceName of the content.
    processedGalleries: {[key: number]: number};
    processedTemplates: {[key: string]: number}; //format Key -> pageTemplateName, Value pageTemplateID.
    processedPages : {[key: number]: number}; //format Key -> old page id, Value new page id.
    processedAssets: { [key: string]: string; };
    processedContainers: { [key: number]: number; };
    private settings: any;
    private processedCount: number = 0;
    private _apiClient: mgmtApi.ApiClient;
    private _referenceMapper: ReferenceMapper;
    private failedContainers: number = 0;
    private failedContent: number = 0;
    private _useBlessedUI: boolean = false;
    private elements: any;
    private rootPath: string;
    private legacyFolders: boolean;
    private dryRun: boolean;
    private contentFolder: string;
    private _logModelDiffs: boolean;

    constructor(options: mgmtApi.Options, multibar: cliProgress.MultiBar, guid: string, targetGuid:string, locale:string, isPreview: boolean, useBlessedUI?: boolean, elements?: any, rootPath?: string, legacyFolders?: boolean, dryRun?: boolean, contentFolder?: string, logModelDiffs?: boolean ){
        // Handle SSL certificate verification for local development
        if (process.env.NODE_ENV === 'development' || process.env.LOCAL) {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        }
        
        this._options = options;
        this._multibar = multibar;
        this._guid = guid;
        this._targetGuid = targetGuid;
        this._locale = locale;
        this._isPreview = isPreview;
        this._token = options.token;
        this.processedModels = {};
        this.processedDefinitionIds = {};
        this.processedContentIds = {};
        this.processedGalleries = {};
        this.skippedContentItems = {};
        this.processedTemplates = {};
        this.processedPages = {};
        this.settings = {};
        this.processedAssets = {};
        this.processedContainers = {};
        this._apiClient = new mgmtApi.ApiClient(this._options);
        this.rootPath = rootPath || 'agility-files';
        this._referenceMapper = new ReferenceMapper(this._guid, this._targetGuid, this.rootPath, this.legacyFolders);
        this._useBlessedUI = useBlessedUI ?? false;
        this.elements = elements ?? [];
        this.legacyFolders = legacyFolders ?? false;
        this.dryRun = dryRun ?? false;
        this.contentFolder = contentFolder ?? null;
        this._logModelDiffs = logModelDiffs ?? false;
    }

    async initialize() {
        let auth = new Auth();
        this._options.token = await auth.getToken();
    }

    async pushInstance(): Promise<void> {
        

        await this.initialize();

        let screen: any | null = null;
        let logContainer: any | null = null;
        let progressContainerBox: any | null = null;
        let stepProgressBars: any[] = [];
        
        // Filter push steps based on selected elements
        const availableSteps = [ 'Galleries', 'Assets', 'Models', 'Containers', 'Content', 'Templates', 'Pages' ];
        const pushSteps = availableSteps.filter(step => this.elements.includes(step));
        
        if (pushSteps.length === 0) {
            console.log(ansiColors.yellow("No elements selected to push."));
            if (this._useBlessedUI) restoreConsole();
            return; // Nothing to do
        }

        const totalSteps = pushSteps.length;
        let stepStatuses = new Array(totalSteps).fill(0); // Status array based on filtered steps
        let originalConsoleLog = console.log;
        let originalConsoleError = console.error;

        // Define restoreConsole early using function keyword for hoisting
        function restoreConsole() {
            console.log = originalConsoleLog;
            console.error = originalConsoleError;
        };

        // Declare galleries variable outside the conditional block
        let galleries: mgmtApi.assetGalleries[] = [];

        const updateProgress = (currentStepIndex: number, status: 'success' | 'error', percentage?: number) => {
            if (!this._useBlessedUI) return; // Do nothing if UI not enabled
            if (currentStepIndex >= 0 && currentStepIndex < totalSteps) {
                const targetBar = stepProgressBars[currentStepIndex];
                if (targetBar) {
                    // Use provided percentage or default to 100 for completion
                    const fillPercentage = percentage !== undefined ? percentage : 100;
                    targetBar.setProgress(fillPercentage);

                    // Determine color - turn red on first error and stay red
                    let barColor = 'blue'; // Default/in-progress
                    
                    // --- Refined Logic --- 
                    // Mark step as errored immediately if status is error
                    if (status === 'error' && stepStatuses[currentStepIndex] !== 2) {
                         stepStatuses[currentStepIndex] = 2; // Mark step as errored PERMANENTLY
                    }
                    
                    // Set color based on the PERMANENT status
                    if (stepStatuses[currentStepIndex] === 2) { // If step is marked errored
                        barColor = 'red';
                    } else if (fillPercentage === 100) { // Completed successfully?
                        barColor = 'green';
                        stepStatuses[currentStepIndex] = 1; // Mark step as success
                    } else {
                        // Still in progress and no error encountered yet
                        barColor = 'blue'; 
                    }
                    
                    // Apply the style
                    targetBar.style.bar.bg = barColor;

                    // Optionally update label with status on completion
                    if(fillPercentage === 100) {
                        targetBar.setLabel(` ${pushSteps[currentStepIndex]} (${status}) `);
                    }
                }
            }
            screen?.render(); 
        };

        if (this._useBlessedUI) {
            // Initialize Blessed screen
            screen = blessed.screen({
                smartCSR: true,
                title: 'Agility CLI - Push Operation'
            });

            // Initialize Grid layout - Covers full screen, 13 rows to leave space for header
            const grid = new contrib.grid({
                rows: 13,       // Use 13 rows
                cols: 12,
                screen: screen
                // Remove top/bottom offsets, let it cover screen
            });

            // Left Column Container (Box) - Start at Grid Row 1
            progressContainerBox = grid.set(1, 0, 12, 4, blessed.box, { // Start Row 1, Height 12
                label: ' Progress ',
                border: { type: 'line' },
                style: {
                    border: { fg: 'cyan' },
                 }
                 // Remove padding: { top: 1 }
            });

            // Create individual progress bars (positioning remains relative to parent)
            pushSteps.forEach((stepName, index) => {
                 const bar = blessed.progressbar({
                    parent: progressContainerBox,
                    border: 'line',
                    pch: ' ', // Use space character for filled portion
                    style: {
                        fg: 'white',
                        bg: 'black',
                        bar: { bg: 'blue', fg: 'white' }, // Default to blue (pending)
                        border: { fg: '#f0f0f0' }
                    },
                    width: '90%',
                    height: 3,
                    top: 1 + (index * 3), // Position vertically
                    left: 'center',
                    filled: 0,
                    label: ` ${stepName} ` // Add spaces for padding
                 });
                 stepProgressBars.push(bar);
            });

            // Logs (Right Column) - Start at Grid Row 1
            logContainer = grid.set(1, 4, 12, 8, blessed.log, { // Start Row 1, Height 12
                label: ' Logs ',
                border: { type: 'line' },
                style: { border: { fg: 'green' } },
                padding: { left: 2, right: 1, top: 1, bottom: 1 },
                scrollable: true,
                alwaysScroll: true,
                scrollbar: {
                    ch: ' ',
                    inverse: true
                },
                keys: true, // Enable scrolling with keys
                vi: true    // Enable vi keys for scrolling
            });

            // --- Header (Drawn After Grid) ---
            // Header Left Column ("Push")
            const pushHeaderLeft = blessed.box({
                parent: screen, // Attach directly to screen
                width: '20%',
                height: 1,
                top: 0,
                left: 0,
                content: ' ',
                tags: true,
                style: { fg: 'cyan', bold: true }
            });

            // Header Right Column (GUIDs)
            const pushHeaderRight = blessed.box({
                parent: screen, // Attach directly to screen
                width: '80%',
                height: 1,
                top: 0,
                left: '20%', // Start after the left column
                content: `Source: ${this._guid} -> Target: ${this._targetGuid} `,
                tags: true,
                align: 'right',
                style: { fg: 'white' }
            });
            // --- End Header ---

            // Redirect console logging to the blessed log widget
            console.log = (...args: any[]) => {
                if (logContainer) {
                    logContainer.log(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' '));
                    screen?.render(); // Ensure screen updates after log
                }
            };
            console.error = (...args: any[]) => {
                if (logContainer) {
                    const errorMsg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
                    logContainer.log(ansiColors.red(`ERROR: ${errorMsg}`));
                    screen?.render(); // Ensure screen updates after error
                }
            };

            // Quit on Escape, q, or Control-C.
            screen.key(['escape', 'q', 'C-c'], function(ch, key) {
                restoreConsole();
                screen?.destroy(); // Destroy screen before exiting
                return homePrompt(this._useBlessedUI);
                // return process.exit(0);
            });

            // Render the screen.
            screen.render();

            // Explicitly focus the log container for scrolling
            logContainer.focus();

        } else {
            // If not using blessed UI, ensure original console is used
            restoreConsole(); 
        }

        // Initial update to show 0%
        if (this._useBlessedUI) {
            updateProgress(-1, 'success'); // Call initially to set 0%
        }

        let currentStep = -1;
        try {
            // --- Galleries --- 
            if (this.elements.includes('Galleries')) {
                currentStep = pushSteps.indexOf('Galleries');
                let galleryStatus: 'success' | 'error' = 'success';
                const galleryStepIndex = currentStep;
                try {
                    const galleryProgressCallback = (processed: number, total: number, status?: 'success' | 'error') => {
                        const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
                        updateProgress(galleryStepIndex, status || 'success', percentage); 
                    };
                    galleries = getGalleriesFromFileSystem(
                        this._guid,
                        this._locale,
                        this._isPreview,
                        this._referenceMapper,
                        this.rootPath,
                        this.legacyFolders
                    ) || []; // Ensure galleries is an array
                    const galleryResult = await pushGalleries(
                        galleries, 
                        this._targetGuid, 
                        this._apiClient,
                        this._referenceMapper,
                        galleryProgressCallback
                    );
                    galleryStatus = galleryResult.status;
                 } catch (e: any) {
                    galleryStatus = 'error';
                    if (!this._useBlessedUI) console.error(ansiColors.red(`ERROR pushing galleries: ${e.message}`));
                    else logContainer?.log(ansiColors.red(`ERROR pushing galleries: ${e.message}`));
                }
                updateProgress(galleryStepIndex, galleryStatus); 
            }

            // --- Assets --- 
            if (this.elements.includes('Assets')) {
                currentStep = pushSteps.indexOf('Assets');
                let assetStatus: 'success' | 'error' = 'success';
                const assetStepIndex = currentStep;
                try {
                    const assetProgressCallback = (processed: number, total: number, status?: 'success' | 'error') => {
                        const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
                        updateProgress(assetStepIndex, status || 'success', percentage);
                    };
                    const assets = getAssetsFromFileSystem(
                        this._guid,
                        this._locale,
                        this._isPreview,
                        this._referenceMapper,
                        this.rootPath,
                        this.legacyFolders
                    ) || []; 
                    const assetResult = await pushAssets(
                        assets, 
                        galleries,
                        this._guid,
                        this._targetGuid, 
                        this._locale, 
                        this._isPreview, 
                        this._apiClient, 
                        this._referenceMapper, 
                        assetProgressCallback
                    );
                    assetStatus = assetResult.status;
                } catch (e: any) {
                    assetStatus = 'error';
                    if (!this._useBlessedUI) console.error(ansiColors.red(`ERROR pushing assets: ${e.message}`));
                    else logContainer?.log(ansiColors.red(`ERROR pushing assets: ${e.message}`));
                }
                updateProgress(assetStepIndex, assetStatus); 
            }

            // --- Models --- 
            if (this.elements.includes('Models')) {
                currentStep = pushSteps.indexOf('Models');
                let modelStatus: 'success' | 'error' = 'success';
                const modelStepIndex = currentStep;
                try {
                    if (!this._useBlessedUI) console.log(ansiColors.yellow("Pushing Models..."));
                    const models = await getModelsFromFileSystem(
                        this._guid,
                        this._locale,
                        this._isPreview,
                        this._referenceMapper,
                        this.rootPath,
                        this.legacyFolders
                    );
                    
                    const modelProgressCallback = (processed: number, total: number, status?: 'success' | 'error') => {
                        const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
                        updateProgress(modelStepIndex, status || 'success', percentage); 
                    };

                    const modelResult = await pushModels(
                        models,
                        this._options,
                        this._targetGuid,
                        this._referenceMapper,
                        this._logModelDiffs,
                        false, // forceSync - default to incremental mode
                        modelProgressCallback
                    );
                    modelStatus = modelResult.status;

                } catch (e: any) {
                    modelStatus = 'error';
                    if (!this._useBlessedUI) console.error(ansiColors.red(`ERROR processing models: ${e.message}`));
                    else logContainer?.log(ansiColors.red(`ERROR processing models: ${e.message}`));
                }
                updateProgress(modelStepIndex, modelStatus);
            }

            // --- Containers --- 
            if (this.elements.includes('Containers')) {
                currentStep = pushSteps.indexOf('Containers');
                let containerStatus: 'success' | 'error' = 'success';
                const containerStepIndex = currentStep;
                try{
                    const containers = getContainersFromFileSystem(
                        this._guid,
                        this._locale,
                        this._isPreview,
                        this._referenceMapper,
                        this.rootPath,
                        this.legacyFolders
                    );
                    if (!containers || containers.length === 0) {
                        console.log('No containers found to push');
                    } else {
                        const containerProgressCallback = (processed: number, total: number, status?: 'success' | 'error') => {
                            const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
                            updateProgress(containerStepIndex, status || 'success', percentage);
                        };
                        await pushContainers(
                            containers,
                            this._targetGuid,
                            this._apiClient,
                            this._referenceMapper,
                            containerProgressCallback
                        );
                    }
                } catch(e: any){
                    containerStatus = 'error';
                    if (!this._useBlessedUI) console.error(ansiColors.red(`ERROR processing containers: ${e.message}`));
                    else logContainer?.log(ansiColors.red(`ERROR processing containers: ${e.message}`));
                }
                updateProgress(containerStepIndex, containerStatus);
            }

            // --- Content --- 
            if (this.elements.includes('Content')) {
                currentStep = pushSteps.indexOf('Content');
                let contentStatus: 'success' | 'error' = 'success';
                const contentStepIndex = currentStep;
                try{
                    const allContentItems = await getContentItemsFromFileSystem(
                        this._guid,
                        this._locale,
                        this._isPreview,
                        this._referenceMapper,
                        this.rootPath,
                        this.legacyFolders
                    );
                    if (!allContentItems || allContentItems.length === 0) {
                        console.log('No content items found to push');
                    } else {
                        const contentProgressCallback = (processed: number, total: number, status?: 'success' | 'error') => {
                            const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
                            updateProgress(contentStepIndex, status || 'success', percentage); 
                        };
                        const contentResult = await pushContent(
                            allContentItems,
                            this._targetGuid,
                            this._locale,
                            this._apiClient,
                            this._referenceMapper,
                            contentProgressCallback
                        );
                        const totalContentItems = allContentItems.length;
                        console.log(ansiColors.yellow(`Processed ${contentResult.successfulItems}/${totalContentItems} content items (${contentResult.failedItems} failed)`));
                        if(contentResult.failedItems > 0) contentStatus = 'error';
                    }
                     if (!this._useBlessedUI) console.log('Content items pushed.');
                    else logContainer?.log('Content items pushed.');
                } catch(e: any){
                    contentStatus = 'error';
                    if (!this._useBlessedUI) console.error(ansiColors.red(`ERROR processing content: ${e.message}`));
                    else logContainer?.log(ansiColors.red(`ERROR processing content: ${e.message}`));
                }
                updateProgress(contentStepIndex, contentStatus);
            }

            // --- Templates --- 
            if (this.elements.includes('Templates') || this.elements.includes('Template')) {
                currentStep = pushSteps.indexOf('Templates');
                let templateStatus: 'success' | 'error' = 'success';
                const templateStepIndex = currentStep;
                try {
                    if (!this._useBlessedUI) console.log('Processing templates...'); 
                    else logContainer?.log('Processing templates...');
                    
                    const templates = await getTemplatesFromFileSystem(
                        this._guid,
                        this._locale,
                        this._isPreview,
                        this.rootPath,
                        this.legacyFolders
                    );
                    
                    if(!templates || templates.length === 0){
                        console.log('No templates found to push');
                    } else {
                        const templateProgressCallback = (processed: number, total: number, status?: 'success' | 'error') => {
                            const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
                            updateProgress(templateStepIndex, status || 'success', percentage); 
                        };

                        const templateResult = await pushTemplates(
                            templates,
                            this._targetGuid,
                            this._locale,
                            this._apiClient,
                            this._referenceMapper,
                            templateProgressCallback
                        );
                        templateStatus = templateResult.status; 
                    }
                    if (!this._useBlessedUI) console.log('Templates processed.');
                    else logContainer?.log('Templates processed.');
                } catch(e: any) {
                    templateStatus = 'error';
                    if (!this._useBlessedUI) console.error(ansiColors.red(`ERROR processing templates: ${e.message}`));
                    else logContainer?.log(ansiColors.red(`ERROR processing templates: ${e.message}`));
                }
                 updateProgress(templateStepIndex, templateStatus);
            }

            // --- Pages --- 
            if (this.elements.includes('Pages')) {
                currentStep = pushSteps.indexOf('Pages');
                let pageStatus: 'success' | 'error' = 'success';
                const pageStepIndex = currentStep;
                try {
                    if (!this._useBlessedUI) console.log('Processing pages...');
                    else logContainer?.log('Processing pages...');
                    
                    const pages = await getPagesFromFileSystem(
                        this._guid,
                        this._locale,
                        this._isPreview,
                        this._referenceMapper,
                        this.rootPath,
                        this.legacyFolders
                    ); 
                    
                    if(!pages || pages.length === 0){
                         console.log('No pages found to push');
                    } else {
                        const pageProgressCallback = (processed: number, total: number, status?: 'success' | 'error') => {
                            const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
                            updateProgress(pageStepIndex, status || 'success', percentage); 
                        };

                        const pageResult = await pushPages(
                            pages,
                            this._targetGuid,
                            this._locale,
                            this._apiClient,
                            this._referenceMapper,
                            pageProgressCallback
                        );
                        pageStatus = pageResult.status; 
                    }

                 } catch(e: any){
                    pageStatus = 'error';
                    if (!this._useBlessedUI) console.error(ansiColors.red(`ERROR processing pages: ${e.message}`));
                    else logContainer?.log(ansiColors.red(`ERROR processing pages: ${e.message}`));
                }
                updateProgress(pageStepIndex, pageStatus);
            }

            // Final Status Check
            const overallStatus = stepStatuses.includes(2) ? 'failed' : 'completed successfully';
            const finalMessage = `Push process ${overallStatus}!`;
            if (!this._useBlessedUI) {
                 console.log(finalMessage);
                 process.exit(0);
            } else {
                logContainer?.log(finalMessage);
            }

            if (this._useBlessedUI) {
                screen?.key(['escape', 'q', 'C-c'], function() {
                    restoreConsole();
                    screen?.destroy();
                    process.exit(0);
                });
                screen?.render();
            }
            

        } catch (error) {
             if (!this._useBlessedUI) {
                 console.error(`Unhandled error during push: ${error.message}`);
                 console.error(error.stack);
                 console.log(ansiColors.red('\nPush process failed!'));
             } else {
                logContainer?.log(ansiColors.red(`Unhandled error during push: ${error.message}`));
                logContainer?.log(ansiColors.red(error.stack));
                logContainer?.log(ansiColors.red('\nPush process failed!')); // Log final failure status
             }
        } finally {
             if (this._useBlessedUI) {
                // Keep screen alive briefly to show final status/errors
                logContainer?.log("\nPress ESC, q, or Ctrl+C to exit.");
                screen?.render();
                // Screen destroyed by keybind
             } else {
                 // Ensure console is restored if somehow redirection happened without UI flag
                 restoreConsole();
             }
        }
    }

   
   

    

   
   
  

   
}
