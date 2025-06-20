/**
 * Standardized system arguments for Agility CLI commands
 * Reusable argument definitions to eliminate duplication across commands
 */

/**
 * Common system arguments that are repeated across multiple commands
 * These should be spread into command builders: ...systemArgs
 */
export const systemArgs = {
  // Development/Environment args
  dev: {
    describe: "Enable developer mode",
    type: "boolean" as const,
    default: false,
  },
  local: {
    describe: "Enable local mode",
    type: "boolean" as const,
    default: false,
  },
  preprod: {
    describe: "Enable preprod mode", 
    type: "boolean" as const,
    default: false,
  },
  
  // UI/Output args
  headless: {
    describe: "Turn off the experimental Blessed UI for operations.",
    type: "boolean" as const,
    default: false,
  },
  verbose: {
    describe: "Run in verbose mode: all logs to console, no UI elements. Overridden by headless.",
    type: "boolean" as const,
    default: false,
  },
  blessed: {
    describe: "Use the experimental Blessed UI for operations.",
    type: "boolean" as const,
    default: true,
  },
  
  // File system args
  rootPath: {
    describe: "Specify the root path for the operation.",
    demandOption: false,
    default: "agility-files",
    type: "string" as const,
  },
  legacyFolders: {
    describe: "Use legacy folder structure (all files in root agility-files folder).",
    demandOption: false,
    type: "boolean" as const,
    default: false,
  },
  
  // Instance/Connection args
  locale: {
    describe: "Provide the locale for the operation. If not provided, will use AGILITY_LOCALES from .env file if available.",
    demandOption: false,
    type: "string" as const,
    default: "en-us"
  },
  channel: {
    describe: "Provide the channel for the operation. If not provided, will use AGILITY_WEBSITE from .env file if available.",
    demandOption: false,
    type: "string" as const,
    default: "website"
  },
  preview: {
    describe: "Whether to use preview or live environment data.",
    demandOption: false,
    type: "boolean" as const,
    default: true,
  },
  elements: {
    describe: "Comma-separated list of elements to process (Models,Galleries,Assets,Containers,Content,Templates,Pages)",
    demandOption: false,
    type: "string" as const,
    default: "Models,Galleries,Assets,Containers,Content,Templates,Pages",
  },

  // Network/Security args
  insecure: {
    describe: "Disable SSL certificate verification",
    type: "boolean" as const,
    default: false,
  },
  baseUrl: {
    describe: "(Optional) Specify a base URL for the Agility API, if different from default.",
    type: "string" as const
  },
  

  

  
  // **NEW: Selective Model-Based Sync Parameter (Task 103)**
  models: {
    describe: "Comma-separated list of model reference names to sync. Automatically includes all dependent content, pages, assets, and galleries.",
    demandOption: false,
    type: "string" as const,
    default: "",
  },
  
  // Debug/Analysis args
  test: {
    describe: "Enable test mode: bypasses authentication checks for analysis-only operations. Shows detailed analysis and debugging information.",
    demandOption: false,
    type: "boolean" as const,
    default: false,
  },
  
  // Instance identification args
  sourceGuid: {
    describe: "Provide the source instance GUID. If not provided, will use AGILITY_GUID from .env file if available.",
    demandOption: false,
    type: "string" as const,
  },
  targetGuid: {
    describe: "Provide the target instance GUID for sync operations.",
    demandOption: false,
    type: "string" as const,
  },

  // Force operation args
  overwrite: {
    describe: "Force overwrite existing local files and metadata. Used in pull operations.",
    type: "boolean" as const,
    default: false
  }
};

/**
 * Type helper for command arguments that include system args
 */
export type SystemArgsType = typeof systemArgs; 