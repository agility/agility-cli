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
            demandOption: true,
            type: 'string'
        },
        targetGuid: {
            describe: 'Provide the target guid to push models to your destination instance.',
            demandOption: true,
            type: 'string'
        },
        locale: {
            describe: 'Provide the locale to sync templates to your destination instance.',
            demandOption: true,
            type: 'string'
        },
        instancePull: {
            describe: 'Provide the value as true or false to perform an instance pull to sync models.',
            demandOption: true,
            type: 'boolean'
        },
        dryRun: {
            describe: 'Provide the value as true or false to perform a dry run for model sync.',
            demandOption: false,
            type: 'boolean'
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
            let locale: string = argv.locale as string; 
            let instancePull: boolean = argv.instancePull as boolean;
            let dryRun: boolean = argv.dryRun as boolean;
            let token = await auth.cliPoll(form, guid);

            let multibar = createMultibar({name: 'Sync Models'});

            options = new mgmtApi.Options();
            options.token = token.access_token;
            if(dryRun === undefined){
                dryRun = false;
            }
            let user = await auth.getUser(guid, token.access_token);

            if(user){
                let sourcePermitted = await auth.checkUserRole(guid, token.access_token);
                let targetPermitted = await auth.checkUserRole(targetGuid, token.access_token);

                let modelPush = new modelSync(options, multibar);
                if(sourcePermitted && targetPermitted){
                    if(dryRun){
                        console.log(colors.yellow('Running a dry run on models, please wait...'));
                        if(code.folderExists('models/json')){
                            code.cleanup('.agility-files/models/json');
                        }

                        let containerRefs =  await modelPush.logContainers();
                        if(containerRefs){
                            if(containerRefs.length > 0){
                                await inquirer.prompt([
                                    {
                                        type: 'confirm',
                                        name: 'containers',
                                        message: 'Please review the content containers in the containerReferenceNames.json file in the logs folder. They should be present in the target instance. '
                                    }
                                ]).then(async (answers: { containers: boolean; })=> {
                
                                    if(answers.containers){
                                    //    multibar = createMultibar({name: 'Sync Models'});
                                        await modelPush.dryRun(guid, locale, targetGuid);
                                        }
                                })
                            }
                        }
                       
                    }
                    else{
                        console.log(colors.yellow('Syncing Models from your instance...'));
                        if(instancePull){
                            code.cleanup('.agility-files');
                            code.createBaseFolder();
                            let modelPull = new model(options, multibar);
    
                            let templatesPull = new sync(guid, 'syncKey', 'locale', 'channel', options, multibar);
                    
                            await modelPull.getModels(guid);
                            await templatesPull.getPageTemplates();
                            multibar.stop();
                        }
                        
    
                        let containerRefs =  await modelPush.logContainers();
                        if(containerRefs){
                            if(containerRefs.length > 0){
                                await inquirer.prompt([
                                    {
                                        type: 'confirm',
                                        name: 'containers',
                                        message: 'Please review the content containers in the containerReferenceNames.json file in the logs folder. They should be present in the target instance. '
                                    }
                                ]).then(async (answers: { containers: boolean; })=> {
                
                                    if(answers.containers){
                                        multibar = createMultibar({name: 'Sync Models'});
                                        await modelPush.syncProcess(targetGuid, locale);
                                        }
                                })
                            }
                        }
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
        locale: {
            describe: 'Provide the locale to sync templates to your destination instance.',
            demandOption: true,
            type: 'string'
        }
    },
    handler: async function(argv) {
        auth = new Auth();
        let code = new fileOperations();
        let codeFileStatus = code.codeFileExists();
        if(codeFileStatus){
            code.cleanup('.agility-files');
            code.createBaseFolder();
            let data = JSON.parse(code.readTempFile('code.json'));
            
            const form = new FormData();
            form.append('cliCode', data.code);
            let guid: string = argv.sourceGuid as string;
            let locale: string = argv.locale as string; 
            let token = await auth.cliPoll(form, guid);
            let multibar = createMultibar({name: 'Model Pull'});

            options = new mgmtApi.Options();
            options.token = token.access_token;

            let user = await auth.getUser(guid, token.access_token);

            if(user){
                let sourcePermitted = await auth.checkUserRole(guid, token.access_token);

                if(sourcePermitted){
                    console.log(colors.yellow('Pulling Models from your instance...'));
                    let modelPull = new model(options, multibar);

                    let templatesPull = new sync(guid, 'syncKey', 'locale', 'channel', options, multibar);
            
                    await modelPull.getModels(guid);
                    await templatesPull.getPageTemplates();
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

            let token = await auth.cliPoll(form, guid);

            let multibar = createMultibar({name: 'Pull'});

            options = new mgmtApi.Options();
            options.token = token.access_token;

            let user = await auth.getUser(guid, token.access_token);

            if(user){
                let permitted = await auth.checkUserRole(guid, token.access_token);
                if(permitted){
                    let syncKey = await auth.getPreviewKey(guid);
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
                        console.log(colors.red('Please add a preview key to your instance to perform pull operation.'));
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