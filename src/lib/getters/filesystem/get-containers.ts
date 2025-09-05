import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../../core';

/**
 * Get lists from filesystem
 * @param fileOps - fileOperations instance
 * @returns - array of containers
 */
export async function getListsFromFileSystem(
  fileOps: fileOperations
): Promise<mgmtApi.Container[] | void> {
  const allContainers: mgmtApi.Container[] = [];

  const containerData = fileOps.readJsonFilesFromFolder('list');
  for (const container of containerData) {
    allContainers.push(container);
  }

  return allContainers;
}

/**
 * Get containers from filesystem
 * @param fileOps - fileOperations instance
 * @returns - array of containers
 */
export function getContainersFromFileSystem(fileOps: fileOperations): mgmtApi.Container[] {
  const allContainers: mgmtApi.Container[] = [];

  const containerData = fileOps.readJsonFilesFromFolder('containers');
  for (const container of containerData) {
    allContainers.push(container);
  }

  return allContainers;
}
