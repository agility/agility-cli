import { fileOperations } from "core";
import  * as mgmtApi from "@agility/management-sdk";

interface AssetMapping {
    sourceGuid: string;
    targetGuid: string;
    sourceDateModified: string;
    targetDateModified: string;
    sourceMediaID: number;
    targetMediaID: number;
}


export class AssetMapper {
    private fileOps: fileOperations;
    private sourceGuid: string;
    private targetGuid: string;
    private mappings: AssetMapping[];
    private directory: string;

    constructor(sourceGuid: string, targetGuid: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
        this.directory = 'assets';

        // this will provide access to the /agility-files/{GUID} folder
        this.fileOps = new fileOperations(targetGuid)
        this.mappings = this.loadMapping();

    }

    getAssetMapping(asset: mgmtApi.Media): AssetMapping | null {
        const mapping = this.mappings.find((m: AssetMapping) => m.targetMediaID === asset.mediaID);
        if(!mapping) return null;
        return mapping;       
    }

    addMapping(sourceAsset: mgmtApi.Media, targetAsset: mgmtApi.Media) {
        const mapping = this.getAssetMapping(targetAsset);

        if(mapping) {
            this.updateMapping(sourceAsset, targetAsset);
        } else {

            const newMapping: AssetMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourceDateModified: sourceAsset.dateModified,
                targetDateModified: targetAsset.dateModified,
                sourceMediaID: sourceAsset.mediaID,
                targetMediaID: targetAsset.mediaID,

            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourceAsset: mgmtApi.Media, targetAsset: mgmtApi.Media) {
        const mapping = this.getAssetMapping(targetAsset);
        if(mapping) {
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
            mapping.sourceDateModified = sourceAsset.dateModified;
            mapping.targetDateModified = targetAsset.dateModified;
            mapping.sourceMediaID = sourceAsset.mediaID;
            mapping.targetMediaID = targetAsset.mediaID;
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

    hasSourceChanged(sourceAsset: mgmtApi.Media) {
        const mapping = this.getAssetMapping(sourceAsset);
        if(!mapping) return false;
        return sourceAsset.dateModified !== mapping.sourceDateModified;
    }

    hasTargetChanged(targetAsset: mgmtApi.Media) {
        const mapping = this.getAssetMapping(targetAsset);
        if(!mapping) return false;
        return targetAsset.dateModified !== mapping.targetDateModified;
    }

}