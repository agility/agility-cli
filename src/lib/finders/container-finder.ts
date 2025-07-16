import * as mgmtApi from '@agility/management-sdk';
import { ReferenceMapper } from "../shared/reference-mapper";
import ansiColors from 'ansi-colors';
import { getState } from "../../core/state";
import { FinderDecisionEngine, FinderDecision } from "../shared/target-safety-detector";

/**
 * Enhanced container finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Sync Delta SECOND → Conflict Resolution
 */
export async function findContainerInTargetInstanceEnhanced(
    sourceContainer: mgmtApi.Container,
    apiClient: mgmtApi.ApiClient,
    targetGuid: string,
    targetData: any,
    referenceMapper: ReferenceMapper
): Promise<{ container: mgmtApi.Container | null; shouldUpdate: boolean; shouldCreate: boolean; shouldSkip: boolean; decision?: FinderDecision }> {
    const state = getState();

    // STEP 1: Find existing mapping
    const existingMapping = referenceMapper.getMappingByKey<mgmtApi.Container>("container", "referenceName", sourceContainer.referenceName);
    let targetContainerFromMapping: mgmtApi.Container | null = existingMapping?.target || null;

    // STEP 2: Find target instance data with enhanced matching
    const targetInstanceData = targetData.containers?.find((c: any) => {
        if (targetContainerFromMapping) {
            return (
                c.referenceName === targetContainerFromMapping.referenceName ||
                c.contentViewID === targetContainerFromMapping.contentViewID
            );
        } else {
            // Enhanced matching strategies for containers
            if (c.referenceName === sourceContainer.referenceName) {
                return true;
            }
            
            // Case-insensitive match
            if (c.referenceName && sourceContainer.referenceName &&
                c.referenceName.toLowerCase() === sourceContainer.referenceName.toLowerCase()) {
                return true;
            }
            
            // Partial match for containers with generated suffixes
            const sourceBase = sourceContainer.referenceName?.split('_')[0]?.toLowerCase();
            const targetBase = c.referenceName?.split('_')[0]?.toLowerCase();
            
            if (sourceBase && targetBase && sourceBase === targetBase && 
                sourceBase.length > 5) { // Only match if base name is meaningful
                return true;
            }
            
            return false;
        }
    });

    // STEP 3: Use FinderDecisionEngine for proper conflict resolution
    const decision = FinderDecisionEngine.makeDecision(
        'container',
        sourceContainer.contentViewID,
        sourceContainer.referenceName || `Container-${sourceContainer.contentViewID}`,
        sourceContainer,
        targetContainerFromMapping,
        targetInstanceData
    );

    return {
        container: decision.entity || sourceContainer, // Fallback to source container if no target found
        shouldUpdate: decision.shouldUpdate,
        shouldCreate: decision.shouldCreate,
        shouldSkip: decision.shouldSkip,
        decision: decision
    };
}

// Function overloads to handle both Container object and string referenceName
export async function findContainerInTargetInstance(
  container: mgmtApi.Container,
  apiClient: mgmtApi.ApiClient,
  guid: string,
  referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container | null>;

export async function findContainerInTargetInstance(
    referenceName: string, 
    apiClient: mgmtApi.ApiClient, 
    guid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container | null>;

export async function findContainerInTargetInstance(
    containerOrReferenceName: mgmtApi.Container | string, 
    apiClient: mgmtApi.ApiClient, 
    guid: string,
    referenceMapper: ReferenceMapper
): Promise<mgmtApi.Container | null> {
  try {
    // Extract referenceName from either Container object or string
    const referenceName = typeof containerOrReferenceName === 'string' 
        ? containerOrReferenceName 
        : containerOrReferenceName.referenceName;

    // First check the local reference mapper for a container with the same reference name
    const mappingResult = referenceMapper.getMappingByKey("container", "referenceName", referenceName);
    const targetMapping = mappingResult?.target;

    if (targetMapping) {
      return targetMapping as mgmtApi.Container;
    }

    // If not in mapper, try to find it in the target instance by referenceName
    const containers = await apiClient.containerMethods.getContainerList(guid);
    const targetContainer = containers.find(c => c.referenceName === referenceName);

    if (targetContainer) {
      // CRITICAL: Add the mapping so we don't lose track of it
      // Only add mapping if we have the full container object
      if (typeof containerOrReferenceName !== 'string') {
        referenceMapper.addMapping("container", containerOrReferenceName, targetContainer);
      }
      return targetContainer;
    }

    return null;
  } catch (error: any) {
    return null;
  }
}
