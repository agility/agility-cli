import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';
import { ReferenceMapper } from '../../reference-mapper';

export function getBaseModelsFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    referenceMapper: ReferenceMapper,
    rootPath?: string,
    legacyFolders?: boolean 
): mgmtApi.Model[] {
    const baseFolder = rootPath || 'agility-files';
    let modelsPath: string;

    if (legacyFolders) {
        modelsPath = `${baseFolder}/models`;
    } else {
        modelsPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/models`;
    }

    const modelFiles = fs.readdirSync(modelsPath);
    return modelFiles.map(file => {
        const modelData = JSON.parse(fs.readFileSync(`${modelsPath}/${file}`, 'utf8'));
        const model = modelData as mgmtApi.Model;
        // Add source model to reference mapper
        referenceMapper.addRecord('model', model, null);
        return model;
    });
}

export async function getModelsFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    referenceMapper: ReferenceMapper,
    rootPath?: string,
    legacyFolders?: boolean
): Promise<mgmtApi.Model[]> {
    const models = getBaseModelsFromFileSystem(guid, locale, isPreview, referenceMapper, rootPath, legacyFolders) || [];
    return models;
}
