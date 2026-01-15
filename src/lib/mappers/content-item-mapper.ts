import { fileOperations } from "../../core";
import * as mgmtApi from "@agility/management-sdk";

export interface ContentItemMapping {
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
    private mappings: ContentItemMapping[];
    private directory: string;
    public locale: string;

    constructor(sourceGuid: string, targetGuid: string, locale: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
        this.directory = 'item';
        this.locale = locale;
        // this will provide access to the /agility-files/{GUID}/{locale} folder
        this.fileOps = new fileOperations(targetGuid, locale);
        this.mappings = this.loadMapping();

    }

    getContentItemMapping(contentItem: mgmtApi.ContentItem, type: 'source' | 'target'): ContentItemMapping | null {
        const mapping = this.mappings.find((m: ContentItemMapping) =>
            type === 'source' ? m.sourceContentID === contentItem.contentID : m.targetContentID === contentItem.contentID
        );
        if (!mapping) return null;
        return mapping;
    }

    getContentItemMappingByContentID(contentID: number, type: 'source' | 'target'): ContentItemMapping | null {
        const mapping = this.mappings.find((m: ContentItemMapping) =>
            type === 'source' ? m.sourceContentID === contentID : m.targetContentID === contentID
        );
        if (!mapping) return null;
        return mapping;
    }

    getMappedEntity(mapping: ContentItemMapping, type: 'source' | 'target'): mgmtApi.ContentItem | null {
        //fetch the content item from the file system based on source or target GUID
        if (!mapping) {
            return null;
        }
        
        const guid = type === 'source' ? mapping.sourceGuid : mapping.targetGuid;
        const contentID = type === 'source' ? mapping.sourceContentID : mapping.targetContentID;

        if (!guid || !contentID) {
            return null;
        }

        try {
            const fileOps = new fileOperations(guid, this.locale);
            
            // Use the file operations to get the content item file path
            const contentData = fileOps.readJsonFile(`item/${contentID}.json`);
            if (!contentData) {
                // This is normal for target entities that don't exist yet - not an error
                return null;
            }
            
            // Validate that the content data has the expected structure
            if (!contentData.properties) {
                return null;
            }
            
            return contentData as mgmtApi.ContentItem;
        } catch (error) {
            return null;
        }
    }

    addMapping(sourceContentItem: mgmtApi.ContentItem, targetContentItem: mgmtApi.ContentItem) {
        const mapping = this.getContentItemMapping(targetContentItem, 'target');

        if (mapping) {
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
        const mapping = this.getContentItemMapping(targetContentItem, 'target');
        if (mapping) {
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
        const mapping = this.fileOps.getMappingFile(this.directory, this.sourceGuid, this.targetGuid, this.locale);
        return mapping;
    }

    saveMapping() {
        this.fileOps.saveMappingFile(this.mappings, this.directory, this.sourceGuid, this.targetGuid, this.locale);
    }

    hasSourceChanged(sourceContentItem: mgmtApi.ContentItem) {
        if (!sourceContentItem) return false;
        const mapping = this.getContentItemMapping(sourceContentItem, 'source');
        if (!mapping) return true;
        return sourceContentItem.properties.versionID > mapping.sourceVersionID;
    }

    hasTargetChanged(targetContentItem: mgmtApi.ContentItem) {
        const mapping = this.getContentItemMapping(targetContentItem, 'target');
        if (!mapping) return false;
        return targetContentItem.properties.versionID > mapping.targetVersionID;
    }

    /**
     * Update only the target versionID in a mapping (used after publishing)
     * Does NOT update sourceVersionID - that should only change during sync operations
     * 
     * @returns Object with success status and old/new version IDs
     */
    updateTargetVersionID(targetContentID: number, newVersionID: number): { 
        success: boolean; 
        oldVersionID?: number; 
        newVersionID?: number;
    } {
        const mapping = this.getContentItemMappingByContentID(targetContentID, 'target');
        if (!mapping) return { success: false };
        
        const oldVersionID = mapping.targetVersionID;
        
        // Only update if version actually changed
        if (oldVersionID !== newVersionID) {
            mapping.targetVersionID = newVersionID;
            this.saveMapping();
        }
        
        return { 
            success: true, 
            oldVersionID, 
            newVersionID
        };
    }

}