import { fileOperations } from "core";
import * as mgmtApi from "@agility/management-sdk";

interface ContainerMapping {
    sourceGuid: string;
    targetGuid: string;
    sourceContentViewID: number;
    targetContentViewID: number;
    sourceReferenceName?: string;
    targetReferenceName?: string;
    sourceLastModifiedDate: string;
    targetLastModifiedDate: string;
}


export class ContainerMapper {
    private fileOps: fileOperations;
    private sourceGuid: string;
    private targetGuid: string;
    private mappings: ContainerMapping[];
    private directory: string;

    constructor(sourceGuid: string, targetGuid: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
        this.directory = 'containers';
        // this will provide access to the /agility-files/{GUID} folder
        this.fileOps = new fileOperations(targetGuid);
        this.mappings = this.loadMapping();

    }

    getContainerMapping(container: mgmtApi.Container, type: 'source' | 'target'): ContainerMapping | null {
        const mapping = this.mappings.find((m: ContainerMapping) =>
            type === 'source' ? m.sourceContentViewID === container.contentViewID : m.targetContentViewID === container.contentViewID
        );
        if (!mapping) return null;
        return mapping;
    }

    getContainerMappingByContentViewID(contentViewID: number, type: 'source' | 'target'): ContainerMapping | null {
        const mapping = this.mappings.find((m: ContainerMapping) =>
            type === 'source' ? m.sourceContentViewID === contentViewID : m.targetContentViewID === contentViewID
        );
        if (!mapping) return null;
        return mapping;
    }

    getContainerMappingByReferenceName(referenceName: string, type: 'source' | 'target'): ContainerMapping | null {
        const mapping = this.mappings.find((m: ContainerMapping) =>
            type === 'source' ? m.sourceReferenceName === referenceName : m.targetReferenceName === referenceName
        );
        if (!mapping) return null;
        return mapping;
    }

    addMapping(sourceContainer: mgmtApi.Container, targetContainer: mgmtApi.Container) {
        const mapping = this.getContainerMapping(targetContainer, 'target');

        if (mapping) {
            this.updateMapping(sourceContainer, targetContainer);
        } else {

            const newMapping: ContainerMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourceContentViewID: sourceContainer.contentViewID,
                targetContentViewID: targetContainer.contentViewID,
                sourceLastModifiedDate: sourceContainer.lastModifiedDate,
                targetLastModifiedDate: targetContainer.lastModifiedDate,
                sourceReferenceName: sourceContainer.referenceName,
                targetReferenceName: targetContainer.referenceName

            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourceContainer: mgmtApi.Container, targetContainer: mgmtApi.Container) {
        const mapping = this.getContainerMapping(targetContainer, 'target');
        if (mapping) {
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
            mapping.sourceContentViewID = sourceContainer.contentViewID;
            mapping.targetContentViewID = targetContainer.contentViewID;
            mapping.sourceLastModifiedDate = sourceContainer.lastModifiedDate;
            mapping.targetLastModifiedDate = targetContainer.lastModifiedDate;
            mapping.sourceReferenceName = sourceContainer.referenceName;
            mapping.targetReferenceName = targetContainer.referenceName;
            this.saveMapping();
        }

    }

    loadMapping() {
        const mapping = this.fileOps.getMappingFile(this.directory);
        return mapping;
    }

    saveMapping() {
        this.fileOps.saveMappingFile(this.mappings, this.directory);
    }

    hasSourceChanged(sourceContainer: mgmtApi.Container) {
        const mapping = this.getContainerMapping(sourceContainer, 'source');
        if (!mapping) return false;
        return sourceContainer.lastModifiedDate !== mapping.sourceLastModifiedDate;
    }

    hasTargetChanged(targetContainer: mgmtApi.Container) {
        const mapping = this.getContainerMapping(targetContainer, 'target');
        if (!mapping) return false;
        return targetContainer.lastModifiedDate !== mapping.targetLastModifiedDate;
    }



}