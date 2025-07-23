import { fileOperations } from "core";
import  * as mgmtApi from "@agility/management-sdk";
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
    private mappings: GalleryMapping[];
    private directory: string;

    constructor(sourceGuid: string, targetGuid: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
        this.directory = 'galleries';
        // this will provide access to the /agility-files/{GUID} folder
        this.fileOps = new fileOperations(targetGuid)
        this.mappings = this.loadMapping();

    }

    getGalleryMapping(gallery: mgmtApi.assetMediaGrouping, type: 'source' | 'target'): GalleryMapping | null {
        const mapping = this.mappings.find((m: GalleryMapping) => 
            type === 'source' ? m.sourceMediaGroupingID === gallery.mediaGroupingID : m.targetMediaGroupingID === gallery.mediaGroupingID
        );
        if(!mapping) return null;
        return mapping;       
    }

    getGalleryMappingByMediaGroupingID(mediaGroupingID: number, type: 'source' | 'target'): GalleryMapping | null {
        const mapping = this.mappings.find((m: GalleryMapping) => 
            type === 'source' ? m.sourceMediaGroupingID === mediaGroupingID : m.targetMediaGroupingID === mediaGroupingID
        );
        if(!mapping) return null;
        return mapping;
    }

    addMapping(sourceGallery: mgmtApi.assetMediaGrouping, targetGallery: mgmtApi.assetMediaGrouping) {
        const mapping = this.getGalleryMapping(targetGallery, 'target');

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

    updateMapping(sourceGallery: mgmtApi.assetMediaGrouping, targetGallery: mgmtApi.assetMediaGrouping) {
        const mapping = this.getGalleryMapping(targetGallery, 'target');
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
        const mapping = this.fileOps.getMappingFile(this.directory);
        return mapping;
    }

    saveMapping() {
        this.fileOps.saveMappingFile(this.mappings, this.directory);
    }

    hasSourceChanged(sourceGallery: mgmtApi.assetMediaGrouping) {
        const mapping = this.getGalleryMapping(sourceGallery, 'source');
        if(!mapping) return false;
        return sourceGallery.modifiedOn !== mapping.sourceModifiedOn;
    }
    
    hasTargetChanged(targetGallery: mgmtApi.assetMediaGrouping) {
        const mapping = this.getGalleryMapping(targetGallery, 'target');
        if(!mapping) return false;
        return targetGallery.modifiedOn !== mapping.targetModifiedOn;
    }
    
    

}