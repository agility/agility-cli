import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../../core';

/**
 * Get pages from filesystem without side effects
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getPagesFromFileSystem(
    fileOps: fileOperations
): mgmtApi.PageItem[] {
    const pageData = fileOps.readJsonFilesFromFolder('page');
    return pageData.map(data => data as mgmtApi.PageItem);
}
