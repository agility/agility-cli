import * as yargs from "yargs";
import { Auth } from "./auth";
import { fileOperations } from './fileOperations';
import { sync } from "./sync";
import {asset} from './asset';
import {container} from './container';
import { model } from "./model";
import * as mgmtApi  from '@agility/management-sdk';
const FormData = require('form-data');

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
    command: 'clone',
    describe: 'Clone an Instance',
    builder: {
        guid: {
            describe: 'Provide guid to clone an instance.',
            demandOption: true,
            type: 'string'
        },
        locale: {
            describe: 'Provide the locale to clone an instance.',
            demandOption: true,
            type: 'string'
        },
        channel: {
            describe: 'Provide the channel to clone an instance.',
            demandOption: true,
            type: 'string'
        }
    },
    handler: async function(argv) {
        auth = new Auth();
        let code = new fileOperations();
        let data = JSON.parse(code.readFile('code.json'));
        
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

        let assetsSync = new asset(options);

        await assetsSync.getAssets(guid);

        let containerSync = new container(options);

        await containerSync.getContainers(guid);

        let modelSync = new model(options);

        await modelSync.getModels(guid);
    }
})

yargs.parse();