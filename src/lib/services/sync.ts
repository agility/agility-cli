import * as agilitySync from "@agility/content-sync";
import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
// fs and path might be re-introduced if Pull.pullInstance needs custom file moving for sync output.
// const fs = require("fs");
// const path = require("path");
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
          rootPath: `agility-files/${this._guid}/${this._locale}/${this._isPreview ? "preview" : "live"}`,
        },
      },
    });

    // TODO: Temporarily disabled for pure Management SDK testing
    // const syncResult = await syncClient.runSync();
    const syncResult = { status: 'disabled', message: 'runSync temporarily disabled for Management SDK testing' };
    return syncResult;
  }

  // getPageTemplates method has been ENTIRELY REMOVED.
  // Its logic is now in: src/lib/downloaders/download-templates.ts

  // getPages method has been ENTIRELY REMOVED.
  // Pages are now handled by the Content Sync SDK directly in the sync() method

  /**
   * DEPRECATED_CANDIDATE
   * This method previously handled a full pull, including base sync, file moving, and fetching pages/templates.
   * Its responsibilities are being superseded by the new `Pull` service (`src/lib/services/pull.ts`).
   * For now, it can serve as a way to trigger the base sync via `this.sync()`.
   * The complex file moving logic has been removed as it was likely redundant or problematic.
   * The `Pull.pullInstance` will manage the overall pull process, including calling the new downloaders.
   */
  async pullFiles(guid: string, locale: string, isPreview: boolean = true): Promise<boolean> {
    console.log(colors.yellow("Note: sync.pullFiles() is being refactored. Prefer using the new Pull service when available."));
    
    try {
      await this.sync(guid, locale, isPreview); // Perform the base sync
      // Post-sync operations (fetching all pages, templates, assets etc.) will be handled by the Pull service.
      return true; // Indicates base sync part was attempted.
    } catch (error) {
      console.error(colors.red(`Error during base sync in pullFiles for ${guid}/${locale}:`), error);
      return false;
    }
  }
}

// Adding ansi-colors for the warning message in pullFiles
const colors = require("ansi-colors");
