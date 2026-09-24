#!/usr/bin/env node

// Enable TypeScript path mapping at runtime
const { register } = require("tsconfig-paths");
register({
  baseUrl: __dirname,
  paths: {
    "lib/*": ["lib/*"],
    "core/*": ["core/*"],
    core: ["core"],
    "types/*": ["types/*"],
  },
});

import * as yargs from "yargs";

import colors from "ansi-colors";
import inquirer from "inquirer";
import searchList from "inquirer-search-list";
inquirer.registerPrompt("search-list", searchList);

import {
  Auth,
  state,
  setState,
  resetState,
  enableReverseSync,
  primeFromEnv,
  systemArgs,
  workflowArgs,
  normalizeProcessArgs,
  normalizeArgv,
} from "./core";
import { Pull } from "./core/pull";
import { Push } from "./core/push";
import { WorkflowOperation } from "./lib/workflows";

import { initializeLogger, getLogger, finalizeLogger } from "./core/state";
import { emitAbortSummary } from "./core/json-summary";

let auth: Auth;

// TODO: Do not hardcode this
yargs.exitProcess(false);

console.log(colors.yellow("Welcome to Agility CLI."));

// Default command - shows instructions when no command is provided
yargs.command({
  command: "$0",
  describe: "Default command - shows available commands",
  handler: function () {
    console.log(colors.cyan("\nAvailable commands:"));
    console.log(colors.white("  pull              - Pull your Agility instance locally"));
    console.log(colors.white("  push              - Push your instance to a target instance"));
    console.log(colors.white("  sync              - Sync your instance (alias for push with updates enabled)"));
    console.log(
      colors.white("  reverse-sync      - Sync the target back to the source, reusing the original mapping files")
    );
    console.log(
      colors.white("  workflowOperation - Perform workflow operations (publish, unpublish, approve, decline)")
    );
    console.log(colors.white("\nFor more information, use: --help"));
    console.log("");
  },
});

yargs.command({
  command: "login",
  describe: "Login to Agility.",
  builder: {
    ...systemArgs,
    // Add any login-specific args here if needed
  },
  handler: async function (argv) {
    resetState(); // Clear any previous command state

    // Normalize argv to handle rich text editor character conversions
    argv = normalizeArgv(argv);

    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(", ")}`));
    }

    setState(argv);
    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      console.log(colors.red("You are not authorized to login."));
      return;
    } else {
      console.log(
        colors.green(
          "You are now logged in, you can now use the CLI commands such as 'pull', 'push', 'sync', 'genenv', etc."
        )
      );
      process.exit(0);
    }
  },
});

yargs.command({
  command: "logout",
  describe: "Log out of Agility.",
  builder: {
    // System args (commonly repeated across commands)
    ...systemArgs,
  },
  handler: async function (argv) {
    resetState(); // Clear any previous command state

    // Normalize argv to handle rich text editor character conversions
    argv = normalizeArgv(argv);

    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(", ")}`));
    }

    setState(argv);
    auth = new Auth();
    await auth.logout();
  },
});

yargs.command({
  command: "pull",
  describe: "Pull your Agility instance locally.",
  builder: {
    // System args (commonly repeated across commands)
    ...systemArgs,
  },
  handler: async function (argv) {
    resetState(); // Clear any previous command state

    // Normalize argv to handle rich text editor character conversions
    argv = normalizeArgv(argv);

    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(", ")}`));
    }

    setState(argv);
    state.isPull = true;

    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      return;
    }

    // Validate pull command requirements
    const isValidCommand = await auth.validateCommand("pull");
    if (!isValidCommand) {
      return;
    }

    const pull = new Pull();
    await pull.pullInstances();
  },
});

// New 2-Pass Sync Command using the enhanced dependency system
yargs.command({
  command: "push",
  aliases: ["sync"],
  describe: "Push your instance using the new 2-pass dependency system.",
  builder: {
    // Override targetGuid to be required for push
    targetGuid: {
      describe: "Provide the target instance GUID to push your instance to.",
      demandOption: true,
      type: "string",
    },

    // System args (commonly repeated across commands)
    ...systemArgs,
  },
  handler: async function (argv) {
    const invokedAs = Array.isArray(argv._) && argv._.length > 0 ? String(argv._[0]) : "";
    await runPushCommand(argv, invokedAs === "sync" ? "sync" : "push");
  },
});

// Reverse Sync (PROD-2526): push the ORIGINAL target back to the ORIGINAL source, reusing the
// forward sync's mapping files. --sourceGuid/--targetGuid are the same pair you used for `sync`.
yargs.command({
  command: "reverse-sync",
  describe:
    "Sync the target instance back to the source instance, reusing (and updating) the mapping files from the original sync. Pass the same --sourceGuid/--targetGuid as the forward sync.",
  builder: {
    // System args first so the per-command overrides below win (a later spread would clobber them).
    // Both guids are required, but NOT via yargs demandOption: they may come from .env
    // (AGILITY_GUID / AGILITY_TARGET_GUID via primeFromEnv), and enableReverseSync() gives a
    // clear error if either is still missing after that.
    ...systemArgs,

    sourceGuid: {
      ...systemArgs.sourceGuid,
      describe:
        "The ORIGINAL source instance GUID from the forward sync (this run writes INTO it). Required; falls back to AGILITY_GUID from .env.",
    },
    targetGuid: {
      ...systemArgs.targetGuid,
      describe:
        "The ORIGINAL target instance GUID from the forward sync (this run reads FROM it). Required; falls back to AGILITY_TARGET_GUID from .env.",
    },
  },
  handler: async function (argv) {
    await runPushCommand(argv, "reverse-sync");
  },
});

/**
 * Shared handler for push / sync / reverse-sync.
 *
 * Order matters for reverse-sync: enableReverseSync() must run after setState() (so it sees the
 * original pair) and before auth.init()/validateCommand() (which pin the Management API base URL
 * and API keys to state.targetGuid — i.e. the instance being written to).
 */
async function runPushCommand(argv: any, mode: "push" | "sync" | "reverse-sync"): Promise<void> {
  resetState(); // Clear any previous command state

  // Normalize argv to handle rich text editor character conversions
  argv = normalizeArgv(argv);

  // Prime state from .env file before applying command line args
  const envPriming = primeFromEnv();
  if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
    console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(", ")}`));
  }

  setState(argv);

  // mark whether this invocation is a sync, a reverse sync, or a push
  if (mode === "reverse-sync") {
    try {
      enableReverseSync();
    } catch (error: any) {
      console.log(colors.red(`\n❌ ${error.message}`));
      process.exit(1);
    }
  } else if (mode === "sync") {
    state.isSync = true;
  } else {
    state.isPush = true;
  }

  const runStartedAt = new Date();

  auth = new Auth();
  const isAuthorized = await auth.init();
  if (!isAuthorized) {
    // PROD-2310, same class as the precondition abort below: failing to authenticate is
    // an abort with zero work done, not a successful no-op. Returning here exited 0, so a
    // CI job with expired or wrong credentials went green having synced nothing.
    emitAbortSummary(state, "Authentication failed — could not resolve API keys for the requested instances.", runStartedAt);
    process.exit(1);
  }

  // Validate sync command requirements
  const isValidCommand = await auth.validateCommand("push");
  if (!isValidCommand) {
    // PROD-2310: a failed precondition (e.g. a requested locale missing on the target)
    // is an abort with zero work done — it must exit non-zero so CI can detect it,
    // instead of returning silently with exit code 0.
    emitAbortSummary(state, "Command validation failed — a precondition for this sync was not met.", runStartedAt);
    process.exit(1);
  }

  const push = new Push();
  try {
    // PROD-2310: honor the sync result. The handler previously ignored the returned
    // { success }, so a sync with failed items or failed auto-publish still exited 0.
    const result = await push.pushInstances();
    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    // PROD-2310: a hard-stop abort (e.g. model-validation failure) throws out of
    // pushInstances. The error is already logged inside pushInstances; exit non-zero
    // here rather than relying on unhandled-rejection behavior for the exit code.
    process.exit(1);
  }
}

// Workflow operation command - performs workflow operations on content/pages from existing mappings
yargs.command({
  command: "workflows",
  aliases: ["workflow"],
  describe:
    "Perform workflow operations (publish, unpublish, approve, decline, requestApproval) on content and pages from existing mappings.",
  builder: {
    sourceGuid: {
      describe: "Source instance GUID (from the original sync).",
      demandOption: true,
      type: "string",
    },
    targetGuid: {
      describe: "Target instance GUID to perform workflow operation on.",
      demandOption: true,
      type: "string",
    },
    list: {
      describe: "List available mapping pairs instead of running operation.",
      type: "boolean",
      default: false,
    },
    // Workflow operation type for batch workflow operations
    operationType: {
      describe:
        "Workflow operation to perform: publish, unpublish, approve, decline, or requestApproval. Used with workflowOperation command.",
      type: "string" as const,
      alias: ["operation-type", "operationType", "OperationType", "OPERATION_TYPE", "op", "type"],
      choices: ["publish", "unpublish", "approve", "decline", "requestApproval"],
      // default: "publish",
      coerce: (value: string) => {
        if (!value) return "publish";
        const lower = String(value).toLowerCase();
        // Normalize various input formats
        switch (lower) {
          case "publish":
          case "pub":
            return "publish";
          case "unpublish":
          case "unpub":
            return "unpublish";
          case "approve":
          case "app":
            return "approve";
          case "decline":
          case "dec":
            return "decline";
          case "requestapproval":
          case "request-approval":
          case "request_approval":
          case "req":
            return "requestApproval";
          default:
            return "publish";
        }
      },
    },
    // System args (commonly repeated across commands)
    ...systemArgs,
    // Explicit content/page ID overrides — only meaningful for workflow operations (PROD-2230)
    ...workflowArgs,
  },
  handler: async function (argv) {
    resetState(); // Clear any previous command state

    // Normalize argv to handle rich text editor character conversions
    argv = normalizeArgv(argv);

    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(", ")}`));
    }

    setState(argv);

    // If --list flag, just list available mappings
    if (argv.list) {
      const workflowOp = new WorkflowOperation();
      workflowOp.listMappings();
      return;
    }

    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      return;
    }

    // Validate command requirements
    const isValidCommand = await auth.validateCommand("push");
    if (!isValidCommand) {
      return;
    }

    const workflowOp = new WorkflowOperation();
    const result = await workflowOp.executeFromMappings();

    if (!result.success) {
      process.exit(1);
    }
  },
});

// Normalize process.argv to handle rich text editor character conversions
// (e.g., em dashes, curly quotes from Word/Notepad)
normalizeProcessArgs();

yargs.parse();
