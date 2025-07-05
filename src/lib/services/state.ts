/**
 * Centralized state management for Agility CLI
 * Simple state object that gets populated from argv and referenced throughout the app
 */

import * as mgmtApi from '@agility/management-sdk';
import fs from 'fs';
import path from 'path';

interface CliState {
  // Environment modes
  dev: boolean;
  local: boolean;
  preprod: boolean;
  
  // UI modes
  headless: boolean;
  verbose: boolean;
  blessed: boolean;
  
  // Instance/Connection
  sourceGuid?: string;
  targetGuid?: string;
  locale: string;
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
  reset: boolean;
  update: boolean;
  
  // Publishing control  
  publish: boolean;
  
  // Batch processing control
  noBatch: boolean;
  
  // Model-specific
  models: string;
  
  // Content-specific
  contentItems?: string;
  
  // Computed UI modes (set by auth.init())
  useHeadless?: boolean;
  useVerbose?: boolean;
  useBlessed?: boolean;
  
  // Auth/API objects (set by auth.init())
  mgmtApiOptions?: any;
  apiClient?: mgmtApi.ApiClient; // Lazy-loaded API client
  user?: any;
  apiKeyForPull?: string;
  previewKey?: string;
  fetchKey?: string;
  currentWebsite?: any;
  
  // Legacy fields (for backward compatibility)
  token: string | null;
  localServer: string;
  isAgilityDev: boolean;
  forceNGROK: boolean;
}

// Global state - populated from argv and referenced throughout the app
export const state: CliState = {
  // Environment modes
  dev: false,
  local: false,
  preprod: false,
  
  // UI modes
  headless: false,
  verbose: false,
  blessed: true,
  
  // Instance/Connection
  locale: "en-us",
  channel: "website",
  preview: true,
  elements: "Models,Galleries,Assets,Containers,Content,Templates,Pages",
  
  // File system
  rootPath: "agility-files",
  legacyFolders: false,
  
  // Network/Security
  insecure: false,
  
  // Debug/Analysis
  test: false,
  
  // Operation control
  overwrite: false,
  reset: false,
  update: true,
  
  // Publishing control
  publish: false,
  
  // Batch processing control
  noBatch: false,
  
  // Model-specific
  models: "",
  
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
  if (argv.blessed !== undefined) state.blessed = argv.blessed;
  
  // Instance/Connection
  if (argv.sourceGuid !== undefined) state.sourceGuid = argv.sourceGuid;
  if (argv.targetGuid !== undefined) state.targetGuid = argv.targetGuid;
  if (argv.locale !== undefined) state.locale = argv.locale;
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
  if (argv.reset !== undefined) state.reset = argv.reset;
  if (argv.update !== undefined) state.update = argv.update;
  
  // Publishing control
  if (argv.publish !== undefined) state.publish = argv.publish;
  
  // Batch processing control
  if (argv.noBatch !== undefined) state.noBatch = argv.noBatch;
  
  // Model-specific
  if (argv.models !== undefined) state.models = argv.models;
  
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
        AGILITY_BLESSED: envContent.match(/AGILITY_BLESSED=([^\n]+)/),
        AGILITY_LEGACY_FOLDERS: envContent.match(/AGILITY_LEGACY_FOLDERS=([^\n]+)/),
        AGILITY_INSECURE: envContent.match(/AGILITY_INSECURE=([^\n]+)/),
        
        AGILITY_MODELS: envContent.match(/AGILITY_MODELS=([^\n]+)/),
      };

      // Only prime state values that aren't already set from command line
      if (envVars.AGILITY_GUID && envVars.AGILITY_GUID[1] && !state.sourceGuid) {
        state.sourceGuid = envVars.AGILITY_GUID[1].trim();
        primedValues.push('sourceGuid');
      }
      
      if (envVars.AGILITY_WEBSITE && envVars.AGILITY_WEBSITE[1] && !state.channel) {
        state.channel = envVars.AGILITY_WEBSITE[1].trim();
        primedValues.push('channel');
      }
      
      if (envVars.AGILITY_LOCALES && envVars.AGILITY_LOCALES[1] && !state.locale) {
        state.locale = envVars.AGILITY_LOCALES[1].trim().split(',')[0];
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
      if (envVars.AGILITY_TARGET_GUID && envVars.AGILITY_TARGET_GUID[1] && !state.targetGuid) {
        state.targetGuid = envVars.AGILITY_TARGET_GUID[1].trim();
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

      if (envVars.AGILITY_BLESSED && envVars.AGILITY_BLESSED[1] && state.blessed === undefined) {
        state.blessed = envVars.AGILITY_BLESSED[1].trim().toLowerCase() === 'true';
        primedValues.push('blessed');
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
  state.blessed = true;
  
  // Instance/Connection
  state.sourceGuid = undefined;
  state.targetGuid = undefined;
  state.locale = "en-us";
  state.channel = "website";
  state.preview = true;
  state.elements = "Models,Galleries,Assets,Containers,Content,Templates,Pages";
  
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
  state.reset = false;
  state.update = true;
  
  // Publishing control
  state.publish = false;
  
  // Batch processing control
  state.noBatch = false;
  
  // Model-specific
  state.models = "";
  
  // Content-specific
  state.contentItems = undefined;
  
  // Clear computed properties
  state.useHeadless = undefined;
  state.useVerbose = undefined;
  state.useBlessed = undefined;
  
  // Clear auth/API objects
  state.mgmtApiOptions = undefined;
  state.apiClient = undefined;
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
 * Get or create ApiClient - lazy instantiation on first use
 * This ensures the client is only created when actually needed and uses current auth state
 */
export function getApiClient(): mgmtApi.ApiClient {
  // Return existing client if available
  if (state.apiClient) {
    return state.apiClient;
  }

  // Create new client on first use
  if (!state.mgmtApiOptions) {
    throw new Error('Management API options not initialized. Call auth.init() first.');
  }
  
  // Create and store the client for reuse
  state.apiClient = new mgmtApi.ApiClient(state.mgmtApiOptions);
  return state.apiClient;
}

/**
 * @deprecated Use getApiClient() instead - this function is kept for backward compatibility
 */
export function createApiClient(): mgmtApi.ApiClient {
  return getApiClient();
}

/**
 * Clear the cached API client (useful when auth state changes)
 */
export function clearApiClient(): void {
  state.apiClient = undefined;
}

/**
 * Get computed UI mode based on state
 */
export function getUIMode() {
  const useHeadless = state.headless;
  const useVerbose = !useHeadless && state.verbose;
  const useBlessed = !useHeadless && !useVerbose && state.blessed;
  
  return {
    useHeadless,
    useVerbose,
    useBlessed
  };
} 