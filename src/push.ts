import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';

export class push{
    _options : mgmtApi.Options;
    processedModels: { [key: string]: number; };

    constructor(options: mgmtApi.Options){
        this._options = options;
        this.processedModels = {};
    }

    createBaseModels(){
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

    createBaseAssets(){
        try{
            let fileOperation = new fileOperations();
            let files = fileOperation.readDirectory('assets/json');

            let assets: mgmtApi.AssetMediaList[] = [];

            for(let i = 0; i < files.length; i++){
                let file = JSON.parse(files[i]) as mgmtApi.AssetMediaList;
                assets.push(file);
            }
            return assets;
        } catch {

        }
    }

    createBaseContainers(){
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

    async pushContainers(containers: mgmtApi.Container[], models: mgmtApi.Model[], guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        let modelRefs: { [key: number]: string; } = {};

  
        for(let i = 0; i < containers.length; i++){
            let container = containers[i];
            try{
                let referenceName = models.find(model => model.id === container.contentDefinitionID);
                if(referenceName){
                    if(!modelRefs[container.contentDefinitionID])
                        modelRefs[container.contentDefinitionID] = referenceName.referenceName;
                }
            } catch {

            }
            
        }
        for(let i = 0; i < containers.length; i++){
            let container = containers[i];
            let referenceName = modelRefs[container.contentDefinitionID];
            if(referenceName){
                let modelID = this.processedModels[referenceName];
                if(modelID){
                    console.log(`Processing Container : ${container.referenceName}, For Model ${referenceName}`)
                    container.contentDefinitionID = modelID;
                    try{
                        let existingContainer = await apiClient.containerMethods.getContainerByReferenceName(container.referenceName, guid);
                        if(existingContainer){
                            container.contentViewID = existingContainer.contentViewID;
                        } else {
                            container.contentViewID = -1;
                            console.log('in else');
                        }
                        await apiClient.containerMethods.saveContainer(container, guid);
                    } catch{
                        container.contentViewID = -1;
                        console.log('in exception');
                        await apiClient.containerMethods.saveContainer(container, guid);
                    }
                }
                else{
                    console.log('ModelID not found');
                }
            } else{
                console.log('ReferenceName not found');
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
                    let existing = await apiClient.modelMethods.getModelByReferenceName(model.referenceName, guid);
                    if(existing){
                        model.id = existing.id;
                        let updatedModel = await apiClient.modelMethods.saveModel(model, guid);
                        this.processedModels[updatedModel.referenceName] = updatedModel.id;
                        models[i] = null;
                    }
                } catch{
                    for(let j = 0; j < model.fields.length; j++){
                        let field = model.fields[j];
                        if(field.settings['ContentDefinition']){
                            let modelRef = field.settings['ContentDefinition'];
                            if(this.processedModels[modelRef] && !(this.processedModels[model.referenceName])){
                                model.id = 0;
                                try{
                                    let createdModel = await apiClient.modelMethods.saveModel(model, guid);
                                    this.processedModels[createdModel.referenceName] = createdModel.id;
                                    models[i] = null;
                                } catch{
                                    console.log(`Error creating model ${model.referenceName}`);
                                }
                            }
                        }
                        else{

                        }
                    }
                }

            }
        } while(models.filter(m => m !== null).length !== 0)

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

    async pushAssets(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        let assetMedias = this.createBaseAssets();
        let medias: mgmtApi.Media[] = [];
        for(let i = 0; i < assetMedias.length; i++){
            let assetMedia = assetMedias[i];
            for(let j = 0; j < assetMedia.assetMedias.length; j++){
                let media = assetMedia.assetMedias[j];
                medias.push(media);
            }
        }
        
        //let url = new URL(medias[0].originUrl);
        
        for(let i = 0; i < medias.length; i++){
            let media = medias[i];
            try{
                //Change the URL to the instance to be cloned.
                //Check if the media present from the new URL.
                
                let existingMedia = await apiClient.assetMethods.getAssetByUrl(media.originKey, guid);
                if(existingMedia){
                    media.mediaID = existingMedia.mediaID;
                    media.containerEdgeUrl = existingMedia.containerEdgeUrl;
                    media.edgeUrl = existingMedia.edgeUrl;
                    media.originUrl = existingMedia.originUrl;
                    media.containerOriginUrl = existingMedia.containerOriginUrl;
                } else {
                    
                }
            } catch {
                
            }
        }
    }

    async pushInstance(guid: string){
        try{
            await this.pushAssets(guid);
            // let models = this.createBaseModels();
            // let containers = this.createBaseContainers();
            
            // let linkedModels = await this.getLinkedModels(models);
            // let normalModels = await this.getNormalModels(models, linkedModels);
            //  for(let i = 0; i < normalModels.length; i++){
            //     let normalModel = normalModels[i];
            //     await this.pushNormalModels(normalModel, guid);
            //  }
             
            // await this.pushLinkedModels(linkedModels, guid);
            // let containerModels = this.createBaseModels();
            // await this.pushContainers(containers, containerModels, guid);
        } catch {

        }
   }
}