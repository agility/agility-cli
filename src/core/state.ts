/**
 * Centralized state management for Agility CLI
 * Simple state object that gets populated from argv and referenced throughout the app
 */

import * as mgmtApi from '@agility/management-sdk';
import fs from 'fs';
import path from 'path';

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

  // Publishing control
  publish: boolean;

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

  // Legacy fields (for backward compatibility)
  token: string | null;
  localServer: string;
  isAgilityDev: boolean;
  forceNGROK: boolean;
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

  // Debug/Analysis
  test: false,

  // Operation control
  overwrite: false,
  force: false,
  reset: false,
  update: true,

  // Publishing control
  publish: false,

  // Model-specific
  models: "",
  modelsWithDeps: "",

  // Cached API client instance (to prevent connection pool exhaustion)
  cachedApiClient: undefined,

  // Content-specific
  contentItems: undefined,

  // Legacy fields
  token: null,
  localServer: "",
  isAgilityDev: false,
  forceNGROK: false,
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

  // Publishing control
  if (argv.publish !== undefined) state.publish = argv.publish;

  // Model-specific
  if (argv.models !== undefined) state.models = argv.models;
  if (argv.modelsWithDeps !== undefined) state.modelsWithDeps = argv.modelsWithDeps;

  // Content-specific
  if (argv.contentItems !== undefined) state.contentItems = argv.contentItems;
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

  for (const envFile of envFiles) {
    const envPath = path.join(process.cwd(), envFile);
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');

      // Parse all relevant environment variables
      const envVars = {
        AGILITY_GUID: envContent.match(/AGILITY_GUID=([^\n]+)/),
        AGILITY_TARGET_GUID: envContent.match(/AGILITY_TARGET_GUID=([^\n]+)/),
        AGILITY_WEBSITE: envContent.match(/AGILITY_WEBSITE=([^\n]+)/),
        AGILITY_LOCALES: envContent.match(/AGILITY_LOCALES=([^\n]+)/),
        AGILITY_TEST: envContent.match(/AGILITY_TEST=([^\n]+)/),
        AGILITY_OVERWRITE: envContent.match(/AGILITY_OVERWRITE=([^\n]+)/),

        AGILITY_PREVIEW: envContent.match(/AGILITY_PREVIEW=([^\n]+)/),
        AGILITY_VERBOSE: envContent.match(/AGILITY_VERBOSE=([^\n]+)/),
        AGILITY_HEADLESS: envContent.match(/AGILITY_HEADLESS=([^\n]+)/),
        AGILITY_ELEMENTS: envContent.match(/AGILITY_ELEMENTS=([^\n]+)/),
        AGILITY_ROOT_PATH: envContent.match(/AGILITY_ROOT_PATH=([^\n]+)/),
        AGILITY_BASE_URL: envContent.match(/AGILITY_BASE_URL=([^\n]+)/),
        AGILITY_DEV: envContent.match(/AGILITY_DEV=([^\n]+)/),
        AGILITY_LOCAL: envContent.match(/AGILITY_LOCAL=([^\n]+)/),
        AGILITY_PREPROD: envContent.match(/AGILITY_PREPROD=([^\n]+)/),
        AGILITY_LEGACY_FOLDERS: envContent.match(/AGILITY_LEGACY_FOLDERS=([^\n]+)/),
        AGILITY_INSECURE: envContent.match(/AGILITY_INSECURE=([^\n]+)/),

        AGILITY_MODELS: envContent.match(/AGILITY_MODELS=([^\n]+)/),
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

  // Publishing control
  state.publish = false;

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
    throw new Error('Management API options not initialized. Call auth.init() first.');
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
 * Resolve locales for operation
 * Uses specified locales or stored available locales from auth.init
 */
export function resolveLocales(): string[] {
  // If locales already specified, use them
  if (state.locale && state.locale.length > 0) {
    console.log(`Using specified locales: ${state.locale.join(', ')}`);
    return state.locale;
  }

  // Use available locales detected during auth.init
  if (state.availableLocales && state.availableLocales.length > 0) {
    console.log(`Using auto-detected locales: ${state.availableLocales.join(', ')}`);

    // Update state with detected locales for consistency
    state.locale = state.availableLocales;

    return state.availableLocales;
  }

  // Fallback if no locales available
  console.log('⚠️  No locales available, falling back to en-us');
  return ['en-us'];
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
