import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';
import * as fs from 'fs';
const FormData = require('form-data');

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

    createBaseGalleries(){
        try{
            let fileOperation = new fileOperations();
            let files = fileOperation.readDirectory('assets/galleries');

            let assetGalleries: mgmtApi.assetGalleries[] = [];

            for(let i = 0; i < files.length; i++){
                let assetGallery = JSON.parse(files[i]) as mgmtApi.assetGalleries;
                assetGalleries.push(assetGallery);
            }
            return assetGalleries;
        } catch{

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

    async createBaseContentItems(guid: string, locale: string){
            let apiClient = new mgmtApi.ApiClient(this._options);
            let fileOperation = new fileOperations();
            let files = fileOperation.readDirectory(`${locale}\\item`);

            let contentItems : mgmtApi.ContentItem[] = [];

            for(let i = 0; i < files.length; i++){
                let contentItem = JSON.parse(files[i]) as mgmtApi.ContentItem;
                try{
                    let container = await apiClient.containerMethods.getContainerByReferenceName(contentItem.properties.referenceName, guid);
                    if(container){
                        contentItems.push(contentItem);
                    }
                } catch{
                    continue;
                }
            }
            return contentItems;
    }

    async getLinkedContent(guid: string, contentItems: mgmtApi.ContentItem[]){
            let linkedContentItems : mgmtApi.ContentItem[] = []
            let apiClient = new mgmtApi.ApiClient(this._options);
            for(let i = 0; i < contentItems.length; i++){
                let contentItem = contentItems[i];
                let containerRef = contentItem.properties.referenceName;
                try{
                    let container = await apiClient.containerMethods.getContainerByReferenceName(containerRef, guid);
                    let model = await apiClient.modelMethods.getContentModel(container.contentDefinitionID, guid);
                
                    model.fields.flat().find((field) => {
                        if(field.type === 'Content'){
                            return linkedContentItems.push(contentItem);
                        }
                    })
                } catch {
                    continue;
                }
            }
            return linkedContentItems;
        }
        
    async getNormalContent(guid: string, baseContentItems: mgmtApi.ContentItem[], linkedContentItems: mgmtApi.ContentItem[]){
//        let normalContentItems : mgmtApi.ContentItem[] = []
        let apiClient = new mgmtApi.ApiClient(this._options);
        let contentItems = baseContentItems.filter(contentItem => linkedContentItems.indexOf(contentItem) < 0);

        // for(let i = 0; i < contentItems.length; i++){
        //     let contentItem = contentItems[i];
        //    try{
        //         let container = await apiClient.containerMethods.getContainerByReferenceName(contentItem.properties.referenceName, guid);
        //         if(container){
        //             normalContentItems.push(contentItem);
        //         } else{
        //             continue;
        //         }
        //    } catch {
        //     continue;
        //    }
        // }
        return contentItems;
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
                    container.contentDefinitionID = modelID;
                    try{
                        let existingContainer = await apiClient.containerMethods.getContainerByReferenceName(container.referenceName, guid);
                        if(existingContainer){
                            container.contentViewID = existingContainer.contentViewID;
                        } else {
                            container.contentViewID = -1;
                        }
                        await apiClient.containerMethods.saveContainer(container, guid);
                    } catch{
                        container.contentViewID = -1;
                        await apiClient.containerMethods.saveContainer(container, guid);
                    }
                }
                else{
                }
            } else{
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
                            if(model.referenceName !== modelRef){
                                if(this.processedModels[modelRef] && !(this.processedModels[model.referenceName])){
                                    model.id = 0;
                                    try{
                                        let createdModel = await apiClient.modelMethods.saveModel(model, guid);
                                        this.processedModels[createdModel.referenceName] = createdModel.id;
                                        models[i] = null;
                                    } catch{
                                    }
                                }
                            } else{
                                model.id = 0;
                                try{
                                    let createdModel = await apiClient.modelMethods.saveModel(model, guid);
                                    this.processedModels[createdModel.referenceName] = createdModel.id;
                                    models[i] = null;
                                } catch{

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

    async pushGalleries(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);

        let assetGalleries = this.createBaseGalleries();
        for(let i = 0; i < assetGalleries.length; i++){
            let assetGallery = assetGalleries[i];
            for(let j = 0; j < assetGallery.assetMediaGroupings.length; j++){
                let gallery = assetGallery.assetMediaGroupings[j];
                try{
                    let existingGallery = await apiClient.assetMethods.getGalleryByName(guid, gallery.name);
                    if(existingGallery){
                        gallery.mediaGroupingID = existingGallery.mediaGroupingID;
                    }
                    else{
                        gallery.mediaGroupingID = 0;
                    }
                  await apiClient.assetMethods.saveGallery(guid, gallery);
                } catch {
                    gallery.mediaGroupingID = 0;
                    await apiClient.assetMethods.saveGallery(guid, gallery);
                }
            }
        }
    }

    async pushAssets(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        let defaultContainer = await apiClient.assetMethods.getDefaultContainer(guid);
        let fileOperation = new fileOperations();

        let assetMedias = this.createBaseAssets();
        let medias: mgmtApi.Media[] = [];
        for(let i = 0; i < assetMedias.length; i++){
            let assetMedia = assetMedias[i];
            for(let j = 0; j < assetMedia.assetMedias.length; j++){
                let media = assetMedia.assetMedias[j];
                medias.push(media);
            }
        }
        
         let re = /(?:\.([^.]+))?$/;
         for(let i = 0; i < medias.length; i++){
            let media = medias[i];
            let filePath = this.getFilePath(media.originUrl);
            filePath = filePath.replace(/%20/g, " ");
            let folderPath = filePath.split("/").slice(0, -1).join("/");
            if(!folderPath){
                folderPath = '/';
            }
            let orginUrl = `${defaultContainer.originUrl}/${filePath}`;
            const form = new FormData();
            const file = fs.readFileSync(`.agility-files/assets/${filePath}`, null);
            form.append('files',file, media.fileName);
            let mediaGroupingID = -1;
            try{
                let existingMedia = await apiClient.assetMethods.getAssetByUrl(orginUrl, guid);
                
                if(existingMedia){
                    if(media.mediaGroupingID > 0){
                        mediaGroupingID = await this.doesGalleryExists(guid, media.mediaGroupingName);
                    }
                }
                else{
                    if(media.mediaGroupingID > 0){
                        mediaGroupingID = await this.doesGalleryExists(guid, media.mediaGroupingName);
                    }
                }
                let uploadedMedia = await apiClient.assetMethods.upload(form, folderPath, guid,mediaGroupingID);
            } catch {
                if(media.mediaGroupingID > 0){
                    mediaGroupingID = await this.doesGalleryExists(guid, media.mediaGroupingName);
                }
               let uploadedMedia = await apiClient.assetMethods.upload(form, folderPath, guid,mediaGroupingID);
            }
                
        }

    }

    async doesGalleryExists(guid: string, mediaGroupingName: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        let mediaGroupingID = -1;
        try{
            let gallery = await apiClient.assetMethods.getGalleryByName(guid, mediaGroupingName);
            if(gallery){
                mediaGroupingID = gallery.mediaGroupingID;
            } else{
                mediaGroupingID =  -1;
            }
        } catch {
            return -1;
        }
        return mediaGroupingID;
    }

    getFilePath(originUrl: string): string{
        let url = new URL(originUrl);
        let pathName = url.pathname;
        let extractedStr = pathName.split("/")[1];
        let removedStr = pathName.replace(`/${extractedStr}/`, "");

        return removedStr;
    }

    async pushInstance(guid: string, locale: string){
        try{
           /* await this.pushGalleries(guid);
            await this.pushAssets(guid);
            let models = this.createBaseModels();
            let containers = this.createBaseContainers();
            
            let linkedModels = await this.getLinkedModels(models);
            let normalModels = await this.getNormalModels(models, linkedModels);
             for(let i = 0; i < normalModels.length; i++){
                let normalModel = normalModels[i];
                await this.pushNormalModels(normalModel, guid);
             }
             
           await this.pushLinkedModels(linkedModels, guid);
            let containerModels = this.createBaseModels();
            await this.pushContainers(containers, containerModels, guid);*/

            let contentItems = await this.createBaseContentItems(guid, locale);

            let linkedContentItems = await this.getLinkedContent(guid, contentItems);

            let normalContentItems = await this.getNormalContent(guid, contentItems, linkedContentItems);

        } catch {

        }
   }
}