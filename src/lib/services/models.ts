import * as mgmtApi from "@agility/management-sdk";
import { fileOperations } from "./fileOperations";
import * as cliProgress from "cli-progress";
import ansiColors from "ansi-colors";
import path from "path";
import fs from "fs";

export class models {
    _options: mgmtApi.Options;
    _multibar: cliProgress.MultiBar;
    private _fileOps: fileOperations;
    private _progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void;

    constructor(
        options: mgmtApi.Options,
        multibar: cliProgress.MultiBar,
        fileOps: fileOperations,
        legacyFolders: boolean,
        progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
    ) {
        this._options = options;
        this._multibar = multibar;
        this._fileOps = fileOps;
        this._progressCallback = progressCallback;
    }

    async getModels(guid: string, locale: string, isPreview: boolean, update: boolean = false) {
        const modelsDestPath = this._fileOps.getDataFolderPath("models");

        let apiClient = new mgmtApi.ApiClient(this._options);
        let fileExport = this._fileOps;
        let successfullyDownloadedCount = 0;
        let skippedCount = 0;
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

            // Use fileOperations to create folder
            fileExport.createFolder("models");

            for (let i = 0; i < allModels.length; i++) {
                const modelSummary = allModels[i]; // This is a summary item
                let modelDetails: mgmtApi.Model | null = null;
                let fileName = modelSummary.id.toString();
                let modelDisplayName = modelSummary.referenceName || modelSummary.displayName || `ID ${modelSummary.id}`;

                const modelFilePath = this._fileOps.getDataFolderPath(`models/${fileName}.json`);
                
                // Check if we should skip file existence check based on update flag
                // update=false (default): Skip existing files, update=true: Force download/overwrite
                if (!update && this._fileOps.checkFileExists(modelFilePath)) {
                    console.log(ansiColors.grey.italic('Found'),ansiColors.gray(modelDisplayName),ansiColors.grey.italic('skipping download'));
                    skippedCount++;
                } else {
                    try {
                        // JOEL'S SIMPLIFICATION: Always fetch full model details regardless of type
                        // This ensures consistent behavior and complete data for all models
                        modelDetails = await apiClient.modelMethods.getContentModel(modelSummary.id, guid);
                        
                        if (!modelDetails) {
                            throw new Error("Could not retrieve model details.");
                        }
                        
                        modelDisplayName = modelDetails.referenceName || modelDetails.displayName || `ID ${modelDetails.id}`;

                        // Use fileOperations to export files to models folder
                        fileExport.exportFiles("models", fileName, modelDetails);
                        console.log(`✓ Downloaded model ${ansiColors.cyan(modelDisplayName)} ID: ${modelSummary.id}`);
                        successfullyDownloadedCount++;
                    } catch (itemError: any) {
                        console.error(ansiColors.red(`✗ Error processing model ${modelDisplayName} (ID ${modelSummary.id}): ${itemError.message}`));
                    }
                }
                const processedCount = successfullyDownloadedCount + skippedCount;
                if (this._progressCallback) {
                    this._progressCallback(processedCount, totalModels, 'progress');
                }
            }

            const processedCount = successfullyDownloadedCount + skippedCount;
            const errorCount = totalModels - processedCount;
            const summaryMessage = `\nDownloaded ${successfullyDownloadedCount} models (${successfullyDownloadedCount}/${totalModels} models, ${skippedCount} skipped, ${errorCount} errors)\n`;

            if (this._progressCallback) {
                this._progressCallback(processedCount, totalModels, errorCount === 0 ? 'success' : 'error');
                console.log(ansiColors.yellow(summaryMessage));
            } else {
                console.log(ansiColors.yellow(summaryMessage));
            }

        } catch (mainError: any) {
            console.error(ansiColors.red(`An error occurred during model processing: ${mainError.message}`));
            const processedCount = successfullyDownloadedCount + skippedCount;
            const errorCount = totalModels - processedCount; // Recalculate in case it failed early
            const summaryMessage = `\nDownloaded ${successfullyDownloadedCount} models (${successfullyDownloadedCount}/${totalModels} models, ${skippedCount} skipped, ${errorCount} errors)\n`;
            if (this._progressCallback) {
                this._progressCallback(processedCount, totalModels, 'error');
                console.log(ansiColors.yellow(summaryMessage));
            } else {
                console.log(ansiColors.yellow(summaryMessage));
            }
        }
    }

    async validateModels(guid: string, locale: string, isPreview: boolean = false) {
        try {
            let apiClient = new mgmtApi.ApiClient(this._options);

            let fileOperation = this._fileOps;
            let files = fileOperation.readDirectory("models");
            let modelStr: string[] = [];
            for (let i = 0; i < files.length; i++) {
                let model = JSON.parse(files[i]) as mgmtApi.Model;
                let existingModel = await apiClient.modelMethods.getModelByReferenceName(model.referenceName, guid);

                if (existingModel.referenceName) {
                    modelStr.push(existingModel.referenceName);
                }

            }
            return modelStr;
        }
        catch {

        }

    }

    deleteModelFiles(models: string[], guid: string, locale: string, isPreview: boolean = false) {
        let file = this._fileOps;
        for (let i = 0; i < models.length; i++) {
            let fileName = `${models[i]}.json`;
            file.deleteFile(file.getDataFolderPath(`models/${fileName}`));
        }
    }
}