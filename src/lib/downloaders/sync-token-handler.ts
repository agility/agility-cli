import ansiColors from "ansi-colors";
import * as fs from "fs";

export async function handleSyncToken(syncTokenPath: string, reset: boolean) {

  const syncTokenExists = fs.existsSync(syncTokenPath);

  if (!reset) {
    if (syncTokenExists) {
      // console.log("--reset=false (default): Existing content sync token found. Performing incremental content sync.");
    } else {
      // console.log("--reset=false (default): No existing content sync token. Performing full content sync by default.");
    }
  } else {
    if (syncTokenExists) {
      try {
        fs.rmSync(syncTokenPath, { force: true });
        console.log("--reset=true: Cleared existing sync token. Performing full content sync.");
      } catch (error: any) {
        console.log(`--reset=true: Error clearing sync token: ${error.message}. Proceeding with full sync.`);
      }
    } else {
      console.log("No existing sync token. Performing full content sync.");
    }
  }

  // Return true if incremental sync is needed, false otherwise
  return !reset && syncTokenExists;
}
