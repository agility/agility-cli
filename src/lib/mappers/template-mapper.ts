import { fileOperations } from "../../core";
import * as mgmtApi from "@agility/management-sdk";
interface TemplateMapping {
    sourceGuid: string;
    targetGuid: string;
    sourcePageTemplateID: number;
    targetPageTemplateID: number;
    sourcePageTemplateName: string;
    targetPageTemplateName: string;
}


export class TemplateMapper {
    private fileOps: fileOperations;
    private sourceGuid: string;
    private targetGuid: string;
    private mappings: TemplateMapping[];
    private directory: string;

    constructor(sourceGuid: string, targetGuid: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
        this.directory = 'templates';
        // this will provide access to the /agility-files/{GUID} folder
        this.fileOps = new fileOperations(targetGuid)
        this.mappings = this.loadMapping();

    }

    getTemplateMapping(template: mgmtApi.PageModel, type: 'source' | 'target'): TemplateMapping | null {
        if (!template) return null;
        const mapping = this.mappings.find((m: TemplateMapping) =>
            type === 'source'
                ? m.sourcePageTemplateID === template.pageTemplateID
                : m.targetPageTemplateID === template.pageTemplateID
        );
        if (!mapping) return null;
        return mapping;
    }

    getTemplateMappingByPageTemplateID(pageTemplateID: number, type: 'source' | 'target'): TemplateMapping | null {
        const mapping = this.mappings.find((m: TemplateMapping) =>
            type === 'source' ? m.sourcePageTemplateID === pageTemplateID : m.targetPageTemplateID === pageTemplateID
        );
        if (!mapping) return null;
        return mapping;
    }

    getTemplateMappingByPageTemplateName(pageTemplateName: string, type: 'source' | 'target'): TemplateMapping | null {
        const mapping = this.mappings.find((m: TemplateMapping) =>
            type === 'source' ? m.sourcePageTemplateName === pageTemplateName : m.targetPageTemplateName === pageTemplateName
        );
        if (!mapping) return null;
        return mapping;
    }

    getMappedEntity(mapping: TemplateMapping, type: 'source' | 'target'): mgmtApi.PageModel | null {
        if (!mapping) return null;
        const guid = type === 'source' ? mapping.sourceGuid : mapping.targetGuid;
        const pageTemplateID = type === 'source' ? mapping.sourcePageTemplateID : mapping.targetPageTemplateID;
        const fileOps = new fileOperations(guid);

        const templateData = fileOps.readJsonFile(`templates/${pageTemplateID}.json`);
        if (!templateData) return null;
        return templateData as mgmtApi.PageModel;
    }

    addMapping(sourceTemplate: mgmtApi.PageModel, targetTemplate: mgmtApi.PageModel) {
        const targetMapping = this.getTemplateMapping(targetTemplate, 'target');
        const sourceMapping = this.getTemplateMapping(sourceTemplate, 'source');

        if (targetMapping && sourceMapping && targetMapping !== sourceMapping) {
            throw new Error(`Invalid Mappings detected! Source pageTemplateID: ${sourceTemplate.pageTemplateID}, Target pageTemplateID: ${targetTemplate.pageTemplateID}`);
        }

        if (targetMapping) {
            this.updateMapping(sourceTemplate, targetTemplate, targetMapping);
        } else {

            const newMapping: TemplateMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourcePageTemplateID: sourceTemplate.pageTemplateID,
                targetPageTemplateID: targetTemplate.pageTemplateID,
                sourcePageTemplateName: sourceTemplate.pageTemplateName,
                targetPageTemplateName: targetTemplate.pageTemplateName,
            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourceTemplate: mgmtApi.PageModel, targetTemplate: mgmtApi.PageModel, mapping: TemplateMapping) {
        if (targetTemplate.pageTemplateID !== mapping.targetPageTemplateID) {
            throw new Error(`Invalid items trying to be mapped! Source pageTemplateID: ${sourceTemplate.pageTemplateID}, Target pageTemplateID: ${targetTemplate.pageTemplateID}`);
        }
        mapping.sourceGuid = this.sourceGuid;
        mapping.targetGuid = this.targetGuid;
        mapping.sourcePageTemplateID = sourceTemplate.pageTemplateID;
        mapping.targetPageTemplateID = targetTemplate.pageTemplateID;
        mapping.sourcePageTemplateName = sourceTemplate.pageTemplateName;
        mapping.targetPageTemplateName = targetTemplate.pageTemplateName;
        this.saveMapping();
    }

    loadMapping() {
        const mapping = this.fileOps.getMappingFile(this.directory, this.sourceGuid, this.targetGuid);
        return mapping;
    }

    saveMapping() {
        this.fileOps.saveMappingFile(this.mappings, this.directory, this.sourceGuid, this.targetGuid);
    }

    hasTargetChanged(template: mgmtApi.PageModel): boolean {
        if (!template) return false;
        const mapping = this.getTemplateMapping(template, 'target');
        if (!mapping) return false;
        return mapping.targetPageTemplateID !== template.pageTemplateID;
    }

    hasSourceChanged(template: mgmtApi.PageModel): boolean {
        const mapping = this.getTemplateMapping(template, 'source');
        if (!mapping) return false;
        return mapping.sourcePageTemplateID !== template.pageTemplateID;
    }


    // we can't detect if the template has changed
    // we just have to push it to the target and respect the --overwrite flag

}