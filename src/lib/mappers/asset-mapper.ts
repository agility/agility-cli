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
    sourceContainerEdgeUrl?: string;
    targetContainerEdgeUrl?: string;
    sourceContainerOriginUrl?: string;
    targetContainerOriginUrl?: string;
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
        // Try exact match first
        const exact = this.mappings.find((m: AssetMapping) => type === 'source' ? m.sourceUrl === url : m.targetUrl === url);
        if (exact) return exact;

        // Fallback: match by container prefix (handles subfolder paths like /mobile/feature-carousel/)
        return this.findMappingByContainerPrefix(url, type);
    }

    /**
     * Remap a URL from source container to target container, preserving any subfolder path.
     * e.g. "cdn-usa2.aglty.io/brightstar-tns-cat/mobile/feature-carousel/file.png"
     *    → "cdn-usa2.aglty.io/2151a7f2/mobile/feature-carousel/file.png"
     *
     * Returns null if the URL doesn't match any mapping's container prefix.
     */
    remapUrlByContainer(url: string, type: 'source' | 'target'): string | null {
        const mapping = this.findMappingByContainerPrefix(url, type);
        if (!mapping) return null;

        // Determine which container URLs to use based on whether this is an edge or origin URL
        const sourceEdge = type === 'source' ? mapping.sourceContainerEdgeUrl : mapping.targetContainerEdgeUrl;
        const targetEdge = type === 'source' ? mapping.targetContainerEdgeUrl : mapping.sourceContainerEdgeUrl;
        const sourceOrigin = type === 'source' ? mapping.sourceContainerOriginUrl : mapping.targetContainerOriginUrl;
        const targetOrigin = type === 'source' ? mapping.targetContainerOriginUrl : mapping.sourceContainerOriginUrl;

        // Try edge URL swap first, then origin URL swap
        if (sourceEdge && targetEdge && url.startsWith(sourceEdge)) {
            return url.replace(sourceEdge, targetEdge);
        }
        if (sourceOrigin && targetOrigin && url.startsWith(sourceOrigin)) {
            return url.replace(sourceOrigin, targetOrigin);
        }

        return null;
    }

    private findMappingByContainerPrefix(url: string, type: 'source' | 'target'): AssetMapping | null {
        return this.mappings.find((m: AssetMapping) => {
            const edgeUrl = type === 'source' ? m.sourceContainerEdgeUrl : m.targetContainerEdgeUrl;
            const originUrl = type === 'source' ? m.sourceContainerOriginUrl : m.targetContainerOriginUrl;
            return (edgeUrl && url.startsWith(edgeUrl + '/')) || (originUrl && url.startsWith(originUrl + '/'));
        }) || null;
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
                sourceContainerEdgeUrl: sourceAsset.containerEdgeUrl,
                targetContainerEdgeUrl: targetAsset.containerEdgeUrl,
                sourceContainerOriginUrl: sourceAsset.containerOriginUrl,
                targetContainerOriginUrl: targetAsset.containerOriginUrl,
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
            mapping.sourceContainerEdgeUrl = sourceAsset.containerEdgeUrl;
            mapping.targetContainerEdgeUrl = targetAsset.containerEdgeUrl;
            mapping.sourceContainerOriginUrl = sourceAsset.containerOriginUrl;
            mapping.targetContainerOriginUrl = targetAsset.containerOriginUrl;
        }
        this.saveMapping();
    }

    loadMapping() {
        const mapping = this.fileOps.getMappingFile(this.directory, this.sourceGuid, this.targetGuid);
        return mapping;
    }

    saveMapping() {
        this.fileOps.saveMappingFile(this.mappings, this.directory, this.sourceGuid, this.targetGuid);
    }

    hasSourceChanged(sourceAsset: mgmtApi.Media | null | undefined) {
        if (!sourceAsset) return false;
        const mapping = this.getAssetMapping(sourceAsset, 'source');
        if (!mapping) return false;

        const sourceDate = new Date(sourceAsset.dateModified);
        const mappingDate = new Date(mapping.sourceDateModified);
        return sourceDate > mappingDate;

    }

    hasTargetChanged(targetAsset?: mgmtApi.Media | null | undefined) {

        if (!targetAsset) return false;
        const mapping = this.getAssetMapping(targetAsset, 'target');
        if (!mapping) return false;

        const targetDate = new Date(targetAsset.dateModified);
        const mappingDate = new Date(mapping.targetDateModified);

        return targetDate > mappingDate;
    }


}