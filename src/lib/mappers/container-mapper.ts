import { fileOperations } from "../../core";
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

    getMappedEntity(mapping: ContainerMapping, type: 'source' | 'target'): mgmtApi.Container | null {
        //fetch the container from the file system based on source or target GUID
        const guid = type === 'source' ? mapping.sourceGuid : mapping.targetGuid;
        const containerID = type === 'source' ? mapping.sourceContentViewID : mapping.targetContentViewID;
        const fileOps = new fileOperations(guid);
        const containerFilePath = fileOps.getDataFilePath(`containers/${containerID}.json`);
        const containerData = fileOps.readJsonFile(containerFilePath);
        if (!containerData) return null;
        return containerData as mgmtApi.Container;
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
        const mapping = this.fileOps.getMappingFile(this.directory, this.sourceGuid, this.targetGuid);
        return mapping;
    }

    saveMapping() {
        this.fileOps.saveMappingFile(this.mappings, this.directory, this.sourceGuid, this.targetGuid);
    }

    hasSourceChanged(sourceContainer: mgmtApi.Container | null | undefined) {
        if (!sourceContainer) return false;
        const mapping = this.getContainerMapping(sourceContainer, 'source');
        if (!mapping) return false;
        const sourceDate = new Date(sourceContainer.lastModifiedDate);
        const mappedDate = new Date(mapping.sourceLastModifiedDate);

        return sourceDate > mappedDate;
    }

    hasTargetChanged(targetContainer: mgmtApi.Container | null | undefined) {
        if (!targetContainer) return false;
        const mapping = this.getContainerMapping(targetContainer, 'target');
        if (!mapping) return false;
        const targetDate = new Date(targetContainer.lastModifiedDate);
        const mappedDate = new Date(mapping.targetLastModifiedDate);
        return targetDate > mappedDate;
    }



}