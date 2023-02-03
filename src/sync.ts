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
            guid: this._guid,
            apiKey: this._apiKey,
            languages: [`${this._locale}`],
            channels: [`${this._channel}`],
            isPreview: true
        })

        await syncClient.runSync();
     }
}
