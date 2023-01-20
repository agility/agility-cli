import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';

export class push{
    _options : mgmtApi.Options;

    constructor(options: mgmtApi.Options){
        this._options = options;
    }

    async createBaseModels(){
        try{
            let fileOperation = new fileOperations();
            let files = fileOperation.readDirectory('models');

            let models : mgmtApi.Model[] = [];

            for(let i = 0; i < files.length; i++){
                let model = JSON.parse(files[i]) as mgmtApi.Model;
                models.push(model);
            }
            return models;
        } catch {

        }
    }

    async createBaseContainers(){
        try{
            let fileOperation = new fileOperations();
            let files = fileOperation.readDirectory('containers');

            let containers : mgmtApi.Container[] = [];

            for(let i = 0; i < files.length; i++){
                let container = JSON.parse(files[i]) as mgmtApi.Container;
                containers.push(container);
            }
           return containers;
        } catch{

        }
    }

    async getLinkedModels(models: mgmtApi.Model[]){
        try{
            let linkedModels : mgmtApi.Model[] = [];
            models.forEach((model) => model.fields.flat().find((field)=> {
                if(field.type === 'Content') {
                    return linkedModels.push(model);
                };
            } ));
            return linkedModels;
        } catch {

        }
    }

    async getNormalModels(allModels: mgmtApi.Model[], linkedModels: mgmtApi.Model[]){
        try{
            let normalModels = allModels.filter(model => linkedModels.indexOf(model) < 0);
            return normalModels;
        } catch {

        }
    }

    async pushNormalModels(models: mgmtApi.Model[], guid: string){
            let apiClient = new mgmtApi.ApiClient(this._options);

            for(let i = 0; i < models.length; i++){
                try{
                    let model = models[i];
                    let existing = await apiClient.modelMethods.getModelByReferenceName(model.referenceName, guid);
                    if(existing){
                        model.id = existing.id;
                        await apiClient.modelMethods.saveModel(model,guid);
                    } else{
                        model.id = 0;
                        await apiClient.modelMethods.saveModel(model,guid);
                    }
                } catch{
                    let model = models[i];
                    model.id = 0;
                    await apiClient.modelMethods.saveModel(model,guid);
                }
               
            }
    }

    async pushNormalContainers(containers: mgmtApi.Container[], oldModelId: number, newModelId: number, guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);

        for(let i = 0; i < containers.length; i++){
            try{
                let container = containers[i];
                let existingContainer = await apiClient.containerMethods.getContainerByReferenceName(container.referenceName, guid);
                if(container.contentDefinitionID === oldModelId){
                    if(existingContainer){
                        container.contentViewID = existingContainer.contentViewID;
                        container.contentDefinitionID = newModelId;
                    } else{
                        container.contentViewID = -1;
                        container.contentDefinitionID = newModelId;
                        await apiClient.containerMethods.saveContainer(container, guid);
                    }
                }
                
            } catch{
                let container = containers[i];
                container.contentViewID = -1;
                container.contentDefinitionID = newModelId;
                await apiClient.containerMethods.saveContainer(container, guid);
            }
        }
    }

    async testMethod(){
        console.log('create model');
    }

   async pushModelsContainers(guid: string){
        try{
            let models = await this.createBaseModels();
            let containers = await this.createBaseContainers();
           
            let linkedModels = await this.getLinkedModels(models);
            let normalModels = await this.getNormalModels(models, linkedModels);
            console.log(JSON.stringify(containers));
 //           await this.pushNormalModels(normalModels, guid);
        } catch {

        }
   }

}