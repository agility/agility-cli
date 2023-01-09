import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';


export class model{
    _options : mgmtApi.Options;

    constructor(options: mgmtApi.Options){
        this._options = options;
    }

    async getModels(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);

        let contentModules = await apiClient.modelMethods.getContentModules(true, guid, true);

        let pageModules = await apiClient.modelMethods.getPageModules(true, guid);

        let fileExport = new fileOperations();

        for(let i = 0; i < contentModules.length; i++){
            fileExport.exportFiles('models',contentModules[i].referenceName,contentModules[i]);
        }

        for(let i = 0; i < pageModules.length; i++){
            fileExport.exportFiles('models',pageModules[i].referenceName,pageModules[i]);
        }
    }
}