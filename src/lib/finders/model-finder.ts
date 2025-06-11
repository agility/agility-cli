import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from '../reference-mapper';

export async function findModelInTargetInstance(model: mgmtApi.Model, apiClient: mgmtApi.ApiClient, guid: string, referenceMapper: ReferenceMapper): Promise<mgmtApi.Model | null> {
    try {

        // first check the local reference mapper for a model with the same reference name
        const mappingResult = referenceMapper.getMappingByKey('model', 'referenceName', model.referenceName);
        const targetMapping = mappingResult?.target;

        if (targetMapping) {
            return targetMapping as mgmtApi.Model;
        }


        const targetModel = await apiClient.modelMethods.getModelByReferenceName(model.referenceName, guid);




        if (targetModel) {
            return targetModel;
        }



        return null;
        // const model = await apiClient.modelMethods.getModelByReferenceName(model.referenceName, guid);
        // return model;
        return null;
    } catch (error: any) {
        return null;
    }
}