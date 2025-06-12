import * as mgmtApi from "@agility/management-sdk";
import { fileOperations } from "./fileOperations";
import * as cliProgress from "cli-progress";
import ansiColors from "ansi-colors";
import path from "path";

export class assets {
  _options: mgmtApi.Options;
  _multibar: cliProgress.MultiBar;
  unProcessedAssets: { [key: number]: string };
  private _fileOps: fileOperations;
  private _progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void;

  constructor(
    options: mgmtApi.Options,
    multibar: cliProgress.MultiBar,
    fileOps: fileOperations,
    legacyFolders:boolean = false,
    progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
    ) {
    this._options = options;
    this._multibar = multibar;
    this.unProcessedAssets = {};
    this._fileOps = fileOps;
    this._progressCallback = progressCallback;
  }

  async getGalleries(guid: string, locale: string, isPreview: boolean = true) {
    let apiClient = new mgmtApi.ApiClient(this._options);
    let fileExport = this._fileOps;

    let pageSize = 250;
    let rowIndex = 0;

    let multiExport = false;

    let index = 1;

    let initialRecords = await apiClient.assetMethods.getGalleries(
      guid,
      "",
      pageSize,
      rowIndex
    );

    let totalRecords = initialRecords.totalCount;

    fileExport.createFolder("assets/galleries");
    fileExport.exportFiles(
      "assets/galleries",
      index,
      initialRecords
    );

    let iterations = Math.round(totalRecords / pageSize);

    if (totalRecords > pageSize) {
      multiExport = true;
    }

    if (iterations === 0) {
      iterations = 1;
    }

    // const progressBar1 = this._multibar.create(iterations, 0);

    if (multiExport) {
      // progressBar1.update(0, { name: "Galleries" });

      for (let i = 0; i < iterations; i++) {
        rowIndex += pageSize;
        // if (index === 1) {
        //   progressBar1.update(1);
        // } else {
        //   progressBar1.update(index);
        // }
        index += 1;
        let galleries = await apiClient.assetMethods.getGalleries(
          guid,
          "",
          pageSize,
          rowIndex
        );

        fileExport.exportFiles(
          "assets/galleries",
          index,
          galleries
        );
      }
    } else {
      // progressBar1.update(1, { name: "Galleries" });
    }

    // progressBar1.stop();
  }

  getFilePath(originUrl: string): string {
    let url = new URL(originUrl);
    let pathName = url.pathname;
    let extractedStr = pathName.split("/")[1];
    let removedStr = pathName.replace(`/${extractedStr}/`, "");

    return removedStr;
  }

  async getAssets(guid: string, locale: string, isPreview: boolean = true) {
    let apiClient = new mgmtApi.ApiClient(this._options);
    let fileExport = this._fileOps;

    let pageSize = 250;
    let recordOffset = 0;
    let index = 1;
    let multiExport = false;
    let processedAssetsInLoop = 0;
    let totalSuccessfullyDownloaded = 0;
    let totalAttemptedToProcess = 0;
    let totalRecords = 0;

    try {
      let initialRecords = await apiClient.assetMethods.getMediaList(
        pageSize,
        recordOffset,
        guid
      );

      totalRecords = initialRecords.totalCount;
      if (this._progressCallback) this._progressCallback(totalSuccessfullyDownloaded, totalRecords, 'progress');

      const assetsRootWithinInstance = fileExport.getDataFolderPath("assets");
      const assetsJsonPath = fileExport.getDataFolderPath("assets/json");

      fileExport.createFolder("assets/json");

      fileExport.exportFiles(
        "assets/json",
        index,
        initialRecords
      );
      index++;

      let iterations = Math.ceil(totalRecords / pageSize);
      if (iterations === 0 && totalRecords > 0) iterations = 1;
      else if (totalRecords === 0) iterations = 0;

      if (totalRecords > pageSize) {
        multiExport = true;
      }
      
      for (let i = 0; i < initialRecords.assetMedias.length; i++) {
        totalAttemptedToProcess++;
        const assetMedia = initialRecords.assetMedias[i];
        const originUrl = assetMedia.originUrl;
        const assetMediaID = assetMedia.mediaID;
        const filePath = this.getFilePath(originUrl);
        const folderPath = filePath.split("/").slice(0, -1).join("/");
        let fileName = `${assetMedia.fileName}`;
        const assetFileDownloadBase = assetsRootWithinInstance;

        // Sanitize filename to avoid filesystem issues
        fileName = fileName.replace(/[<>:"|?*]/g, '_'); // Replace invalid filesystem characters
        fileName = fileName.substring(0, 200); // Limit filename length to prevent path issues

        // Note: Removed broken isUrlProperlyEncoded check - all valid assets should be downloaded

        const assetFolderPath = folderPath ? `assets/${folderPath}` : "assets";
        if (folderPath) {
          fileExport.createFolder(assetFolderPath);
        }
        
        try {
          await fileExport.downloadFile(
            originUrl,
            fileExport.getDataFolderPath(`${assetFolderPath}/${fileName}`)
          );
          console.log('✓ Downloaded file', ansiColors.underline(fileName || originUrl.split('/').pop()));
          totalSuccessfullyDownloaded++;
        } catch (downloadError: any) {
          console.error('✗ Failed to download file', ansiColors.red(fileName || originUrl.split('/').pop()), ansiColors.gray(downloadError.message ? `- ${downloadError.message}` : ''));
          this.unProcessedAssets[assetMediaID] = fileName;
        }
        if (this._progressCallback) this._progressCallback(totalSuccessfullyDownloaded, totalRecords, 'progress');
      }

      if (multiExport) {
        for (let iter = 1; iter < iterations; iter++) { 
          recordOffset += pageSize;
          processedAssetsInLoop = 0;

          let assetsPage = await apiClient.assetMethods.getMediaList(
            pageSize,
            recordOffset,
            guid
          );
          fileExport.exportFiles(
            "assets/json",
            index,
            assetsPage
          );
          index++;

          for (let j = 0; j < assetsPage.assetMedias.length; j++) {
            totalAttemptedToProcess++;
            const assetMedia = assetsPage.assetMedias[j];
            const originUrl = assetMedia.originUrl;
            const mediaID = assetMedia.mediaID;
            const filePath = this.getFilePath(originUrl);
            const folderPath = filePath.split("/").slice(0, -1).join("/");
            let fileName = `${assetMedia.fileName}`;

            // Sanitize filename to avoid filesystem issues
            fileName = fileName.replace(/[<>:"|?*]/g, '_'); // Replace invalid filesystem characters
            fileName = fileName.substring(0, 200); // Limit filename length to prevent path issues

            // Note: Removed broken isUrlProperlyEncoded check - all valid assets should be downloaded

            const assetFolderPath = folderPath ? `assets/${folderPath}` : "assets";
            if (folderPath) {
              fileExport.createFolder(assetFolderPath);
            }

            try {
              await fileExport.downloadFile(
                originUrl,
                fileExport.getDataFolderPath(`${assetFolderPath}/${fileName}`)
              );
              console.log('✓ Downloaded file', ansiColors.underline(fileName || originUrl.split('/').pop()));
              totalSuccessfullyDownloaded++;
            } catch (downloadError: any) {
              console.error('✗ Failed to download file', ansiColors.red(fileName || originUrl.split('/').pop()), ansiColors.gray(downloadError.message ? `- ${downloadError.message}` : ''));
              this.unProcessedAssets[mediaID] = fileName;
            }
            if (this._progressCallback) this._progressCallback(totalSuccessfullyDownloaded, totalRecords, 'progress');
          }
        }
      }
      if (this._progressCallback) this._progressCallback(totalSuccessfullyDownloaded, totalRecords, totalSuccessfullyDownloaded === totalAttemptedToProcess && totalAttemptedToProcess >= totalRecords ? 'success' : 'error');
    } catch (error) {
      if (this._progressCallback) this._progressCallback(totalSuccessfullyDownloaded, totalRecords, 'error');
      throw error;
    }
  }

  async deleteAllGalleries(guid:string, locale: string, isPreview: boolean = true){

    //  TODO: delete all galleries
    let apiClient = new mgmtApi.ApiClient(this._options);
    const galleries = await apiClient.assetMethods.getGalleries(guid, null, 250, 0);

    

  }

  async deleteAllAssets(
    guid: string,
    locale: string,
    isPreview: boolean = true
  ) {
    let apiClient = new mgmtApi.ApiClient(this._options);

    let pageSize = 250;
    let recordOffset = 0;
    let index = 1;
    let multiExport = false;

    let initialRecords = await apiClient.assetMethods.getMediaList(
      pageSize,
      recordOffset,
      guid
    );

    let totalRecords = initialRecords.totalCount;
    let allRecords = initialRecords.assetMedias;

    let iterations = Math.round(totalRecords / pageSize);

    if (totalRecords > pageSize) {
      multiExport = true;
    }

    if (iterations === 0) {
      iterations = 1;
    }

    const progressBar = this._multibar.create(totalRecords, 0);
    progressBar.update(0, { name: "Deleting Assets" });

    for (let i = 0; i < iterations; i++) {
      let assets = await apiClient.assetMethods.getMediaList(
        pageSize,
        recordOffset,
        guid
      );

      allRecords = allRecords.concat(assets.assetMedias);
      assets.assetMedias.forEach(async (mediaItem) => {
      
        if(mediaItem.isFolder) {
            const d = await apiClient.assetMethods.deleteFolder(mediaItem.originKey, guid, mediaItem.mediaID);
            console.log('Deleted', d);
        } else {
            await apiClient.assetMethods.deleteFile(mediaItem.mediaID, guid);
        }

        progressBar.increment();

      });
      recordOffset += pageSize;
    }
    
    return allRecords;
  }

  isUrlProperlyEncoded(url: string) {
    try {
      // Decode and re-encode the URL to compare with the original
      const decoded = decodeURIComponent(url);
      const reEncoded = encodeURIComponent(decoded);

      // Check if the encoded version matches the input
      return url === reEncoded;
    } catch (e) {
      // If decoding throws an error, the URL is not properly encoded
      return false;
    }
  }

  async retryUnprocessedAssets(guid: string, locale: string, isPreview: boolean = true) {
    // Implementation of retryUnprocessedAssets method
  }
}
