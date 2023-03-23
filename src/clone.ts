import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';
import * as fs from 'fs';
const FormData = require('form-data');
import { Auth } from "./auth";
import { sync } from './sync';
import { asset } from './asset';
import { container } from './container';
import { model } from './model';
import { push } from "./push";
import { createMultibar } from './multibar';

export class clone{
    auth: Auth
    options: mgmtApi.Options;
    sourceGuid: string;
    targetGuid: string;
    locale: string;
    channel: string;

    constructor(_sourceGuid: string, _targetGuid: string, _locale: string, _channel: string){
        this.sourceGuid = _sourceGuid;
        this.targetGuid = _targetGuid;
        this.locale = _locale;
        this.channel = _channel;
    }

    async pull(){
        let code = new fileOperations();
        this.auth = new Auth();
        let data = JSON.parse(code.readTempFile('code.json'));
        const form = new FormData();
        form.append('cliCode', data.code);
        
        let token = await this.auth.cliPoll(form, this.sourceGuid);

        this.options = new mgmtApi.Options();
        this.options.token = token.access_token;

        let multibar = createMultibar({name: 'Instance'});

        let syncKey = await this.auth.getPreviewKey(this.sourceGuid);
        let contentPageSync = new sync(this.sourceGuid, syncKey, this.locale, this.channel, this.options, multibar);

        await contentPageSync.sync();

        

        let assetsSync = new asset(this.options, multibar);

        await assetsSync.getAssets(this.sourceGuid);

        let containerSync = new container(this.options, multibar);

        await containerSync.getContainers(this.sourceGuid);

        let modelSync = new model(this.options, multibar);

        await modelSync.getModels(this.sourceGuid);
    }

    async push(){
        let code = new fileOperations();
        this.auth = new Auth();
        let data = JSON.parse(code.readTempFile('code.json'));
        let multibar = createMultibar({name: 'Instance'});
         
        const form = new FormData();
        form.append('cliCode', data.code);
 
        let token = await this.auth.cliPoll(form, this.targetGuid);
 
        this.options = new mgmtApi.Options();
        this.options.token = token.access_token;

        let modelSync = new model(this.options, multibar);
        let pushSync = new push(this.options, multibar);

        
        let containerSync = new container(this.options,multibar);

        await pushSync.pushInstance(this.targetGuid, this.locale);
    }

}