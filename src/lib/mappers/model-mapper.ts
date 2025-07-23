import { fileOperations } from "../../core";
import * as mgmtApi from "@agility/management-sdk";

interface ModelMapping {
    sourceGuid: string;
    targetGuid: string;
    sourceID: number;
    targetID: number;
    sourceLastModifiedDate: string;
    targetLastModifiedDate: string;
}


export class ModelMapper {
    private fileOps: fileOperations;
    private sourceGuid: string;
    private targetGuid: string;
    private mappings: ModelMapping[];
    private directory: string;

    constructor(sourceGuid: string, targetGuid: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
        this.directory = 'models';
        // this will provide access to the /agility-files/{GUID} folder
        this.fileOps = new fileOperations(targetGuid)
        this.mappings = this.loadMapping();

    }

    getModelMapping(model: mgmtApi.Model, type: 'source' | 'target'): ModelMapping | null {
        const mapping = this.mappings.find((m: ModelMapping) =>
            type === 'source' ? m.sourceID === model.id : m.targetID === model.id
        );
        if (!mapping) return null;
        return mapping;
    }

    getModelMappingByID(id: number, type: 'source' | 'target'): ModelMapping | null {
        const mapping = this.mappings.find((m: ModelMapping) =>
            type === 'source' ? m.sourceID === id : m.targetID === id
        );
        if (!mapping) return null;
        return mapping;
    }

    getMappedEntity(mapping: ModelMapping, type: 'source' | 'target'): mgmtApi.Model | null {
        //fetch the model from the file system based on source or target GUID
        const guid = type === 'source' ? mapping.sourceGuid : mapping.targetGuid;
        const modelID = type === 'source' ? mapping.sourceID : mapping.targetID;
        const fileOps = new fileOperations(guid);
        const modelFilePath = fileOps.getDataFilePath(`models/${modelID}.json`);
        const modelData = fileOps.readJsonFile(modelFilePath);
        if (!modelData) return null;
        return modelData as mgmtApi.Model;
    }

    addMapping(sourceModel: mgmtApi.Model, targetModel: mgmtApi.Model) {
        const mapping = this.getModelMapping(targetModel, 'target');

        if (mapping) {
            this.updateMapping(sourceModel, targetModel);
        } else {

            const newMapping: ModelMapping = {
                sourceGuid: this.sourceGuid,
                targetGuid: this.targetGuid,
                sourceID: sourceModel.id,
                targetID: targetModel.id,
                sourceLastModifiedDate: sourceModel.lastModifiedDate,
                targetLastModifiedDate: targetModel.lastModifiedDate,

            }

            this.mappings.push(newMapping);
        }

        this.saveMapping();
    }

    updateMapping(sourceModel: mgmtApi.Model, targetModel: mgmtApi.Model) {
        const mapping = this.getModelMapping(targetModel, 'target');
        if (mapping) {
            mapping.sourceGuid = this.sourceGuid;
            mapping.targetGuid = this.targetGuid;
            mapping.sourceID = sourceModel.id;
            mapping.targetID = targetModel.id;
            mapping.sourceLastModifiedDate = sourceModel.lastModifiedDate;
            mapping.targetLastModifiedDate = targetModel.lastModifiedDate;
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

    hasSourceChanged(sourceModel: mgmtApi.Model) {
        const mapping = this.getModelMapping(sourceModel, 'source');
        if (!mapping) return false;
        return sourceModel.lastModifiedDate !== mapping.sourceLastModifiedDate;
    }

    hasTargetChanged(targetModel: mgmtApi.Model) {
        const mapping = this.getModelMapping(targetModel, 'target');
        if (!mapping) return false;
        return targetModel.lastModifiedDate !== mapping.targetLastModifiedDate;
    }

}