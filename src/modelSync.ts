import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';
import * as cliProgress from 'cli-progress';
import { push } from './push';

export class modelSync{
    _options : mgmtApi.Options;
    _multibar: cliProgress.MultiBar;

    constructor(options: mgmtApi.Options, multibar: cliProgress.MultiBar){
        this._options = options;
        this._multibar = multibar;
    }

    createModelObject(){
        let fileOperation = new fileOperations();
        try{
            
            let files = fileOperation.readDirectory('models');

            let models : mgmtApi.Model[] = [];

            for(let i = 0; i < files.length; i++){
                let model = JSON.parse(files[i]) as mgmtApi.Model;
                models.push(model);
            }
            return models;
        } catch {
            fileOperation.appendLogFile(`\n No Models were found in the source Instance to process.`);
            return null;
        }
    }

    async logContainers(filterModel?: mgmtApi.Model[]){
        let fileOperation = new fileOperations();
        try{
            let models: mgmtApi.Model[] = [];
            if(filterModel.length > 0){
                models = filterModel;
            }
            else{
                models = this.createModelObject();
            }
            fileOperation.createLogFile('logs', 'instancelog');
            let containerRefs : string [] = []
            for(let i = 0; i < models.length; i++){
                let sourceModel = models[i];

                for(let j = 0; j < sourceModel.fields.length; j++){
                    let field = sourceModel.fields[j];
                    if(field){
                        if(field.type === 'Content'){
                            if(field.settings.hasOwnProperty("ContentView")){
                                if(field.settings['ContentView']){
                                    let containerRef = field.settings['ContentView'];
                                    if(!containerRefs.includes(containerRef)){
                                       // fileOperation.appendLogFile(`\n Please ensure the content container with reference name ${containerRef} exists.`);
                                       containerRefs.push(containerRef);
                                    }
                                    
                                }
                            }
                        }
                    }
                }
            }
            fileOperation.exportFiles('logs','containerReferenceNames', containerRefs);
            return containerRefs;
        } catch{
        }
    }

    async syncProcess(guid: string, locale: string, filterModels?: mgmtApi.Model[], filterTemplates?: mgmtApi.PageModel[]){
        let pushOperation = new push(this._options, this._multibar);
        let fileOperation = new fileOperations();
        let models: mgmtApi.Model[] = [];
        let processedModels: mgmtApi.Model[] = [];
        if(filterModels.length > 0){
            models = filterModels;
        }
        else{
            models = pushOperation.createBaseModels();
        }
        if(models){
            let linkedModels = await pushOperation.getLinkedModels(models);
            let normalModels = await pushOperation.getNormalModels(models, linkedModels);
            const progressBar3 = this._multibar.create(normalModels.length, 0);
                progressBar3.update(0, {name : 'Models: Non Linked'});
                let index = 1;
                for(let i = 0; i < normalModels.length; i++){
                    let normalModel = normalModels[i];
                    let model = await pushOperation.pushNormalModels(normalModel, guid);
                    processedModels.push(model);
                    progressBar3.update(index);
                    index += 1;
                }
            let processedLinkedModels =  await pushOperation.pushLinkedModels(linkedModels, guid);
            const finalModels: mgmtApi.Model[] = [...processedModels, ...processedLinkedModels];
            fileOperation.exportFiles('models','createdModels', finalModels);
            let pageTemplates: mgmtApi.PageModel[] = [];

            
            if(filterTemplates.length > 0){
                for(let i = 0; i < filterTemplates.length; i++){
                    let filterTemplate = filterTemplates[i];
                    //pageTemplateID
                    if(fileOperation.checkFileExists(`.agility-files/templates/${filterTemplate.pageTemplateID}.json`)){
                        let file = fileOperation.readFile(`.agility-files/templates/${filterTemplate.pageTemplateID}.json`);
                        const template = JSON.parse(file) as mgmtApi.PageModel;
                        pageTemplates.push(template);
                    }
                }
            }
            else{
                pageTemplates = await pushOperation.createBaseTemplates();
            }
            if(pageTemplates){
               let createdTemplates =  await pushOperation.pushTemplates(pageTemplates, guid, locale);
               fileOperation.exportFiles('templates','createdTemplates', createdTemplates);
            }
        }

        this._multibar.stop();
    }

    async validateAndCreateFilterModels(referenceNames: string[], guid: string){
        let pushOperation = new push(this._options, this._multibar);
        let fileOperation = new fileOperations();
        const progressBar = this._multibar.create(referenceNames.length, 0);
        let models: mgmtApi.Model[] = [];
        progressBar.update(0, {name : 'Validating and Creating Model Object for model filter.'});
        let index = 1;
        for(let i = 0; i < referenceNames.length; i++){
            let referenceName = referenceNames[i];
            let model = await pushOperation.createModelsForFilter(referenceName, guid);
            if(model){
                models.push(model);
            }
            else{
                fileOperation.appendLogFile(`\n Unable to find model for referenceName: ${referenceName}`);
            }
            progressBar.update(index);
            index += 1;
        }
        this._multibar.stop();
        return models;
    }

    async validateAndCreateFilterTemplates(pageTemplateNames: string[], guid: string, locale: string){
        let pushOperation = new push(this._options, this._multibar);
        let fileOperation = new fileOperations();
        const progressBar2 = this._multibar.create(pageTemplateNames.length, 0);
        let templates: mgmtApi.PageModel[] = [];
        progressBar2.update(0, {name : 'Validating and Creating Page Template Object for model filter.'});
        let index = 1;
        for(let i = 0; i < pageTemplateNames.length; i++){
            let pageTemplateName = pageTemplateNames[i];
            let template = await pushOperation.createTempllateForFilter(pageTemplateName, guid, locale);
            if(template){
                templates.push(template);
            }
            else{
                fileOperation.appendLogFile(`\n Unable to find page template for template name: ${pageTemplateName}`);
            }
            progressBar2.update(index);
            index += 1;
        }
        this._multibar.stop();
        return templates;
    }

    async dryRun(guid: string, locale: string, targetGuid: string, filterModels?: mgmtApi.Model[], filterTemplates?: mgmtApi.PageModel[]){
        let pushOperation = new push(this._options, this._multibar);
        let fileOperation = new fileOperations();
        let models: mgmtApi.Model[] = [];
        if(filterModels.length > 0){
            models = filterModels;
        }
        else{
            models = pushOperation.createBaseModels();
        }
        const modelDifferences: any = [] = [];
        //let dryRunModels: mgmtApi.Model[] = []
        if(models){
            let linkedModels = await pushOperation.getLinkedModels(models);
            let normalModels = await pushOperation.getNormalModels(models, linkedModels);
            const progressBar4 = this._multibar.create(normalModels.length, 0);
            
            progressBar4.update(0, {name : 'Models Dry Run: Non Linked'});
            let index = 1;
            for(let i = 0; i < normalModels.length; i++){
                let normalModel = normalModels[i];
                let difference =  await pushOperation.validateDryRun(normalModel, targetGuid);
                if(difference){
                    if (Object.keys(difference).length > 0){
                        modelDifferences.push(difference);
                    }
                }
                progressBar4.update(index);
                index += 1;
            }
             const progressBar5 = this._multibar.create(linkedModels.length, 0);
             progressBar5.update(0, {name : 'Models Dry Run: Linked'});
             index = 1;
            for(let i = 0; i < linkedModels.length; i++){
                let linkedModel = linkedModels[i];
                let difference = await pushOperation.validateDryRunLinkedModels(linkedModel, targetGuid);
                if(difference){
                    if (Object.keys(difference).length > 0){
                        modelDifferences.push(difference);
                    }
                }
                progressBar5.update(index);
                index += 1;
            }
            let pageTemplates: mgmtApi.PageModel[] = []
            if(filterTemplates.length > 0){
                for(let i = 0; i < filterTemplates.length; i++){
                    let filterTemplate = filterTemplates[i];
                    //pageTemplateID
                    if(fileOperation.checkFileExists(`.agility-files/templates/${filterTemplate.pageTemplateID}.json`)){
                        let file = fileOperation.readFile(`.agility-files/templates/${filterTemplate.pageTemplateID}.json`);
                        const template = JSON.parse(file) as mgmtApi.PageModel;
                        pageTemplates.push(template);
                    }
                }
            }
            else{
                pageTemplates = await pushOperation.createBaseTemplates();
            }
            
            const progressBar6 = this._multibar.create(pageTemplates.length, 0);
            progressBar6.update(0, {name : 'Templates Dry Run'});
            index = 1;
            if(pageTemplates){
                for(let i = 0; i < pageTemplates.length; i++){
                    let template = pageTemplates[i];
                    let difference = await pushOperation.validateDryRunTemplates(template, guid, locale);
                    if(difference){
                        if (Object.keys(difference).length > 0){
                            modelDifferences.push(difference);
                        }
                    }
                    progressBar6.update(index);
                    index += 1;
                }
            }
        }
        fileOperation.exportFiles('models-sync','modelsDryRun', modelDifferences);
        this._multibar.stop();
    }
}