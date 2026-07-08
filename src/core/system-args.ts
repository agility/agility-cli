/**
 * Standardized system arguments for Agility CLI commands
 * Reusable argument definitions to eliminate duplication across commands
 */

/**
 * Common system arguments that are repeated across multiple commands
 * These should be spread into command builders: ...systemArgs
 */
export const systemArgs = {
  // tokens
  token: {
    describe: "Provide your personal access token. Or use AGILITY_TOKEN from .env file if available.",
    demandOption: false,
    type: "string" as const,
    // default: "",
  },

  // Development/Environment args
  dev: {
    describe: "Enable developer mode",
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
    default: true,
  },

  // Instance/Connection args
  locales: {
    describe:
      "Provide locale(s) for the operation. Comma-separated for multiple locales (e.g., 'en-us,en-ca,fr-fr'). If not provided, all available locales will be auto-detected and used.",
    demandOption: false,
    type: "string" as const,
    alias: ["Locales", "LOCALES"],
    // No default - auto-detection when not specified
  },
  channel: {
    describe:
      "Provide the channel for the operation. If not provided, will use AGILITY_WEBSITE from .env file if available.",
    demandOption: false,
    type: "string" as const,
    default: "website",
  },
  elements: {
    describe:
      "Comma-separated list of elements to process (Models,Galleries,Assets,Containers,Content,Templates,Pages,Sitemaps)",
    demandOption: false,
    type: "string" as const,
    default: "Models,Galleries,Assets,Containers,Content,Templates,Pages,Sitemaps",
  },

  // **NEW: Selective Model-Based Sync Parameter (Task 103)**
  models: {
    describe:
      "Comma-separated list of model reference names to sync. Filters only specified models and their direct content.",
    demandOption: false,
    type: "string" as const,
    default: "",
  },

  // **NEW: Model-Based Sync with Dependencies (Task 20.2)**
  modelsWithDeps: {
    describe:
      "Comma-separated list of model reference names to sync with full dependency tree. Automatically includes all dependent content, pages, assets, galleries, templates, and containers.",
    demandOption: false,
    alias: ["models-with-deps", "modelswithDeps", "ModelsWithDeps", "MODELSWITHSDEPS"],
    type: "string" as const,
    default: "",
  },

  // Preflight (dry-run preview) args
  preflight: {
    describe:
      "Preflight mode (sync/push only): run the full source-pull, target-pull, dependency analysis and change detection, then report the creates/updates/skips/conflicts that a real sync would produce — WITHOUT writing anything to the target instance or mapping files. Exits non-zero if conflicts are detected.",
    demandOption: false,
    type: "boolean" as const,
    alias: ["pre-flight", "Preflight", "PREFLIGHT", "PreFlight"],
    default: false,
  },
  preflightJson: {
    describe:
      "Emit the --preflight report as machine-readable JSON instead of the human-readable summary.",
    demandOption: false,
    type: "boolean" as const,
    alias: ["preflight-json", "preflightjson", "PreflightJson", "PREFLIGHT_JSON"],
    default: false,
  },

  // **Explicit ID Override for Workflow Operations**
  contentIDs: {
    describe:
      "Comma-separated list of target content IDs to process. Bypasses mappings lookup when provided (e.g., --contentIDs=121,1221,345).",
    demandOption: false,
    alias: ["content-ids", "contentIds", "ContentIDs", "CONTENTIDS"],
    type: "string" as const,
    default: "",
  },
  pageIDs: {
    describe:
      "Comma-separated list of target page IDs to process. Bypasses mappings lookup when provided (e.g., --pageIDs=12,11,45).",
    demandOption: false,
    alias: ["page-ids", "pageIds", "PageIDs", "PAGEIDS"],
    type: "string" as const,
    default: "",
  },

  // Instance identification args
  sourceGuid: {
    describe:
      "The source Agility instance GUID — the instance you pull from (and the source for a sync). Comma-separated for multiple instances (e.g., 'guid1,guid2,guid3'). Required for pull and sync; falls back to AGILITY_GUID from your .env file when omitted.",
    alias: [
      "source-guid",
      "sourceguid",
      "source",
      "SourceGuid",
      "SourceGUID",
      "SOURCE",
      "SOURCEGUID",
      "sourceGuids",
      "source-guids",
      "SourceGuids",
      "SOURCEGUIDS",
    ],
    demandOption: false,
    type: "string" as const,
  },
  targetGuid: {
    describe:
      "The target Agility instance GUID — the instance you push/sync to. Comma-separated for multiple instances (e.g., 'guid1,guid2,guid3'). Required for sync and push; falls back to AGILITY_TARGET_GUID from your .env file when omitted.",
    alias: [
      "target-guid",
      "targetguid",
      "target",
      "TargetGuid",
      "TargetGUID",
      "TARGET",
      "TARGETGUID",
      "targetGuids",
      "target-guids",
      "TargetGuids",
      "TARGETGUIDS",
    ],
    demandOption: false,
    type: "string" as const,
  },

  // Force operation args
  overwrite: {
    describe:
      "(sync only) Override target safety conflicts. By default, a target item that has its own changes conflicting with the source is skipped to prevent data loss; with --overwrite those conflicting items are overwritten with the source version. Non-conflicting updates are applied either way. Default: false.",
    type: "boolean" as const,
    alias: ["Overwrite", "OVERWRITE"],
    default: false,
  },

  // Auto-publish after sync
  autoPublish: {
    describe:
      "(sync only) After the sync completes, automatically publish items that were published in the source instance. Accepts 'content' (content items only), 'pages' (pages only), or 'both'. Providing the flag with no value defaults to 'both'; omit the flag to leave synced items unpublished.",
    demandOption: false,
    alias: ["auto-publish", "AutoPublish", "AUTO_PUBLISH", "autopublish"],
    type: "string" as const,
    coerce: (value: string | boolean) => {
      // Handle --autoPublish without value (defaults to 'both')
      if (value === true || value === "") return "both";
      if (value === false) return "";
      const lower = String(value).toLowerCase();
      if (["content", "pages", "both"].includes(lower)) return lower;
      return "both"; // Default to 'both' for any other value
    },
  },
};

/**
 * Type helper for command arguments that include system args
 */
export type SystemArgsType = typeof systemArgs;

export interface SystemArgs {
  help?: boolean;
  version?: boolean;
  pull?: boolean;
  push?: boolean;
  sync?: boolean;
  clean?: boolean;
  generate?: boolean;
  operationType?: string; // Workflow operation: publish, unpublish, approve, decline, requestApproval
  preflight?: boolean; // Preflight mode - report planned sync actions without writing to target/mappings
  preflightJson?: boolean; // Emit the preflight report as machine-readable JSON
  verbose?: boolean;
  overwrite?: boolean;
  elements?: string;
  guid?: string;
  sourceGuid?: string;
  targetGuid?: string;
  locales?: string;
  channel?: string;
  contentIDs?: string; // Explicit content IDs (bypasses mappings)
  pageIDs?: string; // Explicit page IDs (bypasses mappings)
}
