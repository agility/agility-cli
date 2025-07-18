import * as fs from "fs";

export async function handleSyncToken(syncTokenPath: string, update: boolean) {
  const syncTokenExists = fs.existsSync(syncTokenPath);

  if (!update) {
    if (syncTokenExists) {
      console.log("--update=false (default): Existing content sync token found. Performing incremental content sync.");
    } else {
      console.log("--update=false (default): No existing content sync token. Performing full content sync by default.");
    }
  } else {
    if (syncTokenExists) {
      try {
        fs.rmSync(syncTokenPath, { force: true });
        console.log("--update=true: Cleared existing sync token. Performing full content sync.");
      } catch (error: any) {
        console.log(`--update=true: Error clearing sync token: ${error.message}. Proceeding with full sync.`);
      }
    } else {
      console.log("--update=true: No existing sync token. Performing full content sync.");
    }
  }

  // Return true if incremental sync is needed, false otherwise
  return !update && syncTokenExists;
}
