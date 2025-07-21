#!/usr/bin/env node

import * as yargs from "yargs";

import colors from "ansi-colors";
import inquirer from "inquirer";
import searchList from "inquirer-search-list";
inquirer.registerPrompt("search-list", searchList);

import { Auth, Sync, state, setState, resetState, primeFromEnv, systemArgs } from "./core";
import { Pull, } from "./core/pull";
import { homePrompt, instancesPrompt, localePrompt } from "./lib/ui/prompts";
import { generateEnv } from "./lib/shared";
import { instanceSelector } from "./lib/ui/prompts";
import { Push } from "./core/push";
  
let auth: Auth;

yargs.version("1.0.0-beta.7").demand(1).exitProcess(false);

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

    try {
      const pull = new Pull();
      const result = await pull.pullInstances();
      
      // Simple completion summary
      const totalElapsedSeconds = Math.floor(result.elapsedTime / 1000);
      const minutes = Math.floor(totalElapsedSeconds / 60);
      const seconds = totalElapsedSeconds % 60;
      const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      
      let totalSuccessful = 0;
      let totalFailed = 0;
      
      result.results.forEach(res => {
        if (res.failed?.length > 0) {
          totalFailed++;
        } else {
          totalSuccessful++;
        }
      });
      
      console.log(colors.cyan('\nSummary:'));
      console.log(`Processed ${result.results.length} GUID/locale combinations`);
      console.log(`${totalSuccessful} successful, ${totalFailed} failed`);
      console.log(`Total time: ${timeDisplay}`);
      
      if (result.success) {
        console.log(colors.green(`✓ Pull completed successfully`));
        process.exit(0);
      } else {
        console.log(colors.red(`✗ Pull completed with errors`));
        process.exit(1);
      }
    } catch (error: any) {
      console.error(colors.red("\n❌ Pull command failed:"), error.message);
      process.exit(1);
    }
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
    const pushCommandUsed = invokedAs === "push"; 

    
    resetState(); // Clear any previous command state
    
    // Prime state from .env file before applying command line args
    const envPriming = primeFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(colors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(', ')}`));
    }
    
    setState(argv);
    
    // if the user is "pushing" only, we need to turn off the updates on the downloaders
    if (pushCommandUsed) {
      state.update = false;
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

    // const syncOperation = new Sync();
    // await syncOperation.syncInstance();
    try {
      const push = new Push();
      const result = await push.pushInstances();
      
      // Simple completion summary
      const totalElapsedSeconds = Math.floor(result.elapsedTime / 1000);
      const minutes = Math.floor(totalElapsedSeconds / 60);
      const seconds = totalElapsedSeconds % 60;
      const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      
      let totalSuccessful = 0;
      let totalFailed = 0;
      
      result.results.forEach(res => {
        if (res.failed?.length > 0) {
          totalFailed++;
        } else {
          totalSuccessful++;
        }
      });
      
      console.log(colors.cyan('\nSummary:'));
      console.log(`Processed ${result.results.length} GUID/locale combinations`);
      console.log(`${totalSuccessful} successful, ${totalFailed} failed`);
      console.log(`Total time: ${timeDisplay}`);
      
      if (result.success) {
        console.log(colors.green(`✓ Push completed successfully`));
        process.exit(0);
      } else {
        console.log(colors.red(`✗ Push completed with errors`));
        process.exit(1);
      }
    } catch (error: any) {
      console.error(colors.red("\n❌ Push command failed:"), error.message);
      process.exit(1);
    }
  }
})

yargs.parse();

