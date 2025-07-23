import { fileOperations } from "core";

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
    private mappings: any;

    constructor(sourceGuid: string, targetGuid: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;

        // this will provide access to the /agility-files/{GUID} folder
        this.fileOps = new fileOperations(targetGuid)
        this.mappings = this.loadMapping();

    }

    getAssetMapping(asset: any) {
        const mapping = this.mappings.find((m: AssetMapping) => m.targetMediaID === asset.mediaID);
        return mapping;       
    }

    addMapping(sourceAsset: any, targetAsset: any) {
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

    updateMapping(sourceAsset: any, targetAsset: any) {
        const mapping = this.getAssetMapping(targetAsset);
        if(mapping) {
            mapping.sourceDateModified = sourceAsset.dateModified;
            mapping.sourceMediaID = sourceAsset.mediaID;
            mapping.targetDateModified = targetAsset.dateModified;
            mapping.targetMediaID = targetAsset.mediaID;
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
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