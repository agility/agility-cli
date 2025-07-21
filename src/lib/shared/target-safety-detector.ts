/**
 * Target Safety Detector & Conflict Resolution
 * 
 * Implements proper logic flow for sync operations:
 * 1. Check Target Safety (mapping vs target data) - FIRST
 * 2. Check Sync Delta (source changes to apply)  
 * 3. Conflict Resolution (target changes + sync delta changes)
 * 4. Decision with --force override capability
 */

import { SyncDelta } from './sync-delta-tracker';
import { getState } from '../../core/state';
import ansiColors from 'ansi-colors';

export interface TargetSafetyResult {
  isSafe: boolean;
  hasTargetChanges: boolean;
  targetChangeDate?: string;
  mappingDate?: string;
  warningMessage?: string;
}

export interface SyncDeltaResult {
  hasChanges: boolean;
  entityChange?: any; // EntityChange from sync delta
}

export interface ConflictResolution {
  shouldUpdate: boolean;
  shouldCreate: boolean;
  shouldSkip: boolean;
  hasConflict: boolean;
  warningMessage?: string;
  recommendForce?: boolean;
}

export interface FinderDecision {
  entity: any | null;
  shouldUpdate: boolean;
  shouldCreate: boolean;
  shouldSkip: boolean;
  targetSafety: TargetSafetyResult;
  syncDelta: SyncDeltaResult;
  resolution: ConflictResolution;
  sourceEntity: any;
}

/**
 * Target Safety Detection for different entity types
 */
export class TargetSafetyDetector {
  
  /**
   * Check if target instance is safe to update (no user changes since last sync)
   */
  static checkTargetSafety(
    entityType: string,
    targetMapping: any | null,
    targetInstanceData: any | null
  ): TargetSafetyResult {
    
    // If no mapping exists, target is considered safe (new entity or no previous sync)
    if (!targetMapping) {
      return {
        isSafe: true,
        hasTargetChanges: false,
        warningMessage: undefined
      };
    }
    
    // If no target instance data, target is safe (entity doesn't exist in target)
    if (!targetInstanceData) {
      return {
        isSafe: true,
        hasTargetChanges: false,
        warningMessage: undefined
      };
    }
    
    // Compare dates based on entity type
    const dateComparison = this.compareDates(entityType, targetMapping, targetInstanceData);
    
    if (dateComparison.targetNewer) {
      return {
        isSafe: false,
        hasTargetChanges: true,
        targetChangeDate: dateComparison.targetDate,
        mappingDate: dateComparison.mappingDate,
        warningMessage: `Target instance has changes since last sync (target: ${dateComparison.targetDate}, mapping: ${dateComparison.mappingDate})`
      };
    }
    
    return {
      isSafe: true,
      hasTargetChanges: false,
      targetChangeDate: dateComparison.targetDate,
      mappingDate: dateComparison.mappingDate
    };
  }
  
  /**
   * Compare dates for different entity types
   */
  private static compareDates(
    entityType: string,
    targetMapping: any,
    targetInstanceData: any
  ): { targetNewer: boolean; targetDate: string; mappingDate: string } {
    
    let mappingDate: Date;
    let targetDate: Date;
    
    switch (entityType) {
      case 'model':
        mappingDate = new Date(targetMapping.lastModifiedDate || 0);
        targetDate = new Date(targetInstanceData.lastModifiedDate || 0);
        break;
        
      case 'container':
        mappingDate = new Date(targetMapping.lastModifiedDate || 0);
        targetDate = new Date(targetInstanceData.lastModifiedDate || 0);
        break;
        
      case 'asset':
        mappingDate = new Date(targetMapping.dateModified || 0);
        targetDate = new Date(targetInstanceData.dateModified || 0);
        break;
        
      case 'gallery':
        mappingDate = new Date(targetMapping.modifiedOn || 0);
        targetDate = new Date(targetInstanceData.modifiedOn || 0);
        break;
        
      case 'content-item':
        // For content, we compare versionID instead of dates
        const mappingVersion = targetMapping.properties?.versionID || 0;
        const targetVersion = targetInstanceData.properties?.versionID || 0;
        return {
          targetNewer: targetVersion !== mappingVersion,
          targetDate: `v${targetVersion}`,
          mappingDate: `v${mappingVersion}`
        };
        
      case 'page':
        mappingDate = targetMapping.pageVersionID || 0;
        targetDate = targetInstanceData.pageVersionID || 0;
        break;
        
      case 'template':
        // Templates typically don't have reliable modification dates
        // For now, consider them safe unless explicitly overwritten
        return {
          targetNewer: false,
          targetDate: 'unknown',
          mappingDate: 'unknown'
        };
        
      default:
        return {
          targetNewer: false,
          targetDate: 'unknown',
          mappingDate: 'unknown'
        };
    }
    
    // Validate dates before calling toISOString()
    const targetDateStr = isNaN(targetDate.getTime()) ? 'invalid-date' : targetDate.toISOString();
    const mappingDateStr = isNaN(mappingDate.getTime()) ? 'invalid-date' : mappingDate.toISOString();
    
    return {
      targetNewer: targetDate > mappingDate,
      targetDate: targetDateStr,
      mappingDate: mappingDateStr
    };
  }
}

/**
 * Conflict Resolution Engine
 */
export class ConflictResolver {
  
  /**
   * Resolve conflicts between target safety and sync delta
   */
  static resolveConflict(
    entityType: string,
    entityId: string | number,
    entityName: string,
    targetSafety: TargetSafetyResult,
    syncDelta: SyncDeltaResult,
    existsInTarget: boolean
  ): ConflictResolution {
    
    const state = getState();
    const forceOverride = state.force;
    const overwrite = state.overwrite;
    
    // Decision Matrix Implementation
    
    if (targetSafety.isSafe) {
      // TARGET SAFE scenarios
      
      if (!syncDelta.hasChanges) {
        // Safe + No sync delta = Normal logic
        return this.normalLogic(existsInTarget, overwrite);
      } else {
        // Safe + Sync delta = Apply sync delta
        return {
          shouldUpdate: existsInTarget,
          shouldCreate: !existsInTarget,
          shouldSkip: false,
          hasConflict: false,
          warningMessage: `Applying sync delta changes for ${entityType} '${entityName}'`
        };
      }
      
    } else {
      // TARGET UNSAFE scenarios (user made changes)
      
      if (!syncDelta.hasChanges) {
        // Unsafe + No sync delta = Skip with warning (unless force)
        if (forceOverride) {
          return this.normalLogic(existsInTarget, overwrite);
        } else {
          return {
            shouldUpdate: false,
            shouldCreate: false,
            shouldSkip: true,
            hasConflict: false,
            warningMessage: `⚠️  Skipping ${entityType} '${entityName}': ${targetSafety.warningMessage}. Use --force to override.`,
            recommendForce: true
          };
        }
      } else {
        // Unsafe + Sync delta = CONFLICT (requires force)
        if (forceOverride) {
          return {
            shouldUpdate: existsInTarget,
            shouldCreate: !existsInTarget,
            shouldSkip: false,
            hasConflict: true,
            warningMessage: `🔥 FORCING update of ${entityType} '${entityName}' despite target changes. Target changes will be overwritten.`
          };
        } else {
          return {
            shouldUpdate: false,
            shouldCreate: false,
            shouldSkip: true,
            hasConflict: true,
            warningMessage: `⚠️  CONFLICT: ${entityType} '${entityName}' has both target changes AND sync delta updates. Use --force to override target changes.`,
            recommendForce: true
          };
        }
      }
    }
  }
  
  /**
   * Normal logic for safe scenarios
   */
  private static normalLogic(existsInTarget: boolean, overwrite: boolean): ConflictResolution {
    if (existsInTarget) {
      return {
        shouldUpdate: overwrite,
        shouldCreate: false,
        shouldSkip: !overwrite,
        hasConflict: false
      };
    } else {
      return {
        shouldUpdate: false,
        shouldCreate: true,
        shouldSkip: false,
        hasConflict: false
      };
    }
  }
}

/**
 * Master decision function for all finders
 */
export class FinderDecisionEngine {
  
  /**
   * Make finder decision using proper logic flow
   */
  static makeDecision(
    entityType: string,
    entityId: string | number,
    entityName: string,
    sourceEntity: any,
    targetMapping: any | null,
    targetInstanceData: any | null
  ): FinderDecision {
    
    const state = getState();
    const existsInTarget = !!targetInstanceData || !!targetMapping;
    const finalTargetEntity = targetInstanceData || targetMapping;
    
    // console.log(ansiColors.bold.magenta(`sourceEntity: ${JSON.stringify(sourceEntity)}`));
    // STEP 1: Check Target Safety (FIRST)
    const targetSafety = TargetSafetyDetector.checkTargetSafety(
      entityType,
      targetMapping,
      targetInstanceData
    );

    return null;

    
    // STEP 2: Check Sync Delta (SECOND)
    // const syncDelta: SyncDeltaResult = {
    //   hasChanges: SyncDeltaReader.isEntityInSyncDelta(
    //     entityType,
    //     entityId,
    //     entityName,
    //     state.rootPath
    //   ),
    //   entityChange: SyncDeltaReader.getSyncDeltaEntity(
    //     entityType,
    //     entityId,
    //     entityName,
    //     state.rootPath
    //   )
    // };
    // STEP 3: Conflict Resolution (THIRD)
    // const resolution = ConflictResolver.resolveConflict(
    //   entityType,
    //   entityId,
    //   entityName,
    //   targetSafety,
    //   syncDelta,
    //   existsInTarget
    // );
    // return {
    //   entity: finalTargetEntity,
    //   shouldUpdate: resolution.shouldUpdate,
    //   shouldCreate: resolution.shouldCreate,
    //   shouldSkip: resolution.shouldSkip,
    //   targetSafety,
    //   syncDelta,
    //   resolution,
    //   sourceEntity
    // };
  }
} 
