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
 * so "no file for a model" means "no rules". When the instance can't answer (an API without the
 * feature yet), the folder is removed, and the push treats that side as unknown.
 *
 * ⚠️ An instance whose DATABASE doesn't have the feature yet does answer: with an empty list, the
 * same as an instance with no rules. So an empty folder doesn't prove the instance stores rules;
 * the push allows for that.
 */
export const MODEL_AVAILABILITY_FOLDER = "model-availability";

/**
 * Status codes on a read that mean "this instance doesn't support availability rules yet": 404/405
 * from an API without the route. (A read on a database without the feature answers "no rules", not
 * 409; a 409 is tolerated anyway, as only the save is specified to return it.)
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

  // An older API serves `model/availability` from its `model/{referenceName}` route: an instance
  // with a model named "availability" answers with that model, not a list. That's an API without
  // the feature, too.
  if (!Array.isArray(rules)) {
    removeFolder();
    logger?.info(`Component availability rules aren't available on ${guid} yet; skipping them.`);
    return;
  }

  const pulledIds = new Set<string>();
  try {
    fs.mkdirSync(folderPath, { recursive: true });

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
  } catch (error: any) {
    // A half-written folder would read as the instance's current rules: remove it all.
    removeFolder();
    logger?.error(`Error writing component availability rules: ${error?.message || error}`);
    throw error;
  }

  if (pulledIds.size > 0) {
    logger?.info(`Pulled component availability rules for ${pulledIds.size} model(s).`);
  }
}
