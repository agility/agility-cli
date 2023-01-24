import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';

export class push{
    _options : mgmtApi.Options;
    processedModels: { [key: string]: number; };

    constructor(options: mgmtApi.Options){
        this._options = options;
        this.processedModels = {};
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

    async pushNormalModels(model: mgmtApi.Model, guid: string){
        await this.createModel(model, guid);
    }

    async pushContainers(containers: mgmtApi.Container[], oldModelId: number, newModelId: number, guid: string){
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

    async pushLinkedModels(models: mgmtApi.Model[], guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        do{
            for(let i = 0; i < models.length; i++ ){
                let model = models[i];
                if(!model){
                    continue;
                }
                try{
                  //  console.log(`Processing model ${model.referenceName}`);
                    let existing = await apiClient.modelMethods.getModelByReferenceName(model.referenceName, guid);
                    if(existing){
                        model.id = existing.id;
                        let updatedModel = await apiClient.modelMethods.saveModel(model, guid);
                        this.processedModels[updatedModel.referenceName] = updatedModel.id;
                        models[i] = null;
                       // return;
                    } 
                } catch{
                    model.fields.forEach((async (field) => {
                        if(field.settings['ContentDefinition']){
                            let modelRef = field.settings['ContentDefinition'];
                            if(modelRef in this.processedModels){
                                model.id = 0;
                                try{
                                    let createdModel = await apiClient.modelMethods.saveModel(model, guid);
                                    this.processedModels[createdModel.referenceName] = createdModel.id;
                                    models[i] = null;
                                } catch{
                                    console.log(`Error creating model ${model.referenceName}`);
                                }
                                console.log(JSON.stringify(this.processedModels));
                               // this.processedModels[model.referenceName] = model.id;
                                
                               // return;
                            }
                            else{

                            }
                        }
                    }))
                }
                
            }
            
            //console.log(models.filter(m => m !== null).length);
        } while(models.filter(m => m !== null).length >= 0)
       
    }


    async createModel(model: mgmtApi.Model, guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        try{
            let existing = await apiClient.modelMethods.getModelByReferenceName(model.referenceName, guid);
            let oldModelId = model.id;
            if(existing){
                model.id = existing.id;
                let updatedModel = await apiClient.modelMethods.saveModel(model,guid);
                this.processedModels[updatedModel.referenceName] = updatedModel.id;
            } else{
                model.id = 0;
                let newModel =  await apiClient.modelMethods.saveModel(model,guid);
                this.processedModels[newModel.referenceName] = newModel.id;
            }
        }
        catch{
            model.id = 0;
            let newModel =  await apiClient.modelMethods.saveModel(model,guid);
            this.processedModels[newModel.referenceName] = newModel.id;
        }
    }

    async pushModelsContainers(guid: string){
        try{
            let models = await this.createBaseModels();
            let containers = await this.createBaseContainers();
           // await this.processModels(models, guid);
             let linkedModels = await this.getLinkedModels(models);
             let normalModels = await this.getNormalModels(models, linkedModels);
             for(let i = 0; i < normalModels.length; i++){
                let normalModel = normalModels[i];
                await this.pushNormalModels(normalModel, guid);
             }
            await this.pushLinkedModels(linkedModels, guid);
        } catch {

        }
   }
}