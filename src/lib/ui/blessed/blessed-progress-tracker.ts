import { BlessedUIManager } from './blessed-ui-manager';

export interface StepProgress {
  stepName: string;
  status: 'pending' | 'progress' | 'success' | 'error';
  percentage: number;
  startTime?: number;
  endTime?: number;
}

export interface ProgressSummary {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  overallSuccess: boolean;
  elapsedTime: number;
}

export type ProgressCallbackType = (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void;

export class BlessedProgressTracker {
  private steps: StepProgress[] = [];
  private startTime: number = 0;
  private uiManager: BlessedUIManager;

  constructor(uiManager: BlessedUIManager) {
    this.uiManager = uiManager;
  }

  /**
   * Initialize steps for tracking
   */
  initializeSteps(stepNames: string[]): void {
    this.steps = stepNames.map(name => ({
      stepName: name,
      status: 'pending',
      percentage: 0
    }));
    this.startTime = Date.now();
  }

  /**
   * Update step progress and UI
   */
  updateStep(stepIndex: number, status: 'pending' | 'progress' | 'success' | 'error', percentage?: number): void {
    if (stepIndex < 0 || stepIndex >= this.steps.length) return;

    const step = this.steps[stepIndex];
    const previousStatus = step.status;

    step.status = status;
    if (percentage !== undefined) {
      step.percentage = percentage;
    }

    // Track timing
    if (previousStatus === 'pending' && status === 'progress') {
      step.startTime = Date.now();
    } else if ((status === 'success' || status === 'error') && !step.endTime) {
      step.endTime = Date.now();
      step.percentage = 100;
    }

    // Update BlessedUI (map 'pending' to 'progress' for UI display)
    const uiStatus: 'success' | 'error' | 'progress' = status === 'pending' ? 'progress' : status;
    this.uiManager.updateProgress(stepIndex, uiStatus, step.percentage);
  }

  /**
   * Create progress callback for a specific step
   */
  createProgressCallback(stepIndex: number): ProgressCallbackType {
    return (processed: number, total: number, status?: 'success' | 'error' | 'progress') => {
      const percentage = total > 0 
        ? Math.floor((processed / total) * 100)
        : (status === "success" || status === "error") ? 100 : 0;

      this.updateStep(stepIndex, status || 'progress', percentage);
    };
  }

  /**
   * Get current progress summary
   */
  getSummary(): ProgressSummary {
    const completedSteps = this.steps.filter(s => s.status === 'success').length;
    const failedSteps = this.steps.filter(s => s.status === 'error').length;
    const overallSuccess = this.steps.every(s => s.status === 'success');

    return {
      totalSteps: this.steps.length,
      completedSteps,
      failedSteps,
      overallSuccess,
      elapsedTime: Date.now() - this.startTime
    };
  }

  /**
   * Get step details
   */
  getSteps(): StepProgress[] {
    return [...this.steps];
  }

  /**
   * Format elapsed time for display
   */
  getFormattedElapsedTime(): string {
    const elapsedMs = Date.now() - this.startTime;
    const seconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
  }

  /**
   * Log progress summary to BlessedUI
   */
  logSummary(): void {
    const summary = this.getSummary();
    const timeDisplay = this.getFormattedElapsedTime();
    
    const summaryMessage = `Pull completed: ${summary.completedSteps}/${summary.totalSteps} steps successful, ${summary.failedSteps} errors, ${timeDisplay}`;
    
    if (summary.overallSuccess) {
      this.uiManager.log(`✅ ${summaryMessage}`);
    } else {
      this.uiManager.log(`⚠️ ${summaryMessage}`);
    }
  }

  /**
   * Start auto-exit process
   */
  startAutoExit(): void {
    this.logSummary();
    this.uiManager.startAutoExit();
  }
} 