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
            let container = await apiClient.containerMethods.getContainerByID(containers[i].contentViewID, guid);
            fileExport.exportFiles('containers', container.referenceName,container);
            let progressCount = i + 1;
        }

    }

    async validateContainers(guid: string){
        try{
            let apiClient = new mgmtApi.ApiClient(this._options);

            let fileOperation = new fileOperations();
            let files = fileOperation.readDirectory('containers');
    
            let containerStr: string[] = [];
            for(let i = 0; i < files.length; i++){
                let container = JSON.parse(files[i]) as mgmtApi.Container;
                let existingContainer = await apiClient.containerMethods.getContainerByReferenceName(container.referenceName, guid);
    
                if(existingContainer.referenceName){
                    containerStr.push(existingContainer.referenceName);
                }
               
            }
            return containerStr;
        } catch{

        }
        
    }
}