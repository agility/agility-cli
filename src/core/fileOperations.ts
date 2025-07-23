import * as fs from 'fs';
import * as Https from 'https';
import * as path from 'path';
const os = require('os');
import { state } from './state';
os.tmpDir = os.tmpdir;

export class fileOperations {

  private _rootPath: string;
  private _guid: string;
  private _locale: string;
  private _legacyFolders: boolean;
  private _resolvedRootPath: string;
  private _basePath: string;
  private _instanceLogDir: string;
  private _currentLogFilePath: string;
  private _isGuidLevel: boolean;
  private _mappingsPath: string;

  constructor(guid: string, locale?: string) {
    this._rootPath = state.rootPath;
    this._guid = guid;
    this._isGuidLevel = locale === undefined || locale === null || locale === ""
    this._locale = locale ?? "";
    this._legacyFolders = state.legacyFolders;

    // Keep paths relative instead of resolving to absolute paths
    // This prevents files from being written to /Users/ directories
    this._resolvedRootPath = state.rootPath;

    // Calculate paths based on legacy mode
    if (state.legacyFolders) {
      // Legacy mode: flat structure
      this._basePath = this._resolvedRootPath;
      this._mappingsPath = path.join(this._resolvedRootPath, 'mappings');
      this._instanceLogDir = path.join(this._resolvedRootPath, 'logs');
    } else {
      // Normal mode: nested structure
      this._basePath = this._isGuidLevel ? path.join(this._resolvedRootPath, this._guid) : path.join(this._resolvedRootPath, this._guid, this._locale);
      this._mappingsPath = path.join(this._resolvedRootPath, this._guid, 'mappings');
      this._instanceLogDir = path.join(this._basePath, 'logs');
    }

    this._currentLogFilePath = path.join(this._instanceLogDir, 'instancelog.txt');
  }

  // Public getters for path access
  public get instancePath(): string {
    return this._basePath;
  }

  public get mappingsPath(): string {
    return this._mappingsPath;
  }

  public get isLegacyMode(): boolean {
    return this._legacyFolders;
  }

  public get resolvedRootPath(): string {
    return this._resolvedRootPath;
  }

  // Public getters for instance configuration
  public get guid(): string {
    return this._guid;
  }

  public get locale(): string {
    return this._locale;
  }

  /**
   * Strip ANSI color codes from text for clean log files
   * Matches ANSI escape sequences like [33m, [3m, [23m, [39m, etc.
   * Also cleans up JSON formatting for better readability
   */
  private stripAnsiCodes(text: string): string {
    // eslint-disable-next-line no-control-regex
    let cleaned = text.replace(/\x1b\[[0-9;]*m/g, '');

    // Clean up JSON formatting: replace \n with actual newlines for better readability
    cleaned = cleaned.replace(/\\n/g, '\n');

    // Remove unnecessary escaped quotes in JSON context
    cleaned = cleaned.replace(/\\"/g, '"');

    return cleaned;
  }

  exportFiles(folder: string, fileIdentifier: any, extractedObject: any, baseFolder?: string) {
    let effectiveBase: string;
    if (baseFolder) {
      // If baseFolder is provided, use it directly.
      // It's assumed to be the correct base, whether absolute or relative.
      effectiveBase = baseFolder;
    } else {
      // If no baseFolder is provided, check if the 'folder' argument itself is absolute.
      if (path.isAbsolute(folder)) {
        // If 'folder' is absolute, it defines the complete path up to its own level.
        // So, the effectiveBase is empty string, and 'folder' will be joined from root.
        effectiveBase = "";
      } else {
        // If 'folder' is relative, use the base path (instance-specific path) as the base
        effectiveBase = this._basePath;
      }
    }

    // Create the full directory path using path.join for OS-independent path construction
    const directoryForFile = path.join(effectiveBase, folder);

    // Ensure the directory structure exists
    if (!fs.existsSync(directoryForFile)) {
      fs.mkdirSync(directoryForFile, { recursive: true });
    }

    const fileName = path.join(directoryForFile, `${fileIdentifier}.json`);
    fs.writeFileSync(fileName, JSON.stringify(extractedObject));
  }

  appendFiles(folder: string, fileIdentifier: any, extractedObject: any) {
    const folderPath = path.join(this._basePath, folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    let fileName = path.join(folderPath, `${fileIdentifier}.json`);
    fs.appendFileSync(fileName, JSON.stringify(extractedObject));
  }

  createLogFile(folder: string, fileIdentifier: any, baseFolder?: string) {
    if (baseFolder === undefined || baseFolder === '') {
      baseFolder = this._basePath;
    }
    if (!fs.existsSync(`${baseFolder}`)) {
      fs.mkdirSync(`${baseFolder}`);
    }
    if (!fs.existsSync(`${baseFolder}/${folder}`)) {
      fs.mkdirSync(`${baseFolder}/${folder}`);
    }
    let fileName = `${baseFolder}/${folder}/${fileIdentifier}.txt`;
    fs.closeSync(fs.openSync(fileName, 'w'))
  }

  appendLogFile(data: string) {
    if (!fs.existsSync(this._instanceLogDir)) {
      fs.mkdirSync(this._instanceLogDir, { recursive: true });
    }
    // Strip ANSI color codes before writing to file
    const cleanData = this.stripAnsiCodes(data);
    fs.appendFileSync(this._currentLogFilePath, cleanData);
  }

  createFolder(folder: string): boolean {
    try {
      let fullPath: string;
      if (path.isAbsolute(folder)) {
        fullPath = folder;
      } else {
        // Use the base path (instance-specific path) instead of resolved root path
        // This ensures folders are created in the correct nested structure
        fullPath = path.join(this._basePath, folder);
      }

      // Normalize the path and split into segments
      const normalizedPath = path.normalize(fullPath);
      const segments = normalizedPath.split(path.sep);

      // Start from the root and create each directory
      let currentPath = '';
      for (const segment of segments) {
        currentPath = path.join(currentPath, segment);

        // Skip empty segments
        if (!segment) continue;

        try {
          if (!fs.existsSync(currentPath)) {
            fs.mkdirSync(currentPath);
          }
        } catch (err) {
          console.error(`Error creating directory ${currentPath}:`, err);
          return false;
        }
      }

      // Verify the final directory exists
      if (fs.existsSync(normalizedPath)) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error('Error in createFolder:', error);
      return false;
    }
  }

  createBaseFolder(folder?: string) {
    if (folder === undefined || folder === '') {
      folder = this._basePath;
    }
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder);
    }
  }

  checkBaseFolderExists(folder: string) {
    if (!fs.existsSync(folder)) {
      return false;
    }
    return true;
  }

  async downloadFile(url: string, targetFile: string) {
    return await new Promise((resolve, reject) => {
      // Ensure the target directory exists
      const targetDir = path.dirname(targetFile);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      Https.get(url, response => {
        const code = response.statusCode ?? 0;

        if (code >= 400) {
          return reject(new Error(response.statusMessage));
        }

        if (code > 300 && code < 400 && !!response.headers.location) {
          return resolve(
            this.downloadFile(response.headers.location, targetFile)
          );
        }

        const fileWriter = fs
          .createWriteStream(targetFile)
          .on('finish', () => {
            resolve({});
          })
          .on('error', (err) => {
            reject(err);
          });

        response.pipe(fileWriter);
      }).on('error', error => {
        console.error(`Error downloading from ${url}:`, error);
        reject(error);
      });
    });
  }

  createFile(filename: string, content: string) {
    fs.writeFileSync(filename, content);
  }

  saveFile(filename: string, content: string) {
    fs.writeFileSync(filename, content);
  }

  readFile(fileName: string) {
    const file = fs.readFileSync(fileName, "utf-8");
    return file;
  }

  createReadStream(fileName: string) {
    return fs.createReadStream(fileName);
  }

  checkFileExists(filePath: string): boolean {
    try {
      fs.accessSync(filePath, fs.constants.F_OK);
      return true;
    } catch (err) {
      return false;
    }
  }

  deleteFile(fileName: string) {
    fs.unlinkSync(fileName);
  }

  // Mapping file operations
  getMappingFilePath(sourceGuid: string, targetGuid: string, locale?: string | null): string {
    // Store mappings centrally in /agility-files/mappings/ instead of per-instance
    return path.join(this._rootPath, 'mappings', `${sourceGuid}-${targetGuid}`, locale ?? '');
  }

  getMappingFile(type: string, sourceGuid: string, targetGuid: string, locale?: string | null): any[] {
    const centralMappingsPath = path.join(this._rootPath, 'mappings',`${sourceGuid}-${targetGuid}`, locale ?? '', type);
    if (fs.existsSync(centralMappingsPath)) {
      const data = fs.readFileSync(path.join(centralMappingsPath, `mappings.json`), 'utf8');
      const jsonData = JSON.parse(data);
      return jsonData;
    }
    else {
      return [];
    }
  }


  saveMappingFile(mappingData: any[], type?: string, sourceGuid?: string, targetGuid?: string, locale?: string | null): void {

    const mappingRootPath = this.getMappingFilePath(sourceGuid, targetGuid, locale);
    const centralMappingsPath = path.join(mappingRootPath, type);

    const mappingFilePath = path.join(centralMappingsPath, `mappings.json`);

    if (!fs.existsSync(centralMappingsPath)) {
      fs.mkdirSync(centralMappingsPath, { recursive: true });
    }

    // This will overwrite the existing mappings.json file.
    fs.writeFileSync(mappingFilePath, JSON.stringify(mappingData, null, 2));
  }


  /**
   * Get reverse mapping file path for fallback lookups
   * For B→A sync: when A→B mapping file exists, use it by flipping the source/target GUIDs
   */
  getReverseMappingFilePath(sourceGuid: string, targetGuid: string, locale?: string): string {
    const localeToUse = locale || this._locale;
    const centralMappingsPath = path.join(this._rootPath, 'mappings');
    return path.join(centralMappingsPath, `${targetGuid}-to-${sourceGuid}-${localeToUse}.json`);
  }

  // saveMappingFile(sourceGuid: string, targetGuid: string, mappingData: any, locale?: string): void {
  //   const localeToUse = locale || this._locale;

  //   // Ensure centralized mappings directory exists
  //   const centralMappingsPath = path.join(this._rootPath, 'mappings');
  //   if (!fs.existsSync(centralMappingsPath)) {
  //     fs.mkdirSync(centralMappingsPath, { recursive: true });
  //   }

  //   // Add locale to mapping data for consistency
  //   const mappingDataWithLocale = {
  //     ...mappingData,
  //     locale: localeToUse
  //   };

  //   const mappingFilePath = this.getMappingFilePath(sourceGuid, targetGuid, localeToUse);
  //   this.createFile(mappingFilePath, JSON.stringify(mappingDataWithLocale, null, 2));

  //   // TODO: PERSISTENCE INTEGRATION POINT
  //   // This is where we would integrate with external persistence services
  //   // for scenarios where mappings need to survive beyond ephemeral agents:
  //   //
  //   // Examples:
  //   // - Upload to cloud storage (AWS S3, Azure Blob, etc.)
  //   // - Save to database (MongoDB, PostgreSQL, etc.)
  //   // - Sync to external API/service
  //   // - Store in shared network drive
  //   //
  //   // Implementation example:
  //   // await this.persistMappingExternally(sourceGuid, targetGuid, mappingDataWithLocale, localeToUse);
  // }

  loadMappingFile(sourceGuid: string, targetGuid: string, locale?: string): any | null {
    const localeToUse = locale || this._locale;

    // First try to load direct mapping file (A→B)
    const mappingFilePath = this.getMappingFilePath(sourceGuid, targetGuid, localeToUse);
    if (this.checkFileExists(mappingFilePath)) {
      try {
        const content = this.readFile(mappingFilePath);
        const mappingData = JSON.parse(content);
        console.log(`[FileOps] Loaded direct mapping file: ${sourceGuid}→${targetGuid}`);
        return mappingData;
      } catch (error) {
        console.error(`Error loading mapping file ${mappingFilePath}:`, error);
      }
    }

    // Try to load reverse mapping file (B→A) for fallback
    const reverseMappingFilePath = this.getReverseMappingFilePath(sourceGuid, targetGuid, localeToUse);
    if (this.checkFileExists(reverseMappingFilePath)) {
      try {
        const content = this.readFile(reverseMappingFilePath);
        const reverseMappingData = JSON.parse(content);
        console.log(`[FileOps] Loaded reverse mapping file: ${targetGuid}→${sourceGuid} (for ${sourceGuid}→${targetGuid} sync)`);
        return reverseMappingData;
      } catch (error) {
        console.error(`Error loading reverse mapping file ${reverseMappingFilePath}:`, error);
      }
    }

    return null;
  }

  clearMappingFile(sourceGuid: string, targetGuid: string, locale?: string): void {
    const localeToUse = locale || this._locale;

    // Clear direct mapping file
    const mappingFilePath = this.getMappingFilePath(sourceGuid, targetGuid, localeToUse);
    if (this.checkFileExists(mappingFilePath)) {
      this.deleteFile(mappingFilePath);
    }
  }

  // Data folder path utilities
  getDataFolderPath(folderName?: string): string {
    if (folderName) {
      return path.join(this._basePath, folderName);
    }
    return this._basePath;
  }

  getFolderPath(folderName?: string): string {
    if (folderName) {
      return path.join(this._basePath, folderName);
    }
    return this._basePath;
  }

  getFilePath(folderName?: string, fileName?: string): string {
    if (folderName && fileName) {
      return path.join(this._basePath, folderName, fileName);
    }
    else if (folderName) {
      return path.join(this._basePath, folderName);
    }
    else if (fileName) {
      return path.join(this._basePath, fileName);
    }
    return this._basePath;
  }

  getDataFilePath(folderName?: string, fileName?: string): string {
    if (folderName && fileName) {
      return path.join(this._basePath, folderName, fileName);
    }
    else if (folderName) {
      return path.join(this._basePath, folderName);
    }
    else if (fileName) {
      return path.join(this._basePath, fileName);
    }
    return this._basePath;
  }

  getNestedSitemapPath(): string {
    return path.join(this._basePath, 'nestedsitemap', 'website.json');
  }

  // Path utilities
  resolveFilePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.resolve(this._basePath, relativePath);
  }

  // JSON file utilities - centralized JSON parsing
  readJsonFile(relativePath: string): any | null {
    try {
      const fullPath = this.getDataFolderPath(relativePath);
      if (!fs.existsSync(fullPath)) {
        return null;
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      return JSON.parse(content);
    } catch (error: any) {
      console.warn(`[FileOps] Error reading JSON file ${relativePath}: ${error.message}`);
      return null;
    }
  }

  readJsonFileAbsolute(absolutePath: string): any | null {
    try {
      const content = fs.readFileSync(absolutePath, 'utf8');
      return JSON.parse(content);
    } catch (error: any) {
      console.warn(`[FileOps] Error reading JSON file ${absolutePath}: ${error.message}`);
    }
  }

  readJsonFilesFromFolder(folderName: string, fileExtension: string = '.json'): any[] {
    try {
      const folderPath = this.getDataFolderPath(folderName);
      if (!fs.existsSync(folderPath)) {
        return [];
      }

      const files = fs.readdirSync(folderPath).filter(file => file.endsWith(fileExtension));
      const results: any[] = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(folderPath, file), 'utf8');
          const parsed = JSON.parse(content);
          results.push(parsed);
        } catch (error: any) {
          console.warn(`[FileOps] Error parsing JSON file ${file}: ${error.message}`);
        }
      }

      return results;
    } catch (error: any) {
      console.warn(`[FileOps] Error reading folder ${folderName}: ${error.message}`);
      return [];
    }
  }

  listFilesInFolder(folderName: string, fileExtension?: string): string[] {
    try {
      const folderPath = this.getDataFolderPath(folderName);
      if (!fs.existsSync(folderPath)) {
        return [];
      }

      let files = fs.readdirSync(folderPath);
      if (fileExtension) {
        files = files.filter(file => file.endsWith(fileExtension));
      }

      return files;
    } catch (error: any) {
      console.warn(`[FileOps] Error listing files in ${folderName}: ${error.message}`);
      return [];
    }
  }

  readTempFile(fileName: string) {
    let appName = 'mgmt-cli-code';
    let tmpFolder = os.tmpDir();
    let tmpDir = `${tmpFolder}/${appName}`;
    let fileData = this.readFile(`${tmpDir}/${fileName}`);
    return fileData;
  }

  createTempFile(fileName: string, content: string) {
    let appName = 'mgmt-cli-code';
    let tmpFolder = os.tmpDir();
    let tmpDir = `${tmpFolder}/${appName}`;
    fs.access(tmpDir, (error) => {
      if (error) {
        fs.mkdirSync(tmpDir);
        this.createFile(`${tmpDir}/${fileName}`, content);
      }
      else {
        this.createFile(`${tmpDir}/${fileName}`, content);
      }
    });
    return tmpDir;
  }

  renameFile(oldFile: string, newFile: string) {
    fs.renameSync(oldFile, newFile);
  }

  readDirectory(folderName: string, baseFolder?: string) {
    if (baseFolder === undefined || baseFolder === '') {
      baseFolder = this._basePath;
    }
    let directory = `${baseFolder}/${folderName}`;

    let files: string[] = [];
    fs.readdirSync(directory).forEach(file => {
      let readFile = this.readFile(`${directory}/${file}`);
      files.push(readFile);
    })

    return files;
  }

  folderExists(folderName: string, baseFolder?: string) {
    if (baseFolder === undefined || baseFolder === '') {
      baseFolder = this._basePath;
    }
    let directory = `${baseFolder}/${folderName}`;
    if (fs.existsSync(directory)) {
      return true;
    }
    else {
      return false;
    }
  }

  codeFileExists() {
    let appName = 'mgmt-cli-code';
    let tmpFolder = os.tmpDir();
    let tmpDir = `${tmpFolder}/${appName}/code.json`;
    if (fs.existsSync(tmpDir)) {
      return true;
    }
    else {
      return false;
    }
  }

  deleteCodeFile() {
    let appName = 'mgmt-cli-code';
    let tmpFolder = os.tmpDir();
    let tmpDir = `${tmpFolder}/${appName}/code.json`;

    if (fs.existsSync(tmpDir)) {

      fs.rmSync(tmpDir);

      console.log('Logged out successfully');
      return true;
    }
    else {
      return false;
    }
  }

  fileExists(path: string) {
    if (fs.existsSync(path)) {
      return true;
    }
    return false;
  }

  cleanup(path: string) {
    if (fs.existsSync(path)) {
      fs.readdirSync(path).forEach((file) => {
        const curPath = `${path}/${file}`;
        if (fs.lstatSync(curPath).isDirectory()) {
          this.cleanup(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(path);
    }
  }

  cliFolderExists() {
    if (fs.existsSync(this._basePath)) {
      return true;
    } else {
      return false;
    }
  }

  public finalizeLogFile(operationType: 'pull' | 'push' | 'sync'): string {
    const now = new Date();

    // Create semantic filename like "2025-may-12-at-10-15-32-am.txt"
    const months = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'
    ];

    const year = now.getFullYear();
    const month = months[now.getMonth()];
    const day = now.getDate();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();
    const ampm = hour >= 12 ? 'pm' : 'am';
    const hour12 = hour % 12 || 12;

    const pad = (num: number) => String(num).padStart(2, '0');
    const semanticTimestamp = `${year}-${month}-${pad(day)}-at-${pad(hour12)}-${pad(minute)}-${pad(second)}-${ampm}`;

    if (!fs.existsSync(this._currentLogFilePath)) {
      // If the initial log file doesn't exist, there's nothing to rename.
      // This might happen if no logging occurred.
      // We can either create an empty one to signify the operation or just return an expected path.
      // For now, let's log a message and return the expected path if it were created.
      console.warn(`\nLog file ${this._currentLogFilePath} not found. Cannot finalize.`);
      const newLogFileName = `${operationType}-${semanticTimestamp}.txt`;
      return path.join(this._instanceLogDir, newLogFileName);
    }

    const newLogFileName = `${operationType}-${semanticTimestamp}.txt`;
    const newLogFilePath = path.join(this._instanceLogDir, newLogFileName);

    try {
      // Ensure the directory exists (it should, if appendLogFile was called)
      if (!fs.existsSync(this._instanceLogDir)) {
        fs.mkdirSync(this._instanceLogDir, { recursive: true });
      }
      fs.renameSync(this._currentLogFilePath, newLogFilePath);
      return newLogFilePath;
    } catch (error) {
      console.error(`Error renaming log file from ${this._currentLogFilePath} to ${newLogFilePath}:`, error);
      // Fallback: return the original path or throw, depending on desired error handling
      return this._currentLogFilePath; // Or throw error;
    }
  }
}
