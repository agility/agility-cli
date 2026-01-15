import { fileOperations } from "../../core";
import * as mgmtApi from "@agility/management-sdk";

interface PageMapping {
    sourceGuid: string;
    targetGuid: string;
    sourcePageID: number;
    targetPageID: number;
    sourceVersionID: number;
    targetVersionID: number;
    sourcePageTemplateName: string;
    targetPageTemplateName: string;
}


export class PageMapper {
    private fileOps: fileOperations;
    private sourceGuid: string;
    private targetGuid: string;
    private mappings: PageMapping[];
    private directory: string;
    private locale: string;

    constructor(sourceGuid: string, targetGuid: string, locale: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
        this.directory = 'page';
        this.locale = locale;
        // this will provide access to the /agility-files/{GUID}/{locale} folder
        this.fileOps = new fileOperations(targetGuid, locale)
        this.mappings = this.loadMapping();

    }

    getPageMapping(page: mgmtApi.PageItem, type: 'source' | 'target'): PageMapping | null {
        const mapping = this.mappings.find((m: PageMapping) =>
            type === 'source' ? m.sourcePageID === page.pageID : m.targetPageID === page.pageID
        );
        if (!mapping) return null;
        return mapping;
    }

    getPageMappingByPageID(pageID: number, type: 'source' | 'target'): PageMapping | null {
        const mapping = this.mappings.find((m: PageMapping) =>
            type === 'source' ? m.sourcePageID === pageID : m.targetPageID === pageID
        );
        if (!mapping) return null;
        return mapping;
    }

    getPageMappingByPageTemplateName(pageTemplateName: string, type: 'source' | 'target'): PageMapping | null {
        const mapping = this.mappings.find((m: PageMapping) =>
            type === 'source' ? m.sourcePageTemplateName === pageTemplateName : m.targetPageTemplateName === pageTemplateName
        );
        if (!mapping) return null;
        return mapping;
    }

    getMappedEntity(mapping: PageMapping, type: 'source' | 'target'): mgmtApi.PageItem | null {
        if (!mapping) return null;
        const guid = type === 'source' ? mapping.sourceGuid : mapping.targetGuid;
        const pageID = type === 'source' ? mapping.sourcePageID : mapping.targetPageID;
        const fileOps = new fileOperations(guid, this.locale);
        const pageData = fileOps.readJsonFile(`page/${pageID}.json`);
        if (!pageData) return null;
        return pageData as mgmtApi.PageItem;
    }

    addMapping(sourcePage: mgmtApi.PageItem, targetPage: mgmtApi.PageItem) {
        const mapping = this.getPageMapping(targetPage, 'target');

        if (mapping) {
            this.updateMapping(sourcePage, targetPage);
        } else {

            const newMapping: PageMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourcePageID: sourcePage.pageID,
                targetPageID: targetPage.pageID,
                sourceVersionID: sourcePage.properties.versionID,
                targetVersionID: targetPage.properties.versionID,
                sourcePageTemplateName: sourcePage.templateName,
                targetPageTemplateName: targetPage.templateName,
            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourcePage: mgmtApi.PageItem, targetPage: mgmtApi.PageItem) {
        const mapping = this.getPageMapping(targetPage, 'target');
        if (mapping) {
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
            mapping.sourcePageID = sourcePage.pageID;
            mapping.targetPageID = targetPage.pageID;
            mapping.sourceVersionID = sourcePage.properties.versionID;
            mapping.targetVersionID = targetPage.properties.versionID;
            mapping.sourcePageTemplateName = sourcePage.templateName;
            mapping.targetPageTemplateName = targetPage.templateName;
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

    hasSourceChanged(sourcePage: mgmtApi.PageItem) {
        if (!sourcePage) return false;
        const mapping = this.getPageMapping(sourcePage, 'source');
        if (!mapping) return true;
        return sourcePage.properties.versionID > mapping.sourceVersionID;
    }

    hasTargetChanged(targetPage: mgmtApi.PageItem) {
        if (!targetPage) return false;
        const mapping = this.getPageMapping(targetPage, 'target');
        if (!mapping) return false;
        return targetPage.properties.versionID > mapping.targetVersionID;
    }

    /**
     * Update only the target versionID in a mapping (used after publishing)
     * Does NOT update sourceVersionID - that should only change during sync operations
     * 
     * @returns Object with success status and old/new version IDs
     */
    updateTargetVersionID(targetPageID: number, newVersionID: number): { 
        success: boolean; 
        oldVersionID?: number; 
        newVersionID?: number;
    } {
        const mapping = this.getPageMappingByPageID(targetPageID, 'target');
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