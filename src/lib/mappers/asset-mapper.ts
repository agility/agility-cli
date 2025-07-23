import { fileOperations } from "../../core";
import * as mgmtApi from "@agility/management-sdk";

interface AssetMapping {
    sourceGuid: string;
    targetGuid: string;
    sourceDateModified: string;
    targetDateModified: string;
    sourceMediaID: number;
    targetMediaID: number;
    sourceUrl?: string;
    targetUrl?: string;
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

    getAssetMapping(asset: mgmtApi.Media, type: 'source' | 'target'): AssetMapping | null {
        const mapping = this.mappings.find((m: AssetMapping) => type === 'source' ? m.sourceMediaID === asset.mediaID : m.targetMediaID === asset.mediaID);
        if (!mapping) return null;
        return mapping;
    }

    getAssetMappingByMediaID(mediaID: number, type: 'source' | 'target'): AssetMapping | null {
        const mapping = this.mappings.find((m: AssetMapping) => type === 'source' ? m.sourceMediaID === mediaID : m.targetMediaID === mediaID);
        if (!mapping) return null;
        return mapping;
    }

    getAssetMappingByMediaUrl(url: string, type: 'source' | 'target'): AssetMapping | null {
        const mapping = this.mappings.find((m: AssetMapping) => type === 'source' ? m.sourceUrl === url : m.targetUrl === url);
        if (!mapping) return null;
        return mapping;
    }

    getMappedEntity(mapping: AssetMapping, type: 'source' | 'target'): mgmtApi.Media | null {
        const guid = type === 'source' ? mapping.sourceGuid : mapping.targetGuid;
        const mediaID = type === 'source' ? mapping.sourceMediaID : mapping.targetMediaID;
        const fileOps = new fileOperations(guid);
        const mediaFilePath = fileOps.getDataFilePath(`assets/${mediaID}.json`);
        const mediaData = fileOps.readJsonFile(mediaFilePath);
        if (!mediaData) return null;
        return mediaData as mgmtApi.Media;
    }

    addMapping(sourceAsset: mgmtApi.Media, targetAsset: mgmtApi.Media) {
        const mapping = this.getAssetMapping(targetAsset, 'target');

        if (mapping) {
            this.updateMapping(sourceAsset, targetAsset);
        } else {

            const newMapping: AssetMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourceDateModified: sourceAsset.dateModified,
                targetDateModified: targetAsset.dateModified,
                sourceMediaID: sourceAsset.mediaID,
                targetMediaID: targetAsset.mediaID,
                sourceUrl: sourceAsset.edgeUrl,
                targetUrl: targetAsset.edgeUrl,

            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourceAsset: mgmtApi.Media, targetAsset: mgmtApi.Media) {
        const mapping = this.getAssetMapping(targetAsset, 'target');
        if (mapping) {
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
            mapping.sourceDateModified = sourceAsset.dateModified;
            mapping.targetDateModified = targetAsset.dateModified;
            mapping.sourceMediaID = sourceAsset.mediaID;
            mapping.targetMediaID = targetAsset.mediaID;
            mapping.sourceUrl = sourceAsset.edgeUrl;
            mapping.targetUrl = targetAsset.edgeUrl;
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
        if (!sourceAsset) return false;
        const mapping = this.getAssetMapping(sourceAsset, 'source');
        if (!mapping) return false;

        const sourceDate = new Date(sourceAsset.dateModified);
        const mappingDate = new Date(mapping.sourceDateModified);
        return sourceDate > mappingDate;

    }

    hasTargetChanged(targetAsset?: mgmtApi.Media | null) {

        if (!targetAsset) return false;
        const mapping = this.getAssetMapping(targetAsset, 'target');
        if (!mapping) return false;

        const targetDate = new Date(targetAsset.dateModified);
        const mappingDate = new Date(mapping.targetDateModified);

        return targetDate > mappingDate;
    }


}