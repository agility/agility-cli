import { Auth, fileOperations, state } from "../../core";
import { homePrompt } from "../ui/prompts";
const FormData = require("form-data");

export async function listInstances() {
  let auth = new Auth();
  let user = await auth.getUser();
  let instances = user.websiteAccess;

  console.log(instances);
  homePrompt("Any other actions you would like to take?");
}
