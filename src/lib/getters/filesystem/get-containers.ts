import * as mgmtApi from '@agility/management-sdk';
import * as fs from 'fs';
import { ReferenceMapper } from '../../reference-mapper';

export function getContainersFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    referenceMapper: ReferenceMapper,
    rootPath?: string,
    legacyFolders?: boolean
): mgmtApi.Container[] {
    const baseFolder = rootPath || 'agility-files';
    let containersPath: string;

    if (legacyFolders) {
        containersPath = `${baseFolder}/containers`;
    } else {
        containersPath = `${baseFolder}/${guid}/${locale}/${isPreview ? 'preview':'live'}/containers`;
    }
    
    const containerFiles = fs.readdirSync(containersPath);
    const containers: mgmtApi.Container[] = [];

    for (const file of containerFiles) {
        const containerData = JSON.parse(fs.readFileSync(`${containersPath}/${file}`, 'utf8'));
        const container = containerData as mgmtApi.Container;
        referenceMapper.addRecord('container', container, null);
        containers.push(container);
    }

    return containers;
}
