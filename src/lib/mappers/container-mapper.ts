import { fileOperations } from "core";
import  * as mgmtApi from "@agility/management-sdk";

interface ContainerMapping {
    sourceGuid: string;
    targetGuid: string;
    sourceContentViewID: number;
    targetContentViewID: number;
    sourceLastModifiedDate: string;
    targetLastModifiedDate: string;
}


export class ContainerMapper {
    private fileOps: fileOperations;
    private sourceGuid: string;
    private targetGuid: string;
    private locale: string;
    private mappings: any;

    constructor(sourceGuid: string, targetGuid: string, locale: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
        this.locale = locale;
        // this will provide access to the /agility-files/{GUID}/{locale} folder
        this.fileOps = new fileOperations(targetGuid, locale)
        this.mappings = this.loadMapping();

    }

    getContainerMapping(container: any) {
        const mapping = this.mappings.find((m: ContainerMapping) => m.targetContentViewID === container.contentViewID);
        return mapping;       
    }

    addMapping(sourceContainer: mgmtApi.Container, targetContainer: mgmtApi.Container) {
        const mapping = this.getContainerMapping(targetContainer);

        if(mapping) {
            this.updateMapping(sourceContainer, targetContainer);
        } else {

            const newMapping: ContainerMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourceContentViewID: sourceContainer.contentViewID,
                targetContentViewID: targetContainer.contentViewID,
                sourceLastModifiedDate: sourceContainer.lastModifiedDate,
                targetLastModifiedDate: targetContainer.lastModifiedDate,

            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourceContainer: mgmtApi.Container, targetContainer: mgmtApi.Container) {
        const mapping = this.getContainerMapping(targetContainer);
        if(mapping) {
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
            mapping.sourceContentViewID = sourceContainer.contentViewID;
            mapping.targetContentViewID = targetContainer.contentViewID;
            mapping.sourceLastModifiedDate = sourceContainer.lastModifiedDate;
            mapping.targetLastModifiedDate = targetContainer.lastModifiedDate;
        }
        this.saveMapping();
    }

    loadMapping() {
        const mapping = this.fileOps.getMappingFile('containers');
        return mapping;
    }

    saveMapping() {
        this.fileOps.saveMappingFile(this.mappings, 'containers');
    }

}