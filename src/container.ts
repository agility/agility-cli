import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';
import * as cliProgress from 'cli-progress';


export class container{
    _options : mgmtApi.Options;
    _multibar: cliProgress.MultiBar;

    constructor(options: mgmtApi.Options, multibar: cliProgress.MultiBar){
        this._options = options;
        this._multibar = multibar;
    }

    async getContainers(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        try{
            let containers = await apiClient.containerMethods.getContainerList(guid);

            const progressBar3 = this._multibar.create(containers.length, 0);
            progressBar3.update(0, {name : 'Containers'});
    
            let fileExport = new fileOperations();
    
            let index = 1;
            for(let i = 0; i < containers.length; i++){
                let container = await apiClient.containerMethods.getContainerByID(containers[i].contentViewID, guid);
                let referenceName = container.referenceName.replace(/[^a-zA-Z ]/g, "");;
                fileExport.exportFiles('containers', referenceName,container);
                let progressCount = i + 1;
                if(index === 1){
                    progressBar3.update(1);
                }
                else{
                    progressBar3.update(index);
                }
                index += 1;
            }
        } catch {
            
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

    deleteContainerFiles(containers: string[]){
        let file = new fileOperations();
        for(let i = 0; i < containers.length; i++){
            let fileName = `${containers[i]}.json`;
            file.deleteFile(`.agility-files/containers/${fileName}`);
        }
    }
}