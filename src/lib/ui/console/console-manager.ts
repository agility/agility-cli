import { fileOperations } from '../../../core/fileOperations';
import { getState } from '../../../core/state';
import ansiColors from 'ansi-colors';

export type ConsoleMode = 'headless' | 'verbose' | 'plain';

export interface ConsoleState {
  mode: ConsoleMode;
  originalLog: typeof console.log;
  originalError: typeof console.error;
  isRedirected: boolean;
}

export interface ConsoleRedirectionHandlers {
  onLog?: (message: string) => void;
  onError?: (message: string) => void;
}

export class ConsoleManager {
  private state: ConsoleState;
  private fileOps?: fileOperations;
  private redirectionHandlers?: ConsoleRedirectionHandlers;

  constructor() {
    this.state = {
      mode: 'plain',
      originalLog: console.log,
      originalError: console.error,
      isRedirected: false,
    };
  }

  /**
   * Setup console mode and redirection
   */
  setupMode(
    mode: ConsoleMode,
    fileOps?: fileOperations,
    handlers?: ConsoleRedirectionHandlers
  ): void {
    this.state.mode = mode;
    this.fileOps = fileOps;
    this.redirectionHandlers = handlers;

    switch (mode) {
      case 'headless':
        this.setupHeadlessMode();
        break;
      case 'verbose':
        this.setupVerboseMode();
        break;
      // Remove blessed case - no longer supported
      case 'plain':
        this.setupPlainMode();
        break;
    }
  }

  /**
   * Setup headless mode (file logging only, no console output)
   */
  private setupHeadlessMode(): void {
    if (this.state.isRedirected) return;

    console.log = (...args: any[]) => {
      const message = this.formatMessage(args);
      this.logToFile(message);
    };

    console.error = (...args: any[]) => {
      const message = this.formatMessage(args);
      this.logToFile(message, true);
    };

    this.state.isRedirected = true;
  }

  /**
   * Setup verbose mode (console + file logging)
   */
  private setupVerboseMode(): void {
    if (this.state.isRedirected) return;

    console.log = (...args: any[]) => {
      const message = this.formatMessage(args);
      this.state.originalLog(...args); // Show on console
      this.logToFile(message); // Also log to file
    };

    console.error = (...args: any[]) => {
      const message = this.formatMessage(args);
      this.state.originalError(...args); // Show on console
      this.logToFile(message, true); // Also log to file
    };

    this.state.isRedirected = true;
  }

  // Remove setupBlessedMode - no longer supported

  /**
   * Setup plain mode (console + file logging, like verbose but less verbose)
   */
  private setupPlainMode(): void {
    if (this.state.isRedirected) return;

    console.log = (...args: any[]) => {
      const message = this.formatMessage(args);
      this.state.originalLog(...args); // Show on console
      this.logToFile(message); // Also log to file
    };

    console.error = (...args: any[]) => {
      const message = this.formatMessage(args);
      this.state.originalError(...args); // Show on console
      this.logToFile(message, true); // Also log to file
    };

    this.state.isRedirected = true;
  }

  /**
   * Format console arguments into a single message string
   */
  private formatMessage(args: any[]): string {
    return args.map((arg) => String(arg)).join(' ');
  }

  /**
   * Log message to file using existing fileOperations infrastructure
   */
  private logToFile(message: string, isError: boolean = false): void {
    if (!this.fileOps) return;

    const timestamp = new Date().toISOString();
    const level = isError ? 'ERROR' : 'INFO';
    // fileOperations.appendLogFile handles ANSI stripping automatically
    this.fileOps.appendLogFile(`[${timestamp}] [${level}] ${message}\n`);
  }

  /**
   * Restore original console methods
   */
  restoreConsole(): void {
    if (!this.state.isRedirected) return;

    console.log = this.state.originalLog;
    console.error = this.state.originalError;
    this.state.isRedirected = false;
  }

  /**
   * Check if console is currently redirected
   */
  isRedirected(): boolean {
    return this.state.isRedirected;
  }

  /**
   * Get current console mode
   */
  getMode(): ConsoleMode {
    return this.state.mode;
  }

  /**
   * Conditional logging - only log if conditions are met
   */
  conditionalLog(message: string, condition: boolean): void {
    if (condition) {
      console.log(message);
    }
  }

  /**
   * Log with specific color formatting (maintains existing ansiColors patterns)
   */
  logSuccess(message: string): void {
    console.log(ansiColors.green(message));
  }

  logError(message: string): void {
    console.error(ansiColors.red(message));
  }

  logWarning(message: string): void {
    console.log(ansiColors.yellow(message));
  }

  logInfo(message: string): void {
    console.log(ansiColors.cyan(message));
  }

  /**
   * Log step-related messages (consistent with existing pusher patterns)
   */
  logStepStart(stepName: string): void {
    console.log(`Starting ${stepName}...`);
  }

  logStepSuccess(stepName: string, details?: string): void {
    const message = details ? `✓ ${stepName} - ${details}` : `✓ ${stepName} completed`;
    console.log(ansiColors.green(message));
  }

  logStepError(stepName: string, error: string): void {
    console.error(ansiColors.red(`✗ ${stepName} failed: ${error}`));
  }

  /**
   * Log separator (consistent with existing patterns)
   */
  logSeparator(): void {
    console.log('----------------------------------------------------------------------');
  }

  /**
   * Create a file operations instance for the current state
   */
  static createFileOps(guid?: string): fileOperations {
    const state = getState();
    const targetGuid = guid || state.sourceGuid;
    return new fileOperations(targetGuid[0], state.locale[0]);
  }

  /**
   * Finalize log file and return path
   */
  finalizeLogFile(operationType: 'pull' | 'push' | 'sync'): string | null {
    if (!this.fileOps) return null;
    return this.fileOps.finalizeLogFile(operationType);
  }

  /**
   * Update redirection handlers (useful for dynamic handler changes)
   */
  updateRedirectionHandlers(handlers: ConsoleRedirectionHandlers): void {
    this.redirectionHandlers = handlers;
  }

  /**
   * Get console state for debugging
   */
  getConsoleState(): ConsoleState {
    return { ...this.state };
  }
}
