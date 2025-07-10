#!/usr/bin/env node

import * as yargs from "yargs";

import colors from "ansi-colors";
import inquirer from "inquirer";
import searchList from "inquirer-search-list";
inquirer.registerPrompt("search-list", searchList);

import { Auth, Clean, Pull, Sync, state, setState, resetState, primeFromEnv, systemArgs } from "./core";
import { homePrompt, instancesPrompt, localePrompt } from "./lib/ui/prompts";
import { generateEnv } from "./lib/shared";
import { instanceSelector } from "./lib/ui/prompts";
  
let auth: Auth;

yargs.version("0.0.1_beta").demand(1).exitProcess(false);

console.log(colors.yellow("Welcome to Agility CLI."));
yargs.command({
  command: "$0",
  describe: "Default command",
  builder: {
    ...systemArgs,
    // Add any default-command-specific args here if needed
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
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      return;
    }

    // Interactive mode doesn't need strict validation
    const isValidCommand = await auth.validateCommand('interactive');
    if (!isValidCommand) {
      return;
    }

    // Check if we have a specific instance defined and should skip home prompt
    if (state.sourceGuid && !state.local && !state.dev && !state.preprod) {
      console.log("------------------------------------------------");
      console.log(colors.green("●"), colors.green(`${state.currentWebsite?.displayName || 'Instance'}`), colors.white(`${state.sourceGuid}`));
      console.log("------------------------------------------------");

      await instancesPrompt();
      return;
    }

    // Default to home prompt
    homePrompt();
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
    
    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(', ')}`));
    }
    
    setState(argv);
    auth = new Auth();
    await auth.init();
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
  command: "clean",
  describe: "Scrub all the data out of an instance",
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
    // Force local mode for clean operations
    state.local = true;
    
    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      return;
    }

    // Validate clean command requirements (minimal validation)
    const isValidCommand = await auth.validateCommand('clean');
    if (!isValidCommand) {
      return;
    }

    const selectedInstance = await instanceSelector();
    const locale = await localePrompt(selectedInstance);
    const clean = new Clean(selectedInstance, locale);
    await clean.cleanAll();
  },
});

yargs.command({
  command: "genenv",
  describe: "Generate an env file for your instance.",
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
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      console.log(colors.red("You are not authorized to generate an env file."));
      return;
    }

    const result = await generateEnv();
    if (result) {
      process.exit(0);
    }
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

    const pullOperation = new Pull();
    await pullOperation.pullInstance();
  },
});


// New 2-Pass Sync Command using the enhanced dependency system
yargs.command({
  command: "sync",
  describe: "Sync your instance using the new 2-pass dependency system with multi-target support.",
  builder: {
    // Override targetGuid to be required for sync with enhanced multi-target support
    targetGuid: {
      describe: "Provide the target instance GUID(s) to sync your instance to. Use comma-separated values for multi-target sync (e.g., 'guid1,guid2,guid3'). All targets will be validated for locale compatibility.",
      demandOption: true,
      type: "string",
    },

    // Add multi-target specific options
    continueOnError: {
      describe: "Continue syncing other targets if one target fails (multi-target sync only). Default: true.",
      type: "boolean",
      default: true,
    },
    
    maxRetries: {
      describe: "Maximum number of retry attempts per target on recoverable errors. Default: 2.",
      type: "number",
      default: 2,
    },
    
    retryDelay: {
      describe: "Delay between retry attempts in milliseconds. Default: 1000ms.",
      type: "number", 
      default: 1000,
    },
    
    // Auto-publishing option for sync
    publish: {
      describe: "Automatically publish synced content items and pages after successful sync. Only applies to content items and pages.",
      type: "boolean",
      default: false,
    },

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
    
    // Enhanced multi-target validation and reporting
    const isMultiTarget = state.targetGuid.length > 1;
    if (isMultiTarget) {
      console.log(colors.cyan(`🎯 Multi-target sync detected: ${state.targetGuid.length} targets`));
      console.log(colors.gray(`Source: ${state.sourceGuid[0]}`));
      console.log(colors.gray(`Targets: ${state.targetGuid.join(', ')}`));
      console.log(colors.gray(`Locales: ${state.locale.join(', ')}`));
      console.log(colors.gray(`Matrix operations: ${state.targetGuid.length * state.locale.length} total`));
      console.log(colors.gray(`Configuration: continueOnError=${argv.continueOnError}, maxRetries=${argv.maxRetries}, retryDelay=${argv.retryDelay}ms`));
      
      // Validate that all required configurations are present for multi-target
      if (state.locale.length === 0) {
        console.log(colors.red('❌ Multi-target sync requires explicit locale specification'));
        console.log(colors.yellow('💡 Use --locale="en-us" or --locale="en-us,fr-fr" for multiple locales'));
        return;
      }
    } else {
      console.log(colors.cyan(`🎯 Single-target sync: ${state.targetGuid[0]}`));
    }
    
    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      return;
    }

    // Validate sync command requirements
    const isValidCommand = await auth.validateCommand('sync');
    if (!isValidCommand) {
      return;
    }

    const syncOperation = new Sync();
    await syncOperation.syncInstance();
  }
})

yargs.parse();

