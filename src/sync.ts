import * as agilitySync from '@agility/content-sync';


export class sync{
     _guid: string;
     _apiKey: string;
     _locale: string;
     _channel: string;

     constructor(guid: string, apiKey: string, locale: string, channel: string){
        this._guid = guid;
        this._apiKey = apiKey;
        this._locale = locale;
        this._channel = channel;
     }

     async sync(){
        let syncClient = agilitySync.getSyncClient({
            guid: this._guid,// '9670e398-d',
            apiKey: this._apiKey,// 'defaultpreview.2ba972eae0618c6a80a68a23ef5d260a92a482c6b34e8cd142ea80a6db904510',
            languages: [`${this._locale}`],
            channels: [`${this._channel}`],
            isPreview: true
        })

        await syncClient.runSync();
     }
     

    // const method = async () => {
    //     await syncClient.runSync();
    // }
}
