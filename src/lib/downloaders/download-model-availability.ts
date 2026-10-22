import * as fs from "fs";
import * as path from "path";
import * as mgmtApi from "@agility/management-sdk";
import { fileOperations } from "core/fileOperations";
import { getApiClient, getLoggerForGuid } from "core/state";

/**
 * PROD-2914: component availability rules (who can add a component model, and where it can go) are
 * pulled into their own folder, one file per model: `{guid}/model-availability/{modelID}.json`, the
 * same layout as `models/{modelID}.json`. They live outside `models/` because everything in that
 * folder is read back as a model.
 *
 * The folder's presence is meaningful: it exists (possibly empty) only when the instance answered,
 * so "no file for a model" means "no rules". When the instance can't answer (an API or database
 * without the feature yet), the folder is removed, and the push treats that side as unknown and
 * leaves its rules alone.
 */
export const MODEL_AVAILABILITY_FOLDER = "model-availability";

/**
 * Status codes that mean "this instance doesn't support availability rules yet": 404/405 from an
 * API without the route, 409 from an API whose instance database hasn't been migrated.
 */
export function isAvailabilityUnsupported(error: any): boolean {
  const status = error?.statusCode ?? error?.response?.status;
  return status === 404 || status === 405 || status === 409;
}

export async function downloadModelAvailability(guid: string): Promise<void> {
  const fileOps = new fileOperations(guid);
  const apiClient = getApiClient();
  const logger = getLoggerForGuid(guid);
  const folderPath = fileOps.getDataFolderPath(MODEL_AVAILABILITY_FOLDER);

  const removeFolder = () => {
    if (fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true, force: true });
  };

  // An older SDK build has no availability methods: same as an instance without the feature.
  if (typeof apiClient?.modelMethods?.getAllModelAvailability !== "function") {
    removeFolder();
    return;
  }

  let rules: mgmtApi.ModelAvailability[];
  try {
    rules = (await apiClient.modelMethods.getAllModelAvailability(guid)) || [];
  } catch (error: any) {
    // Never leave stale rules behind: a push would otherwise send rules the instance no longer has.
    removeFolder();
    if (isAvailabilityUnsupported(error)) {
      logger?.info(`Component availability rules aren't available on ${guid} yet; skipping them.`);
      return;
    }
    logger?.error(`Error pulling component availability rules: ${error?.message || error}`);
    throw error;
  }

  fs.mkdirSync(folderPath, { recursive: true });

  const pulledIds = new Set<string>();
  for (const rule of rules) {
    if (rule?.modelID === undefined || rule?.modelID === null) continue;
    const fileName = rule.modelID.toString();
    pulledIds.add(fileName);
    fileOps.exportFiles(MODEL_AVAILABILITY_FOLDER, fileName, rule);
  }

  // A model that has lost all its rules is no longer listed: drop its file.
  for (const file of fs.readdirSync(folderPath)) {
    if (!file.endsWith(".json")) continue;
    if (!pulledIds.has(file.replace(".json", ""))) {
      fs.unlinkSync(path.join(folderPath, file));
    }
  }

  if (pulledIds.size > 0) {
    logger?.info(`Pulled component availability rules for ${pulledIds.size} model(s).`);
  }
}
