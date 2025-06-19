import * as agilitySync from "@agility/content-sync";
import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import * as path from "path";

const storeInterfaceFileSystem = require("./store-interface-filesystem");

export class sync {
  // Properties remain as they might be used by the constructor or methods if they evolve.
  _guid: string;
  _apiKey: string;
  _locale: string;
  _channel: string;
  _options: mgmtApi.Options;
  _multibar: cliProgress.MultiBar;
  _isPreview: boolean;
  _rootPath: string;
  _legacyFolders: boolean;

  constructor(
    guid: string,
    apiKey: string,
    locale: string,
    channel: string,
    options: mgmtApi.Options,
    multibar: cliProgress.MultiBar,
    isPreview: boolean,
    rootPath: string,
    legacyFolders: boolean
  ) {
    this._guid = guid;
    this._apiKey = apiKey;
    this._locale = locale;
    this._channel = channel;
    this._options = options;
    this._multibar = multibar;
    this._isPreview = isPreview;
    this._rootPath = rootPath;
    this._legacyFolders = legacyFolders;
  }

  /**
   * Performs the base content synchronization using @agility/content-sync.
   * This method now solely focuses on running the sync client.
   * Post-sync operations like fetching full page/template details are handled
   * by dedicated downloader functions called by the new Pull service.
   */
  async sync(guid: string, locale: string, isPreview: boolean = true): Promise<any> {
    // Update instance context if necessary (though these might be better passed directly if used by syncClient)
    this._guid = guid;
    this._isPreview = isPreview;
    this._locale = locale;

    const syncClient = agilitySync.getSyncClient({
      guid: this._guid, // Use updated guid
      apiKey: this._apiKey, // from constructor
      languages: [`${this._locale}`], // Use updated locale
      channels: [`${this._channel}`], // from constructor
      isPreview: this._isPreview, // Use updated isPreview
      store: {
        interface: storeInterfaceFileSystem,
        options: {
          // Sync SDK writes directly to this final structured path
          rootPath: path.join('agility-files', this._guid, this._locale, this._isPreview ? 'preview' : 'live'),
        },
      },
    });


    const syncResult = { status: 'disabled', message: 'runSync temporarily disabled for Management SDK testing' };
    return syncResult;
  }

  // getPageTemplates method has been ENTIRELY REMOVED.
  // Its logic is now in: src/lib/downloaders/download-templates.ts

  // getPages method has been ENTIRELY REMOVED.
  // Pages are now handled by the Content Sync SDK directly in the sync() method


}