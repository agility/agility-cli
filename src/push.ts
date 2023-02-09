import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';
import * as fs from 'fs';
const FormData = require('form-data');

export class push{
    _options : mgmtApi.Options;
    processedModels: { [key: string]: number; };
    processedContentIds : {[key: number]: number;}; //format Key -> Old ContentId, Value New ContentId.
    skippedContentItems: {[key: number]: string}; //format Key -> ContentId, Value ReferenceName of the content.
    processedGalleries: {[key: number]: number};

    constructor(options: mgmtApi.Options){
        this._options = options;
        this.processedModels = {};
        this.processedContentIds = {};
        this.processedGalleries = {};
        this.skippedContentItems = {};
    }


    /////////////////////////////START: DELETE METHODS ONCE DONE/////////////////////////////////////////////////////////////////
    createAllContent(){
        let fileOperation = new fileOperations();
        try{
            let files = fileOperation.readFile('.agility-files\\all\\all.json');
            let contentItems = JSON.parse(files) as mgmtApi.ContentItem[];

            return contentItems;
        } catch(err){
            console.log(err);
        }
        
    }

    createLinkedContent(){
        let fileOperation = new fileOperations();
        try{
            let files = fileOperation.readFile('.agility-files\\linked\\linked.json');
            let contentItems = JSON.parse(files) as mgmtApi.ContentItem[];

            return contentItems;
        } catch(err){
            console.log(err);
        }
        
    }

    createNonLinkedContent(){
        let fileOperation = new fileOperations();
        try{
            let files = fileOperation.readFile('.agility-files\\nonlinked\\nonlinked.json');
            let contentItems = JSON.parse(files) as mgmtApi.ContentItem[];

            return contentItems;
        } catch(err){
            console.log(err);
        }
        
    }
    /////////////////////////////END: DELETE METHODS ONCE DONE/////////////////////////////////////////////////////////////////

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
                    this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName
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
        let apiClient = new mgmtApi.ApiClient(this._options);
        let contentItems = baseContentItems.filter(contentItem => linkedContentItems.indexOf(contentItem) < 0);

        return contentItems;
    }

    async pusNormalContentItems(guid: string, locale: string, contentItems: mgmtApi.ContentItem[]){
        let apiClient = new mgmtApi.ApiClient(this._options);

        for(let i = 0; i < contentItems.length; i++){
            let contentItem = contentItems[i]; //contentItems.find((content) => content.contentID === 122);//160, 106
         //   console.log(`Iteration ${i}, Content Item Ref: ${contentItem.properties.referenceName}, Content ID: ${contentItem.contentID}`);
            let container = new mgmtApi.Container();
            let model = new mgmtApi.Model();
                try{
                    container = await apiClient.containerMethods.getContainerByReferenceName(contentItem.properties.referenceName, guid);
                } catch {
                 //   console.log(`Container not found for ref: ${contentItem.properties.referenceName}`);
                    this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                    continue;
                }
            
                try{
                    model = await apiClient.modelMethods.getContentModel(container.contentDefinitionID, guid);
                } catch{
                 //   console.log(`Model not found for id ${container.contentDefinitionID}`);
                    this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                    continue;
                }
            for(let j = 0; j < model.fields.length; j++){
                let field = model.fields[j];
                let fieldName = this.camelize(field.name);
                let fieldVal = contentItem.fields[fieldName];
                if(field.type === 'ImageAttachment' || field.type === 'FileAttachment' || field.type === 'AttachmentList'){
                    if(typeof fieldVal === 'object'){
                            if(Array.isArray(fieldVal)){
                                for(let k = 0; k < fieldVal.length; k++){
                                    let retUrl = await this.changeOriginKey(guid, fieldVal[k].url);
                                    contentItem.fields[fieldName][k].url = retUrl;
                                }
                            } else {
                                if('url' in fieldVal){
                                    let retUrl = await this.changeOriginKey(guid, fieldVal.url);
                                    contentItem.fields[fieldName].url = retUrl;
                                }
                            }
                    } 
                }
                else 
                {
                    if(typeof fieldVal === 'object'){
                        if('fulllist' in fieldVal){
                            delete fieldVal.fulllist;
                            if(field.type === 'PhotoGallery'){
                                let oldGalleryId = fieldVal.galleryid;
                                if(this.processedGalleries[oldGalleryId]){
                                  //  console.log(`Gallery found old: ${oldGalleryId}, New Gallery: ${this.processedGalleries[oldGalleryId]}`);
                                    contentItem.fields[fieldName] = this.processedGalleries[oldGalleryId].toString();
                                }
                                else{
                                //    console.log(`Gallery Not found old: ${oldGalleryId}`);
                                    contentItem.fields[fieldName] = fieldVal.galleryid.toString();
                                }
                            }
                        }
                    }
                }
            }
            const oldContentId = contentItem.contentID; 
            contentItem.contentID = -1;

            let createdContentItemId = await apiClient.contentMethods.saveContentItem(contentItem, guid, locale);

            if(createdContentItemId[0]){
                if(createdContentItemId[0] > 0){
                    this.processedContentIds[oldContentId] = createdContentItemId[0];
                }
                else{
                    this.skippedContentItems[oldContentId] = contentItem.properties.referenceName;
                  //  console.log(`Unable to create content for old contentId: ${oldContentId}`);
                }
            }
        }
        // let fileOperation = new fileOperations();
        // fileOperation.createTempFile('skippedContents.json', JSON.stringify(this.skippedContentItems));
        // fileOperation.createTempFile('processedContents.json', JSON.stringify(this.processedContentIds));
   }

   async pushLinkedContentItems(guid: string, locale: string, contentItems: mgmtApi.ContentItem[]){
        let apiClient = new mgmtApi.ApiClient(this._options);
        /////////////START: TEMPORARY//////////////////////////////////////////////////////////////////
        let fileOperation = new fileOperations();
       /* let files = fileOperation.readFile('.agility-files\\processed\\processedContents.json');
        this.processedContentIds = JSON.parse(files);
        
        let files2 = fileOperation.readFile('.agility-files\\skipped\\skippedContents.json');
        this.skippedContentItems = JSON.parse(files2);*/
 
        /////////////END: TEMPORARY//////////////////////////////////////////////////////////////////
        // let content = 1111;
        
        do{
            for(let i = 0; i < contentItems.length; i++){
                let contentItem = contentItems[i];
                if(this.skippedContentItems[contentItem.contentID]){
                    contentItem = null;
                }
                if(!contentItem){
                    continue;
                }
                let container = new mgmtApi.Container();
                let model = new mgmtApi.Model();
    
                try{
                    container = await apiClient.containerMethods.getContainerByReferenceName(contentItem.properties.referenceName, guid);
                } catch {
                    this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                    contentItem[i] = null;
                }
            
                try{
                    model = await apiClient.modelMethods.getContentModel(container.contentDefinitionID, guid);
                } catch{
                    this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                    contentItem[i] = null;
                }
                for(let j = 0; j < model.fields.length; j++){
                    let field = model.fields[j];
                    let settings = field.settings;
                    let fieldName = this.camelize(field.name);
                    let fieldVal = contentItem.fields[fieldName];
                    if(fieldVal){
                        if(field.type === 'Content'){
                             if(settings['LinkeContentDropdownValueField']){
                                 if(settings['LinkeContentDropdownValueField']!=='CREATENEW'){
                                    let linkedField = this.camelize(settings['LinkeContentDropdownValueField']);
                                    let linkedContentIds = contentItem.fields[linkedField];
                                    let newlinkedContentIds = '';
                                    if(linkedContentIds){
                                        let splitIds = linkedContentIds.split(',');
                                        for(let k = 0; k < splitIds.length; k++){
                                            let id = splitIds[k];
                                            if(this.skippedContentItems[id]){
                                                this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                                                // contentItem = null;
                                                //contentItem[i] = null;
                                                continue;
                                            }
                                            if(this.processedContentIds[id]){
                                                let newSortId = this.processedContentIds[id].toString();
                                                if(!newlinkedContentIds){
                                                    newlinkedContentIds = newSortId.toString();
                                                    
                                                } else{
                                                    newlinkedContentIds += ',' + newSortId.toString();
                                                }
                                            }
                                            else{
                                                try{
                                                    let file = fileOperation.readFile(`.agility-files\\${locale}\\item\\${id}.json`);
                                                    contentItem = null;
                                                    break;
                                                } catch{
                                                    this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                                                    this.skippedContentItems[id] = 'OrphanRef';
                                                    // console.log(`4. handle totally orphan record contentID ${contentItem.contentID}`);
                                                    // contentItem = null;
                                                    //contentItem[i] = null;
                                                    continue;
                                                }
                                                
                                            }
                                        }
                                    }
                                    if(newlinkedContentIds)
                                        contentItem.fields[linkedField] = newlinkedContentIds;
                                 }
                             }
                                 delete fieldVal.fulllist;
                                 if('contentid' in fieldVal){
                                     let linkedContentId = fieldVal.contentid;
                                     if(this.skippedContentItems[linkedContentId]){
                                         this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                                        //  console.log(`Content Found in skipped ${linkedContentId}`);
                                        //  contentItem = null;
                                         //contentItem[i] = null;
                                         continue;
                                     }
                                     if(this.processedContentIds[linkedContentId]){
                                         let file = fileOperation.readFile(`.agility-files\\${locale}\\item\\${linkedContentId}.json`);
                                         let extractedContent = JSON.parse(file) as mgmtApi.ContentItem;
                                         contentItem.fields[fieldName] = extractedContent.properties.referenceName; 
                                     }
                                     else{
                                         try{
                                             let file = fileOperation.readFile(`.agility-files\\${locale}\\item\\${linkedContentId}.json`);
                                             contentItem = null;
                                             break;
                                         }
                                         catch{
                                             this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                                             this.skippedContentItems[linkedContentId] = 'OrphanRef';
                                            //  console.log(`1. handle totally orphan record contentID ${contentItem.contentID}`);
                                            //  contentItem = null;
                                             //contentItem[i] = null;
                                             continue;
                                         }
                                         
                                     }
                                 }
                                 if('referencename' in fieldVal){
                                     let refName = fieldVal.referencename;
                                     try{
                                         let container = await apiClient.containerMethods.getContainerByReferenceName(refName, guid);
                                         if(!container){
                                             this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                                            //  contentItem = null;
                                             //contentItem[i] = null;
                                             continue;
                                         }
                                         if('sortids' in fieldVal){
                                             contentItem.fields[fieldName].referencename = fieldVal.referencename;
                                         }
                                         else{
                                             contentItem.fields[fieldName] = fieldVal.referencename;
                                         }
                                     } catch{
                                         this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                                        //  contentItem = null;
                                         //contentItem[i] = null;
                                         continue;
                                     }
                                 }
                                 if('sortids' in fieldVal){
                                     let sortids = fieldVal.sortids.split(',');
                                     let newSortIds = '';
                                     for(let s = 0; s < sortids.length; s++){
                                         let sortid = sortids[s];
                                         if(this.skippedContentItems[sortid]){
                                             this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                                            //  contentItem = null;
                                             //contentItem[i] = null;
                                             continue;
                                         }
                                         if(this.processedContentIds[sortid]){
                                             let newSortId = this.processedContentIds[sortid].toString();
                                             if(!newSortIds){
                                                 newSortIds = newSortId.toString();
                                                 
                                             } else{
                                                 newSortIds += ',' + newSortId.toString();
                                             }
                                         }
                                         else{
                                             try{
                                                 let file = fileOperation.readFile(`.agility-files\\${locale}\\item\\${sortid}.json`);
                                                 contentItem = null;
                                                 break;
                                             } catch{
                                                 this.skippedContentItems[contentItem.contentID] = contentItem.properties.referenceName;
                                                 this.skippedContentItems[sortid] = 'OrphanRef';
                                                //  console.log(`2. handle totally orphan record contentID ${contentItem.contentID}`);
                                                // contentItem = null;
                                                 //contentItem[i] = null;
                                                 continue;
                                             }
                                             
                                         }
                                     }
                                     if(newSortIds){
                                         newSortIds = newSortIds.substring(0, newSortIds.length);
                                     }
                                     contentItem.fields[fieldName].sortids = newSortIds;
                                 }
                             
                         }
                         else if(field.type === 'ImageAttachment' || field.type === 'FileAttachment' || field.type === 'AttachmentList'){
                             if(typeof fieldVal === 'object'){
                                 if(Array.isArray(fieldVal)){
                                     for(let k = 0; k < fieldVal.length; k++){
                                         let retUrl = await this.changeOriginKey(guid, fieldVal[k].url);
                                         contentItem.fields[fieldName][k].url = retUrl;
                                     }
                                 } else {
                                     if('url' in fieldVal){
                                         let retUrl = await this.changeOriginKey(guid, fieldVal.url);
                                         contentItem.fields[fieldName].url = retUrl;
                                     }
                                 }
                             } 
                         }
                         else 
                         {
                             if(typeof fieldVal === 'object'){
                                 if('fulllist' in fieldVal){
                                     delete fieldVal.fulllist;
                                     if(field.type === 'PhotoGallery'){
                                         let oldGalleryId = fieldVal.galleryid;
                                         if(this.processedGalleries[oldGalleryId]){
                                             contentItem.fields[fieldName] = this.processedGalleries[oldGalleryId].toString();
                                         }
                                         else{
                                             contentItem.fields[fieldName] = fieldVal.galleryid.toString();
                                         }
                                     }
                                 }
                             }
                         }
                    }
                    
                }

                if(contentItem){
                    if(!this.skippedContentItems[contentItem.contentID]){
                        const oldContentId = contentItem.contentID; 
                        console.log(`Processed old Content ${oldContentId}`);
                        contentItem.contentID = -1;
                        
                        let createdContentItemId = await apiClient.contentMethods.saveContentItem(contentItem, guid, locale);

                        if(createdContentItemId[0]){
                            if(createdContentItemId[0] > 0){
                                this.processedContentIds[oldContentId] = createdContentItemId[0];
                            }
                            else{
                                this.skippedContentItems[oldContentId] = contentItem.properties.referenceName;
                                // console.log(`Unable to create content for old contentId: ${oldContentId}`);
                            }
                        }
                        contentItem[i] = null;
                    }
               
                }
            }
        } while(contentItems.filter(c => c !== null).length !==0)
        
   }
    

    async changeOriginKey(guid: string, url: string){
        let apiClient = new mgmtApi.ApiClient(this._options);

        let defaultContainer = await apiClient.assetMethods.getDefaultContainer(guid);

        let filePath = this.getFilePath(url);
        filePath = filePath.replace(/%20/g, " ");

        let edgeUrl = `${defaultContainer.edgeUrl}/${filePath}`;

        try{
            let existingMedia = await apiClient.assetMethods.getAssetByUrl(edgeUrl, guid);
            return edgeUrl;
        } catch{
            return url;
        }
    }

     camelize(str: string) {
        return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(word, index) {
          return index === 0 ? word.toLowerCase() : word.toUpperCase();
        }).replace(/\s+/g, '');
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
                const oldGalleryId = gallery.mediaGroupingID;
                try{
                    let existingGallery = await apiClient.assetMethods.getGalleryByName(guid, gallery.name);
                    if(existingGallery){
                        gallery.mediaGroupingID = existingGallery.mediaGroupingID;
                    }
                    else{
                        gallery.mediaGroupingID = 0;
                    }
                 let createdGallery = await apiClient.assetMethods.saveGallery(guid, gallery);
                 this.processedGalleries[oldGalleryId] = createdGallery.mediaGroupingID;
                } catch {
                    gallery.mediaGroupingID = 0;
                    let createdGallery = await apiClient.assetMethods.saveGallery(guid, gallery);
                    this.processedGalleries[oldGalleryId] = createdGallery.mediaGroupingID;
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
            await this.pushGalleries(guid);
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
            await this.pushContainers(containers, containerModels, guid);

            let contentItems = await this.createBaseContentItems(guid, locale);

            let linkedContentItems = await this.getLinkedContent(guid, contentItems);

            let normalContentItems = await this.getNormalContent(guid, contentItems, linkedContentItems);
          /*  let contentItems = this.createAllContent();

            let linkedContentItems = this.createLinkedContent();

            let normalContentItems = this.createNonLinkedContent();*/
            await this.pusNormalContentItems(guid, locale, normalContentItems);

            await this.pushLinkedContentItems(guid, locale, linkedContentItems);
    
        } catch {

        }
   }
}