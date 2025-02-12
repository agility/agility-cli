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
import { create } from "domain";

let auth: Auth
let options: mgmtApi.Options;

yargs.version('0.0.1_beta').demand(1).exitProcess(false);



// async function promptUser() {
//     const answers = await inquirer.prompt([
//         {
//             type: 'list',
//             name: 'option',
//             message: 'What would you like to do today?:',
//             choices: ['Download Models', 'Download Content', 'Sync Models', 'Sync Content', 'Push Content', 'Push Models', 'Clone Instance', 'Exit']
//         }
//     ]);
//     console.log(`You selected: ${answers.option}`);
// }

console.log(colors.yellow('Welcome to Agility CLI.'));



yargs.command({
    command: '$0',
    describe: 'Default command',
    handler: async function() {

        
        let auth = new Auth();
        let isAuthenticated = false;

        let code = new fileOperations();
        let codeFileStatus = code.codeFileExists();

        if (!codeFileStatus) {
            console.log(colors.red('Launching authentication in browser...'));
            auth.authorize();
        }

        const interval = setInterval(() => {
            let code = new fileOperations();
            if (code.codeFileExists()) {
                isAuthenticated = true;
                console.log(colors.green('You have successfuly authenticated.'));
                clearInterval(interval);
                mainMenu();
            }
        }, 1000); // Check every second

       
        async function mainMenu() {
            const answers = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'option',
                            message: 'What would you like to do today?:',
                            choices: ['Pull files from an instance', 
                                'Push files to an instance', 
                                'Sync models', 
                                'Clone instance to another instance', 
                                'List instances',
                                // 'Create new instance',
                                'Logout']
                        }
            ]).then((answers: { option: string }) => {
                switch (answers.option) {
                    case 'Pull files from an instance':
                        pullFiles();
                        break;
                    case 'Push files to an instance':
                        pushFiles();
                        break;
                    case 'Sync models':
                        syncModels();
                        break;
                    case 'Clone instance to another instance':
                        cloneInstance();
                        break;
                    case 'List instances':
                        listInstances();
                        break;
                    case 'Create new instance':
                        createNewInstance();
                        break;
                    case 'Logout':
                        logout();
                        break;
                    default:
                        console.log(colors.red('Invalid option selected.'));
                }
            });

            async function listInstances() {
                console.log('Listing instances...');

                let data = JSON.parse(code.readTempFile('code.json'));
            
                const form = new FormData();
                form.append('cliCode', data.code);
                let token = await auth.cliPoll(form, null);
            let user = await auth.getUser(null, token.access_token);
            let instances = user.websiteAccess;
            console.log(instances)
                mainMenu()


                // Add your logic here
            }  
            async function createNewInstance() {
                
            }
            async function pullFiles() {
                console.log('Pulling files from an instance...');

                let data = JSON.parse(code.readTempFile('code.json'));
            
                const form = new FormData();
                form.append('cliCode', data.code);


            let token = await auth.cliPoll(form, null);
            let user = await auth.getUser(null, token.access_token);
            let instances = user.websiteAccess;

            const instanceChoices = instances.map((instance: any) => ({
                name: `${instance.websiteName} (${instance.guid})`,
                value: instance.guid
            }));

            const instanceAnswer = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'selectedInstance',
                    message: 'Select an instance:',
                    choices: instanceChoices
                }
            ]);


            const selectedInstance = instanceAnswer.selectedInstance;

            const instanceOptions = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: 'What would you like to do with this instance?',
                    choices: ['Download', 'Push to another instance.']
                }
            ]);

            switch (instanceOptions.action) {
                case 'Download Models':
                    console.log(`Downloading models from instance: ${selectedInstance}`);
                    // Add your logic to download models
                    break;
                case 'Download Content':
                    console.log(`Downloading content from instance: ${selectedInstance}`);
                    // Add your logic to download content
                    break;
                case 'Push Content':
                    console.log(`Pushing content to instance: ${selectedInstance}`);
                    // Add your logic to push content
                    break;
                case 'Push Models':
                    console.log(`Pushing models to instance: ${selectedInstance}`);
                    // Add your logic to push models
                    break;
                default:
                    console.log(colors.red('Invalid option selected.'));
            }

            // console.log(`You selected instance: ${instanceAnswer.selectedInstance}`);

            // console.log(user)

                // let token = await auth.cliPoll(form, authGuid);
                // let user = await auth.getUser(null, token.access_token);


                // user.getUser()
                // console.log(user)
              
//             options.token = token.access_token;
                // Add your logic here
            }

            async function pushFiles() {
                console.log('Pushing files to an instance...');
                // Add your logic here
            }

            async function syncModels() {
                console.log('Syncing models...');
                // Add your logic here
            }

            async function cloneInstance() {
                console.log('Cloning instance...');
                // Add your logic here
            }

            async function logout() {
                console.log('Logging out...');
                let code = new fileOperations();
                code.deleteCodeFile();
            }
        }
        
        // let code = new fileOperations();

        // if(isAuthenticated){
        //     console.log('proceeding with authenticated functions')
        // }

           
        
        // let codeFileStatus = code.codeFileExists();
        
        //     if (!codeFileStatus) {
        //         console.log(colors.red('Please authenticate first to perform any operation.'));
        //         let agilityCLI = new Auth();
        //         await agilityCLI.authorize();
        //         let isAuthorized = await agilityCLI.checkAuthorization();
        //         if (isAuthorized) {
        //             console.log(colors.green('Authorization successful.'));
        //         } else {
        //             console.log(colors.red('Authorization failed.'));
        //         }
        //     }
            
        //     if(!codeFileStatus){

        //     }


        //     if (codeFileStatus) {
        //         let data = JSON.parse(code.readTempFile('code.json'));
        //         // console.log(colors.yellow(JSON.stringify(data)));
        //     }



            //  console.log('Please provide a valid command.');
    }
});

yargs.command({
    command: 'logout',
    describe: 'Log out of Agility.',
    handler: async function() {
        let code = new fileOperations();
        code.deleteCodeFile();
    }
})  

yargs.parse();

// Prevent the script from exiting
setInterval(() => {}, 1000);

// console.log(auth)
// let code = new fileOperations();

// let codeFileStatus = code.codeFileExists();

// if(!codeFileStatus){
//     console.log(colors.red('Please authenticate first to perform any operation.'));

// }

// if(codeFileStatus){
//     let data = JSON.parse(code.readTempFile('code.json'));
//     // console.log(colors.yellow(JSON.stringify(data)));
// }

// (async () => {
//     console.log(colors.yellow('Welcome to Agility CLI.'));
//     console.log(auth);
//     let code = new fileOperations();

//     let codeFileStatus = code.codeFileExists();

//     if (!codeFileStatus) {
//         console.log(colors.red('Please authenticate first to perform any operation.'));
//         let agilityCLI = new Auth();
//         await agilityCLI.authorize();
//         let isAuthorized = await agilityCLI.checkAuthorization();
//         if (isAuthorized) {
//             console.log(colors.green('Authorization successful.'));
//         } else {
//             console.log(colors.red('Authorization failed.'));
//         }
//     }

//     if (codeFileStatus) {
//         let data = JSON.parse(code.readTempFile('code.json'));
//         // console.log(colors.yellow(JSON.stringify(data)));
//     }

//     // delete the auth code
//     // let deleteCode = code.deleteCodeFile();

//     // promptUser();

//     yargs.command({
//         command: '',
//         describe: 'Default command',
//         handler: function() {
//             console.log('Please provide a valid command.');
//         }
//     });

//     // yargs.parse();
// })();

// delete the auth code
// let deleteCode = code.deleteCodeFile();


// promptUser();

// yargs.command({
//     command: '$0',
//     describe: 'Default command',
//     handler: function() {


//         console.log('Please authenticate.');
//     }
// })

// yargs.parse('Test', async function (err, argv, output) {

//     console.log('testing the parse')
// });

// Add this line to require at least one command
// yargs.demandCommand(1, 'You need at least one command before moving on');

// Parse the arguments to keep the process running
// yargs.parse('', async function (err, argv, output) {


// });

// if (!yargs.argv._.length) {
//    console.log('Please provide a valid command.');
// }




// ...existing code...

yargs.command({
    command: 'logout',
    describe: 'Log out of Agility.',
    handler: async function() {
        let code = new fileOperations();
        code.deleteCodeFile();
    }
})  

// yargs.command({
//     command: 'login',
//     describe: 'Login to Agility.',
//     handler: async function() {
//         auth = new Auth();
//         let code = await auth.authorize();
//     }
// })

// yargs.command({
//     command: 'sync-models',
//     describe: 'Sync Models locally.',
//     builder: {
//         sourceGuid: {
//             describe: 'Provide the source guid to pull models from your source instance.',
//             demandOption: false,
//             type: 'string'
//         },
//         targetGuid: {
//             describe: 'Provide the target guid to push models to your destination instance.',
//             demandOption: false,
//             type: 'string'
//         },
//         pull: {
//             describe: 'Provide the value as true or false to perform an instance pull to sync models.',
//             demandOption: false,
//             type: 'boolean'
//         },
//         folder: {
//             describe: 'Specify the path of the folder where models and template folders are present for model sync. If no value provided, the default folder will be .agility-files.',
//             demandOption: false,
//             type: 'string'
//         },
//         dryRun: {
//             describe: 'Provide the value as true or false to perform a dry run for model sync.',
//             demandOption: false,
//             type: 'boolean'
//         },
//         filter: {
//             describe: 'Specify the path of the filter file. Ex: C:\Agility\myFilter.json.',
//             demandOption: false,
//             type: 'string'
//         }
//     },
//     handler: async function(argv) {
//         auth = new Auth();
//         let code = new fileOperations();
//         let codeFileStatus = code.codeFileExists();
//         if(codeFileStatus){
//             let data = JSON.parse(code.readTempFile('code.json'));
            
//             const form = new FormData();
//             form.append('cliCode', data.code);
//             let guid: string = argv.sourceGuid as string;
//             let targetGuid: string = argv.targetGuid as string;
//             let instancePull: boolean = argv.pull as boolean;
//             let dryRun: boolean = argv.dryRun as boolean;
//             let filterSync: string = argv.filter as string;
//             let folder: string = argv.folder as string;

//             if(guid === undefined && targetGuid === undefined){
//                 console.log(colors.red('Please provide a source guid or target guid to perform the operation.'));
//                 return;
//             }

//             let authGuid: string = '';

//             if(guid !== undefined){
//                 authGuid = guid;
//             }
//             else{
//                 authGuid = targetGuid;
//             }
            
//             let token = await auth.cliPoll(form, authGuid);

//             let models: mgmtApi.Model[] = [];

//             let templates: mgmtApi.PageModel[] = [];

//             let multibar = createMultibar({name: 'Sync Models'});

//             options = new mgmtApi.Options();
//             options.token = token.access_token;
            
//             if(dryRun === undefined){
//                 dryRun = false;
//             }
//             if(instancePull === undefined){
//                 instancePull = false;
//             }
//             if(filterSync === undefined){
//                 filterSync = '';
//             }
//             if(folder === undefined){
//                 folder = '.agility-files';
//             }
//             let user = await auth.getUser(authGuid, token.access_token);

//             if(!instancePull){
//                 if(!code.checkBaseFolderExists(folder)){
//                     console.log(colors.red(`To proceed with the command the folder ${folder} should exist.`));
//                     return;
//                 }
//             }

//             if(user){
//                 if(guid === undefined){
//                     guid = '';
//                 }
//                 if(targetGuid === undefined){
//                     targetGuid = '';
//                 }
//                 let sourcePermitted = await auth.checkUserRole(guid, token.access_token);
//                 let targetPermitted = await auth.checkUserRole(targetGuid, token.access_token);
//                 if(guid === ''){
//                     sourcePermitted = true;
//                 }
//                 if(targetGuid === ''){
//                     targetPermitted = true;
//                 }
//                 let modelPush = new modelSync(options, multibar);
//                 if(sourcePermitted && targetPermitted){

//                     if(instancePull){
//                         if(guid === ''){
//                             console.log(colors.red('Please provide the sourceGuid of the instance for pull operation.'));
//                             return;
//                         }
//                         console.log(colors.yellow('Pulling models from your instance. Please wait...'));
//                         code.cleanup(folder);
//                         code.createBaseFolder(folder);
//                         code.createLogFile('logs', 'instancelog', folder);
//                         let modelPull = new model(options, multibar);

//                         let templatesPull = new sync(guid, 'syncKey', 'locale', 'channel', options, multibar);
                
//                         await modelPull.getModels(guid, folder);
//                         await templatesPull.getPageTemplates(folder);
//                         multibar.stop();

//                         if(targetGuid === ''){
//                             return;
//                         }
//                     }
//                     if(filterSync){
//                         if(!code.checkFileExists(filterSync)){
//                             console.log(colors.red(`Please check the filter file is present at ${filterSync}.`));
//                             return;
//                         }
//                         else{
//                             let file = code.readFile(`${filterSync}`);
//                             const jsonData: FilterData = JSON.parse(file);
//                             const modelFilter = new ModelFilter(jsonData);
//                             models = await modelPush.validateAndCreateFilterModels(modelFilter.filter.Models, folder);
//                             templates = await modelPush.validateAndCreateFilterTemplates(modelFilter.filter.Templates, 'locale', folder);
//                         }
//                     }
//                     if(dryRun){
//                         if(targetGuid === ''){
//                             console.log(colors.red('Please provide the targetGuid parameter a valid instance guid to perform the dry run operation.'));
//                             return;
//                         }
//                         console.log(colors.yellow('Running a dry run on models, please wait...'));
//                         if(code.folderExists('models-sync')){
//                             code.cleanup(`${folder}/models-sync`);
//                         }

//                         let containerRefs =  await modelPush.logContainers(models);
//                         if(containerRefs){
//                             if(containerRefs.length > 0){
//                                 console.log(colors.yellow('Please review the content containers in the containerReferenceNames.json file in the logs folder. They should be present in the target instance.'));
//                             }
//                         }
//                         await modelPush.dryRun(guid, 'locale', targetGuid, models, templates, folder);
//                     }
//                     else{
//                         if(targetGuid === ''){
//                             console.log(colors.red('Please provide the targetGuid parameter a valid instance guid to perform the model sync operation.'));
//                             return;
//                         }
//                         console.log(colors.yellow('Syncing Models from your instance...'));
//                         multibar = createMultibar({name: 'Sync Models'});
//                         let containerRefs =  await modelPush.logContainers(models);
//                         if(containerRefs){
//                             if(containerRefs.length > 0){
//                                 console.log(colors.yellow('Please review the content containers in the containerReferenceNames.json file in the logs folder. They should be present in the target instance.'));
//                             }
//                         }
//                         await modelPush.syncProcess(targetGuid, 'locale', models, templates, folder);
//                     }
                    
//                 }
//                 else{
//                     console.log(colors.red('You do not have the required permissions to perform the model sync operation.'));
//                 }
                
//             }
//             else{
//                 console.log(colors.red('Please authenticate first to perform the sync models operation.'));
//             }

           
//         }
//         else{
//             console.log(colors.red('Please authenticate first to perform the sync models operation.'));
//         }
//     }
// })

// yargs.command({
//     command: 'model-pull',
//     describe: 'Pull models locally.',
//     builder: {
//         sourceGuid: {
//             describe: 'Provide the source guid to pull models from your source instance.',
//             demandOption: true,
//             type: 'string'
//         },
//         folder: {
//             describe: 'Specify the path of the folder where models and template folders are present for model pull.',
//             demandOption: false,
//             type: 'string'
//         }
//     },
//     handler: async function(argv) {
//         auth = new Auth();
//         let code = new fileOperations();
//         let codeFileStatus = code.codeFileExists();
//         if(codeFileStatus){
//             let data = JSON.parse(code.readTempFile('code.json'));
            
//             const form = new FormData();
//             form.append('cliCode', data.code);
//             let guid: string = argv.sourceGuid as string;
//             let folder: string = argv.folder as string;
//             let token = await auth.cliPoll(form, guid);
//             let multibar = createMultibar({name: 'Model Pull'});

//             options = new mgmtApi.Options();
//             options.token = token.access_token;

//             if(folder === undefined){
//                 folder = '.agility-files';
//             }

//             let user = await auth.getUser(guid, token.access_token);

//             if(user){
//                 let sourcePermitted = await auth.checkUserRole(guid, token.access_token);

//                 if(sourcePermitted){
//                     code.cleanup(folder);
//                     code.createBaseFolder(folder);
//                     code.createLogFile('logs', 'instancelog', folder);
//                     console.log(colors.yellow('Pulling Models from your instance...'));
//                     let modelPull = new model(options, multibar);

//                     let templatesPull = new sync(guid, 'syncKey', 'locale', 'channel', options, multibar);
            
//                     await modelPull.getModels(guid, folder);
//                     await templatesPull.getPageTemplates(folder);
//                     multibar.stop();

//                 }
//                 else{
//                     console.log(colors.red('You do not have the required permissions to perform the model pull operation.'));
//                 }
                
//             }
//             else{
//                 console.log(colors.red('Please authenticate first to perform the pull operation.'));
//             }

           
//         }
//         else{
//             console.log(colors.red('Please authenticate first to perform the pull operation.'));
//         }
//     }
// })

// yargs.command({
//     command: 'pull',
//     describe: 'Pull your Instance',
//     builder: {
//         guid: {
//             describe: 'Provide guid to pull your instance.',
//             demandOption: true,
//             type: 'string'
//         },
//         locale: {
//             describe: 'Provide the locale to pull your instance.',
//             demandOption: true,
//             type: 'string'
//         },
//         channel: {
//             describe: 'Provide the channel to pull your instance.',
//             demandOption: true,
//             type: 'string'
//         },
//         baseUrl: {
//             describe: 'Specify the base url of your instance.',
//             demandOption: false,
//             type: 'string'
//         }
//     },
//     handler: async function(argv) {
//         auth = new Auth();
//         let code = new fileOperations();
//         let codeFileStatus = code.codeFileExists();
//         if(codeFileStatus){
//             code.cleanup('.agility-files');
            
//             let data = JSON.parse(code.readTempFile('code.json'));
            
//             const form = new FormData();
//             form.append('cliCode', data.code);
//             let guid: string = argv.guid as string;
//             let locale: string = argv.locale as string;
//             let channel: string = argv.channel as string;
//             let userBaseUrl: string = argv.baseUrl as string;

//             let token = await auth.cliPoll(form, guid);

//             let multibar = createMultibar({name: 'Pull'});

//             options = new mgmtApi.Options();
//             options.token = token.access_token;

//             let user = await auth.getUser(guid, token.access_token);

//             if(user){
//                 let permitted = await auth.checkUserRole(guid, token.access_token);
//                 if(permitted){
//                     let syncKey = await auth.getPreviewKey(guid, userBaseUrl);
//                     if(syncKey){
//                         console.log(colors.yellow('Pulling your instance...'));
//                         let contentPageSync = new sync(guid, syncKey, locale, channel, options, multibar);
        
//                         await contentPageSync.sync();
            
//                         let assetsSync = new asset(options, multibar);
            
//                         await assetsSync.getAssets(guid);
            
//                         let containerSync = new container(options, multibar);
            
//                         await containerSync.getContainers(guid);
            
//                         let modelSync = new model(options, multibar);
            
//                         await modelSync.getModels(guid);
//                     }
//                     else{
//                         console.log(colors.red('Either the preview key is not present in your instance or you need to specify the baseUrl parameter as an input based on the location. Please refer the docs for the Base Url.'));
//                     }
//                 }
//                 else{
//                     console.log(colors.red('You do not have required permissions on the instance to perform the pull operation.'));
//                 }
                
//             }
//             else{
//                 console.log(colors.red('Please authenticate first to perform the pull operation.'));
//             }
           
//         }
//         else{
//             console.log(colors.red('Please authenticate first to perform the pull operation.'));
//         }
//     }
// })

// yargs.command({
//     command: 'push',
//     describe: 'Push your Instance.',
//     builder: {
//         guid: {
//             describe: 'Provide the target guid to push your instance.',
//             demandOption: true,
//             type: 'string'
//         },
//         locale: {
//             describe: 'Provide the locale to push your instance.',
//             demandOption: true,
//             type: 'string'
//         }
//     },
//     handler: async function(argv) {
//        let guid: string = argv.guid as string;
//        let locale: string = argv.locale as string;
//        let code = new fileOperations();
//        auth = new Auth();
//        let codeFileStatus = code.codeFileExists();

//        if(codeFileStatus){
//         let agilityFolder = code.cliFolderExists();
//         if(agilityFolder){
//             let data = JSON.parse(code.readTempFile('code.json'));

//             let multibar = createMultibar({name: 'Push'});
            
//             const form = new FormData();
//             form.append('cliCode', data.code);

//             let token = await auth.cliPoll(form, guid);

//             options = new mgmtApi.Options();
//             options.token = token.access_token;

//             let user = await auth.getUser(guid, token.access_token);
//             if(user){
//                 let permitted = await auth.checkUserRole(guid, token.access_token);
//                 if(permitted){
//                     console.log(colors.yellow('Pushing your instance...'));
//                     let pushSync = new push(options, multibar);

//                 /*
//                 TODO: Inquirer for Content and Pages.
//                     let modelSync = new model(options, multibar);
//                     let existingModels = await modelSync.validateModels(guid);

//                     let containerSync = new container(options, multibar);
//                     let existingContainers = await containerSync.validateContainers(guid);

//                     let duplicates: string[] = [];

//                     if(existingModels){
//                             for(let i = 0; i < existingModels.length; i++){
//                                 duplicates.push(existingModels[i]);
//                             }
//                     }
//                     if(existingContainers){
//                             for(let i = 0; i < existingContainers.length; i++){
//                                 duplicates.push(existingContainers[i]);
//                             }
//                     }

                
//                     if(duplicates.length > 0){
//                     await inquirer.prompt([
//                             {
//                                 type: 'confirm',
//                                 name: 'duplicates',
//                                 message: 'Found duplicate(s) Models and Containers. Overwrite the models and containers? '
//                             }
//                         ]).then((answers: { duplicates: boolean; })=> {

//                             if(!answers.duplicates){
//                                     if(existingContainers)
//                                         containerSync.deleteContainerFiles(existingContainers);
//                                     if(existingModels)
//                                         modelSync.deleteModelFiles(existingModels);
//                                 }
//                         })
//                     }*/
//                      await pushSync.pushInstance(guid, locale);
//                 }
//                 else{
//                     console.log(colors.red('You do not have required permissions on the instance to perform the push operation.'));
//                 }
                
//             } else{
//                 console.log(colors.red('Please authenticate first to perform the push operation.'));
//             }
            
//         }
//         else{
//             console.log(colors.red('Please pull an instance first to push an instance.'));
//         }
        
//        }
//        else {
//         console.log(colors.red('Please authenticate first to perform the push operation.'));
//        }
//     }
// })

// yargs.command({
//     command: 'clone',
//     describe: 'Clone your Instance.',
//     builder: {
//         sourceGuid: {
//             describe: 'Provide the source guid to clone your instance.',
//             demandOption: true,
//             type: 'string'
//         },
//         targetGuid: {
//             describe: 'Provide the target guid to clone your instance.',
//             demandOption: true,
//             type: 'string'
//         },
//         locale: {
//             describe: 'Provide the locale to clone your instance.',
//             demandOption: true,
//             type: 'string'
//         },
//         channel: {
//             describe: 'Provide the channel to pull your instance.',
//             demandOption: true,
//             type: 'string'
//         }
//     },
//     handler: async function(argv) {
//        let sourceGuid: string = argv.sourceGuid as string;
//        let targetGuid: string = argv.targetGuid as string;
//        let locale: string = argv.locale as string;
//        let channel: string = argv.channel as string;
//        let code = new fileOperations();
//        auth = new Auth();
//        let codeFileStatus = code.codeFileExists();
//        if(codeFileStatus){
//         code.cleanup('.agility-files');
//         let data = JSON.parse(code.readTempFile('code.json'));
//         const form = new FormData();
//         form.append('cliCode', data.code);

//         let token = await auth.cliPoll(form, sourceGuid);

//         let user = await auth.getUser(sourceGuid, token.access_token);

//         if(user){

//             let sourcePermitted = await auth.checkUserRole(sourceGuid, token.access_token);
//             let targetPermitted = await auth.checkUserRole(targetGuid, token.access_token);

//             if(sourcePermitted && targetPermitted){
//                 console.log(colors.yellow('Cloning your instance...'));
//                 let cloneSync = new clone(sourceGuid, targetGuid, locale, channel);

//                 console.log(colors.yellow('Pulling your instance...'));
//                 await cloneSync.pull();

//                 let agilityFolder = code.cliFolderExists();
//                 if(agilityFolder){
//                     console.log(colors.yellow('Pushing your instance...'));
//                     await cloneSync.push();
//                 }
//                 else{
//                     console.log(colors.red('Please pull an instance first to push an instance.'));
//                 }
//             }
//             else{
//                 console.log(colors.red('You do not have the required permissions to perform the clone operation.'));
//             }
//         }
//         else{
//             console.log(colors.red('Please authenticate first to perform the clone operation.'));
//         }
        
//        }
//        else {
//         console.log(colors.red('Please authenticate first to perform the clone operation.'));
//        }
//     }
// })


// yargs.parse();