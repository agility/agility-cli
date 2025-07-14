import { ProgressTracker, ProgressCallbacks, ProgressSummary, StepStatus } from './progress-tracker';
import { ProgressCalculator, ProgressStats } from './progress-calculator';
import { getState } from '../../../core/state';

export interface StepConfig {
  name: string;
  weight?: number;
  description?: string;
  isOptional?: boolean;
  dependencies?: string[];
}

export interface StepExecutionContext {
  stepIndex: number;
  stepName: string;
  startTime: Date;
  progressCallback: (processed: number, total: number, status?: "success" | "error" | "progress") => void;
  updateProgress: (percentage: number) => void;
  complete: () => void;
  fail: (error?: string) => void;
}

export class StepStatusManager {
  private progressTracker: ProgressTracker;
  private stepConfigs: StepConfig[] = [];
  private activeStepIndex: number = -1;
  private callbacks: ProgressCallbacks = {};

  constructor(operationName: string = 'Operation') {
    this.progressTracker = new ProgressTracker(operationName);
  }

  /**
   * Initialize steps with configuration
   */
  initializeSteps(stepConfigs: StepConfig[]): void {
    this.stepConfigs = stepConfigs;
    const stepNames = stepConfigs.map(config => config.name);
    this.progressTracker.initializeSteps(stepNames);
  }

  /**
   * Set callbacks for progress events
   */
  setCallbacks(callbacks: ProgressCallbacks): void {
    this.callbacks = callbacks;
    this.progressTracker.setCallbacks(callbacks);
  }

  /**
   * Get available steps based on state elements filter
   */
  static getAvailableSteps(): string[] {
    return [
      "downloadAllGalleries",
      "downloadAllAssets", 
      "downloadAllModels",
      "downloadAllTemplates",
      "downloadAllContainers",
      "downloadAllSyncSDK"
    ];
  }

  /**
   * Filter steps based on state elements
   */
  static filterStepsByElements(availableSteps: string[]): string[] {
    const state = getState();
    const elements = state.elements ? state.elements.split(",") : ['Galleries', 'Assets', 'Models', 'Templates', 'Containers', 'Content', 'Pages'];
    
    // Map element names to step names (some elements map to multiple steps)
    const elementToStepMap: Record<string, string[]> = {
      'Galleries': ['downloadAllGalleries'],
      'Assets': ['downloadAllAssets'],
      'Models': ['downloadAllModels'],
      'Templates': ['downloadAllTemplates'],
      'Containers': ['downloadAllContainers', 'downloadAllSyncSDK'], // Run both isolated and sync SDK downloaders
      'Content': ['downloadAllSyncSDK'],
      'Pages': ['downloadAllSyncSDK'],
      'Sitemaps': ['downloadAllSyncSDK'],
      'Redirections': ['downloadAllSyncSDK']
    };
    
    // Convert elements to step names and filter available steps, removing duplicates
    const requiredStepNames = Array.from(new Set(elements.flatMap(element => elementToStepMap[element] || []).filter(Boolean)));
    return availableSteps.filter(step => requiredStepNames.includes(step));
  }

  /**
   * Create step configurations from element filter
   */
  static createStepConfigs(stepNames?: string[]): StepConfig[] {
    const steps = stepNames || StepStatusManager.filterStepsByElements(StepStatusManager.getAvailableSteps());
    
    return steps.map(stepName => {
      const config: StepConfig = {
        name: stepName,
        weight: StepStatusManager.getStepWeight(stepName),
        description: StepStatusManager.getStepDescription(stepName),
        isOptional: StepStatusManager.isStepOptional(stepName)
      };

      // Add dependencies for certain steps
      if (stepName === "downloadAllSyncSDK") {
        config.dependencies = ["downloadAllModels", "downloadAllContainers"];
      }

      return config;
    });
  }

  /**
   * Get step weight for weighted progress calculation
   */
  private static getStepWeight(stepName: string): number {
    const weights: Record<string, number> = {
      "downloadAllSyncSDK": 5,     // Content Sync SDK is usually the heaviest operation
      "downloadAllGalleries": 1,
      "downloadAllAssets": 3,
      "downloadAllModels": 2,
      "downloadAllTemplates": 1,
      "downloadAllContainers": 2
    };
    return weights[stepName] || 1;
  }

  /**
   * Get step description
   */
  private static getStepDescription(stepName: string): string {
    const descriptions: Record<string, string> = {
      "downloadAllSyncSDK": "Download content items, pages, sitemaps, and redirections via Content Sync SDK",
      "downloadAllGalleries": "Download asset galleries and media groupings",
      "downloadAllAssets": "Download media files and asset metadata",
      "downloadAllModels": "Download content models and field definitions",
      "downloadAllTemplates": "Download page templates and layouts",
      "downloadAllContainers": "Download content containers and views"
    };
    return descriptions[stepName] || `Download ${stepName}`;
  }

  /**
   * Check if step is optional
   */
  private static isStepOptional(stepName: string): boolean {
    // All current steps are required
    return false;
  }

  /**
   * Start execution of a step
   */
  startStep(stepIndex: number): StepExecutionContext {
    if (stepIndex < 0 || stepIndex >= this.stepConfigs.length) {
      throw new Error(`Invalid step index: ${stepIndex}`);
    }

    this.activeStepIndex = stepIndex;
    this.progressTracker.startStep(stepIndex);

    const stepConfig = this.stepConfigs[stepIndex];
    const startTime = new Date();

    const context: StepExecutionContext = {
      stepIndex,
      stepName: stepConfig.name,
      startTime,
      progressCallback: this.progressTracker.createStepProgressCallback(stepIndex),
      updateProgress: (percentage: number) => {
        this.progressTracker.updateStepProgress(stepIndex, percentage, 'progress');
      },
      complete: () => {
        this.progressTracker.completeStep(stepIndex);
        this.activeStepIndex = -1;
      },
      fail: (error?: string) => {
        this.progressTracker.failStep(stepIndex, error);
        this.activeStepIndex = -1;
      }
    };

    return context;
  }

  /**
   * Get current active step
   */
  getActiveStep(): StepExecutionContext | null {
    if (this.activeStepIndex < 0) return null;
    return this.startStep(this.activeStepIndex);
  }

  /**
   * Get progress tracker
   */
  getProgressTracker(): ProgressTracker {
    return this.progressTracker;
  }

  /**
   * Get step configurations
   */
  getStepConfigs(): StepConfig[] {
    return [...this.stepConfigs];
  }

  /**
   * Get step config by name
   */
  getStepConfig(stepName: string): StepConfig | null {
    return this.stepConfigs.find(config => config.name === stepName) || null;
  }

  /**
   * Get step index by name
   */
  getStepIndex(stepName: string): number {
    return this.stepConfigs.findIndex(config => config.name === stepName);
  }

  /**
   * Check if dependencies are satisfied for a step
   */
  areDependenciesSatisfied(stepIndex: number): boolean {
    if (stepIndex < 0 || stepIndex >= this.stepConfigs.length) return false;

    const stepConfig = this.stepConfigs[stepIndex];
    if (!stepConfig.dependencies || stepConfig.dependencies.length === 0) return true;

    // Check if all dependency steps are completed
    return stepConfig.dependencies.every(depName => {
      const depStep = this.progressTracker.getStepByName(depName);
      return depStep && depStep.status === 'success';
    });
  }

  /**
   * Get next available step that can be executed
   */
  getNextAvailableStep(): number {
    for (let i = 0; i < this.stepConfigs.length; i++) {
      const step = this.progressTracker.getStep(i);
      if (step && step.status === 'pending' && this.areDependenciesSatisfied(i)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Calculate weighted overall progress
   */
  getWeightedProgress(): number {
    const stepProgresses = this.progressTracker.getAllSteps().map(step => step.percentage);
    const weights = this.stepConfigs.map(config => config.weight || 1);
    return ProgressCalculator.calculateWeightedProgress(stepProgresses, weights);
  }

  /**
   * Get execution summary with timing details
   */
  getExecutionSummary(): ProgressSummary & {
    stepDetails: Array<{
      name: string;
      status: string;
      duration?: number;
      error?: string;
    }>;
    weightedProgress: number;
  } {
    const summary = this.progressTracker.getSummary();
    const allSteps = this.progressTracker.getAllSteps();
    
    const stepDetails = allSteps.map(step => ({
      name: step.name,
      status: step.status,
      duration: step.startTime && step.endTime 
        ? step.endTime.getTime() - step.startTime.getTime()
        : undefined,
      error: step.error
    }));

    return {
      ...summary,
      stepDetails,
      weightedProgress: this.getWeightedProgress()
    };
  }

  /**
   * Create a UI mode-specific progress reporter
   */
  createModeSpecificProgressReporter(): {
    shouldShowProgress: boolean;
    shouldShowVerbose: boolean;
    reportProgress: (stepIndex: number, percentage: number) => void;
    reportStepStart: (stepIndex: number) => void;
    reportStepComplete: (stepIndex: number, status: 'success' | 'error') => void;
  } {
    const state = getState();
    const shouldShowProgress = !state.useHeadless;
    const shouldShowVerbose = state.useVerbose;

    return {
      shouldShowProgress,
      shouldShowVerbose,
      reportProgress: (stepIndex: number, percentage: number) => {
        if (shouldShowProgress) {
          this.progressTracker.updateStepProgress(stepIndex, percentage, 'progress');
        }
      },
      reportStepStart: (stepIndex: number) => {
        const stepName = this.stepConfigs[stepIndex]?.name;
        if (shouldShowVerbose && stepName) {
          console.log(`Starting ${stepName}...`);
        }
      },
      reportStepComplete: (stepIndex: number, status: 'success' | 'error') => {
        const stepName = this.stepConfigs[stepIndex]?.name;
        if (shouldShowProgress && stepName) {
          if (status === 'success') {
            this.progressTracker.completeStep(stepIndex);
          } else {
            this.progressTracker.failStep(stepIndex);
          }
        }
      }
    };
  }

  /**
   * Handle Content Sync SDK progress integration
   */
  setupContentSyncProgress(contentStepIndex: number): {
    progressCallback: (stats: any) => void;
    cleanup: () => void;
  } {
    const PROGRESS_UPDATE_INTERVAL = 500;
    const LOG_UPDATE_INTERVAL = 5000;
    const CLEANUP_INTERVAL = 15000;

    let lastProgressUpdate = 0;
    let lastLogUpdate = 0;
    let lastCleanup = 0;

    const progressCallback = (stats: any) => {
      const now = Date.now();

      // Throttle progress bar updates
      if (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL) {
        const totalProgress = ProgressCalculator.calculateConservativeProgress(stats.totalItems || 0);
        this.progressTracker.updateStepProgress(contentStepIndex, totalProgress, 'progress');
        lastProgressUpdate = now;
      }

      // Throttle log updates
      if (now - lastLogUpdate > LOG_UPDATE_INTERVAL) {
        const totalItems = stats.totalItems || 0;
        const itemsPerSec = stats.itemsPerSecond || 0;
        console.log(`Progress: ${totalItems} items - ${itemsPerSec.toFixed(1)}/sec`);
        lastLogUpdate = now;
      }

      // Memory cleanup
      if (now - lastCleanup > CLEANUP_INTERVAL) {
        // Trigger cleanup if available
        lastCleanup = now;
      }
    };

    return {
      progressCallback,
      cleanup: () => {
        // Any cleanup needed for Content Sync SDK progress tracking
      }
    };
  }

  /**
   * Reset all steps to pending
   */
  reset(): void {
    this.progressTracker.reset();
    this.activeStepIndex = -1;
  }

  /**
   * Get current operation name
   */
  getOperationName(): string {
    return this.progressTracker.getOperationName();
  }

  /**
   * Set operation name
   */
  setOperationName(name: string): void {
    this.progressTracker.setOperationName(name);
  }
} 