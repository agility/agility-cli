import inquirer from "inquirer";
import colors from "ansi-colors";
import { instanceSelector } from "../instances/instance-list";
import { getInstance, instancesPrompt } from "./instance-prompt";
import { Auth } from "../services/auth";
import { AgilityInstance } from "types/instance";

export async function homePrompt(useBlessedUI: boolean, prompt?: any) {
  await inquirer
    .prompt([
      {
        type: "list",
        name: "option",
        message: prompt ?? "What would you like to do today?:",
        choices: [
          new inquirer.Separator(),
          "Instances",
          new inquirer.Separator(),
          "Logout",
        ],
      },
    ])
    .then(async (answers: { option: string }) => {
      switch (answers.option) {
        case "Instances":

          const selectedInstance: AgilityInstance = await instanceSelector();
          const keys = await getInstance(selectedInstance);
          const keyClone = {
            ...keys
          }
          delete keyClone['websiteDetails']
          await instancesPrompt(selectedInstance, keys, useBlessedUI);
          break;

        case "Logout":
          const auth = new Auth();
          await auth.logout();
          break;
        default:
          console.log(colors.red("Invalid option selected."));
      }
    });
}