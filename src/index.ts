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

import { Auth, state, setState, resetState, primeFromEnv, systemArgs } from "./core";
import { Pull } from "./core/pull";
import { Push } from "./core/push";

import { initializeLogger, getLogger, finalizeLogger, finalizeAllGuidLoggers } from "./core/state";

let auth: Auth;

// TODO: Do not hardcode this
yargs.version("1.0.0-beta.9.0").demand(1).exitProcess(false);

console.log(colors.yellow("Welcome to Agility CLI."));
yargs.command({
  command: "login",
  describe: "Login to Agility.",
  builder: {
    ...systemArgs,
    // Add any login-specific args here if needed
  },
  handler: async function (argv) {
    resetState(); // Clear any previous command state

    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(', ')}`));
    }

    setState(argv);
    auth = new Auth();
    
    try {
      const isAuthenticated = await auth.login();
      if (isAuthenticated) {
        console.log(colors.green("✅ You are now logged in! You can use CLI commands like 'pull', 'push', 'sync', etc."));
        process.exit(0);
      } else {
        console.log(colors.red("❌ Authentication failed. Please try again."));
        process.exit(1);
      }
    } catch (error) {
      console.log(colors.red(`❌ Authentication failed: ${error.message}`));
      process.exit(1);
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

yargs.parse();

