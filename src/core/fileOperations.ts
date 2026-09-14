import * as fs from "fs";
import * as Https from "https";
import * as path from "path";
const os = require("os");
import { state } from "./state";
os.tmpDir = os.tmpdir;

/**
 * Transpose a single mapping record's `source*` / `target*` fields (PROD-2526).
 *
 * Every mapper interface in src/lib/mappers follows the convention that each direction-specific
 * field comes as a pair: `sourceID`/`targetID`, `sourceContentID`/`targetContentID`,
 * `sourceReferenceName`/`targetReferenceName`, `sourceGuid`/`targetGuid`, etc. Swapping the
 * values of each pair converts a record between A→B and B→A orientation. Keys without the
 * prefix (e.g. url redirection `originUrl`) are direction-agnostic and left untouched.
 *
 * A `source*` key with no `target*` counterpart (or vice versa) is renamed to its counterpart
 * so the swap stays lossless and idempotent (transpose(transpose(x)) === x).
 */
export function transposeMappingRecord<T extends Record<string, any>>(record: T): T {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return record;
  }

  const result: Record<string, any> = {};
  for (const key of Object.keys(record)) {
    if (key.startsWith("source")) {
      result[`target${key.slice("source".length)}`] = record[key];
    } else if (key.startsWith("target")) {
      result[`source${key.slice("target".length)}`] = record[key];
    } else {
      result[key] = record[key];
    }
  }
  return result as T;
}

export function transposeMappingRecords<T extends Record<string, any>>(records: T[]): T[] {
  if (!Array.isArray(records)) {
    return records;
  }
  return records.map((record) => transposeMappingRecord(record));
}

export class fileOperations {
  private _rootPath: string;
  private _guid: string;
  private _locale: string;
  private _resolvedRootPath: string;
  private _basePath: string;
  private _instanceLogDir: string;
  private _currentLogFilePath: string;
  private _isGuidLevel: boolean;
  private _mappingsPath: string;

  constructor(guid: string, locale?: string) {
    this._rootPath = state.rootPath;
    this._guid = guid;
    this._isGuidLevel = locale === undefined || locale === null || locale === "";
    this._locale = locale ?? "";

    // Keep paths relative instead of resolving to absolute paths
    // This prevents files from being written to /Users/ directories
    this._resolvedRootPath = state.rootPath;

    // Nested folder structure: rootPath/guid[/locale]
    this._basePath = this._isGuidLevel
      ? path.join(this._resolvedRootPath, this._guid)
      : path.join(this._resolvedRootPath, this._guid, this._locale);
    this._mappingsPath = path.join(this._resolvedRootPath, this._guid, "mappings");
    this._instanceLogDir = path.join(this._basePath, "logs");

    this._currentLogFilePath = path.join(this._instanceLogDir, "instancelog.txt");
  }

  // Public getters for path access
  public get instancePath(): string {
    return this._basePath;
  }

  public get mappingsPath(): string {
    return this._mappingsPath;
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
    let cleaned = text.replace(/\x1b\[[0-9;]*m/g, "");

    // Clean up JSON formatting: replace \n with actual newlines for better readability
    cleaned = cleaned.replace(/\\n/g, "\n");

    // Remove unnecessary escaped quotes in JSON context
    cleaned = cleaned.replace(/\\"/g, '"');

    return cleaned;
  }

  /**
   * Sanitize an object by removing non-serializable properties (like HTTPS Agents)
   * This prevents "Converting circular structure to JSON" errors when saving SDK responses
   */
  private sanitizeForJson(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj !== "object") {
      return obj;
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeForJson(item));
    }

    // Skip known non-serializable types
    const constructorName = obj.constructor?.name;
    if (
      constructorName === "Agent" ||
      constructorName === "ClientRequest" ||
      constructorName === "IncomingMessage" ||
      constructorName === "Socket" ||
      constructorName === "TLSSocket"
    ) {
      return undefined;
    }

    // Create a clean copy of the object
    const cleanObj: any = {};
    for (const key of Object.keys(obj)) {
      // Skip properties that are likely to contain circular references
      if (
        key === "agent" ||
        key === "_httpMessage" ||
        key === "socket" ||
        key === "connection" ||
        key === "request" ||
        key === "response" ||
        key === "_events" ||
        key === "_eventsCount" ||
        key === "httpsAgent" ||
        key === "httpAgent"
      ) {
        continue;
      }

      const value = obj[key];

      // Skip functions
      if (typeof value === "function") {
        continue;
      }

      // Recursively sanitize nested objects
      const sanitizedValue = this.sanitizeForJson(value);
      if (sanitizedValue !== undefined) {
        cleanObj[key] = sanitizedValue;
      }
    }

    return cleanObj;
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

    // Sanitize the object to remove non-serializable properties (like HTTPS Agents)
    // This prevents "Converting circular structure to JSON" errors with --local mode
    const sanitizedObject = this.sanitizeForJson(extractedObject);
    fs.writeFileSync(fileName, JSON.stringify(sanitizedObject));
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
    if (baseFolder === undefined || baseFolder === "") {
      baseFolder = this._basePath;
    }
    if (!fs.existsSync(`${baseFolder}`)) {
      fs.mkdirSync(`${baseFolder}`);
    }
    if (!fs.existsSync(`${baseFolder}/${folder}`)) {
      fs.mkdirSync(`${baseFolder}/${folder}`);
    }
    let fileName = `${baseFolder}/${folder}/${fileIdentifier}.txt`;
    fs.closeSync(fs.openSync(fileName, "w"));
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
      let currentPath = "";
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
      console.error("Error in createFolder:", error);
      return false;
    }
  }

  createBaseFolder(folder?: string) {
    if (folder === undefined || folder === "") {
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

  getFolderContents(folder: string) {
    // A scoped run (e.g. a models-only sync) legitimately skips downloading some
    // element types, so their instance subfolder is never created. Create the
    // folder on demand and return an empty listing instead of throwing ENOENT,
    // matching how readJsonFilesFromFolder/listFilesInFolder already degrade.
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
      return [];
    }
    return fs.readdirSync(folder);
  }

  async downloadFile(url: string, targetFile: string): Promise<{ headers: Record<string, any> }> {
    return await new Promise((resolve, reject) => {
      // Ensure the target directory exists
      const targetDir = path.dirname(targetFile);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      Https.get(url, (response) => {
        const code = response.statusCode ?? 0;

        if (code >= 400) {
          return reject(new Error(response.statusMessage));
        }

        if (code > 300 && code < 400 && !!response.headers.location) {
          return resolve(this.downloadFile(response.headers.location, targetFile));
        }

        const fileWriter = fs
          .createWriteStream(targetFile)
          .on("finish", () => {
            // Surface the response headers so callers can capture image metadata
            // (e.g. focal point) that the CDN/blob returns as headers.
            resolve({ headers: response.headers });
          })
          .on("error", (err) => {
            reject(err);
          });

        response.pipe(fileWriter);
      }).on("error", (error) => {
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

  saveFileToPath(filename: string, content: string, filePath: string) {
    fs.writeFileSync(path.join(filePath, filename), content);
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

  /**
   * Resolve which on-disk mapping pair a (sourceGuid, targetGuid) request refers to.
   *
   * Normally the identity. During a reverse sync (PROD-2526) the pipeline runs with swapped
   * guids, but the mapping files must stay in `mappings/{origSource}-{origTarget}` with their
   * original orientation. So a request for the swapped pair resolves to the original pair and
   * flags that records need their source/target fields transposed on the way in and out.
   */
  private resolveMappingPair(
    sourceGuid: string,
    targetGuid: string
  ): { sourceGuid: string; targetGuid: string; transpose: boolean } {
    const pair = state.mappingPair;
    if (
      state.reverseSync &&
      pair &&
      sourceGuid &&
      targetGuid &&
      sourceGuid === pair.targetGuid &&
      targetGuid === pair.sourceGuid
    ) {
      return { sourceGuid: pair.sourceGuid, targetGuid: pair.targetGuid, transpose: true };
    }
    return { sourceGuid, targetGuid, transpose: false };
  }

  getMappingFilePath(sourceGuid: string, targetGuid: string, locale?: string | null): string {
    // Store mappings centrally in /agility-files/mappings/ instead of per-instance
    const pair = this.resolveMappingPair(sourceGuid, targetGuid);
    return path.join(this._rootPath, "mappings", `${pair.sourceGuid}-${pair.targetGuid}`, locale ?? "");
  }

  getMappingFile(type: string, sourceGuid: string, targetGuid: string, locale?: string | null): any[] {
    const pair = this.resolveMappingPair(sourceGuid, targetGuid);
    const centralMappingsPath = path.join(
      this._rootPath,
      "mappings",
      `${pair.sourceGuid}-${pair.targetGuid}`,
      locale ?? "",
      type
    );
    if (fs.existsSync(centralMappingsPath)) {
      const fullPath = path.join(centralMappingsPath, "mappings.json");
      if (!fs.existsSync(fullPath)) {
        //initialize empty mappings file if it doesn't exist
        fs.writeFileSync(fullPath, "[]");
      }
      const data = fs.readFileSync(fullPath, "utf8");
      const jsonData = JSON.parse(data);
      return pair.transpose ? transposeMappingRecords(jsonData) : jsonData;
    } else {
      return [];
    }
  }

  saveMappingFile(
    mappingData: any[],
    type?: string,
    sourceGuid?: string,
    targetGuid?: string,
    locale?: string | null
  ): void {
    const pair = this.resolveMappingPair(sourceGuid, targetGuid);
    const mappingRootPath = this.getMappingFilePath(sourceGuid, targetGuid, locale);
    const centralMappingsPath = path.join(mappingRootPath, type);

    // Preflight (PROD-2203): never persist mapping changes. Pushers already
    // short-circuit before reaching here, but this is a hard safety net so no
    // mapping file can be written while previewing a sync.
    if (state.preflight) {
      return;
    }

    const mappingFilePath = path.join(centralMappingsPath, `mappings.json`);

    if (!fs.existsSync(centralMappingsPath)) {
      fs.mkdirSync(centralMappingsPath, { recursive: true });
    }

    const dataToWrite = pair.transpose ? transposeMappingRecords(mappingData) : mappingData;

    // This will overwrite the existing mappings.json file.
    fs.writeFileSync(mappingFilePath, JSON.stringify(dataToWrite, null, 2));
  }

  /**
   * Snapshot an entire mapping pair directory before a run that rewrites it (PROD-2526).
   *
   * Copies `mappings/{sourceGuid}-{targetGuid}` to
   * `mappings-backups/{sourceGuid}-{targetGuid}/{timestamp}`. The backup lives outside
   * `mappings/` so `listAvailableMappingPairs()` never mistakes it for a real pair.
   *
   * Returns the backup path, or null when there is nothing to back up.
   */
  backupMappingPair(sourceGuid: string, targetGuid: string): string | null {
    const pairDir = `${sourceGuid}-${targetGuid}`;
    const sourceDir = path.join(this._rootPath, "mappings", pairDir);
    if (!fs.existsSync(sourceDir)) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(this._rootPath, "mappings-backups", pairDir, timestamp);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.cpSync(sourceDir, backupDir, { recursive: true });
    return backupDir;
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
    } else if (folderName) {
      return path.join(this._basePath, folderName);
    } else if (fileName) {
      return path.join(this._basePath, fileName);
    }
    return this._basePath;
  }

  getDataFilePath(folderName?: string, fileName?: string): string {
    if (folderName && fileName) {
      return path.join(this._basePath, folderName, fileName);
    } else if (folderName) {
      return path.join(this._basePath, folderName);
    } else if (fileName) {
      return path.join(this._basePath, fileName);
    }
    return this._basePath;
  }

  getNestedSitemapPath(): string {
    return path.join(this._basePath, "nestedsitemap", "website.json");
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
      const content = fs.readFileSync(fullPath, "utf8");
      return JSON.parse(content);
    } catch (error: any) {
      console.warn(`[FileOps] Error reading JSON file ${relativePath}: ${error.message}`);
      return null;
    }
  }

  readJsonFileAbsolute(absolutePath: string): any | null {
    try {
      const content = fs.readFileSync(absolutePath, "utf8");
      return JSON.parse(content);
    } catch (error: any) {
      return null;
      // console.warn(`[FileOps] Error reading JSON file ${absolutePath}: ${error.message}`);
    }
  }

  readJsonFilesFromFolder(folderName: string, fileExtension: string = ".json"): any[] {
    try {
      const folderPath = this.getDataFolderPath(folderName);
      if (!fs.existsSync(folderPath)) {
        return [];
      }

      const files = fs.readdirSync(folderPath).filter((file) => file.endsWith(fileExtension));
      const results: any[] = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(folderPath, file), "utf8");
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
        files = files.filter((file) => file.endsWith(fileExtension));
      }

      return files;
    } catch (error: any) {
      console.warn(`[FileOps] Error listing files in ${folderName}: ${error.message}`);
      return [];
    }
  }

  readTempFile(fileName: string) {
    let appName = "mgmt-cli-code";
    let tmpFolder = os.tmpDir();
    let tmpDir = `${tmpFolder}/${appName}`;
    let fileData = this.readFile(`${tmpDir}/${fileName}`);
    return fileData;
  }

  createTempFile(fileName: string, content: string) {
    let appName = "mgmt-cli-code";
    let tmpFolder = os.tmpDir();
    let tmpDir = `${tmpFolder}/${appName}`;
    fs.access(tmpDir, (error) => {
      if (error) {
        fs.mkdirSync(tmpDir);
        this.createFile(`${tmpDir}/${fileName}`, content);
      } else {
        this.createFile(`${tmpDir}/${fileName}`, content);
      }
    });
    return tmpDir;
  }

  renameFile(oldFile: string, newFile: string) {
    fs.renameSync(oldFile, newFile);
  }

  readDirectory(folderName: string, baseFolder?: string) {
    if (baseFolder === undefined || baseFolder === "") {
      baseFolder = this._basePath;
    }
    let directory = `${baseFolder}/${folderName}`;

    let files: string[] = [];
    fs.readdirSync(directory).forEach((file) => {
      let readFile = this.readFile(`${directory}/${file}`);
      files.push(readFile);
    });

    return files;
  }

  folderExists(folderName: string, baseFolder?: string) {
    if (baseFolder === undefined || baseFolder === "") {
      baseFolder = this._basePath;
    }
    let directory = `${baseFolder}/${folderName}`;
    if (fs.existsSync(directory)) {
      return true;
    } else {
      return false;
    }
  }

  codeFileExists() {
    let appName = "mgmt-cli-code";
    let tmpFolder = os.tmpDir();
    let tmpDir = `${tmpFolder}/${appName}/code.json`;
    if (fs.existsSync(tmpDir)) {
      return true;
    } else {
      return false;
    }
  }

  deleteCodeFile() {
    let appName = "mgmt-cli-code";
    let tmpFolder = os.tmpDir();
    let tmpDir = `${tmpFolder}/${appName}/code.json`;

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir);

      console.log("Logged out successfully");
      return true;
    } else {
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

  public finalizeLogFile(operationType: "pull" | "push" | "sync"): string {
    const now = new Date();

    // Create semantic filename like "2025-may-12-at-10-15-32-am.txt"
    const months = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];

    const year = now.getFullYear();
    const month = months[now.getMonth()];
    const day = now.getDate();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();
    const ampm = hour >= 12 ? "pm" : "am";
    const hour12 = hour % 12 || 12;

    const pad = (num: number) => String(num).padStart(2, "0");
    const semanticTimestamp = `${year}-${month}-${pad(day)}-at-${pad(hour12)}-${pad(minute)}-${pad(second)}-${ampm}`;

    if (!fs.existsSync(this._currentLogFilePath)) {
      // If the initial log file doesn't exist, there's nothing to rename.
      // This might happen if no logging occurred.
      // We can either create an empty one to signify the operation or just return an expected path.
      // For now, let's log a message and return the expected path if it were created.
      // console.warn(`\nLog file ${this._currentLogFilePath} not found. Cannot finalize.`);
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
