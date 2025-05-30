import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from '../../mapper';
import { fileOperations } from '../../services/fileOperations';

export async function getPagesFromFileSystem(
    guid: string,
    classLocale: string, 
    isPreview: boolean,
    referenceMapper: ReferenceMapper,
    rootPath?: string,
    legacyFolders?: boolean
): Promise<mgmtApi.PageItem[] | null> {
    let fileOperation = new fileOperations(rootPath, guid, classLocale, isPreview);
    const baseFolder = rootPath || 'agility-files';
    let dirPath: string;

    if (legacyFolders) {
        dirPath = `pages`;
    } else {
        dirPath = `${guid}/${classLocale}/${isPreview ? 'preview':'live'}/pages`;
    }

    try{
        let files = fileOperation.readDirectory(dirPath, baseFolder); // Pass full path

        let pages : mgmtApi.PageItem[] = [];

        for(let i = 0; i < files.length; i++){
            let page = JSON.parse(files[i]) as mgmtApi.PageItem;
            referenceMapper.addRecord('page', page, null);
            pages.push(page);
            
            // Debug: Log each page being loaded
            if (page.name === 'winning-numbers' || page.pageID === 28 || page.pageID === 25) {
                console.log(`[Page Debug] Loading page: ${page.name} (ID: ${page.pageID}, Type: ${page.pageType}) from file ${i}`);
            }
        }
        return pages;
    } catch (e){
        console.error(`Error in getPagesFromFileSystem reading ${dirPath}: ${e.message}`);
        fileOperation.appendLogFile(`\n No Pages were found in ${dirPath} to process.`);
        return null;
    }
}
