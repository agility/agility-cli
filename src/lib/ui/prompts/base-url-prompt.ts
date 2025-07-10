import inquirer from "inquirer";
import { state } from "../../../core/state";


export async function getBaseURLfromGUID(guid: string): Promise<string> {
  let baseUrl = "https://mgmt.aglty.io";
  if(state.preprod) {
    baseUrl = "https://management-api-us-pre-prod.azurewebsites.net";
  } else if(state.dev) {
    baseUrl = "https://mgmt-dev.aglty.io";
  } else if(state.local) {
    baseUrl = "http://localhost:5050";
  } else if (guid.endsWith("-d")) {
    baseUrl = "https://mgmt-dev.aglty.io";
  } else if (guid.endsWith("-c")) {
    baseUrl = "https://mgmt-ca.aglty.io";
  } else if (guid.endsWith("-e")) {
    baseUrl = "https://mgmt-eu.aglty.io";
  } else if (guid.endsWith("-a")) {
    baseUrl = "https://mgmt-au.aglty.io";
  }
  return baseUrl;
}

export async function baseUrlPrompt(guid) {
  const specifyRegionAnswer = await inquirer.prompt([
    {
      type: "confirm",
      name: "specifyRegion",
      message: "Do you want to specify a region?",
      default: false,
    },
  ]);

  let instanceAnswer;
  if (specifyRegionAnswer.specifyRegion) {
    instanceAnswer = await inquirer.prompt([
      {
        type: "search-list",
        name: "selectedRegion",
        message: "Select a Region to pull from",
        choices: [
          "https://mgmt.aglty.io",
          "https://mgmt-ca.aglty.io",
          "https://mgmt-eu.aglty.io",
          "https://mgmt-au.aglty.io",
        ],
      },
    ]);
  } else {
    instanceAnswer = "https://mgmt.aglty.io";
  }

  return instanceAnswer;
}
