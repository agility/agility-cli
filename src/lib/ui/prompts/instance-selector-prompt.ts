import inquirer from "inquirer";
import { getState } from "../../../core/state";
import colors from "ansi-colors";

export async function instanceSelector() {
  // Use user data from state (already loaded by auth.init())
  const state = getState();
  const user = state.user;

  console.log('user', user);

  if (!user || !user.websiteAccess) {
    console.log(colors.red('User data not available. Please ensure you are authenticated.'));
    return null;
  }

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
