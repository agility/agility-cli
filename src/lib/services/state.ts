/**
 * Centralized state management for Agility CLI
 * Simple state object that gets populated from argv and referenced throughout the app
 */

import * as mgmtApi from '@agility/management-sdk';

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