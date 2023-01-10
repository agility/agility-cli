import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';

export class asset{
    _options : mgmtApi.Options;

    constructor(options: mgmtApi.Options){
        this._options = options;
    }

    async getAssets(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        let fileExport = new fileOperations();

        let pageSize = 250;
        let recordOffset = 0;
        let index = 1;

        let initialRecords = await apiClient.assetMethods.getMediaList(pageSize, recordOffset, guid);

        let totalRecords = initialRecords.totalCount;

        fileExport.exportFiles('assets', index, initialRecords);

        for(let i = 0; i < initialRecords.assetMedias.length; i++){

            let extension = initialRecords.assetMedias[i].fileName.substring(initialRecords.assetMedias[i].fileName.lastIndexOf(".")+1);
            let fileName = `${initialRecords.assetMedias[i].mediaID}.${extension}`;

            await fileExport.downloadFile(initialRecords.assetMedias[i].originUrl, `.agility-files/assets/${fileName}`);

        }

        let iterations = Math.round(totalRecords/pageSize);

        for(let i = 0; i < iterations - 1; i++){
            recordOffset += pageSize;
            index += 1;

            let assets = await apiClient.assetMethods.getMediaList(pageSize, recordOffset, guid);
            fileExport.exportFiles('assets', index, assets);

            for(let j = 0; j < assets.assetMedias.length; j++){
                
                let extension = assets.assetMedias[j].fileName.substring(assets.assetMedias[j].fileName.lastIndexOf(".")+1);
                let fileName = `${assets.assetMedias[j].mediaID}.${extension}`;

                await fileExport.downloadFile(assets.assetMedias[j].originUrl, `.agility-files/assets/${fileName}`);
            }
        }

    }
}