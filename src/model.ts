import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';

export class model{
    _options : mgmtApi.Options;

    constructor(options: mgmtApi.Options){
        this._options = options;
    }

    async getModels(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);

        let contentModules = await apiClient.modelMethods.getContentModules(true, guid, false);

        let pageModules = await apiClient.modelMethods.getPageModules(true, guid);

        let models : mgmtApi.Model[] = [];

        let fileExport = new fileOperations();

        let totalLength = contentModules.length + pageModules.length;

        for(let i = 0; i < contentModules.length; i++){
            models.push(contentModules[i]);
        }

        for(let i = 0; i < pageModules.length; i++){
            models.push(pageModules[i]);
        }

        for(let i = 0; i < models.length; i++){
            let model = await apiClient.modelMethods.getContentModel(models[i].id, guid);
            fileExport.exportFiles('models', model.referenceName, model);
        }

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
}