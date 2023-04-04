import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';
import * as cliProgress from 'cli-progress';

export class model{
    _options : mgmtApi.Options;
    _multibar: cliProgress.MultiBar;

    constructor(options: mgmtApi.Options, multibar: cliProgress.MultiBar){
        this._options = options;
        this._multibar = multibar;
    }

    async getModels(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        try{
            let contentModules = await apiClient.modelMethods.getContentModules(true, guid, false);

            let pageModules = await apiClient.modelMethods.getPageModules(true, guid);

            let models : mgmtApi.Model[] = [];

            let fileExport = new fileOperations();

            let totalLength = contentModules.length + pageModules.length;

            const progressBar4 = this._multibar.create(totalLength, 0);
            progressBar4.update(0, {name : 'Models'});

            for(let i = 0; i < contentModules.length; i++){
                models.push(contentModules[i]);
            }

            for(let i = 0; i < pageModules.length; i++){
                models.push(pageModules[i]);
            }

            let index = 1;
            for(let i = 0; i < models.length; i++){
                let model = await apiClient.modelMethods.getContentModel(models[i].id, guid);
                fileExport.exportFiles('models', model.id, model);
                if(index === 1){
                    progressBar4.update(1);
                }
                else{
                    progressBar4.update(index);
                }
                index += 1;
            }
        } catch{

        }
        this._multibar.stop();
    }

    async validateModels(guid: string){
        try{
            let apiClient = new mgmtApi.ApiClient(this._options);

            let fileOperation = new fileOperations();
            let files = fileOperation.readDirectory('models');
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

    deleteModelFiles(models: string[]){
        let file = new fileOperations();
        for(let i = 0; i < models.length; i++){
            let fileName = `${models[i]}.json`;
            file.deleteFile(`.agility-files/models/${fileName}`);
        }
    }
}