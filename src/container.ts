import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';


export class container{
    _options : mgmtApi.Options;

    constructor(options: mgmtApi.Options){
        this._options = options;
    }

    async getContainers(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);

        let containers = await apiClient.containerMethods.getContainerList(guid);

        let fileExport = new fileOperations();

        for(let i = 0; i < containers.length; i++){
            fileExport.exportFiles('containers', containers[i].referenceName,containers[i]);
            let progressCount = i + 1;
        }

    }
}