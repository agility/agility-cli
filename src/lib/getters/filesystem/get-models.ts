import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../../core';

/**
 * Get models from filesystem without side effects
 * Simplified - no unnecessary transformations
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getModelsFromFileSystem(fileOps: fileOperations): mgmtApi.Model[] {
  const rawModels = fileOps.readJsonFilesFromFolder('models');

  // Return models as-is - no transformation needed
  return rawModels;
}
