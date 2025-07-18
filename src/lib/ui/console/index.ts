// Console Manager - Main console redirection and management
export {
  ConsoleManager,
  type ConsoleMode,
  type ConsoleState,
  type ConsoleRedirectionHandlers
} from './console-manager';

// File Logger - Enhanced file logging with structured logging
export {
  FileLogger,
  type FileLoggerConfig,
  type LogEntry
} from './file-logger';

// Logging Modes - Mode determination and configuration
export {
  LoggingModes,
  type LoggingModeConfig
} from './logging-modes';

// Utility functions for common console operations
export {
  createConsoleSetup,
  cleanupConsoleSetup,
  // Remove blessed handlers - no longer supported
  createHeadlessConsoleSetup,
  createVerboseConsoleSetup,
  validateConsoleSetup,
  type ConsoleSetupConfig,
  type ConsoleSetupResult
} from './console-setup-utils'; 