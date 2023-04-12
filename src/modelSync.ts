import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';


export class modelSync{
    _options : mgmtApi.Options;

    constructor(options: mgmtApi.Options){
        this._options = options;
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

    async logContainers(guid: string){
        let apiClient = new mgmtApi.ApiClient(this._options);
        let fileOperation = new fileOperations();
        try{
            let models = this.createModelObject();
            
            for(let i = 0; i < models.length; i++){
                let sourceModel = models[i];

                for(let j = 0; j < sourceModel.fields.length; j++){
                    let field = sourceModel.fields[j];
                    if(field){
                        if(field.type === 'Content'){
                            //if(file)
                        }
                    }
                }
                // sourceModel.fields.flat().find((field) => {
                //     if(field.type === 'Content'){

                //     }
                // })              

                // let model = await apiClient.modelMethods.getModelByReferenceName(sourceModel.referenceName, guid);
                // if(model){
                //     let containers = await apiClient.containerMethods.getContainersByModel(model.id, guid);
                //     if(containers){
                //         for(let j = 0; j < containers.length; j++){
                //             fileOperation.appendLogFile(`\n Please ensure the content container with reference name ${containers[j].referenceName} exists.`);
                //         }
                        
                //     }
                // }
            }

        } catch{

        }
    }
}