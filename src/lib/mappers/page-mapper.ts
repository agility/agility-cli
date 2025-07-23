import { fileOperations } from "core";
import  * as mgmtApi from "@agility/management-sdk";

interface PageMapping {
    sourceGuid: string;
    targetGuid: string;
    sourcePageID: number;
    targetPageID: number;
    sourceVersionID: number;
    targetVersionID: number;
}


export class PageMapper {
    private fileOps: fileOperations;
    private sourceGuid: string;
    private targetGuid: string;
    private mappings: PageMapping[];
    private directory: string;
    
    constructor(sourceGuid: string, targetGuid: string, locale: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
        this.directory = 'page';
        // this will provide access to the /agility-files/{GUID}/{locale} folder
        this.fileOps = new fileOperations(targetGuid, locale)
        this.mappings = this.loadMapping();

    }

    getPageMapping(page: mgmtApi.PageItem): PageMapping | null {
        const mapping = this.mappings.find((m: PageMapping) => m.targetPageID === page.pageID);
        if(!mapping) return null;
        return mapping;       
    }

    addMapping(sourcePage: mgmtApi.PageItem, targetPage: mgmtApi.PageItem) {
        const mapping = this.getPageMapping(targetPage);

        if(mapping) {
            this.updateMapping(sourcePage, targetPage);
        } else {

            const newMapping: PageMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourcePageID: sourcePage.pageID,
                targetPageID: targetPage.pageID,
                sourceVersionID: sourcePage.properties.versionID,
                targetVersionID: targetPage.properties.versionID,

            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourcePage: mgmtApi.PageItem, targetPage: mgmtApi.PageItem) {
        const mapping = this.getPageMapping(targetPage);
        if(mapping) {
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
            mapping.sourcePageID = sourcePage.pageID;
            mapping.targetPageID = targetPage.pageID;
            mapping.sourceVersionID = sourcePage.properties.versionID;
            mapping.targetVersionID = targetPage.properties.versionID;
        }
        this.saveMapping();
    }

    loadMapping() {
        const mapping = this.fileOps.getMappingFile(this.directory);
        return mapping;
    }

    saveMapping() {
        this.fileOps.saveMappingFile(this.mappings, this.directory);
    }

    hasSourceChanged(sourcePage: mgmtApi.PageItem) {
        const mapping = this.getPageMapping(sourcePage);
        if(!mapping) return false;
        return sourcePage.properties.versionID !== mapping.sourceVersionID;
    }
    
    hasTargetChanged(targetPage: mgmtApi.PageItem) {
        const mapping = this.getPageMapping(targetPage);
        if(!mapping) return false;
        return targetPage.properties.versionID !== mapping.targetVersionID;
    }
    

}