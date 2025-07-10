import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { getState } from '../../../core/state';

export interface BlessedUIContext {
  screen: any;
  logContainer: any;
  progressBars: any[];
  progressContainer: any;
  isActive: boolean;
}

export interface BlessedUIConfig {
  title: string;
  steps: string[];
  enableAutoExit: boolean;
  autoExitDelay: number;
}

export class BlessedUIManager {
  private context: BlessedUIContext | null = null;
  private config: BlessedUIConfig;
  private autoExitTimer?: NodeJS.Timeout;

  constructor(config: BlessedUIConfig) {
    this.config = config;
  }

  /**
   * Initialize BlessedUI screen and components
   */
  setup(): BlessedUIContext {
    // Create screen
    const screen = blessed.screen({
      smartCSR: true,
      title: this.config.title,
      dockBorders: true,
      fullUnicode: true,
      autoPadding: true,
    });

    // Create grid layout
    const grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: screen,
    });

    // Create progress container
    const progressContainer = grid.set(0, 0, 12, 4, blessed.box, {
      label: " Progress ",
      border: { type: "line" },
      style: { border: { fg: "blue" } },
      padding: { left: 1, right: 1, top: 0, bottom: 0 },
    });

    // Create log container with memory optimization
    const logContainer = grid.set(0, 4, 12, 8, blessed.log, {
      label: " Logs ",
      border: { type: "line" },
      style: { border: { fg: "green" } },
      padding: { left: 1, right: 1, top: 0, bottom: 0 },
      scrollable: true,
      alwaysScroll: true,
      mouse: false,
      keys: false,
      vi: false,
      bufferLength: 200, // Memory optimization
    });

    // Create progress bars
    const progressBars = this.createProgressBars(progressContainer);

    // Setup event handlers
    this.setupEventHandlers(screen);

    this.context = {
      screen,
      logContainer,
      progressBars,
      progressContainer,
      isActive: true
    };

    // Initial render
    screen.render();
    logContainer.focus();

    return this.context;
  }

  /**
   * Create progress bars for each step
   */
  private createProgressBars(container: any): any[] {
    const progressBars: any[] = [];

    this.config.steps.forEach((stepName, index) => {
      const bar = blessed.progressbar({
        parent: container,
        border: "line",
        pch: " ",
        style: { 
          fg: "white", 
          bg: "black", 
          bar: { bg: "blue", fg: "white" }, 
          border: { fg: "#f0f0f0" } 
        },
        width: "95%",
        height: 3,
        top: 1 + index * 3,
        left: "center",
        filled: 0,
        label: ` ${stepName} (0%) `,
      });
      progressBars.push(bar);
    });

    return progressBars;
  }

  /**
   * Setup event handlers for screen
   */
  private setupEventHandlers(screen: any): void {
    // Ctrl+C handler
    screen.key(["C-c"], () => {
      this.cleanup();
      process.exit(0);
    });

    // Allow immediate exit on various key combinations
    screen.key(["escape", "q", "enter", "space"], () => {
      if (this.autoExitTimer) {
        clearInterval(this.autoExitTimer);
        this.cleanup();
        process.exit(0);
      }
    });
  }

  /**
   * Update progress for a specific step
   */
  updateProgress(stepIndex: number, status: 'success' | 'error' | 'progress', percentage?: number): void {
    if (!this.context || stepIndex < 0 || stepIndex >= this.context.progressBars.length) {
      return;
    }

    const bar = this.context.progressBars[stepIndex];
    const fillPercentage = percentage !== undefined 
      ? percentage 
      : (status === "success" || status === "error") ? 100 : bar.filled;

    bar.setProgress(fillPercentage);

    // Update color based on status
    let barColor = "blue";
    if (status === "error") barColor = "red";
    else if (status === "success" && fillPercentage === 100) barColor = "green";

    bar.style.bar.bg = barColor;

    // Update label
    const labelStatus = fillPercentage === 100 ? status : `${fillPercentage}%`;
    bar.setLabel(` ${this.config.steps[stepIndex]} (${labelStatus}) `);

    // Render changes
    this.context.screen.render();
  }

  /**
   * Log message to BlessedUI
   */
  log(message: string): void {
    if (!this.context?.logContainer) return;

    this.context.logContainer.log(message);
    this.context.logContainer.setScrollPerc(100);
    this.context.screen.render();
  }

  /**
   * Start auto-exit countdown
   */
  startAutoExit(): void {
    if (!this.config.enableAutoExit || !this.context) return;

    this.log("----------------------------------------------------------------------");
    this.log("All operations completed. Starting auto-exit countdown...");
    this.log("Press Ctrl+C to exit now");

    let countdown = this.config.autoExitDelay;
    
    this.autoExitTimer = setInterval(() => {
      this.log(`Auto-exit in ${countdown} seconds... (Press any key to exit now)`);
      countdown--;

      if (countdown <= 0) {
        this.cleanup();
        process.exit(0);
      }
    }, 1000);
  }

  /**
   * Setup console redirection for BlessedUI
   */
  setupConsoleRedirection(): { originalLog: typeof console.log; originalError: typeof console.error } {
    const originalLog = console.log;
    const originalError = console.error;

    // Memory-efficient console override with small circular buffer
    let logBuffer: string[] = [];
    const MAX_LOG_BUFFER = 200;

    console.log = (...args: any[]) => {
      const message = args.map((arg) => String(arg)).join(" ");

      // Add to circular buffer (remove oldest if over limit)
      if (logBuffer.length >= MAX_LOG_BUFFER) {
        logBuffer.shift();
      }
      logBuffer.push(message);

      // Send to BlessedUI log
      this.log(message);
    };

    console.error = (...args: any[]) => {
      const rawMessage = args.map((arg) => String(arg)).join(" ");
      const errorMessage = `ERROR: ${rawMessage}`;

      // Add to circular buffer
      if (logBuffer.length >= MAX_LOG_BUFFER) {
        logBuffer.shift();
      }
      logBuffer.push(errorMessage);

      // Send to BlessedUI log
      this.log(errorMessage);
    };

    return { originalLog, originalError };
  }

  /**
   * Restore console methods
   */
  restoreConsole(originalLog: typeof console.log, originalError: typeof console.error): void {
    console.log = originalLog;
    console.error = originalError;
  }

  /**
   * Cleanup BlessedUI resources
   */
  cleanup(): void {
    if (this.autoExitTimer) {
      clearInterval(this.autoExitTimer);
    }

    if (this.context?.screen && !this.context.screen.destroyed) {
      this.context.screen.destroy();
    }

    this.context = null;
  }

  /**
   * Check if BlessedUI is active
   */
  isActive(): boolean {
    return this.context?.isActive ?? false;
  }

  /**
   * Get current context
   */
  getContext(): BlessedUIContext | null {
    return this.context;
  }
} 