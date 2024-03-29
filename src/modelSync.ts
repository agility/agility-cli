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

    async logContainers(){
        let fileOperation = new fileOperations();
        try{
            let models = this.createModelObject();
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
                                    fileOperation.appendLogFile(`\n Please ensure the content container with reference name ${containerRef} exists.`);
                                    containerRefs.push(containerRef);
                                }
                            }
                        }
                    }
                }
            }
            return containerRefs;
        } catch{
        }
    }

    async syncProcess(guid: string, locale: string){
        let pushOperation = new push(this._options, this._multibar);

        let models = pushOperation.createBaseModels();
        if(models){
            let linkedModels = await pushOperation.getLinkedModels(models);
            let normalModels = await pushOperation.getNormalModels(models, linkedModels);
            const progressBar3 = this._multibar.create(normalModels.length, 0);
                progressBar3.update(0, {name : 'Models: Non Linked'});
                let index = 1;
                for(let i = 0; i < normalModels.length; i++){
                    let normalModel = normalModels[i];
                    await pushOperation.pushNormalModels(normalModel, guid);
                    progressBar3.update(index);
                    index += 1;
                }
            await pushOperation.pushLinkedModels(linkedModels, guid);
            let pageTemplates = await pushOperation.createBaseTemplates();
            if(pageTemplates){
                await pushOperation.pushTemplates(pageTemplates, guid, locale);
            }
        }

        this._multibar.stop();
    }
}