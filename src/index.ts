import * as yargs from "yargs";
import { Auth } from "./auth";
import { fileOperations } from './fileOperations';
import { sync } from "./sync";
import {asset} from './asset';
import {container} from './container';
import { model } from "./model";
import { push } from "./push";
import * as mgmtApi  from '@agility/management-sdk';
const FormData = require('form-data');
const cliProgress = require('cli-progress');
const colors = require('ansi-colors');
const inquirer = require('inquirer');

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
        let tasks = 4;
        let tasksCompleted = 0;
        auth = new Auth();
        let code = new fileOperations();
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
        let contentPageSync = new sync(guid, syncKey, locale, channel);

        await contentPageSync.sync();

        const b1 = new cliProgress.SingleBar({
            format: 'Pulling Your instance |' + colors.yellow('{bar}') + '| {percentage}% | {value}/{total} Tasks | Task: {speed}',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
        });

        b1.start(tasks, tasksCompleted);

        b1.increment();

        b1.update(tasksCompleted, {speed: 'Content and Page Pull started'});
        tasksCompleted += 1; 
        b1.update(tasksCompleted, {speed: 'Content and Page Pull completed'});

        let assetsSync = new asset(options);

        b1.update(tasksCompleted, {speed: 'Assets Pull started'});
        await assetsSync.getAssets(guid);
        tasksCompleted += 1; 
        b1.update(tasksCompleted, {speed: 'Assets Pull completed'});

        let containerSync = new container(options);

        b1.update(tasksCompleted, {speed: 'Containers Pull started'});
        await containerSync.getContainers(guid);
        tasksCompleted += 1; 
        b1.update(tasksCompleted, {speed: 'Containers Pull completed'});

        let modelSync = new model(options);

        b1.update(tasksCompleted, {speed: 'Models Pull started'});
        await modelSync.getModels(guid);
        tasksCompleted += 1; 
        b1.update(tasksCompleted, {speed: 'Instance pull complete.'});
        b1.stop();
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
       let data = JSON.parse(code.readTempFile('code.json'));
        
       const form = new FormData();
       form.append('cliCode', data.code);

       let token = await auth.cliPoll(form, guid);

       options = new mgmtApi.Options();
       options.token = token.access_token;
       let modelSync = new model(options);
       let pushSync = new push(options);
       /*let existingModels = await modelSync.validateModels(guid);

       let containerSync = new container(options);
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
})


yargs.parse();