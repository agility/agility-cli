import { fileOperations } from "core";
import  * as mgmtApi from "@agility/management-sdk";

interface ContentItemMapping {
    sourceGuid: string;
    targetGuid: string;
    sourceContentID: number;
    targetContentID: number;
    sourceVersionID: number;
    targetVersionID: number;
}


export class ContentItemMapper {
    private fileOps: fileOperations;
    private sourceGuid: string;
    private targetGuid: string;
    private mappings: any;

    constructor(sourceGuid: string, targetGuid: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;

        // this will provide access to the /agility-files/{GUID} folder
        this.fileOps = new fileOperations(targetGuid)
        this.mappings = this.loadMapping();

    }

    getContentItemMapping(contentItem: any) {
        const mapping = this.mappings.find((m: ContentItemMapping) => m.targetContentID === contentItem.contentID);
        return mapping;       
    }

    addMapping(sourceContentItem: any, targetContentItem: any) {
        const mapping = this.getContentItemMapping(targetContentItem);

        if(mapping) {
            this.updateMapping(sourceContentItem, targetContentItem);
        } else {

            const newMapping: ContentItemMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourceContentID: sourceContentItem.contentID,
                targetContentID: targetContentItem.contentID,
                sourceVersionID: sourceContentItem.properties.versionID,
                targetVersionID: targetContentItem.properties.versionID,

            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourceContentItem: mgmtApi.ContentItem, targetContentItem: mgmtApi.ContentItem) {
        const mapping = this.getContentItemMapping(targetContentItem);
        if(mapping) {
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
            mapping.sourceContentID = sourceContentItem.contentID;
            mapping.targetContentID = targetContentItem.contentID;
            mapping.sourceVersionID = sourceContentItem.properties.versionID;
            mapping.targetVersionID = targetContentItem.properties.versionID;
        }
        this.saveMapping();
    }

    loadMapping() {
        const mapping = this.fileOps.getMappingFile('assets');
        return mapping;
    }

    saveMapping() {
        this.fileOps.saveMappingFile(this.mappings, 'assets');
    }

}