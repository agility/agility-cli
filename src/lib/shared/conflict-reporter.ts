/**
 * Conflict Reporter & Warning System
 * 
 * Tracks conflicts during sync operations and provides helpful user guidance
 * for resolving target safety conflicts and sync delta issues.
 */

import ansiColors from 'ansi-colors';
import { FinderDecision, ConflictResolution } from './target-safety-detector';

export interface ConflictSummary {
  totalConflicts: number;
  targetUnsafeSkipped: number;
  conflictsForced: number;
  syncDeltaApplied: number;
  totalSkipped: number;
  conflictDetails: ConflictDetail[];
}

export interface ConflictDetail {
  entityType: string;
  entityName: string;
  entityId: string | number;
  conflictType: 'target-unsafe' | 'sync-conflict' | 'forced-update';
  message: string;
  recommendForce: boolean;
}

/**
 * Conflict Reporter for tracking and reporting sync conflicts
 */
export class ConflictReporter {
  private conflicts: ConflictDetail[] = [];
  private stats = {
    totalConflicts: 0,
    targetUnsafeSkipped: 0,
    conflictsForced: 0,
    syncDeltaApplied: 0,
    totalSkipped: 0
  };

  /**
   * Record a finder decision for conflict tracking
   */
  recordDecision(
    entityType: string,
    entityName: string,
    entityId: string | number,
    decision: FinderDecision
  ): void {
    
    const resolution = decision.resolution;
    
    // Track statistics
    if (resolution.shouldSkip) {
      this.stats.totalSkipped++;
    }
    
    if (resolution.hasConflict) {
      this.stats.totalConflicts++;
      
      if (resolution.shouldUpdate || resolution.shouldCreate) {
        // Conflict was forced
        this.stats.conflictsForced++;
        this.addConflict({
          entityType,
          entityName,
          entityId,
          conflictType: 'forced-update',
          message: resolution.warningMessage || '',
          recommendForce: false
        });
      } else {
        // Conflict was skipped
        this.addConflict({
          entityType,
          entityName,
          entityId,
          conflictType: 'sync-conflict',
          message: resolution.warningMessage || '',
          recommendForce: resolution.recommendForce || false
        });
      }
    } else if (!decision.targetSafety.isSafe && resolution.shouldSkip) {
      // Target unsafe, skipped
      this.stats.targetUnsafeSkipped++;
      this.addConflict({
        entityType,
        entityName,
        entityId,
        conflictType: 'target-unsafe',
        message: resolution.warningMessage || '',
        recommendForce: resolution.recommendForce || false
      });
    } else if (decision.syncDelta.hasChanges && (resolution.shouldUpdate || resolution.shouldCreate)) {
      // Sync delta applied successfully
      this.stats.syncDeltaApplied++;
    }
  }

  /**
   * Add a conflict detail
   */
  private addConflict(conflict: ConflictDetail): void {
    this.conflicts.push(conflict);
  }

  /**
   * Display warning messages during sync operation
   */
  displayWarning(decision: FinderDecision, entityType: string, entityName: string): void {
    if (decision.resolution.warningMessage) {
      console.log(decision.resolution.warningMessage);
    }
  }

  /**
   * Get conflict summary
   */
  getSummary(): ConflictSummary {
    return {
      totalConflicts: this.stats.totalConflicts,
      targetUnsafeSkipped: this.stats.targetUnsafeSkipped,
      conflictsForced: this.stats.conflictsForced,
      syncDeltaApplied: this.stats.syncDeltaApplied,
      totalSkipped: this.stats.totalSkipped,
      conflictDetails: this.conflicts
    };
  }

  /**
   * Display final conflict report
   */
  displayFinalReport(): void {
    const summary = this.getSummary();
    
    if (summary.totalConflicts === 0 && summary.targetUnsafeSkipped === 0) {
      // No conflicts - clean sync
      if (summary.syncDeltaApplied > 0) {
        console.log(ansiColors.green(`\n✅ Sync completed cleanly with ${summary.syncDeltaApplied} sync delta changes applied.`));
      }
      return;
    }

    console.log(ansiColors.yellow('\n📊 SYNC CONFLICT SUMMARY:'));
    console.log(ansiColors.gray('=' .repeat(50)));

    if (summary.syncDeltaApplied > 0) {
      console.log(ansiColors.green(`✅ Applied ${summary.syncDeltaApplied} sync delta changes`));
    }

    if (summary.targetUnsafeSkipped > 0) {
      console.log(ansiColors.yellow(`⚠️  Skipped ${summary.targetUnsafeSkipped} entities with target changes`));
    }

    if (summary.totalConflicts > 0) {
      console.log(ansiColors.red(`🔥 ${summary.totalConflicts} conflicts detected`));
      
      if (summary.conflictsForced > 0) {
        console.log(ansiColors.red(`   ${summary.conflictsForced} conflicts forced with --force flag`));
      }
    }

    // Show detailed conflict information
    if (summary.conflictDetails.length > 0) {
      console.log(ansiColors.yellow('\n📋 CONFLICT DETAILS:'));
      
      for (const conflict of summary.conflictDetails) {
        const icon = this.getConflictIcon(conflict.conflictType);
        console.log(`${icon} ${conflict.entityType} "${conflict.entityName}": ${conflict.message}`);
      }
    }

    // Show recommendations
    const hasSkippedConflicts = summary.conflictDetails.some(c => c.recommendForce);
    if (hasSkippedConflicts) {
      console.log(ansiColors.cyan('\n💡 RECOMMENDATIONS:'));
      console.log(ansiColors.cyan('   • Review target instance changes before proceeding'));
      console.log(ansiColors.cyan('   • Use --force flag to override target changes if necessary'));
      console.log(ansiColors.cyan('   • Consider backing up target instance before using --force'));
    }

    console.log(ansiColors.gray('=' .repeat(50)));
  }

  /**
   * Get icon for conflict type
   */
  private getConflictIcon(conflictType: string): string {
    switch (conflictType) {
      case 'target-unsafe':
        return ansiColors.yellow('⚠️ ');
      case 'sync-conflict':
        return ansiColors.red('🔥');
      case 'forced-update':
        return ansiColors.magenta('💪');
      default:
        return ansiColors.gray('❓');
    }
  }

  /**
   * Check if there are any unresolved conflicts
   */
  hasUnresolvedConflicts(): boolean {
    return this.conflicts.some(c => c.recommendForce);
  }

  /**
   * Reset conflict tracking for new operation
   */
  reset(): void {
    this.conflicts = [];
    this.stats = {
      totalConflicts: 0,
      targetUnsafeSkipped: 0,
      conflictsForced: 0,
      syncDeltaApplied: 0,
      totalSkipped: 0
    };
  }
} 