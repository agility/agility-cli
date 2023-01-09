import axios, { AxiosInstance } from 'axios';
import { cliToken } from './models/cliToken';
import { fileOperations } from './fileOperations';
const open = require('open');


export class Auth{

    async generateCode(){
        let firstPart = (Math.random() * 46656) | 0;
        let secondPart = (Math.random() * 46656) | 0;
        let firstString = ("000" + firstPart.toString(36)).slice(-3);
        let secondString = ("000" + secondPart.toString(36)).slice(-3);
        return firstString + secondString;
    }

    determineBaseUrl(guid: string): string{
        if(guid.endsWith('d')){
            return "https://mgmt-dev.aglty.io";
        }
        else if(guid.endsWith('u')){
            return "https://mgmt.aglty.io";
        }
        else if(guid.endsWith('ca')){
            return "https://mgmt-ca.aglty.io";
        }
        else if(guid.endsWith('eu')){
            return "https://mgmt-eu.aglty.io";
        }
        else if(guid.endsWith('aus')){
            return "https://mgmt-aus.aglty.io";
        }
        return "https://mgmt.aglty.io";
    }

    getInstance(guid: string) : AxiosInstance{
        let baseUrl = this.determineBaseUrl(guid);
        let instance =  axios.create({
             baseURL: `${baseUrl}/oauth`
         })
         return instance;
     }

     async executeGet(apiPath: string, guid: string){
        let instance = this.getInstance(guid);
        try{
            const resp = await instance.get(apiPath, {
                headers: {
                  'Cache-Control': 'no-cache'
                }
              })
            return resp;
        }
        catch(err){
            throw err;
        }
        
    }

    async executePost(apiPath: string, guid: string, data: any){
        let instance = this.getInstance(guid);
        try{
            const resp = await instance.post(apiPath,data, {
                headers: {
                  'Cache-Control': 'no-cache'
                }
              })
            return resp;
        }
        catch(err){
            throw err;
        }
    }

    async authorize(){
        let code = await this.generateCode();
        let url = `https://mgmt-dev.aglty.io/oauth/Authorize?response_type=code&redirect_uri=https://mgmt-dev.aglty.io/oauth/CliAuth&state=cli-code%2e${code}`;
        await open(url);
        let codeFile = new fileOperations();
        codeFile.createFile('code.json', `{"code": "${code}"}`);
        return code;
    }

    async cliPoll(formData: FormData, guid: string = 'blank-d'){
        let apiPath = `CliPoll`;

        const response = await this.executePost(apiPath, guid, formData);
        return response.data as cliToken;
    }

    async getPreviewKey(guid: string){
        let apiPath = `GetPreviewKey?guid=${guid}`;

        const response = await this.executeGet(apiPath, guid);
        return response.data as string;
    }
}