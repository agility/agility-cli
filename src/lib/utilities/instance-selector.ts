import inquirer from "inquirer";
import { Auth, fileOperations } from "../services";

import colors from "ansi-colors";
import { homePrompt } from "../prompts/home-prompt";
const FormData = require("form-data");

export async function instanceSelector() {
  let auth = new Auth();
  let user = await auth.getUser();  

  let instances = user.websiteAccess;

  
  const instanceChoices = instances.map((instance: any) => ({
    name: `${instance.displayName || instance.websiteName} (${instance.guid})`,
    value: instance.guid,
    ...instance,
  }));

  const instanceAnswer = await inquirer.prompt([
    {
      type: "search-list",
      name: "selectedInstance",
      message: "Select an instance:",
      choices: instanceChoices,
    },
  ]);


  const website = instances.find(
    (instance: any) => instance.guid === instanceAnswer.selectedInstance
  );


  const { guid, websiteName, displayName } = website;
  console.log('------------------------------------------------');
  console.log(colors.green('●'), colors.green(` ${displayName || websiteName}`), colors.white(`${guid}`));
  console.log('------------------------------------------------');

  return website;
  return instanceAnswer.selectedInstance;
}
