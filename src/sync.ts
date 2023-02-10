import * as agilitySync from '@agility/content-sync';
import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';


export class sync{
     _guid: string;
     _apiKey: string;
     _locale: string;
     _channel: string;
     _options : mgmtApi.Options;

     constructor(guid: string, apiKey: string, locale: string, channel: string, options: mgmtApi.Options){
        this._guid = guid;
        this._apiKey = apiKey;
        this._locale = locale;
        this._channel = channel;
        this._options = options;
     }

     async sync(){
        let syncClient = agilitySync.getSyncClient({
            guid: this._guid,
            apiKey: this._apiKey,
            languages: [`${this._locale}`],
            channels: [`${this._channel}`],
            isPreview: true
        })

        await syncClient.runSync();

        await this.getPageTemplates();
     }

     async getPageTemplates(){
      let apiClient = new mgmtApi.ApiClient(this._options);

      let pageTemplates = await apiClient.pageMethods.getPageTemplates(this._guid, this._locale, true);

      let fileExport = new fileOperations();

      for(let i = 0; i < pageTemplates.length; i++){
         let template = pageTemplates[i];

         fileExport.exportFiles('templates', template.pageTemplateID, template);
      }
     }
}
