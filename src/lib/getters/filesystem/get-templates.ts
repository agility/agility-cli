import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../services/fileOperations';

/**
 * Get templates from filesystem without side effects
 * Pure function - no filesystem operations, delegates to fileOperations
 */
export function getTemplatesFromFileSystem(
    fileOps: fileOperations
): mgmtApi.PageModel[] {
    const templateData = fileOps.readJsonFilesFromFolder('templates');
    return templateData.map(data => data as mgmtApi.PageModel);
}
