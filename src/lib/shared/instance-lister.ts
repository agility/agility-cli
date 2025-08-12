import { Auth } from "core";

export async function listInstances() {
  let auth = new Auth();
  let user = await auth.getUser();
  let instances = user.websiteAccess;

  console.log(instances);
  // homePrompt("Any other actions you would like to take?");
}
