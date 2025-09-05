import { fileOperations } from '../../core';
import * as mgmtApi from '@agility/management-sdk';

interface ModelMapping {
  sourceGuid: string;
  targetGuid: string;
  sourceID: number;
  targetID: number;
  sourceReferenceName?: string;
  targetReferenceName?: string;
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
    this.fileOps = new fileOperations(targetGuid);
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

  getModelMappingByReferenceName(
    referenceName: string,
    type: 'source' | 'target'
  ): ModelMapping | null {
    //do a case-insensitive search for the referenceName
    const refNameLower = referenceName.toLowerCase();

    const mapping = this.mappings.find((m: ModelMapping) =>
      type === 'source'
        ? m.sourceReferenceName.toLowerCase() === refNameLower
        : m.targetReferenceName.toLowerCase() === refNameLower
    );
    if (!mapping) return null;
    return mapping;
  }

  getMappedEntity(mapping: ModelMapping, type: 'source' | 'target'): mgmtApi.Model | null {
    if (!mapping) return null;
    //fetch the model from the file system based on source or target GUID
    const guid = type === 'source' ? mapping.sourceGuid : mapping.targetGuid;
    const modelID = type === 'source' ? mapping.sourceID : mapping.targetID;

    const fileOps = new fileOperations(guid);
    const modelData = fileOps.readJsonFile(`models/${modelID}.json`);
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
        sourceReferenceName: sourceModel.referenceName,
        targetReferenceName: targetModel.referenceName,
        sourceLastModifiedDate: sourceModel.lastModifiedDate,
        targetLastModifiedDate: targetModel.lastModifiedDate,
      };

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
      mapping.sourceReferenceName = sourceModel.referenceName;
      mapping.targetReferenceName = targetModel.referenceName;
      mapping.sourceLastModifiedDate = sourceModel.lastModifiedDate;
      mapping.targetLastModifiedDate = targetModel.lastModifiedDate;
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

  hasSourceChanged(sourceModel: mgmtApi.Model | null | undefined) {
    if (!sourceModel) return false;
    const mapping = this.getModelMapping(sourceModel, 'source');
    if (!mapping) return false;

    const sourceDate = new Date(sourceModel.lastModifiedDate);
    const mappedDate = new Date(mapping.sourceLastModifiedDate);

    return sourceDate > mappedDate;
  }

  hasTargetChanged(targetModel: mgmtApi.Model | null | undefined) {
    if (!targetModel) return false;
    const mapping = this.getModelMapping(targetModel, 'target');
    if (!mapping) return false;
    const targetDate = new Date(targetModel.lastModifiedDate);
    const mappedDate = new Date(mapping.targetLastModifiedDate);
    return targetDate > mappedDate;
  }
}
