import * as mgmtApi from "@agility/management-sdk";
import { fileOperations } from "./fileOperations";
import * as cliProgress from "cli-progress";
import ansiColors from "ansi-colors";

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

  // Download methods moved to respective downloaders:
  // - getGalleries -> download-galleries.ts
  // - getAssets -> download-assets.ts

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
}
