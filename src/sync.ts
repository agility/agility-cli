import * as agilitySync from '@agility/content-sync';
import * as mgmtApi  from '@agility/management-sdk';
import { fileOperations } from './fileOperations';
import * as cliProgress from 'cli-progress';


export class sync{
     _guid: string;
     _apiKey: string;
     _locale: string;
     _channel: string;
     _options : mgmtApi.Options;
     _multibar: cliProgress.MultiBar;

     constructor(guid: string, apiKey: string, locale: string, channel: string, options: mgmtApi.Options, multibar: cliProgress.MultiBar){
        this._guid = guid;
        this._apiKey = apiKey;
        this._locale = locale;
        this._channel = channel;
        this._options = options;
        this._multibar = multibar;
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

        await this.getPages();
     }

     async getPageTemplates(){
      let apiClient = new mgmtApi.ApiClient(this._options);

      let pageTemplates = await apiClient.pageMethods.getPageTemplates(this._guid, this._locale, true);

      const progressBar0 = this._multibar.create(pageTemplates.length, 0);
      progressBar0.update(0, {name : 'Templates'});
      let index = 1;

      let fileExport = new fileOperations();

      for(let i = 0; i < pageTemplates.length; i++){
         let template = pageTemplates[i];
         progressBar0.update(index);
         index += 1;
         fileExport.exportFiles('templates', template.pageTemplateID, template);
      }
     }

     async getPages(){
      let apiClient = new mgmtApi.ApiClient(this._options);

      let fileOperation = new fileOperations();
      let files = fileOperation.readDirectory(`${this._locale}/page`);

      const progressBar01 = this._multibar.create(files.length, 0);
      progressBar01.update(0, {name : 'Modifying Page Object'});
      let index = 1;

      for(let i = 0; i < files.length; i++){
         let pageItem = JSON.parse(files[i]) as mgmtApi.PageItem;

         progressBar01.update(index);
         index += 1;

         try{
            let page = await apiClient.pageMethods.getPage(pageItem.pageID, this._guid, this._locale);

            fileOperation.exportFiles(`${this._locale}/pages`, page.pageID, page);
         } catch{

         }
      }
     }
}
