import * as mgmtApi from "@agility/management-sdk";
import { fileOperations } from "../../../core";
import { MODEL_AVAILABILITY_FOLDER } from "../../downloaders/download-model-availability";

/**
 * Get the pulled component availability rules (PROD-2914) from the filesystem.
 *
 * Returns `null` when the folder doesn't exist, which means the rules are unknown for this instance
 * (never pulled, or the instance doesn't support them yet). An empty array means the instance was
 * read and has no rules.
 */
export function getModelAvailabilityFromFileSystem(fileOps: fileOperations): mgmtApi.ModelAvailability[] | null {
  if (!fileOps.folderExists(MODEL_AVAILABILITY_FOLDER)) return null;
  return fileOps.readJsonFilesFromFolder(MODEL_AVAILABILITY_FOLDER) as mgmtApi.ModelAvailability[];
}
