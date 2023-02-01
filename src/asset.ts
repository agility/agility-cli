import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';

export class asset{
    _options : mgmtApi.Options;

    constructor(options: mgmtApi.Options){
        this._options = options;
    }

    async getGalleries(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        let fileExport = new fileOperations();

        let pageSize = 5;
        let rowIndex = 0;

        let index = 1;

        let initialRecords = await apiClient.assetMethods.getGalleries(guid, '', pageSize, rowIndex);

        let totalRecords = initialRecords.totalCount;

        fileExport.exportFiles('assets/galleries', index, initialRecords);

        let iterations = Math.round(totalRecords/pageSize);
 
        for(let i = 0; i < iterations; i++){
            rowIndex += pageSize;
            index += 1;

            let galleries = await apiClient.assetMethods.getGalleries(guid, '', pageSize, rowIndex);

            fileExport.exportFiles('assets/galleries', index, galleries);
        }
    }

    getFilePath(originUrl: string): string{
        let url = new URL(originUrl);
        let pathName = url.pathname;
        let extractedStr = pathName.split("/")[1];
        let removedStr = pathName.replace(`/${extractedStr}/`, "");

        return removedStr;
    }

    async getAssets(guid: string){
        await this.getGalleries(guid);
        let apiClient = new mgmtApi.ApiClient(this._options);
        let fileExport = new fileOperations();

        let pageSize = 20;
        let recordOffset = 0;
        let index = 1;

        let initialRecords = await apiClient.assetMethods.getMediaList(pageSize, recordOffset, guid);

        let totalRecords = initialRecords.totalCount;

        fileExport.exportFiles('assets/json', index, initialRecords);

        for(let i = 0; i < initialRecords.assetMedias.length; i++){

            let extension = initialRecords.assetMedias[i].fileName.substring(initialRecords.assetMedias[i].fileName.lastIndexOf(".")+1);
            let filePath = this.getFilePath(initialRecords.assetMedias[i].originUrl);

            let folderPath = filePath.split("/").slice(0, -1).join("/");
            let fileName = `${initialRecords.assetMedias[i].fileName}`;
            if(folderPath){ 
                fileExport.createFolder(`assets/${folderPath}`);
                await fileExport.downloadFile(initialRecords.assetMedias[i].originUrl, `.agility-files/assets/${folderPath}/${fileName}`);
            }
            else{
                await fileExport.downloadFile(initialRecords.assetMedias[i].originUrl, `.agility-files/assets/${fileName}`);
            }
        }

        let iterations = Math.round(totalRecords/pageSize);

        for(let i = 0; i < iterations; i++){
            recordOffset += pageSize;
            index += 1;

            let assets = await apiClient.assetMethods.getMediaList(pageSize, recordOffset, guid);
            fileExport.exportFiles('assets/json', index, assets);

            for(let j = 0; j < assets.assetMedias.length; j++){
                
                let extension = assets.assetMedias[j].fileName.substring(assets.assetMedias[j].fileName.lastIndexOf(".")+1);
                let filePath = this.getFilePath(assets.assetMedias[j].originUrl);

                let folderPath = filePath.split("/").slice(0, -1).join("/");
                let fileName = `${assets.assetMedias[j].fileName}`;
                if(folderPath){ 
                    fileExport.createFolder(`assets/${folderPath}`);
                    await fileExport.downloadFile(assets.assetMedias[j].originUrl, `.agility-files/assets/${folderPath}/${fileName}`);
                }
                else{
                    await fileExport.downloadFile(assets.assetMedias[j].originUrl, `.agility-files/assets/${fileName}`);
                }
            }
        }

    }
}