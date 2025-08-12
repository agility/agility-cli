import inquirer from "inquirer";
import { Auth } from "core/auth";

export async function baseUrlPrompt(guid) {
  const auth = new Auth();
  const baseUrl = auth.determineBaseUrl(guid);
  if (baseUrl) {
    return baseUrl;
  }

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
          "https://mgmt-usa2.aglty.io",
          "https://mgmt-au.aglty.io",
        ],
      },
    ]);
  } else {
    instanceAnswer = "https://mgmt.aglty.io";
  }

  return instanceAnswer;
}
