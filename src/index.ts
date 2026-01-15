#!/usr/bin/env node

// Enable TypeScript path mapping at runtime
const { register } = require('tsconfig-paths');
register({
  baseUrl: __dirname,
  paths: {
    'lib/*': ['lib/*'],
    'core/*': ['core/*'],
    'core': ['core'],
    'types/*': ['types/*']
  }
});

import * as yargs from "yargs";

import colors from "ansi-colors";
import inquirer from "inquirer";
import searchList from "inquirer-search-list";
inquirer.registerPrompt("search-list", searchList);

import { Auth, state, setState, resetState, primeFromEnv, systemArgs, normalizeProcessArgs, normalizeArgv } from "./core";
import { Pull } from "./core/pull";
import { Push } from "./core/push";
import { WorkflowOperation } from "./lib/workflows";

import { initializeLogger, getLogger, finalizeLogger, finalizeAllGuidLoggers } from "./core/state";

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
    console.log(colors.white("  workflowOperation - Perform workflow operations (publish, unpublish, approve, decline)"));
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
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(', ')}`));
    }

    setState(argv);
    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      console.log(colors.red("You are not authorized to login."));
      return;
    } else {
      console.log(colors.green("You are now logged in, you can now use the CLI commands such as 'pull', 'push', 'sync', 'genenv', etc."));
      process.exit(0);
    }
  },
});

yargs.command({
  command: "logout",
  describe: "Log out of Agility.",
  builder: {
    // System args (commonly repeated across commands)
    ...systemArgs
  },
  handler: async function (argv) {
    resetState(); // Clear any previous command state

    // Normalize argv to handle rich text editor character conversions
    argv = normalizeArgv(argv);

    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(', ')}`));
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
    ...systemArgs
  },
  handler: async function (argv) {
    resetState(); // Clear any previous command state

    // Normalize argv to handle rich text editor character conversions
    argv = normalizeArgv(argv);

    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(', ')}`));
    }

    setState(argv);
    state.update = true; // Ensure updates are enabled for pull
    state.isPull = true;
    
    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      return;
    }

    // Validate pull command requirements
    const isValidCommand = await auth.validateCommand('pull');
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
    ...systemArgs
  },
  handler: async function (argv) {

    const invokedAs = Array.isArray(argv._) && argv._.length > 0 ? String(argv._[0]) : "";
    const isSync = invokedAs === "sync";

    resetState(); // Clear any previous command state

    // Normalize argv to handle rich text editor character conversions
    argv = normalizeArgv(argv);

    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(', ')}`));
    }

    setState(argv);

    // if the user is "syncing", we need to turn on the updates to the downloaders
    if (isSync) {
      state.update = true;
      state.isSync = true;
    } else {
      state.isPush = true;
    }

    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      return;
    }

    // Validate sync command requirements
    const isValidCommand = await auth.validateCommand('push');
    if (!isValidCommand) {
      return;
    }

    const push = new Push();
    await push.pushInstances();

  }
})

// Workflow operation command - performs workflow operations on content/pages from existing mappings
yargs.command({
  command: "workflows",
  aliases: ["workflow"],
  describe: "Perform workflow operations (publish, unpublish, approve, decline, requestApproval) on content and pages from existing mappings.",
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
      describe: "Workflow operation to perform: publish, unpublish, approve, decline, or requestApproval. Used with workflowOperation command.",
      type: "string" as const,
      alias: ["operation-type", "operationType", "OperationType", "OPERATION_TYPE", "op","type"],
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
      }
    },
    // System args (commonly repeated across commands)
    ...systemArgs
  },
  handler: async function (argv) {
    resetState(); // Clear any previous command state

    // Normalize argv to handle rich text editor character conversions
    argv = normalizeArgv(argv);

    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(', ')}`));
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
    const isValidCommand = await auth.validateCommand('push');
    if (!isValidCommand) {
      return;
    }

    const workflowOp = new WorkflowOperation();
    const result = await workflowOp.executeFromMappings();

    if (!result.success) {
      process.exit(1);
    }
  }
})

// Normalize process.argv to handle rich text editor character conversions
// (e.g., em dashes, curly quotes from Word/Notepad)
normalizeProcessArgs();

yargs.parse();

