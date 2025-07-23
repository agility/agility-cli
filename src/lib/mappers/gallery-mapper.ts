import { fileOperations } from "core";

interface GalleryMapping {
    sourceGuid: string;
    targetGuid: string;
    sourceMediaGroupingID: number;
    targetMediaGroupingID: number;
    sourceModifiedOn: string;
    targetModifiedOn: string;
}


export class GalleryMapper {
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

    getGalleryMapping(gallery: any) {
        const mapping = this.mappings.find((m: GalleryMapping) => m.targetMediaGroupingID === gallery.mediaGroupingID);
        return mapping;       
    }

    addMapping(sourceGallery: any, targetGallery: any) {
        const mapping = this.getGalleryMapping(targetGallery);

        if(mapping) {
            this.updateMapping(sourceGallery, targetGallery);
        } else {

            const newMapping: GalleryMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourceMediaGroupingID: sourceGallery.mediaGroupingID,
                targetMediaGroupingID: targetGallery.mediaGroupingID,
                sourceModifiedOn: sourceGallery.modifiedOn,
                targetModifiedOn: targetGallery.modifiedOn,

            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourceGallery: any, targetGallery: any) {
        const mapping = this.getGalleryMapping(targetGallery);
        if(mapping) {
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
            mapping.sourceMediaGroupingID = sourceGallery.mediaGroupingID;
            mapping.targetMediaGroupingID = targetGallery.mediaGroupingID;
            mapping.sourceModifiedOn = sourceGallery.modifiedOn;
            mapping.targetModifiedOn = targetGallery.modifiedOn;
        }
        this.saveMapping();
    }

    loadMapping() {
        const mapping = this.fileOps.getMappingFile('galleries');
        return mapping;
    }

    saveMapping() {
        this.fileOps.saveMappingFile(this.mappings, 'galleries');
    }

}