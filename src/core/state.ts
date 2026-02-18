/**
 * Centralized state management for Agility CLI
 * Simple state object that gets populated from argv and referenced throughout the app
 */

import * as mgmtApi from '@agility/management-sdk';
import fs from 'fs';
import path from 'path';
import { Logs, OperationType, EntityType } from './logs';
import { Options } from '@agility/management-sdk';

export interface State {
  // Environment modes
  dev: boolean;
  local: boolean;
  preprod: boolean;

  // UI modes
  headless: boolean;
  verbose: boolean;

  // Instance/Connection
  sourceGuid: string[]; // Array of source GUIDs
  targetGuid: string[]; // Array of target GUIDs
  locale: string[];     // Array of locales (for backward compatibility / user-specified)
  availableLocales: string[]; // Detected locales from getLocales() during auth
  guidLocaleMap: Map<string, string[]>; // Per-GUID locale mapping for matrix operations
  channel: string;
  preview: boolean;
  elements: string;

  // File system
  rootPath: string;
  legacyFolders: boolean;

  // Network/Security
  insecure: boolean;
  baseUrl?: string;

  // Debug/Analysis
  test: boolean;

  // Operation control
  overwrite: boolean;
  force: boolean; // New: Override target safety conflicts
  reset: boolean;
  update: boolean;

  // Workflow operation control
  operationType?: string; // Workflow operation: publish, unpublish, approve, decline, requestApproval
  dryRun: boolean; // Preview mode - show what would be processed without executing
  autoPublish: string; // Auto-publish after sync: 'content', 'pages', 'both', or '' (disabled)

  // Explicit ID overrides (bypass mappings lookup)
  explicitContentIDs: number[]; // Target content IDs to process directly
  explicitPageIDs: number[]; // Target page IDs to process directly

  // Model-specific
  models: string;
  modelsWithDeps: string;

  // Content-specific
  contentItems?: string;

  // Computed UI modes (set by auth.init())
  useHeadless?: boolean;
  useVerbose?: boolean;

  // Auth/API objects (set by auth.init())
  mgmtApiOptions?: any;
  user?: any;
  apiKeyForPull?: string;
  previewKey?: string;
  fetchKey?: string;
  currentWebsite?: any;

  // API Keys for download operations (simplified approach)
  apiKeys: Array<{ guid: string; previewKey: string; fetchKey: string }>;

  // Cached API client instance (to prevent connection pool exhaustion)
  cachedApiClient?: mgmtApi.ApiClient;

  // Centralized logger instance
  logger?: Logs;
  loggerRegistry: Map<string, Logs>; // New: Registry for per-GUID loggers

  // Legacy fields (for backward compatibility)
  token: string | null;
  localServer: string;
  isAgilityDev: boolean;
  forceNGROK: boolean;

  // Push/Pull/Sync flags
  isPush: boolean;
  isPull: boolean;
  isSync: boolean;

  // Failed content registry - tracks content items that failed during sync
  // Used by page pusher to provide better error messages when content mappings are missing
  failedContentRegistry: Map<number, { referenceName: string; error: string; locale: string }>;
}

// Global state - populated from argv and referenced throughout the app
export const state: State = {
  // Environment modes
  dev: false,
  local: false,
  preprod: false,

  // UI modes
  headless: false,
  verbose: false,

  // Instance/Connection
  sourceGuid: [],
  targetGuid: [],
  locale: [],
  availableLocales: [],
  guidLocaleMap: new Map(),
  apiKeys: [],
  channel: "website",
  preview: true,
  elements: "Models,Galleries,Assets,Containers,Content,Templates,Pages,Sitemaps",

  // File system
  rootPath: "agility-files",
  legacyFolders: false,

  // Network/Security
  insecure: false,
  baseUrl: undefined,

  // Debug/Analysis
  test: false,

  // Operation control
  overwrite: false,
  force: false,
  reset: false,
  update: true,
  dryRun: false,
  autoPublish: '', // Empty string = disabled

  // Explicit ID overrides (bypass mappings lookup)
  explicitContentIDs: [],
  explicitPageIDs: [],

  // Model-specific
  models: "",
  modelsWithDeps: "",

  // Content-specific
  contentItems: undefined,

  // Cached API client instance (to prevent connection pool exhaustion)
  cachedApiClient: undefined,

  // Centralized logger instance
  logger: undefined,
  loggerRegistry: new Map(),

  // Legacy fields (for backward compatibility)
  token: null,
  localServer: "",
  isAgilityDev: false,
  forceNGROK: false,
  isPush: false,
  isPull: false,
  isSync: false,

  // Failed content registry - tracks content items that failed during sync
  failedContentRegistry: new Map(),
};

/**
 * Set state from command line arguments
 */
export function setState(argv: any) {
  // Environment modes
  if (argv.dev !== undefined) state.dev = argv.dev;
  if (argv.local !== undefined) state.local = argv.local;
  if (argv.preprod !== undefined) state.preprod = argv.preprod;

  // UI modes
  if (argv.headless !== undefined) state.headless = argv.headless;
  if (argv.verbose !== undefined) state.verbose = argv.verbose;

  // Instance/Connection - Multi-GUID parsing logic
  if (argv.sourceGuid !== undefined) {
    if (argv.sourceGuid.includes(',')) {
      // Multi-GUID specification
      state.sourceGuid = argv.sourceGuid.split(',')
        .map((g: string) => g.trim())
        .filter((g: string) => g.length > 0);
    } else {
      // Single GUID
      state.sourceGuid = [argv.sourceGuid];
    }
  }

  if (argv.targetGuid !== undefined) {
    if (argv.targetGuid.includes(',')) {
      // Multi-GUID specification
      state.targetGuid = argv.targetGuid.split(',')
        .map((g: string) => g.trim())
        .filter((g: string) => g.length > 0);
    } else {
      // Single GUID
      state.targetGuid = [argv.targetGuid];
    }
  }

  // Multi-locale parsing logic
  if (argv.locale !== undefined) {
    if (argv.locale.trim() === "") {
      // Empty string = auto-detection
      state.locale = [];
    } else if (argv.locale.includes(',') || argv.locale.includes(' ')) {
      // Multi-locale specification
      state.locale = argv.locale.split(/[,\s]+/)
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0);
    } else {
      // Single locale
      state.locale = [argv.locale];
    }
  }

  if (argv.channel !== undefined) state.channel = argv.channel;
  if (argv.preview !== undefined) state.preview = argv.preview;
  if (argv.elements !== undefined) state.elements = argv.elements;

  // File system
  if (argv.rootPath !== undefined) state.rootPath = argv.rootPath;
  if (argv.legacyFolders !== undefined) state.legacyFolders = argv.legacyFolders;

  // Network/Security
  if (argv.insecure !== undefined) state.insecure = argv.insecure;
  if (argv.baseUrl !== undefined) state.baseUrl = argv.baseUrl;

  // Debug/Analysis
  if (argv.test !== undefined) state.test = argv.test;

  // Operation control
  if (argv.overwrite !== undefined) state.overwrite = argv.overwrite;
  if (argv.force !== undefined) state.force = argv.force;
  if (argv.reset !== undefined) state.reset = argv.reset;
  if (argv.update !== undefined) state.update = argv.update;

  // Workflow operation control
  if (argv.operationType !== undefined) state.operationType = argv.operationType;
  if (argv.dryRun !== undefined) state.dryRun = argv.dryRun;
  if (argv.autoPublish !== undefined) state.autoPublish = argv.autoPublish;

  // Explicit ID overrides - parse comma-separated strings into number arrays
  if (argv.contentIDs !== undefined && argv.contentIDs !== "") {
    state.explicitContentIDs = String(argv.contentIDs)
      .split(',')
      .map((id: string) => parseInt(id.trim(), 10))
      .filter((id: number) => !isNaN(id) && id > 0);
  }
  if (argv.pageIDs !== undefined && argv.pageIDs !== "") {
    state.explicitPageIDs = String(argv.pageIDs)
      .split(',')
      .map((id: string) => parseInt(id.trim(), 10))
      .filter((id: number) => !isNaN(id) && id > 0);
  }
  
  // Direct array assignment for programmatic use (e.g., auto-publish)
  if (argv.explicitContentIDs !== undefined && Array.isArray(argv.explicitContentIDs)) {
    state.explicitContentIDs = argv.explicitContentIDs;
  }
  if (argv.explicitPageIDs !== undefined && Array.isArray(argv.explicitPageIDs)) {
    state.explicitPageIDs = argv.explicitPageIDs;
  }

  // Model-specific
  if (argv.models !== undefined) state.models = argv.models;
  if (argv.modelsWithDeps !== undefined) state.modelsWithDeps = argv.modelsWithDeps;

  // Content-specific
  if (argv.contentItems !== undefined) state.contentItems = argv.contentItems;

  // Token authentication
  if (argv.token !== undefined) state.token = argv.token;
}

/**
 * Configure SSL verification based on CLI mode
 */
export function configureSSL() {
  if (state.local) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    console.warn("\nWarning: SSL certificate verification is disabled for development/local mode");
  }
}

/**
 * Prime state from .env file before setState() is called
 * This allows .env values to be overridden by command line arguments
 */
export function primeFromEnv(): { hasEnvFile: boolean; primedValues: string[] } {
  const envFiles = ['.env', '.env.local', '.env.development', '.env.production'];
  const primedValues: string[] = [];

  // Match KEY=value only on uncommented lines (line start or after newline, optional whitespace, no #)
  const uncommentedLine = (key: string) => new RegExp(`(?:^|\\n)\\s*${key}=([^\\n]+)`, 'm');

  for (const envFile of envFiles) {
    const envPath = path.join(process.cwd(), envFile);
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');

      // Parse all relevant environment variables (uncommented lines only)
      const envVars = {
        AGILITY_GUID: envContent.match(uncommentedLine('AGILITY_GUID')),
        AGILITY_TARGET_GUID: envContent.match(uncommentedLine('AGILITY_TARGET_GUID')),
        AGILITY_WEBSITE: envContent.match(uncommentedLine('AGILITY_WEBSITE')),
        AGILITY_LOCALES: envContent.match(uncommentedLine('AGILITY_LOCALES')),
        AGILITY_TEST: envContent.match(uncommentedLine('AGILITY_TEST')),
        AGILITY_OVERWRITE: envContent.match(uncommentedLine('AGILITY_OVERWRITE')),

        AGILITY_PREVIEW: envContent.match(uncommentedLine('AGILITY_PREVIEW')),
        AGILITY_VERBOSE: envContent.match(uncommentedLine('AGILITY_VERBOSE')),
        AGILITY_HEADLESS: envContent.match(uncommentedLine('AGILITY_HEADLESS')),
        AGILITY_ELEMENTS: envContent.match(uncommentedLine('AGILITY_ELEMENTS')),
        AGILITY_ROOT_PATH: envContent.match(uncommentedLine('AGILITY_ROOT_PATH')),
        AGILITY_BASE_URL: envContent.match(uncommentedLine('AGILITY_BASE_URL')),
        AGILITY_DEV: envContent.match(uncommentedLine('AGILITY_DEV')),
        AGILITY_LOCAL: envContent.match(uncommentedLine('AGILITY_LOCAL')),
        AGILITY_PREPROD: envContent.match(uncommentedLine('AGILITY_PREPROD')),
        AGILITY_LEGACY_FOLDERS: envContent.match(uncommentedLine('AGILITY_LEGACY_FOLDERS')),
        AGILITY_INSECURE: envContent.match(uncommentedLine('AGILITY_INSECURE')),

        AGILITY_MODELS: envContent.match(uncommentedLine('AGILITY_MODELS')),
        AGILITY_TOKEN: envContent.match(uncommentedLine('AGILITY_TOKEN')),
      };

      // Only prime state values that aren't already set from command line
      if (envVars.AGILITY_GUID && envVars.AGILITY_GUID[1] && state.sourceGuid.length === 0) {
        state.sourceGuid = [envVars.AGILITY_GUID[1].trim()];
        primedValues.push('sourceGuid');
      }

      if (envVars.AGILITY_WEBSITE && envVars.AGILITY_WEBSITE[1] && !state.channel) {
        state.channel = envVars.AGILITY_WEBSITE[1].trim();
        primedValues.push('channel');
      }

      if (envVars.AGILITY_LOCALES && envVars.AGILITY_LOCALES[1] && state.locale.length === 0) {
        state.locale = envVars.AGILITY_LOCALES[1].trim().split(',');
        primedValues.push('locale');
      }

      // Handle boolean flags - prefer command line args over .env
      if (envVars.AGILITY_TEST && envVars.AGILITY_TEST[1] && state.test === undefined) {
        state.test = envVars.AGILITY_TEST[1].trim().toLowerCase() === 'true';
        primedValues.push('test');
      }

      if (envVars.AGILITY_OVERWRITE && envVars.AGILITY_OVERWRITE[1] && state.overwrite === undefined) {
        state.overwrite = envVars.AGILITY_OVERWRITE[1].trim().toLowerCase() === 'true';
        primedValues.push('overwrite');
      }

      if (envVars.AGILITY_PREVIEW && envVars.AGILITY_PREVIEW[1] && state.preview === undefined) {
        state.preview = envVars.AGILITY_PREVIEW[1].trim().toLowerCase() === 'true';
        primedValues.push('preview');
      }

      if (envVars.AGILITY_VERBOSE && envVars.AGILITY_VERBOSE[1] && state.verbose === undefined) {
        state.verbose = envVars.AGILITY_VERBOSE[1].trim().toLowerCase() === 'true';
        primedValues.push('verbose');
      }

      if (envVars.AGILITY_HEADLESS && envVars.AGILITY_HEADLESS[1] && state.headless === undefined) {
        state.headless = envVars.AGILITY_HEADLESS[1].trim().toLowerCase() === 'true';
        primedValues.push('headless');
      }

      if (envVars.AGILITY_ELEMENTS && envVars.AGILITY_ELEMENTS[1] && !state.elements) {
        state.elements = envVars.AGILITY_ELEMENTS[1].trim();
        primedValues.push('elements');
      }

      if (envVars.AGILITY_ROOT_PATH && envVars.AGILITY_ROOT_PATH[1] && !state.rootPath) {
        state.rootPath = envVars.AGILITY_ROOT_PATH[1].trim();
        primedValues.push('rootPath');
      }

      if (envVars.AGILITY_BASE_URL && envVars.AGILITY_BASE_URL[1] && !state.baseUrl) {
        state.baseUrl = envVars.AGILITY_BASE_URL[1].trim();
        primedValues.push('baseUrl');
      }

      // Additional system args
      if (envVars.AGILITY_TARGET_GUID && envVars.AGILITY_TARGET_GUID[1] && state.targetGuid.length === 0) {
        state.targetGuid = [envVars.AGILITY_TARGET_GUID[1].trim()];
        primedValues.push('targetGuid');
      }

      if (envVars.AGILITY_DEV && envVars.AGILITY_DEV[1] && state.dev === undefined) {
        state.dev = envVars.AGILITY_DEV[1].trim().toLowerCase() === 'true';
        primedValues.push('dev');
      }

      if (envVars.AGILITY_LOCAL && envVars.AGILITY_LOCAL[1] && state.local === undefined) {
        state.local = envVars.AGILITY_LOCAL[1].trim().toLowerCase() === 'true';
        primedValues.push('local');
      }

      if (envVars.AGILITY_PREPROD && envVars.AGILITY_PREPROD[1] && state.preprod === undefined) {
        state.preprod = envVars.AGILITY_PREPROD[1].trim().toLowerCase() === 'true';
        primedValues.push('preprod');
      }

      if (envVars.AGILITY_LEGACY_FOLDERS && envVars.AGILITY_LEGACY_FOLDERS[1] && state.legacyFolders === undefined) {
        state.legacyFolders = envVars.AGILITY_LEGACY_FOLDERS[1].trim().toLowerCase() === 'true';
        primedValues.push('legacyFolders');
      }

      if (envVars.AGILITY_INSECURE && envVars.AGILITY_INSECURE[1] && state.insecure === undefined) {
        state.insecure = envVars.AGILITY_INSECURE[1].trim().toLowerCase() === 'true';
        primedValues.push('insecure');
      }

      if (envVars.AGILITY_MODELS && envVars.AGILITY_MODELS[1] && !state.models) {
        state.models = envVars.AGILITY_MODELS[1].trim();
        primedValues.push('models');
      }

      if (envVars.AGILITY_TOKEN && envVars.AGILITY_TOKEN[1] && !state.token) {
        // Strip quotes from token value if present
        let tokenValue = envVars.AGILITY_TOKEN[1].trim();
        if ((tokenValue.startsWith('"') && tokenValue.endsWith('"')) ||
            (tokenValue.startsWith("'") && tokenValue.endsWith("'"))) {
          tokenValue = tokenValue.slice(1, -1).trim();
        }
        // Only prime token when we actually have a non-empty value
        if (tokenValue.length > 0) {
          state.token = tokenValue;
          process.env.AGILITY_TOKEN = tokenValue;
          primedValues.push('token');
        }
      }

      if (primedValues.length > 0) {
        return { hasEnvFile: true, primedValues };
      }
    }
  }

  return { hasEnvFile: false, primedValues: [] };
}

/**
 * Reset state to default values (called at start of each command)
 * Prevents contamination between command executions
 */
export function resetState() {
  // Environment modes
  state.dev = false;
  state.local = false;
  state.preprod = false;

  // UI modes
  state.headless = false;
  state.verbose = false;

  // Instance/Connection
  state.sourceGuid = [];
  state.targetGuid = [];
  state.locale = [];
  state.availableLocales = [];
  state.guidLocaleMap = new Map();
  state.apiKeys = [];
  state.channel = "website";
  state.preview = true;
  state.elements = "Models,Galleries,Assets,Containers,Content,Templates,Pages,Sitemaps";

  // File system
  state.rootPath = "agility-files";
  state.legacyFolders = false;

  // Network/Security
  state.insecure = false;
  state.baseUrl = undefined;

  // Debug/Analysis
  state.test = false;

  // Operation control
  state.overwrite = false;
  state.force = false;
  state.reset = false;
  state.update = true;

  // Workflow operation control
  state.operationType = undefined;
  state.dryRun = false;

  // Explicit ID overrides
  state.explicitContentIDs = [];
  state.explicitPageIDs = [];

  // Model-specific
  state.models = "";

  // Content-specific
  state.contentItems = undefined;

  // Clear computed properties
  state.useHeadless = undefined;
  state.useVerbose = undefined;

  // Clear auth/API objects
  state.mgmtApiOptions = undefined;
  state.user = undefined;
  state.apiKeyForPull = undefined;
  state.previewKey = undefined;
  state.fetchKey = undefined;
  state.currentWebsite = undefined;

  // Legacy fields
  state.token = null;
  state.localServer = "";
  state.isAgilityDev = false;
  state.forceNGROK = false;
}

/**
 * Get the current state
 */
export function getState() {
  return state;
}

/**
 * Get or create ApiClient - reuses cached instance to prevent connection pool exhaustion
 * This ensures the client always uses current auth state while maintaining connection efficiency
 */
export function getApiClient(): mgmtApi.ApiClient {
  // Check if we already have a cached client
  if (state.cachedApiClient) {
    return state.cachedApiClient;
  }

  // Create new client using current auth state
  if (!state.mgmtApiOptions) {
    // throw new Error('Management API options not initialized. Call auth.init() first.');
  }

  if(!state.mgmtApiOptions && !state.token) {
    throw new Error('Management API options not initialized. Call auth.init() first.');
  } else if (!state.mgmtApiOptions && state.token) {
    state.mgmtApiOptions = new Options();
    state.mgmtApiOptions.token = state.token;
    // Ensure baseUrl is set for local/dev/preprod modes
    if (state.baseUrl) {
      state.mgmtApiOptions.baseUrl = state.baseUrl;
    }
  }
  // Create and cache the client
  state.cachedApiClient = new mgmtApi.ApiClient(state.mgmtApiOptions);
  return state.cachedApiClient;
}

/**
 * @deprecated Use getApiClient() instead - this function is kept for backward compatibility
 */
export function createApiClient(): mgmtApi.ApiClient {
  return getApiClient();
}

/**
 * Clear the cached API client - forces creation of new instance on next getApiClient() call
 */
export function clearApiClient(): void {
  state.cachedApiClient = undefined;
}

/**
 * Get computed UI mode based on state
 */
export function getUIMode() {
  const useHeadless = state.headless;
  const useVerbose = !useHeadless && state.verbose;

  return {
    useHeadless,
    useVerbose,
  };
}

/**
 * Get API keys for a specific GUID
 */
export function getApiKeysForGuid(guid: string): { previewKey: string; fetchKey: string } | null {
  const apiKeyEntry = state.apiKeys.find(item => item.guid === guid);
  return apiKeyEntry ? { previewKey: apiKeyEntry.previewKey, fetchKey: apiKeyEntry.fetchKey } : null;
}

/**
 * Get all API keys
 */
export function getAllApiKeys(): Array<{ guid: string; previewKey: string; fetchKey: string }> {
  return state.apiKeys;
}

/**
 * Validate locale format (e.g., en-us, fr-ca, es-es)
 */
export function validateLocaleFormat(locale: string): boolean {
  const localeRegex = /^[a-z]{2}-[a-z]{2}$/i;
  return localeRegex.test(locale);
}

/**
 * Validate array of locales and return valid/invalid splits
 */
export function validateLocales(locales: string[]): { valid: string[], invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const locale of locales) {
    if (validateLocaleFormat(locale)) {
      valid.push(locale);
    } else {
      invalid.push(locale);
    }
  }

  return { valid, invalid };
}

/**
 * Initialize centralized logger for the current operation
 */
export function initializeLogger(operationType: OperationType): Logs {
  state.logger = new Logs(operationType);
  
  // Configure based on current state
  state.logger.configure({
    logToConsole: !state.headless,
    logToFile: true,
    showColors: !state.headless,
    useStructuredFormat: true
  });
  
  return state.logger;
}

/**
 * Initialize a per-GUID logger for parallel operations
 */
export function initializeGuidLogger(guid: string, operationType: OperationType, entityType?: EntityType): Logs {
  if (!state.loggerRegistry) {
    state.loggerRegistry = new Map();
  }
  
  const logger = new Logs(operationType, entityType, guid);
  
  // Configure based on current state
  logger.configure({
    logToConsole: !state.headless,
    logToFile: true,
    showColors: !state.headless,
    useStructuredFormat: true
  });
  
  state.loggerRegistry.set(guid, logger);
  return logger;
}

/**
 * Get logger for a specific GUID
 */
export function getLoggerForGuid(guid: string): Logs | null {
  if (!state.loggerRegistry) {
    return null;
  }
  
  const logger = state.loggerRegistry.get(guid);
  if (logger && !logger.getGuid()) {
    // Ensure the logger has the GUID set
    logger.setGuid(guid);
  }
  
  return logger || null;
}

/**
 * Get the current global logger instance
 */
export function getLogger(): Logs | null {
  return state.logger || null;
}

/**
 * Save and clear a specific GUID logger
 */
export function finalizeGuidLogger(guid: string): string | null {
  if (state.loggerRegistry && state.loggerRegistry.has(guid)) {
    const guidLogger = state.loggerRegistry.get(guid);
    if (guidLogger) {
      const result = guidLogger.saveLogs();
      state.loggerRegistry.delete(guid);
      return result;
    }
  }
  return null;
}

/**
 * Save and clear all GUID loggers and merge into global log
 */
export function finalizeAllGuidLoggers(): string[] {
  const results: string[] = [];
  
  if (state.loggerRegistry) {
    const entries = Array.from(state.loggerRegistry.entries());
    
    for (const [guid, logger] of entries) {
      const logCount = logger.getLogCount();
      
      if (logCount > 0) {
        const result = logger.saveLogs();
        if (result) {
          results.push(result);
          console.log(`${result}`);
        }
      }
    }
    state.loggerRegistry.clear();
  }
  
  return results;
}

/**
 * Finalize and save the global logger
 */
export function finalizeLogger(): string | null {
  if (state.logger) {
    const result = state.logger.saveLogs();
    state.logger = undefined;
    
    // Return result without automatically displaying it
    // The calling code will handle display if needed
    return result;
  }
  return null;
}

export function startTimer(): void {
  if (state.logger) {
    state.logger.startTimer();
  }
}

export function endTimer(): void {
  if (state.logger) {
    state.logger.endTimer();
  }
}


/**
 * Clear the current logger from state
 */
export function clearLogger(): void {
  state.logger = undefined;
}

// ============================================================================
// Failed Content Registry
// Tracks content items that failed during sync so page pusher can provide
// better error messages when content mappings are missing
// ============================================================================

/**
 * Register a failed content item
 * @param contentID - The source content ID that failed
 * @param referenceName - The reference name of the content item
 * @param error - The error message
 * @param locale - The locale being processed
 */
export function registerFailedContent(
  contentID: number,
  referenceName: string,
  error: string,
  locale: string
): void {
  state.failedContentRegistry.set(contentID, { referenceName, error, locale });
}

/**
 * Look up a failed content item by its source content ID
 * @param contentID - The source content ID to look up
 * @returns The failure info if found, or undefined
 */
export function getFailedContent(contentID: number): { referenceName: string; error: string; locale: string } | undefined {
  return state.failedContentRegistry.get(contentID);
}

/**
 * Clear the failed content registry (should be called at start of each sync)
 */
export function clearFailedContentRegistry(): void {
  state.failedContentRegistry.clear();
}

/**
 * Get the CMS app URL based on environment
 * - dev/local/preprod: app-qa.publishwithagility.com
 * - prod: app.agilitycms.com
 */
export function getCmsAppUrl(): string {
  if (state.dev || state.local || state.preprod) {
    return 'https://app-qa.publishwithagility.com';
  }
  return 'https://app.agilitycms.com';
}

/**
 * Generate a link to a page in the CMS app
 */
export function getPageCmsLink(guid: string, locale: string, pageID: number): string {
  return `${getCmsAppUrl()}/instance/${guid}/${locale}/pages/page-${pageID}`;
}

/**
 * Generate a link to a content item in the CMS app
 * URL format: /content/item-{containerID}/listitem-{contentID}
 * The containerID can be arbitrary (using 0) - only the listitem ID matters for navigation
 */
export function getContentCmsLink(guid: string, locale: string, contentID: number): string {
  return `${getCmsAppUrl()}/instance/${guid}/${locale}/content/item-0/listitem-${contentID}`;
}

/**
 * Check if a content item file exists in source data
 */
export function contentExistsInSourceData(guid: string, locale: string, contentID: number): boolean {
  const fs = require('fs');
  const path = require('path');
  const contentPath = path.join(process.cwd(), state.rootPath, guid, locale, 'item', `${contentID}.json`);
  return fs.existsSync(contentPath);
}

/**
 * Check if a content item exists in another locale but not the current one
 * Returns the locale where it exists, or null if not found anywhere
 */
export function contentExistsInOtherLocale(guid: string, currentLocale: string, contentID: number): string | null {
  const fs = require('fs');
  const path = require('path');
  
  // Get the guid folder and find all locale folders
  const guidPath = path.join(process.cwd(), state.rootPath, guid);
  if (!fs.existsSync(guidPath)) return null;
  
  const entries = fs.readdirSync(guidPath, { withFileTypes: true });
  const localeFolders = entries
    .filter((entry: any) => entry.isDirectory() && entry.name !== 'models' && entry.name !== currentLocale)
    .map((entry: any) => entry.name);
  
  // Check each locale for the content item
  for (const locale of localeFolders) {
    const contentPath = path.join(guidPath, locale, 'item', `${contentID}.json`);
    if (fs.existsSync(contentPath)) {
      return locale;
    }
  }
  
  return null;
}
