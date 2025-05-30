import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from '../mapper';
import ansiColors from 'ansi-colors';

export class ContainerMapper {
    private referenceMapper: ReferenceMapper;

    constructor(referenceMapper: ReferenceMapper) {
        this.referenceMapper = referenceMapper;
    }

    async mapModels(container: mgmtApi.Container): Promise<mgmtApi.Container | null> {
        console.log(ansiColors.yellow(`[Container Mapper] Looking for model mapping for container ${container.referenceName} with contentDefinitionID: ${container.contentDefinitionID}`));
        
        const modelRef = this.referenceMapper.getMapping<mgmtApi.Model>('model', 'id', container.contentDefinitionID);
        
        if (modelRef?.target) {
            console.log(ansiColors.green(`[Container Mapper] Found model mapping: source ID ${modelRef.source.id} -> target ID ${modelRef.target.id}`));
            // Update the container's contentDefinitionID to match the target model's ID
            container.contentDefinitionID = modelRef.target.id;
            container.contentDefinitionType = 1;
            container.contentDefinitionTypeID = 1;

            // contentDefinitionType: (mappedSourceContainer as any).contentDefinitionTypeID,
            // contentDefinitionTypeID: (mappedSourceContainer as any).contentDefinitionTypeID
            return container;
        } else {
            console.log(ansiColors.red(`[Container Mapper] No model mapping found for contentDefinitionID: ${container.contentDefinitionID}`));
            
            // Let's check what model mappings we do have
            const allModelMappings = this.referenceMapper.getRecordsByType('model');
            console.log(ansiColors.yellow(`[Container Mapper] Available model mappings:`));
            allModelMappings.forEach(mapping => {
                console.log(ansiColors.yellow(`  - Model ${mapping.source.referenceName} (source ID: ${mapping.source.id}) -> (target ID: ${mapping.target?.id || 'null'})`));
            });
        }
        return null;
    }

   
}
