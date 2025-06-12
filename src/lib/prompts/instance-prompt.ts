import inquirer from "inquirer";
import { Auth } from "../services/auth";
import { homePrompt } from "./home-prompt";
import { fetchAPIPrompt, fetchCommandsPrompt } from "./fetch-prompt";
import { pullFiles } from "./pull-prompt";
import generateTypes from "../utilities/generate-typescript-models";
import { pushFiles } from "./push-prompt";
import Clean from "../services/clean";
import { localePrompt } from "./locale-prompt";
import { generateEnv } from "../utilities/generate-env";
import { generateSitemap } from "../utilities/generate-sitemap";
import generateReactComponents from "../utilities/generate-components";
import { AgilityInstance } from "../../types/agilityInstance";
const FormData = require("form-data");

inquirer.registerPrompt("search-list", require("inquirer-search-list"));

export async function instancesPrompt(selectedInstance: AgilityInstance, keys: any, useBlessedUI: boolean) {

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
      await pullFiles(selectedInstance, useBlessedUI);
      // if (pullResult) {
      //   homePrompt();
      // }
      break;
    case "push":
      await pushFiles(selectedInstance, useBlessedUI);
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
        homePrompt(useBlessedUI);
      }
      break;
    case "env":
      const generatedEnv = await generateEnv(keys);
      if (generatedEnv) {
        homePrompt(useBlessedUI);
      }
      break;
    case "sitemap":
      const generatedSitemap = await generateSitemap(selectedInstance, keys);
      if (generatedSitemap) {
        homePrompt(useBlessedUI);
      }
      break;
    case "types":
      await generateTypes(selectedInstance);
      break;
    case "reactcomponents":
      const generatedComponents = await generateReactComponents(selectedInstance);
      if (generatedComponents) {
        homePrompt(useBlessedUI);
      }
      break;
    case "clean":
      const locale = await localePrompt(selectedInstance);
      const clean = new Clean(selectedInstance, locale);
      const cleaned = await clean.cleanAll();
      if (cleaned) {
        homePrompt(useBlessedUI);
      }
      break;
    case "home":
      homePrompt(useBlessedUI);
      break;
    default:
      console.log("Invalid action selected.");
  }
}

export async function getInstance(selectedInstance: AgilityInstance) {
  const auth = new Auth();

  let guid: string = selectedInstance.guid as string;

  let user = await auth.getUser(guid);
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
