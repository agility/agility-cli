import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';
import * as cliProgress from 'cli-progress';

export class asset{
    _options : mgmtApi.Options;
    _multibar: cliProgress.MultiBar;

    constructor(options: mgmtApi.Options, multibar: cliProgress.MultiBar){
        this._options = options;
        this._multibar = multibar;
    }

    async getGalleries(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        let fileExport = new fileOperations();

        let pageSize = 250;
        let rowIndex = 0;

        let multiExport = false;

        let index = 1;

        let initialRecords = await apiClient.assetMethods.getGalleries(guid, '', pageSize, rowIndex);

        let totalRecords = initialRecords.totalCount;

        fileExport.exportFiles('assets/galleries', index, initialRecords);

        let iterations = Math.round(totalRecords/pageSize);

        if(totalRecords > pageSize){
            multiExport = true;
        }

        if(iterations === 0){
            iterations = 1;
        }

        const progressBar1 = this._multibar.create(iterations, 0);

        if(multiExport){
            progressBar1.update(0, {name : 'Galleries'});
        
            for(let i = 0; i < iterations; i++){
                rowIndex += pageSize;
                if(index === 1){
                    progressBar1.update(1);
                }
                else{
                    progressBar1.update(index);
                }
                index += 1;
                let galleries = await apiClient.assetMethods.getGalleries(guid, '', pageSize, rowIndex);
    
                fileExport.exportFiles('assets/galleries', index, galleries);
            }
        }
        else{
            progressBar1.update(1, {name : 'Galleries'});
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
        let apiClient = new mgmtApi.ApiClient(this._options);
        let fileExport = new fileOperations();

        let pageSize = 250;
        let recordOffset = 0;
        let index = 1;
        let multiExport = false;

        let initialRecords = await apiClient.assetMethods.getMediaList(pageSize, recordOffset, guid);

        let totalRecords = initialRecords.totalCount;
        fileExport.createFolder('assets/json');
        fileExport.exportFiles('assets/json', index, initialRecords);

        let iterations = Math.round(totalRecords/pageSize);

        if(totalRecords > pageSize){
            multiExport = true;
        }

        if(iterations === 0){
            iterations = 1;
        }

        const progressBar2 = this._multibar.create(iterations, 0);

        progressBar2.update(0, {name : 'Assets'});

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

        if(multiExport){
            for(let i = 0; i < iterations; i++){
                recordOffset += pageSize;
    
                if(index === 1){
                    progressBar2.update(1);
                }
                else{
                    progressBar2.update(index);
                }
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
        else{
            progressBar2.update(1);
        }
        

        await this.getGalleries(guid);
    }
}