export interface ProgressStats {
  processed: number;
  total: number;
  percentage: number;
  startTime: Date;
  currentTime: Date;
  elapsedTime: number;
  estimatedTotalTime?: number;
  estimatedRemainingTime?: number;
  itemsPerSecond?: number;
}

export interface ProgressWindow {
  timestamp: number;
  processed: number;
}

export class ProgressCalculator {
  private progressHistory: ProgressWindow[] = [];
  private windowSize: number = 10; // Keep last 10 measurements for rate calculation
  private startTime: Date = new Date();

  constructor(windowSize: number = 10) {
    this.windowSize = windowSize;
    this.startTime = new Date();
  }

  /**
   * Calculate progress percentage
   */
  static calculatePercentage(processed: number, total: number): number {
    if (total <= 0) return 0;
    return Math.min(100, Math.max(0, Math.floor((processed / total) * 100)));
  }

  /**
   * Calculate progress stats with timing information
   */
  calculateProgress(processed: number, total: number): ProgressStats {
    const currentTime = new Date();
    const elapsedTime = currentTime.getTime() - this.startTime.getTime();
    const percentage = ProgressCalculator.calculatePercentage(processed, total);

    // Add current measurement to history
    this.addMeasurement(processed);

    // Calculate items per second using moving average
    const itemsPerSecond = this.calculateItemsPerSecond();

    // Estimate remaining time
    const remaining = total - processed;
    const estimatedRemainingTime = itemsPerSecond > 0 ? (remaining / itemsPerSecond) * 1000 : undefined;
    const estimatedTotalTime = estimatedRemainingTime ? elapsedTime + estimatedRemainingTime : undefined;

    return {
      processed,
      total,
      percentage,
      startTime: this.startTime,
      currentTime,
      elapsedTime,
      estimatedTotalTime,
      estimatedRemainingTime,
      itemsPerSecond
    };
  }

  /**
   * Add a measurement to the progress history
   */
  private addMeasurement(processed: number): void {
    const now = Date.now();
    this.progressHistory.push({ timestamp: now, processed });

    // Keep only the last windowSize measurements
    if (this.progressHistory.length > this.windowSize) {
      this.progressHistory.shift();
    }
  }

  /**
   * Calculate items per second using moving average
   */
  private calculateItemsPerSecond(): number {
    if (this.progressHistory.length < 2) return 0;

    const latest = this.progressHistory[this.progressHistory.length - 1];
    const earliest = this.progressHistory[0];

    const timeDiff = (latest.timestamp - earliest.timestamp) / 1000; // seconds
    const itemsDiff = latest.processed - earliest.processed;

    return timeDiff > 0 ? itemsDiff / timeDiff : 0;
  }

  /**
   * Format time duration
   */
  static formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format items per second
   */
  static formatRate(itemsPerSecond: number): string {
    if (itemsPerSecond > 1000) {
      return `${(itemsPerSecond / 1000).toFixed(1)}k/sec`;
    } else if (itemsPerSecond > 1) {
      return `${itemsPerSecond.toFixed(1)}/sec`;
    } else if (itemsPerSecond > 0) {
      return `${(itemsPerSecond * 60).toFixed(1)}/min`;
    } else {
      return '0/sec';
    }
  }

  /**
   * Create a progress summary string
   */
  static formatProgressSummary(stats: ProgressStats): string {
    const parts: string[] = [];
    
    parts.push(`${stats.processed}/${stats.total} (${stats.percentage}%)`);
    
    if (stats.itemsPerSecond !== undefined) {
      parts.push(ProgressCalculator.formatRate(stats.itemsPerSecond));
    }
    
    if (stats.estimatedRemainingTime !== undefined) {
      const eta = ProgressCalculator.formatDuration(stats.estimatedRemainingTime);
      parts.push(`ETA: ${eta}`);
    }

    return parts.join(' - ');
  }

  /**
   * Calculate completion percentage for multiple steps
   */
  static calculateOverallProgress(stepProgresses: number[]): number {
    if (stepProgresses.length === 0) return 0;
    
    const totalProgress = stepProgresses.reduce((sum, progress) => sum + progress, 0);
    return Math.floor(totalProgress / stepProgresses.length);
  }

  /**
   * Calculate weighted progress for steps with different importance
   */
  static calculateWeightedProgress(stepProgresses: number[], weights: number[]): number {
    if (stepProgresses.length !== weights.length || stepProgresses.length === 0) return 0;
    
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    if (totalWeight === 0) return 0;
    
    const weightedSum = stepProgresses.reduce((sum, progress, index) => {
      return sum + (progress * weights[index]);
    }, 0);
    
    return Math.floor(weightedSum / totalWeight);
  }

  /**
   * Estimate time until completion
   */
  getEstimatedTimeRemaining(processed: number, total: number): number | null {
    const stats = this.calculateProgress(processed, total);
    return stats.estimatedRemainingTime || null;
  }

  /**
   * Get current processing rate
   */
  getCurrentRate(): number {
    return this.calculateItemsPerSecond();
  }

  /**
   * Reset calculator for new operation
   */
  reset(): void {
    this.progressHistory = [];
    this.startTime = new Date();
  }

  /**
   * Create a throttled progress reporter
   */
  static createThrottledReporter(
    reportCallback: (stats: ProgressStats) => void,
    intervalMs: number = 500
  ): (processed: number, total: number) => void {
    let lastReportTime = 0;
    const calculator = new ProgressCalculator();

    return (processed: number, total: number) => {
      const now = Date.now();
      
      // Always report completion (100%)
      if (processed >= total) {
        const stats = calculator.calculateProgress(processed, total);
        reportCallback(stats);
        return;
      }

      // Throttle intermediate updates
      if (now - lastReportTime > intervalMs) {
        const stats = calculator.calculateProgress(processed, total);
        reportCallback(stats);
        lastReportTime = now;
      }
    };
  }

  /**
   * Create batch progress calculator for large operations
   */
  static createBatchProgressCalculator(batchSize: number): {
    reportProgress: (batchIndex: number, totalBatches: number, batchProgress: number) => ProgressStats;
    reset: () => void;
  } {
    const calculator = new ProgressCalculator();

    return {
      reportProgress: (batchIndex: number, totalBatches: number, batchProgress: number) => {
        // Calculate overall progress: completed batches + current batch progress
        const completedItems = batchIndex * batchSize;
        const currentBatchItems = Math.floor((batchProgress / 100) * batchSize);
        const totalProcessed = completedItems + currentBatchItems;
        const totalItems = totalBatches * batchSize;

        return calculator.calculateProgress(totalProcessed, totalItems);
      },
      reset: () => calculator.reset()
    };
  }

  /**
   * Smooth progress updates to prevent UI jitter
   */
  static createSmoothProgressReporter(
    updateCallback: (percentage: number) => void,
    smoothingFactor: number = 0.1
  ): (processed: number, total: number) => void {
    let lastReportedPercentage = 0;

    return (processed: number, total: number) => {
      const actualPercentage = ProgressCalculator.calculatePercentage(processed, total);
      
      // Use exponential smoothing to reduce jitter
      const smoothedPercentage = lastReportedPercentage + 
        smoothingFactor * (actualPercentage - lastReportedPercentage);
      
      const roundedPercentage = Math.floor(smoothedPercentage);
      
      // Only update if there's a meaningful change or completion
      if (roundedPercentage !== lastReportedPercentage || actualPercentage === 100) {
        updateCallback(actualPercentage === 100 ? 100 : roundedPercentage);
        lastReportedPercentage = roundedPercentage;
      }
    };
  }

  /**
   * Calculate conservative progress for Content Sync SDK operations
   */
  static calculateConservativeProgress(totalItems: number, divisor: number = 20): number {
    // More conservative progress calculation to prevent overly optimistic estimates
    return Math.min(95, Math.floor(totalItems / divisor));
  }

  /**
   * Get progress statistics for debugging
   */
  getStats(): {
    historySize: number;
    currentRate: number;
    elapsedTime: number;
  } {
    return {
      historySize: this.progressHistory.length,
      currentRate: this.calculateItemsPerSecond(),
      elapsedTime: Date.now() - this.startTime.getTime()
    };
  }
} 