import inquirer from "inquirer";
import { Auth } from "../services/auth";
import { homePrompt } from "./home-prompt";
import { fetchAPIPrompt, fetchCommandsPrompt } from "./fetch-prompt";
import { pullFiles } from "./pull-prompt";
import { pushFiles } from "./push-prompt";
import Clean from "../services/clean";
import { localePrompt } from "./locale-prompt";
import { 
  generateTypescriptModels, 
  generateEnv, 
  generateSitemap, 
  generateComponents 
} from "../utilities/generators";
import { AgilityInstance } from "../../types/agilityInstance";
import { getState, getUIMode } from "../services/state";
const FormData = require("form-data");

inquirer.registerPrompt("search-list", require("inquirer-search-list"));

export async function instancesPrompt(selectedInstance?: AgilityInstance, keys?: any) {
  const { useBlessed } = getUIMode();
  const { state } = await import('../services/state');
  
  console.log('selectedInstance', selectedInstance);
  // Build instance data from state if not provided
  if (!selectedInstance && state.sourceGuid) {
    selectedInstance = {
      guid: state.sourceGuid,
      previewKey: state.previewKey || "",
      fetchKey: state.fetchKey || "",
      websiteDetails: state.currentWebsite,
    };
  }
  
  // Build keys from state if not provided
  if (!keys && state.previewKey && state.fetchKey) {
    keys = {
      guid: state.sourceGuid,
      previewKey: state.previewKey,
      fetchKey: state.fetchKey,
      currentWebsite: state.currentWebsite,
    };
  }
  
  // Safety check - make sure we have instance data
  if (!selectedInstance) {
    console.error("No instance data available. Please specify a GUID or run 'agility login' first.");
    return;
  }
  
  const auth = new Auth();
  // const { jobRole} = await auth.getUser(selectedInstance.guid);

  const choices = [
    new inquirer.Separator(),
    { name: "Download assets, models & content from an instance", value: "pull" },
    { name: "Push local assets, models & content to an instance", value: "push" },
    { name: "Sync models to an instance", value: "syncModels" },
    new inquirer.Separator(),
    { name: "Fetch API", value: "fetch" },
    new inquirer.Separator(),
    { name: "Generate .env.local", value: "env" },
    { name: "Generate sitemap.xml", value: "sitemap" },

    new inquirer.Separator(),
    { name: "< Back to Home", value: "home" },
  ];


  // choices.push(  new inquirer.Separator() )
  // choices.push({ name: "Generate TypeScript interfaces (beta)", value: "types" });
  // choices.push({ name: "Generate React Components (beta)", value: "reactcomponents" });
  choices.push(new inquirer.Separator())
  choices.push({ name: "Clean instance (warning: data loss)", value: "clean" })





  const questions = [
    {
      type: "list",
      name: "instanceAction",
      message: "Select an action:",
      choices: choices,
    },
  ];

  const answers = await inquirer.prompt(questions);

  switch (answers.instanceAction) {
    case "pull":
      await pullFiles(selectedInstance, useBlessed);
      // if (pullResult) {
      //   homePrompt();
      // }
      break;
    case "push":
      await pushFiles(selectedInstance, useBlessed);
      break;
    case "syncModels":
      console.log('Sync models needs implementation.');
      // const syncModels = await syncModelsPrompt(selectedInstance);
      // if (syncModels) {
      // homePrompt();
      // }
      break;

    case "fetch":
      const fetch = await fetchAPIPrompt(selectedInstance, keys);
      if (fetch) {
        homePrompt();
      }
      break;
    case "env":
      const generatedEnv = await generateEnv(keys);
      if (generatedEnv) {
        homePrompt();
      }
      break;
    case "sitemap":
      const generatedSitemap = await generateSitemap(selectedInstance, keys);
      if (generatedSitemap) {
        homePrompt();
      }
      break;
    case "types":
      await generateTypescriptModels(selectedInstance);
      break;
    case "reactcomponents":
      const generatedComponents = await generateComponents(selectedInstance);
      if (generatedComponents) {
        homePrompt();
      }
      break;
    case "clean":
      const locale = await localePrompt(selectedInstance);
      const clean = new Clean(selectedInstance, locale);
      const cleaned = await clean.cleanAll();
      if (cleaned) {
        homePrompt();
      }
      break;
    case "home":
      homePrompt();
      break;
    default:
      console.log("Invalid action selected.");
  }
}

export async function getInstance(selectedInstance: AgilityInstance) {

  console.log('getInstance', selectedInstance);
  const auth = new Auth();

  let guid: string = selectedInstance.guid as string;

  // let user = await auth.getUser(guid);
  const state = getState();
  const user = state.user;

  if (!user) {
    console.log("Please authenticate first to perform the operation.");
    return;
  }

  let permitted = await auth.checkUserRole(guid);

  if (!permitted) {
    console.log("You do not have required permissions on the instance to perform the operation.");
    return;
  }

  try {
    let currentWebsite = user.websiteAccess.find((website: any) => website.guid === guid);

    let previewKey = null;
    try {
      previewKey = await auth.getPreviewKey(guid);
    } catch {
    }

    let fetchKey = null;
    try {
      fetchKey = await auth.getFetchKey(guid);
    } catch {
    }

    return {
      guid,
      previewKey,
      fetchKey,
      currentWebsite,
    };

  } catch (error) {
    // Handle error
    return null;
  }
}
