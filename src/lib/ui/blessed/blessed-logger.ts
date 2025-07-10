import { BlessedUIManager } from './blessed-ui-manager';

export interface BlessedLoggerConfig {
  maxBufferSize: number;
  enableFileLogging: boolean;
}

export class BlessedLogger {
  private uiManager: BlessedUIManager;
  private config: BlessedLoggerConfig;
  private logBuffer: string[] = [];
  private originalConsole: { log: typeof console.log; error: typeof console.error };
  private isRedirected: boolean = false;

  constructor(uiManager: BlessedUIManager, config?: Partial<BlessedLoggerConfig>) {
    this.uiManager = uiManager;
    this.config = {
      maxBufferSize: 200,
      enableFileLogging: false,
      ...config
    };

    // Store original console methods
    this.originalConsole = {
      log: console.log,
      error: console.error
    };
  }

  /**
   * Setup console redirection to BlessedUI
   */
  setupConsoleRedirection(): void {
    if (this.isRedirected) return;

    console.log = (...args: any[]) => {
      const message = args.map((arg) => String(arg)).join(" ");
      this.addToBuffer(message);
      this.uiManager.log(message);
    };

    console.error = (...args: any[]) => {
      const rawMessage = args.map((arg) => String(arg)).join(" ");
      const errorMessage = `ERROR: ${rawMessage}`;
      this.addToBuffer(errorMessage);
      this.uiManager.log(errorMessage);
    };

    this.isRedirected = true;
  }

  /**
   * Restore original console methods
   */
  restoreConsole(): void {
    if (!this.isRedirected) return;

    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    this.isRedirected = false;
  }

  /**
   * Add message to circular buffer
   */
  private addToBuffer(message: string): void {
    if (this.logBuffer.length >= this.config.maxBufferSize) {
      this.logBuffer.shift(); // Remove oldest entry
    }
    this.logBuffer.push(message);
  }

  /**
   * Log message directly to BlessedUI (without console redirection)
   */
  log(message: string): void {
    this.addToBuffer(message);
    this.uiManager.log(message);
  }

  /**
   * Log error message directly to BlessedUI
   */
  error(message: string): void {
    const errorMessage = `ERROR: ${message}`;
    this.addToBuffer(errorMessage);
    this.uiManager.log(errorMessage);
  }

  /**
   * Log step start message
   */
  logStepStart(stepName: string): void {
    this.log(`Starting ${stepName}...`);
  }

  /**
   * Log step completion message
   */
  logStepComplete(stepName: string): void {
    this.log(`✓ ${stepName} completed`);
  }

  /**
   * Log step error message
   */
  logStepError(stepName: string, error: string): void {
    this.error(`✗ ${stepName} failed: ${error}`);
  }

  /**
   * Log separator line
   */
  logSeparator(): void {
    this.log("----------------------------------------------------------------------");
  }

  /**
   * Get current log buffer
   */
  getLogBuffer(): string[] {
    return [...this.logBuffer];
  }

  /**
   * Clear log buffer
   */
  clearBuffer(): void {
    this.logBuffer = [];
  }

  /**
   * Check if console is redirected
   */
  isConsoleRedirected(): boolean {
    return this.isRedirected;
  }

  /**
   * Export log buffer as string
   */
  exportLogsAsString(): string {
    return this.logBuffer.join('\n');
  }
} 