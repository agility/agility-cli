import * as mgmtApi from "@agility/management-sdk";
import { fileOperations } from "./fileOperations";
import * as cliProgress from "cli-progress";
import ansiColors from "ansi-colors";
import path from "path";
import fs from "fs";

export class models {
    _options: mgmtApi.Options;
    _multibar: cliProgress.MultiBar;
    _rootPath: string;
    _legacyFolders: boolean;
    private _progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void;

    constructor(
        options: mgmtApi.Options,
        multibar: cliProgress.MultiBar,
        rootPath: string,
        legacyFolders: boolean,
        progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
    ) {
        this._options = options;
        this._multibar = multibar;
        this._rootPath = rootPath;
        this._legacyFolders = legacyFolders;
        this._progressCallback = progressCallback;
    }

    async getModels(guid: string, locale: string, isPreview: boolean, basePathForServiceCall?: string) {
        const actualBasePath = this._legacyFolders ? (basePathForServiceCall || this._rootPath) : this._rootPath;
        const modelsDestPath = path.join(actualBasePath, "models");

        let apiClient = new mgmtApi.ApiClient(this._options);
        let fileExport = new fileOperations(this._rootPath, guid, locale, true);
        let successfullyDownloadedCount = 0;
        let totalModels = 0;
        let allModels: mgmtApi.Model[] = []; // To store combined list of content and page models

        try {
            const contentModules = await apiClient.modelMethods.getContentModules(true, guid, false);
            const pageModules = await apiClient.modelMethods.getPageModules(true, guid);

            allModels = [...contentModules, ...pageModules];
            totalModels = allModels.length;

            if (this._progressCallback) {
                this._progressCallback(0, totalModels, 'progress');
            }

            // No need to explicitly create modelsDestPath if exportFiles handles it, 
            // but ensure it's created for non-legacy before loop if exportFiles relies on pre-existing parent.
            if (!this._legacyFolders && !fs.existsSync(modelsDestPath)) {
                fs.mkdirSync(modelsDestPath, { recursive: true });
            }

            for (let i = 0; i < allModels.length; i++) {
                const modelSummary = allModels[i]; // This is a summary item
                let modelDetails: mgmtApi.Model | null = null;
                let fileName = modelSummary.id.toString();
                let modelDisplayName = modelSummary.referenceName || modelSummary.displayName || `ID ${modelSummary.id}`;

                try {
                    // CRITICAL FIX: Always fetch full details for both content and page modules
                    // This ensures contentDefinitionTypeID is consistently available for all models
                    if (contentModules.find(cm => cm.id === modelSummary.id)) {
                        // Content module - get full details
                        modelDetails = await apiClient.modelMethods.getContentModel(modelSummary.id, guid);
                    } else {
                        // Page module - also get full details (summary data may be incomplete)
                        // Use getContentModel for page modules too as it returns complete model structure
                        try {
                            modelDetails = await apiClient.modelMethods.getContentModel(modelSummary.id, guid);
                        } catch (pageModuleError) {
                            // Fallback to summary if getContentModel fails for page modules
                            console.warn(`⚠️  Using summary data for page module ${modelDisplayName} - full details unavailable`);
                            modelDetails = modelSummary;
                        }
                    }
                    
                    if (!modelDetails) {
                        throw new Error("Could not retrieve model details.");
                    }
                    
                    modelDisplayName = modelDetails.referenceName || modelDetails.displayName || `ID ${modelDetails.id}`;

                    if (this._legacyFolders) {
                        // actualBasePath here for legacy is typically 'agility-files'
                        fileExport.exportFiles(`${guid}/${locale}/${isPreview ? "preview" : "live"}/models`, fileName, modelDetails, actualBasePath);
                    } else {
                        // modelsDestPath is agility-files/guid/locale/mode/models
                        fileExport.exportFiles("", fileName, modelDetails, modelsDestPath);
                    }
                    console.log(`✓ Downloaded model ${ansiColors.cyan(modelDisplayName)} ID: ${modelSummary.id}`);
                    successfullyDownloadedCount++;
                } catch (itemError: any) {
                    console.error(ansiColors.red(`✗ Error processing model ${modelDisplayName} (ID ${modelSummary.id}): ${itemError.message}`));
                }
                if (this._progressCallback) {
                    this._progressCallback(successfullyDownloadedCount, totalModels, 'progress');
                }
            }

            const errorCount = totalModels - successfullyDownloadedCount;
            const summaryMessage = `Downloaded ${successfullyDownloadedCount} models (${successfullyDownloadedCount}/${totalModels} models, ${errorCount} errors)`;

            if (this._progressCallback) {
                this._progressCallback(successfullyDownloadedCount, totalModels, errorCount === 0 ? 'success' : 'error');
                if (errorCount > 0) console.log(ansiColors.yellow(summaryMessage));
                else console.log(ansiColors.yellow(summaryMessage));
            } else {
                console.log(ansiColors.yellow(summaryMessage));
            }

        } catch (mainError: any) {
            console.error(ansiColors.red(`An error occurred during model processing: ${mainError.message}`));
            const errorCount = totalModels - successfullyDownloadedCount; // Recalculate in case it failed early
            const summaryMessage = `Downloaded ${successfullyDownloadedCount} models (${successfullyDownloadedCount}/${totalModels} models, ${errorCount} errors)`;
            if (this._progressCallback) {
                this._progressCallback(successfullyDownloadedCount, totalModels, 'error');
                console.log(ansiColors.yellow(summaryMessage));
            } else {
                console.log(ansiColors.yellow(summaryMessage));
            }
        }
    }

    async validateModels(guid: string,locale:string, isPreview: boolean = false){
        try{
            let apiClient = new mgmtApi.ApiClient(this._options);

            let fileOperation = new fileOperations(this._rootPath, guid, locale, true);
            let files = fileOperation.readDirectory(`${guid}/${locale}/${isPreview ? 'preview':'live'}/models`);
            let modelStr: string[] = [];
            for(let i = 0; i < files.length; i++){
                let model = JSON.parse(files[i]) as mgmtApi.Model;
                let existingModel = await apiClient.modelMethods.getModelByReferenceName(model.referenceName, guid);
    
                if(existingModel.referenceName){
                    modelStr.push(existingModel.referenceName);
                }
               
            }
            return modelStr;
        }
        catch{

        }
        
    }

    deleteModelFiles(models: string[], guid: string, locale:string, isPreview:boolean = false){
        let file = new fileOperations(this._rootPath, guid, locale, true);
        for(let i = 0; i < models.length; i++){
            let fileName = `${models[i]}.json`;
            file.deleteFile(`agility-files/${guid}/${locale}/${isPreview ? 'preview':'live'}/models/${fileName}`);
        }
    }
}