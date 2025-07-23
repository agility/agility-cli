import { fileOperations } from "core";
import  * as mgmtApi from "@agility/management-sdk";
interface TemplateMapping {
    sourceGuid: string;
    targetGuid: string;
    sourcePageTemplateID: number;
    targetPageTemplateID: number;
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
        const mapping = this.mappings.find((m: TemplateMapping) => 
            type === 'source' ? m.sourcePageTemplateID === template.pageTemplateID : m.targetPageTemplateID === template.pageTemplateID
        );
        if(!mapping) return null;
        return mapping;       
    }

    getTemplateMappingByPageTemplateID(pageTemplateID: number, type: 'source' | 'target'): TemplateMapping | null {
        const mapping = this.mappings.find((m: TemplateMapping) => 
            type === 'source' ? m.sourcePageTemplateID === pageTemplateID : m.targetPageTemplateID === pageTemplateID
        );
        if(!mapping) return null;
        return mapping;
    }

    addMapping(sourceTemplate: mgmtApi.PageModel, targetTemplate: mgmtApi.PageModel) {
        const mapping = this.getTemplateMapping(targetTemplate, 'target');

        if(mapping) {
            this.updateMapping(sourceTemplate, targetTemplate);
        } else {

            const newMapping: TemplateMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourcePageTemplateID: sourceTemplate.pageTemplateID,
                targetPageTemplateID: targetTemplate.pageTemplateID,

            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourceTemplate: mgmtApi.PageModel, targetTemplate: mgmtApi.PageModel) {
        const mapping = this.getTemplateMapping(targetTemplate, 'target');
        if(mapping) {
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
            mapping.sourcePageTemplateID = sourceTemplate.pageTemplateID;
            mapping.targetPageTemplateID = targetTemplate.pageTemplateID;
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

   // we can't detect if the template has changed
   // we just have to push it to the target and respect the --overwrite flag 
    
}