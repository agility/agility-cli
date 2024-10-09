#!/usr/bin/env node

import * as yargs from "yargs";
import { Auth } from "./auth";
import { fileOperations } from './fileOperations';
import { sync } from "./sync";
import {asset} from './asset';
import {container} from './container';
import { model } from "./model";
import { push } from "./push";
import { clone } from "./clone";
import * as mgmtApi  from '@agility/management-sdk';
const FormData = require('form-data');
const cliProgress = require('cli-progress');
const colors = require('ansi-colors');
const inquirer = require('inquirer');
import { createMultibar } from './multibar';
import { modelSync } from './modelSync';
import { FilterData, ModelFilter } from "./models/modelFilter";

let auth: Auth
let options: mgmtApi.Options;

yargs.version('0.0.1_beta');

yargs.command({
    command: 'login',
    describe: 'Login to Agility.',
    handler: async function() {
        auth = new Auth();
        let code = await auth.authorize();
    }
})

yargs.command({
    command: 'sync-models',
    describe: 'Sync Models locally.',
    builder: {
        sourceGuid: {
            describe: 'Provide the source guid to pull models from your source instance.',
            demandOption: false,
            type: 'string'
        },
        targetGuid: {
            describe: 'Provide the target guid to push models to your destination instance.',
            demandOption: false,
            type: 'string'
        },
        pull: {
            describe: 'Provide the value as true or false to perform an instance pull to sync models.',
            demandOption: false,
            type: 'boolean'
        },
        folder: {
            describe: 'Specify the path of the folder where models and template folders are present for model sync. If no value provided, the default folder will be .agility-files.',
            demandOption: false,
            type: 'string'
        },
        dryRun: {
            describe: 'Provide the value as true or false to perform a dry run for model sync.',
            demandOption: false,
            type: 'boolean'
        },
        filter: {
            describe: 'Specify the path of the filter file. Ex: C:\Agility\myFilter.json.',
            demandOption: false,
            type: 'string'
        }
    },
    handler: async function(argv) {
        auth = new Auth();
        let code = new fileOperations();
        let codeFileStatus = code.codeFileExists();
        if(codeFileStatus){
            let data = JSON.parse(code.readTempFile('code.json'));
            
            const form = new FormData();
            form.append('cliCode', data.code);
            let guid: string = argv.sourceGuid as string;
            let targetGuid: string = argv.targetGuid as string;
            let instancePull: boolean = argv.pull as boolean;
            let dryRun: boolean = argv.dryRun as boolean;
            let filterSync: string = argv.filter as string;
            let folder: string = argv.folder as string;

            if(guid === undefined && targetGuid === undefined){
                console.log(colors.red('Please provide a source guid or target guid to perform the operation.'));
                return;
            }

            let authGuid: string = '';

            if(guid !== undefined){
                authGuid = guid;
            }
            else{
                authGuid = targetGuid;
            }
            
            let token = await auth.cliPoll(form, authGuid);

            let models: mgmtApi.Model[] = [];

            let templates: mgmtApi.PageModel[] = [];

            let multibar = createMultibar({name: 'Sync Models'});

            options = new mgmtApi.Options();
            options.token = token.access_token;
            
            if(dryRun === undefined){
                dryRun = false;
            }
            if(instancePull === undefined){
                instancePull = false;
            }
            if(filterSync === undefined){
                filterSync = '';
            }
            if(folder === undefined){
                folder = '.agility-files';
            }
            let user = await auth.getUser(authGuid, token.access_token);

            if(!instancePull){
                if(!code.checkBaseFolderExists(folder)){
                    console.log(colors.red(`To proceed with the command the folder ${folder} should exist.`));
                    return;
                }
            }

            if(user){
                if(guid === undefined){
                    guid = '';
                }
                if(targetGuid === undefined){
                    targetGuid = '';
                }
                let sourcePermitted = await auth.checkUserRole(guid, token.access_token);
                let targetPermitted = await auth.checkUserRole(targetGuid, token.access_token);
                if(guid === ''){
                    sourcePermitted = true;
                }
                if(targetGuid === ''){
                    targetPermitted = true;
                }
                let modelPush = new modelSync(options, multibar);
                if(sourcePermitted && targetPermitted){

                    if(instancePull){
                        if(guid === ''){
                            console.log(colors.red('Please provide the sourceGuid of the instance for pull operation.'));
                            return;
                        }
                        console.log(colors.yellow('Pulling models from your instance. Please wait...'));
                        code.cleanup(folder);
                        code.createBaseFolder(folder);
                        code.createLogFile('logs', 'instancelog', folder);
                        let modelPull = new model(options, multibar);

                        let templatesPull = new sync(guid, 'syncKey', 'locale', 'channel', options, multibar);
                
                        await modelPull.getModels(guid, folder);
                        await templatesPull.getPageTemplates(folder);
                        multibar.stop();

                        if(targetGuid === ''){
                            return;
                        }
                    }
                    if(filterSync){
                        if(!code.checkFileExists(filterSync)){
                            console.log(colors.red(`Please check the filter file is present at ${filterSync}.`));
                            return;
                        }
                        else{
                            let file = code.readFile(`${filterSync}`);
                            const jsonData: FilterData = JSON.parse(file);
                            const modelFilter = new ModelFilter(jsonData);
                            models = await modelPush.validateAndCreateFilterModels(modelFilter.filter.Models, folder);
                            templates = await modelPush.validateAndCreateFilterTemplates(modelFilter.filter.Templates, 'locale', folder);
                        }
                    }
                    if(dryRun){
                        if(targetGuid === ''){
                            console.log(colors.red('Please provide the targetGuid parameter a valid instance guid to perform the dry run operation.'));
                            return;
                        }
                        console.log(colors.yellow('Running a dry run on models, please wait...'));
                        if(code.folderExists('models-sync')){
                            code.cleanup(`${folder}/models-sync`);
                        }

                        let containerRefs =  await modelPush.logContainers(models);
                        if(containerRefs){
                            if(containerRefs.length > 0){
                                console.log(colors.yellow('Please review the content containers in the containerReferenceNames.json file in the logs folder. They should be present in the target instance.'));
                            }
                        }
                        await modelPush.dryRun(guid, 'locale', targetGuid, models, templates, folder);
                    }
                    else{
                        if(targetGuid === ''){
                            console.log(colors.red('Please provide the targetGuid parameter a valid instance guid to perform the model sync operation.'));
                            return;
                        }
                        console.log(colors.yellow('Syncing Models from your instance...'));
                        multibar = createMultibar({name: 'Sync Models'});
                        let containerRefs =  await modelPush.logContainers(models);
                        if(containerRefs){
                            if(containerRefs.length > 0){
                                console.log(colors.yellow('Please review the content containers in the containerReferenceNames.json file in the logs folder. They should be present in the target instance.'));
                            }
                        }
                        await modelPush.syncProcess(targetGuid, 'locale', models, templates, folder);
                    }
                    
                }
                else{
                    console.log(colors.red('You do not have the required permissions to perform the model sync operation.'));
                }
                
            }
            else{
                console.log(colors.red('Please authenticate first to perform the sync models operation.'));
            }

           
        }
        else{
            console.log(colors.red('Please authenticate first to perform the sync models operation.'));
        }
    }
})

yargs.command({
    command: 'model-pull',
    describe: 'Pull models locally.',
    builder: {
        sourceGuid: {
            describe: 'Provide the source guid to pull models from your source instance.',
            demandOption: true,
            type: 'string'
        },
        folder: {
            describe: 'Specify the path of the folder where models and template folders are present for model pull.',
            demandOption: false,
            type: 'string'
        }
    },
    handler: async function(argv) {
        auth = new Auth();
        let code = new fileOperations();
        let codeFileStatus = code.codeFileExists();
        if(codeFileStatus){
            let data = JSON.parse(code.readTempFile('code.json'));
            
            const form = new FormData();
            form.append('cliCode', data.code);
            let guid: string = argv.sourceGuid as string;
            let folder: string = argv.folder as string;
            let token = await auth.cliPoll(form, guid);
            let multibar = createMultibar({name: 'Model Pull'});

            options = new mgmtApi.Options();
            options.token = token.access_token;

            if(folder === undefined){
                folder = '.agility-files';
            }

            let user = await auth.getUser(guid, token.access_token);

            if(user){
                let sourcePermitted = await auth.checkUserRole(guid, token.access_token);

                if(sourcePermitted){
                    code.cleanup(folder);
                    code.createBaseFolder(folder);
                    code.createLogFile('logs', 'instancelog', folder);
                    console.log(colors.yellow('Pulling Models from your instance...'));
                    let modelPull = new model(options, multibar);

                    let templatesPull = new sync(guid, 'syncKey', 'locale', 'channel', options, multibar);
            
                    await modelPull.getModels(guid, folder);
                    await templatesPull.getPageTemplates(folder);
                    multibar.stop();

                }
                else{
                    console.log(colors.red('You do not have the required permissions to perform the model pull operation.'));
                }
                
            }
            else{
                console.log(colors.red('Please authenticate first to perform the pull operation.'));
            }

           
        }
        else{
            console.log(colors.red('Please authenticate first to perform the pull operation.'));
        }
    }
})

yargs.command({
    command: 'pull',
    describe: 'Pull your Instance',
    builder: {
        guid: {
            describe: 'Provide guid to pull your instance.',
            demandOption: true,
            type: 'string'
        },
        locale: {
            describe: 'Provide the locale to pull your instance.',
            demandOption: true,
            type: 'string'
        },
        channel: {
            describe: 'Provide the channel to pull your instance.',
            demandOption: true,
            type: 'string'
        },
        baseUrl: {
            describe: 'Specify the base url of your instance.',
            demandOption: false,
            type: 'string'
        }
    },
    handler: async function(argv) {
        auth = new Auth();
        let code = new fileOperations();
        let codeFileStatus = code.codeFileExists();
        if(codeFileStatus){
            code.cleanup('.agility-files');
            
            let data = JSON.parse(code.readTempFile('code.json'));
            
            const form = new FormData();
            form.append('cliCode', data.code);
            let guid: string = argv.guid as string;
            let locale: string = argv.locale as string;
            let channel: string = argv.channel as string;
            let userBaseUrl: string = argv.baseUrl as string;

            let token = await auth.cliPoll(form, guid);

            let multibar = createMultibar({name: 'Pull'});

            options = new mgmtApi.Options();
            options.token = token.access_token;

            let user = await auth.getUser(guid, token.access_token);

            if(user){
                let permitted = await auth.checkUserRole(guid, token.access_token);
                if(permitted){
                    let syncKey = await auth.getPreviewKey(guid, userBaseUrl);
                    if(syncKey){
                        console.log(colors.yellow('Pulling your instance...'));
                        let contentPageSync = new sync(guid, syncKey, locale, channel, options, multibar);
        
                        await contentPageSync.sync();
            
                        let assetsSync = new asset(options, multibar);
            
                        await assetsSync.getAssets(guid);
            
                        let containerSync = new container(options, multibar);
            
                        await containerSync.getContainers(guid);
            
                        let modelSync = new model(options, multibar);
            
                        await modelSync.getModels(guid);
                    }
                    else{
                        console.log(colors.red('Either the preview key is not present in your instance or you need to specify the baseUrl parameter as an input based on the location. Please refer the docs for the Base Url.'));
                    }
                }
                else{
                    console.log(colors.red('You do not have required permissions on the instance to perform the pull operation.'));
                }
                
            }
            else{
                console.log(colors.red('Please authenticate first to perform the pull operation.'));
            }
           
        }
        else{
            console.log(colors.red('Please authenticate first to perform the pull operation.'));
        }
    }
})

yargs.command({
    command: 'push',
    describe: 'Push your Instance.',
    builder: {
        guid: {
            describe: 'Provide the target guid to push your instance.',
            demandOption: true,
            type: 'string'
        },
        locale: {
            describe: 'Provide the locale to push your instance.',
            demandOption: true,
            type: 'string'
        }
    },
    handler: async function(argv) {
       let guid: string = argv.guid as string;
       let locale: string = argv.locale as string;
       let code = new fileOperations();
       auth = new Auth();
       let codeFileStatus = code.codeFileExists();

       if(codeFileStatus){
        let agilityFolder = code.cliFolderExists();
        if(agilityFolder){
            let data = JSON.parse(code.readTempFile('code.json'));

            let multibar = createMultibar({name: 'Push'});
            
            const form = new FormData();
            form.append('cliCode', data.code);

            let token = await auth.cliPoll(form, guid);

            options = new mgmtApi.Options();
            options.token = token.access_token;

            let user = await auth.getUser(guid, token.access_token);
            if(user){
                let permitted = await auth.checkUserRole(guid, token.access_token);
                if(permitted){
                    console.log(colors.yellow('Pushing your instance...'));
                    let pushSync = new push(options, multibar);

                /*
                TODO: Inquirer for Content and Pages.
                    let modelSync = new model(options, multibar);
                    let existingModels = await modelSync.validateModels(guid);

                    let containerSync = new container(options, multibar);
                    let existingContainers = await containerSync.validateContainers(guid);

                    let duplicates: string[] = [];

                    if(existingModels){
                            for(let i = 0; i < existingModels.length; i++){
                                duplicates.push(existingModels[i]);
                            }
                    }
                    if(existingContainers){
                            for(let i = 0; i < existingContainers.length; i++){
                                duplicates.push(existingContainers[i]);
                            }
                    }

                
                    if(duplicates.length > 0){
                    await inquirer.prompt([
                            {
                                type: 'confirm',
                                name: 'duplicates',
                                message: 'Found duplicate(s) Models and Containers. Overwrite the models and containers? '
                            }
                        ]).then((answers: { duplicates: boolean; })=> {

                            if(!answers.duplicates){
                                    if(existingContainers)
                                        containerSync.deleteContainerFiles(existingContainers);
                                    if(existingModels)
                                        modelSync.deleteModelFiles(existingModels);
                                }
                        })
                    }*/
                     await pushSync.pushInstance(guid, locale);
                }
                else{
                    console.log(colors.red('You do not have required permissions on the instance to perform the push operation.'));
                }
                
            } else{
                console.log(colors.red('Please authenticate first to perform the push operation.'));
            }
            
        }
        else{
            console.log(colors.red('Please pull an instance first to push an instance.'));
        }
        
       }
       else {
        console.log(colors.red('Please authenticate first to perform the push operation.'));
       }
    }
})

yargs.command({
    command: 'clone',
    describe: 'Clone your Instance.',
    builder: {
        sourceGuid: {
            describe: 'Provide the source guid to clone your instance.',
            demandOption: true,
            type: 'string'
        },
        targetGuid: {
            describe: 'Provide the target guid to clone your instance.',
            demandOption: true,
            type: 'string'
        },
        locale: {
            describe: 'Provide the locale to clone your instance.',
            demandOption: true,
            type: 'string'
        },
        channel: {
            describe: 'Provide the channel to pull your instance.',
            demandOption: true,
            type: 'string'
        }
    },
    handler: async function(argv) {
       let sourceGuid: string = argv.sourceGuid as string;
       let targetGuid: string = argv.targetGuid as string;
       let locale: string = argv.locale as string;
       let channel: string = argv.channel as string;
       let code = new fileOperations();
       auth = new Auth();
       let codeFileStatus = code.codeFileExists();
       if(codeFileStatus){
        code.cleanup('.agility-files');
        let data = JSON.parse(code.readTempFile('code.json'));
        const form = new FormData();
        form.append('cliCode', data.code);

        let token = await auth.cliPoll(form, sourceGuid);

        let user = await auth.getUser(sourceGuid, token.access_token);

        if(user){

            let sourcePermitted = await auth.checkUserRole(sourceGuid, token.access_token);
            let targetPermitted = await auth.checkUserRole(targetGuid, token.access_token);

            if(sourcePermitted && targetPermitted){
                console.log(colors.yellow('Cloning your instance...'));
                let cloneSync = new clone(sourceGuid, targetGuid, locale, channel);

                console.log(colors.yellow('Pulling your instance...'));
                await cloneSync.pull();

                let agilityFolder = code.cliFolderExists();
                if(agilityFolder){
                    console.log(colors.yellow('Pushing your instance...'));
                    await cloneSync.push();
                }
                else{
                    console.log(colors.red('Please pull an instance first to push an instance.'));
                }
            }
            else{
                console.log(colors.red('You do not have the required permissions to perform the clone operation.'));
            }
        }
        else{
            console.log(colors.red('Please authenticate first to perform the clone operation.'));
        }
        
       }
       else {
        console.log(colors.red('Please authenticate first to perform the clone operation.'));
       }
    }
})


yargs.parse();