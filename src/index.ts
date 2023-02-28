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

let auth: Auth
let options: mgmtApi.Options;

yargs.version('0.0.1_beta');

yargs.command({
    command: 'agility login',
    describe: 'Login to Agility.',
    handler: async function() {
        auth = new Auth();
        let code = await auth.authorize();
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
            let data = JSON.parse(code.readTempFile('code.json'));
        
            const form = new FormData();
            form.append('cliCode', data.code);
            let guid: string = argv.guid as string;
            let locale: string = argv.locale as string;
            let channel: string = argv.channel as string;

            let token = await auth.cliPoll(form, guid);

            options = new mgmtApi.Options();
            options.token = token.access_token;

            let syncKey = await auth.getPreviewKey(guid);
            let contentPageSync = new sync(guid, syncKey, locale, channel, options);

            await contentPageSync.sync();

            let multibar = createMultibar({name: 'Pull'});

            let assetsSync = new asset(options, multibar);

            await assetsSync.getAssets(guid);
 
            let containerSync = new container(options, multibar);

            await containerSync.getContainers(guid);
 
            let modelSync = new model(options, multibar);

            await modelSync.getModels(guid);
        }
        else{
            console.log('Please authenticate first to perform the pull operation.');
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
        let data = JSON.parse(code.readTempFile('code.json'));

        let multibar = createMultibar({name: 'Push'});
        
        const form = new FormData();
        form.append('cliCode', data.code);

        let token = await auth.cliPoll(form, guid);

        options = new mgmtApi.Options();
        options.token = token.access_token;
        let modelSync = new model(options, multibar);
        let pushSync = new push(options, multibar);
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
        }
        await pushSync.pushInstance(guid, locale);
       }
       else {
        console.log('Please authenticate first to perform the push operation.');
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

       let cloneSync = new clone(sourceGuid, targetGuid, locale, channel);

       await cloneSync.pull();

       await cloneSync.push();
    }
})


yargs.parse();