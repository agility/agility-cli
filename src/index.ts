#!/usr/bin/env node

import * as yargs from "yargs";

const colors = require("ansi-colors");
const inquirer = require("inquirer");
inquirer.registerPrompt("search-list", require("inquirer-search-list"));

import { Auth, Clean, Pull, Sync, state, setState, systemArgs } from "./lib/services";
import { homePrompt, instancesPrompt, localePrompt } from "./lib/prompts";
import { generateEnv, instanceSelector } from "./lib/utilities";
  
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
    setState(argv);

    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
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
    setState(argv);
    // Force local mode for clean operations
    state.local = true;
    auth = new Auth();
    const isAuthorized = await auth.init();
    if (isAuthorized) {
      const selectedInstance = await instanceSelector();
      const locale = await localePrompt(selectedInstance);
      const clean = new Clean(selectedInstance, locale);
      await clean.cleanAll();
    }
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
    setState(argv);
    auth = new Auth();
    const isAuthorized = await auth.init();
    if (isAuthorized) {
      const result = await generateEnv();
      if (result) {
        process.exit(0);
      }
    } else {
      console.log(colors.red("You are not authorized to generate an env file."));
      return;
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
    setState(argv);
    
    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      return;
    }

    const pullOperation = new Pull();
    await pullOperation.pullInstance();
    
  },
});


// New 2-Pass Sync Command using the enhanced dependency system
yargs.command({
  command: "sync",
  describe: "Sync your instance using the new 2-pass dependency system.",
  builder: {
    // Override targetGuid to be required for sync
    targetGuid: {
      describe: "Provide the target instance GUID to sync your instance to.",
      demandOption: true,
      type: "string",
    },

    // System args (commonly repeated across commands)
    ...systemArgs
  },
  handler: async function (argv) {
    setState(argv);
    
    auth = new Auth();
    const isAuthorized = await auth.init();
    if (!isAuthorized) {
      return;
    }

    const syncOperation = new Sync();
    await syncOperation.syncInstance();
  }
})

yargs.parse();

