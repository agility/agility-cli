import { getState } from '../../../core/state';

export type ProgressStatus = 'pending' | 'success' | 'error' | 'progress';
export type ProgressCallbackType = (
  processed: number,
  total: number,
  status?: 'success' | 'error' | 'progress'
) => void;

export interface StepStatus {
  name: string;
  status: ProgressStatus;
  percentage: number;
  startTime?: Date;
  endTime?: Date;
  error?: string;
}

export interface ProgressSummary {
  totalSteps: number;
  successfulSteps: number;
  errorSteps: number;
  pendingSteps: number;
  overallSuccess: boolean;
  totalDuration: number;
  durationFormatted: string;
}

export interface ProgressCallbacks {
  onStepStart?: (stepIndex: number, stepName: string) => void;
  onStepProgress?: (stepIndex: number, stepName: string, percentage: number) => void;
  onStepComplete?: (stepIndex: number, stepName: string, status: ProgressStatus) => void;
  onOverallProgress?: (summary: ProgressSummary) => void;
}

export class ProgressTracker {
  private steps: StepStatus[] = [];
  private callbacks: ProgressCallbacks = {};
  private startTime: Date = new Date();
  private operationName: string = 'Operation';

  constructor(operationName: string = 'Operation') {
    this.operationName = operationName;
    this.startTime = new Date();
  }

  /**
   * Initialize steps for tracking
   */
  initializeSteps(stepNames: string[]): void {
    this.steps = stepNames.map((name) => ({
      name,
      status: 'pending',
      percentage: 0,
    }));
    this.startTime = new Date();
  }

  /**
   * Set progress callbacks for different events
   */
  setCallbacks(callbacks: ProgressCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Start a step
   */
  startStep(stepIndex: number): void {
    if (stepIndex < 0 || stepIndex >= this.steps.length) return;

    this.steps[stepIndex].status = 'progress';
    this.steps[stepIndex].percentage = 0;
    this.steps[stepIndex].startTime = new Date();
    this.steps[stepIndex].error = undefined;

    this.callbacks.onStepStart?.(stepIndex, this.steps[stepIndex].name);
  }

  /**
   * Update step progress
   */
  updateStepProgress(
    stepIndex: number,
    percentage: number,
    status: ProgressStatus = 'progress'
  ): void {
    if (stepIndex < 0 || stepIndex >= this.steps.length) return;

    this.steps[stepIndex].percentage = Math.min(100, Math.max(0, percentage));
    this.steps[stepIndex].status = status;

    if (status === 'success' || status === 'error') {
      this.steps[stepIndex].endTime = new Date();
      this.steps[stepIndex].percentage = 100;
    }

    this.callbacks.onStepProgress?.(
      stepIndex,
      this.steps[stepIndex].name,
      this.steps[stepIndex].percentage
    );

    if (status === 'success' || status === 'error') {
      this.callbacks.onStepComplete?.(stepIndex, this.steps[stepIndex].name, status);
    }
  }

  /**
   * Mark step as successful
   */
  completeStep(stepIndex: number): void {
    this.updateStepProgress(stepIndex, 100, 'success');
  }

  /**
   * Mark step as failed
   */
  failStep(stepIndex: number, error?: string): void {
    if (stepIndex < 0 || stepIndex >= this.steps.length) return;

    this.steps[stepIndex].error = error;
    this.updateStepProgress(stepIndex, this.steps[stepIndex].percentage, 'error');
  }

  /**
   * Create a progress callback for a specific step
   */
  createStepProgressCallback(stepIndex: number): ProgressCallbackType {
    return (processed: number, total: number, status = 'progress') => {
      const percentage = total > 0 ? Math.floor((processed / total) * 100) : 0;

      if (status === 'error') {
        this.failStep(stepIndex);
      } else if (status === 'success') {
        this.completeStep(stepIndex);
      } else {
        this.updateStepProgress(stepIndex, percentage, 'progress');
      }
    };
  }

  /**
   * Get current progress summary
   */
  getSummary(): ProgressSummary {
    const totalSteps = this.steps.length;
    const successfulSteps = this.steps.filter((step) => step.status === 'success').length;
    const errorSteps = this.steps.filter((step) => step.status === 'error').length;
    const pendingSteps = this.steps.filter((step) => step.status === 'pending').length;
    const overallSuccess = errorSteps === 0 && successfulSteps === totalSteps;

    const now = new Date();
    const totalDuration = now.getTime() - this.startTime.getTime();
    const totalSeconds = Math.floor(totalDuration / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const durationFormatted = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    const summary: ProgressSummary = {
      totalSteps,
      successfulSteps,
      errorSteps,
      pendingSteps,
      overallSuccess,
      totalDuration,
      durationFormatted,
    };

    this.callbacks.onOverallProgress?.(summary);
    return summary;
  }

  /**
   * Get step status by index
   */
  getStep(stepIndex: number): StepStatus | null {
    if (stepIndex < 0 || stepIndex >= this.steps.length) return null;
    return { ...this.steps[stepIndex] };
  }

  /**
   * Get step status by name
   */
  getStepByName(stepName: string): StepStatus | null {
    const step = this.steps.find((s) => s.name === stepName);
    return step ? { ...step } : null;
  }

  /**
   * Get all steps
   */
  getAllSteps(): StepStatus[] {
    return this.steps.map((step) => ({ ...step }));
  }

  /**
   * Get step index by name
   */
  getStepIndex(stepName: string): number {
    return this.steps.findIndex((s) => s.name === stepName);
  }

  /**
   * Check if all steps are complete
   */
  isComplete(): boolean {
    return this.steps.every((step) => step.status === 'success' || step.status === 'error');
  }

  /**
   * Check if any steps have errors
   */
  hasErrors(): boolean {
    return this.steps.some((step) => step.status === 'error');
  }

  /**
   * Get steps with errors
   */
  getFailedSteps(): StepStatus[] {
    return this.steps.filter((step) => step.status === 'error').map((step) => ({ ...step }));
  }

  /**
   * Get completed steps
   */
  getCompletedSteps(): StepStatus[] {
    return this.steps.filter((step) => step.status === 'success').map((step) => ({ ...step }));
  }

  /**
   * Get pending steps
   */
  getPendingSteps(): StepStatus[] {
    return this.steps.filter((step) => step.status === 'pending').map((step) => ({ ...step }));
  }

  /**
   * Get overall progress percentage (0-100)
   */
  getOverallProgress(): number {
    if (this.steps.length === 0) return 0;

    const totalProgress = this.steps.reduce((sum, step) => sum + step.percentage, 0);
    return Math.floor(totalProgress / this.steps.length);
  }

  /**
   * Reset all steps to pending
   */
  reset(): void {
    this.steps = this.steps.map((step) => ({
      ...step,
      status: 'pending',
      percentage: 0,
      startTime: undefined,
      endTime: undefined,
      error: undefined,
    }));
    this.startTime = new Date();
  }

  /**
   * Format summary for logging
   */
  formatSummary(includeDetails: boolean = false): string[] {
    const summary = this.getSummary();
    const lines: string[] = [];

    lines.push(
      `${this.operationName} completed: ${summary.successfulSteps}/${summary.totalSteps} steps successful, ${summary.errorSteps} errors, ${summary.durationFormatted}`
    );

    if (includeDetails) {
      if (summary.errorSteps > 0) {
        lines.push('Failed steps:');
        this.getFailedSteps().forEach((step) => {
          lines.push(`  ✗ ${step.name}${step.error ? `: ${step.error}` : ''}`);
        });
      }

      if (summary.successfulSteps > 0) {
        lines.push('Successful steps:');
        this.getCompletedSteps().forEach((step) => {
          const duration =
            step.startTime && step.endTime
              ? `(${Math.floor((step.endTime.getTime() - step.startTime.getTime()) / 1000)}s)`
              : '';
          lines.push(`  ✓ ${step.name} ${duration}`);
        });
      }
    }

    return lines;
  }

  /**
   * Create a throttled progress callback for memory optimization
   */
  createThrottledProgressCallback(
    stepIndex: number,
    updateInterval: number = 500
  ): ProgressCallbackType {
    let lastUpdate = 0;

    return (processed: number, total: number, status = 'progress') => {
      const now = Date.now();

      // Always process success/error status immediately
      if (status === 'success' || status === 'error') {
        this.createStepProgressCallback(stepIndex)(processed, total, status);
        return;
      }

      // Throttle progress updates
      if (now - lastUpdate > updateInterval) {
        this.createStepProgressCallback(stepIndex)(processed, total, status);
        lastUpdate = now;
      }
    };
  }

  /**
   * Get operation name
   */
  getOperationName(): string {
    return this.operationName;
  }

  /**
   * Set operation name
   */
  setOperationName(name: string): void {
    this.operationName = name;
  }

  /**
   * Get start time
   */
  getStartTime(): Date {
    return new Date(this.startTime);
  }
}
