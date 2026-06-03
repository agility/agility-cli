import { ConsoleManager, ConsoleMode, ConsoleRedirectionHandlers } from './console-manager';
import { FileLogger } from './file-logger';
import { LoggingModes } from './logging-modes';

export interface ConsoleSetupConfig {
  operationType: 'pull' | 'push' | 'sync';
  guid?: string;
  forceMode?: ConsoleMode;
  handlers?: ConsoleRedirectionHandlers;
}

export interface ConsoleSetupResult {
  consoleManager: ConsoleManager;
  fileLogger: FileLogger;
  mode: ConsoleMode;
  shouldRestore: boolean;
}

/**
 * Create a complete console setup based on current state or configuration
 */
export function createConsoleSetup(config: ConsoleSetupConfig): ConsoleSetupResult {
  // Determine mode from state or use forced mode
  const mode = config.forceMode || LoggingModes.determineMode();
  
  // Create file logger
  const fileLogger = FileLogger.fromState(config.operationType, config.guid);
  
  // Create console manager
  const consoleManager = new ConsoleManager();
  
  // Setup console mode with file operations and handlers
  consoleManager.setupMode(mode, fileLogger.getFileOps(), config.handlers);
  
  return {
    consoleManager,
    fileLogger,
    mode,
    shouldRestore: consoleManager.isRedirected()
  };
}

/**
 * Cleanup console setup (restore console, finalize logs)
 */
export function cleanupConsoleSetup(setup: ConsoleSetupResult): string | null {
  let logPath: string | null = null;
  
  // Restore console if it was redirected
  if (setup.shouldRestore) {
    setup.consoleManager.restoreConsole();
  }
  
  // Finalize log file
  try {
    logPath = setup.fileLogger.finalize();
  } catch (error) {
    console.error('Error finalizing log file:', error);
  }
  
  return logPath;
}

// Remove blessed handler function - no longer supported

/**
 * Quick console setup for headless mode
 */
export function createHeadlessConsoleSetup(config: ConsoleSetupConfig): ConsoleSetupResult {
  return createConsoleSetup({
    ...config,
    forceMode: 'headless'
  });
}

/**
 * Quick console setup for verbose mode
 */
export function createVerboseConsoleSetup(config: ConsoleSetupConfig): ConsoleSetupResult {
  return createConsoleSetup({
    ...config,
    forceMode: 'verbose'
  });
}

/**
 * Validate console setup configuration
 */
export function validateConsoleSetup(config: ConsoleSetupConfig): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Validate operation type
  if (!['pull', 'push', 'sync'].includes(config.operationType)) {
    errors.push(`Invalid operation type: ${config.operationType}`);
  }
  
  // Validate logging state
  const stateValidation = LoggingModes.validateLoggingState();
  if (!stateValidation.isValid) {
    errors.push(...stateValidation.errors);
  }
  warnings.push(...stateValidation.warnings);
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
} 