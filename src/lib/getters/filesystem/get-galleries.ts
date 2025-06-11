import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from '../../reference-mapper';
import { fileOperations } from '../../services/fileOperations'; // Assuming fileOperations is here

export function getGalleriesFromFileSystem(
    guid: string,
    locale: string,
    isPreview: boolean,
    referenceMapper: ReferenceMapper,
    rootPath?: string,
    legacyFolders?: boolean // Added legacyFolders, not used yet
): mgmtApi.assetGalleries[] | null {
    let fileOperation = new fileOperations(rootPath, guid, locale, isPreview); 
    const baseFolder = rootPath || 'agility-files';
    let dirPath: string = `${guid}/${locale}/${isPreview ? 'preview':'live'}/assets/galleries`;

    if (legacyFolders) {
        dirPath = `${baseFolder}/assets/galleries`; 
    } 

    try{
        let files = fileOperation.readDirectory(dirPath, baseFolder); 
        let assetGalleries: mgmtApi.assetGalleries[] = [];

        for(let i = 0; i < files.length; i++){
            let assetGallery = JSON.parse(files[i]) as mgmtApi.assetGalleries;
            // Add source gallery to reference mapper immediately
            referenceMapper.addRecord('gallery', assetGallery, null);
            assetGalleries.push(assetGallery);
        }
        return assetGalleries;
    } catch (e) {
      
        console.error(`Error in getGalleriesFromFileSystem reading ${dirPath}: ${e.message}`); 
        fileOperation.appendLogFile(`\n No Galleries were found in ${dirPath} to process.`);
        return null;
    }
}
