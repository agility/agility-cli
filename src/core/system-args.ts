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
      "Comma-separated list of elements to process (Models,Galleries,Assets,Containers,Content,Templates,Pages,Sitemaps,UrlRedirections)",
    demandOption: false,
    type: "string" as const,
    default: "Models,Galleries,Assets,Containers,Content,Templates,Pages,Sitemaps,UrlRedirections",
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

  // **Selective page sync (PROD-2546)**
  pages: {
    describe:
      "(sync/push only) Sync only these pages and everything beneath them. Accepts a comma-separated list of page paths (e.g. '/my-lottery'), page names, or page IDs. Each selected page brings its child pages and the templates, content, models, containers, assets and galleries those pages need — nothing else is synced. The resolved page tree is printed before anything is written. Parent pages of a selection are NOT synced, and must already exist in the target. Cannot be combined with --models or --models-with-deps.",
    demandOption: false,
    alias: ["Pages", "PAGES", "page", "Page"],
    type: "string" as const,
    default: "",
  },

  // **Selective container sync (PROD-2547)**
  containers: {
    describe:
      "(sync/push only) Sync only these content containers and what they depend on. Accepts a comma-separated list of container reference names, container titles, or container IDs. Use it when several containers share one model and you want to promote just one of them — unlike --models-with-deps, the other containers on that model are left alone. Brings the content in the selected containers, the content it links to, the containers holding that linked content, the models behind all of it, and the assets and galleries it points at. No pages, templates or URL redirections are touched. The resolved scope is printed before anything is written. Cannot be combined with --models, --models-with-deps or --pages.",
    demandOption: false,
    alias: ["Containers", "CONTAINERS", "container", "Container"],
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

  // Machine-readable run summary
  jsonSummary: {
    describe:
      "(sync/push only) Write a machine-readable JSON summary of the run to this path: per-phase success/failure/skip counts, failure and warning details, the exit signal, and the preflight plan when --preflight is used. Intended for CI assertions and test harnesses; parent directories are created, and a write failure warns rather than failing the run.",
    demandOption: false,
    alias: ["json-summary", "jsonsummary", "JsonSummary", "JSONSUMMARY"],
    type: "string" as const,
    default: "",
  },

  // Instance identification args
  sourceGuid: {
    describe:
      "The source Agility instance GUID — the instance you pull from (and the source for a sync). Required for pull and sync; falls back to AGILITY_GUID from your .env file when omitted.",
    alias: ["source-guid", "sourceguid", "source", "SourceGuid", "SourceGUID", "SOURCE", "SOURCEGUID"],
    demandOption: false,
    type: "string" as const,
  },
  targetGuid: {
    describe:
      "The target Agility instance GUID — the instance you push/sync to. Required for sync and push; falls back to AGILITY_TARGET_GUID from your .env file when omitted.",
    alias: ["target-guid", "targetguid", "target", "TargetGuid", "TargetGUID", "TARGET", "TARGETGUID"],
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
 * Args exclusive to the `workflows` command (PROD-2230).
 *
 * These bypass the mappings lookup for workflow operations (publish/unpublish/
 * approve/decline). They must NOT be spread into pull/push/sync's builders —
 * those commands never read state.explicitContentIDs/explicitPageIDs (only
 * lib/workflows/workflow-operation.ts does), so showing them there previously
 * advertised a filter that silently did nothing.
 */
export const workflowArgs = {
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
  verbose?: boolean;
  overwrite?: boolean;
  elements?: string;
  guid?: string;
  sourceGuid?: string;
  targetGuid?: string;
  locales?: string;
  channel?: string;
  pages?: string; // Selective page sync: page paths / names / IDs to scope the sync to
  containers?: string; // Selective container sync: container reference names / titles / IDs to scope the sync to
  contentIDs?: string; // Explicit content IDs (bypasses mappings)
  pageIDs?: string; // Explicit page IDs (bypasses mappings)
  jsonSummary?: string; // Path to write the machine-readable run summary to
}
