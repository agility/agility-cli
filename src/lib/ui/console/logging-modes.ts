import { getState } from '../../../core/state';
import { ConsoleMode } from './console-manager';

export interface LoggingModeConfig {
  mode: ConsoleMode;
  shouldLogToFile: boolean;
  shouldLogToConsole: boolean;
  shouldRedirectToUI: boolean;
  shouldShowProgress: boolean;
  shouldShowVerboseOutput: boolean;
}

export class LoggingModes {
  /**
   * Determine console mode from current state
   */
  static determineMode(): ConsoleMode {
    const state = getState();

    // Priority order: useBlessed > useHeadless > useVerbose > default (plain)
    if (state.useBlessed) {
      return 'blessed';
    }
    
    if (state.useHeadless) {
      return 'headless';
    }
    
    if (state.useVerbose) {
      return 'verbose';
    }
    
    return 'plain';
  }

  /**
   * Get logging configuration for a specific mode
   */
  static getConfig(mode: ConsoleMode): LoggingModeConfig {
    switch (mode) {
      case 'headless':
        return {
          mode: 'headless',
          shouldLogToFile: true,
          shouldLogToConsole: false,
          shouldRedirectToUI: false,
          shouldShowProgress: false,
          shouldShowVerboseOutput: false
        };

      case 'verbose':
        return {
          mode: 'verbose',
          shouldLogToFile: true,
          shouldLogToConsole: true,
          shouldRedirectToUI: false,
          shouldShowProgress: true,
          shouldShowVerboseOutput: true
        };

      case 'blessed':
        return {
          mode: 'blessed',
          shouldLogToFile: true,
          shouldLogToConsole: false,
          shouldRedirectToUI: true,
          shouldShowProgress: true,
          shouldShowVerboseOutput: false
        };

      case 'plain':
      default:
        return {
          mode: 'plain',
          shouldLogToFile: true,
          shouldLogToConsole: true,
          shouldRedirectToUI: false,
          shouldShowProgress: true,
          shouldShowVerboseOutput: false
        };
    }
  }

  /**
   * Get current logging configuration based on state
   */
  static getCurrentConfig(): LoggingModeConfig {
    const mode = this.determineMode();
    return this.getConfig(mode);
  }

  /**
   * Check if current mode supports specific functionality
   */
  static supportsInteractiveUI(): boolean {
    const mode = this.determineMode();
    return mode === 'blessed';
  }

  static supportsProgressBars(): boolean {
    const config = this.getCurrentConfig();
    return config.shouldShowProgress;
  }

  static supportsVerboseOutput(): boolean {
    const config = this.getCurrentConfig();
    return config.shouldShowVerboseOutput;
  }

  static supportsConsoleOutput(): boolean {
    const config = this.getCurrentConfig();
    return config.shouldLogToConsole;
  }

  static requiresFileLogging(): boolean {
    const config = this.getCurrentConfig();
    return config.shouldLogToFile;
  }

  static requiresUIRedirection(): boolean {
    const config = this.getCurrentConfig();
    return config.shouldRedirectToUI;
  }

  /**
   * Conditional logging based on mode
   */
  static shouldLog(logType: 'console' | 'file' | 'ui' | 'progress' | 'verbose'): boolean {
    const config = this.getCurrentConfig();

    switch (logType) {
      case 'console':
        return config.shouldLogToConsole;
      case 'file':
        return config.shouldLogToFile;
      case 'ui':
        return config.shouldRedirectToUI;
      case 'progress':
        return config.shouldShowProgress;
      case 'verbose':
        return config.shouldShowVerboseOutput;
      default:
        return true;
    }
  }

  /**
   * Get mode-specific log format
   */
  static getLogFormat(mode: ConsoleMode): {
    includeTimestamp: boolean;
    includeLevel: boolean;
    includeColors: boolean;
    includeProgressBars: boolean;
  } {
    switch (mode) {
      case 'headless':
        return {
          includeTimestamp: true,
          includeLevel: true,
          includeColors: false,
          includeProgressBars: false
        };

      case 'verbose':
        return {
          includeTimestamp: false,
          includeLevel: false,
          includeColors: true,
          includeProgressBars: true
        };

      case 'blessed':
        return {
          includeTimestamp: false,
          includeLevel: false,
          includeColors: true,
          includeProgressBars: true
        };

      case 'plain':
      default:
        return {
          includeTimestamp: false,
          includeLevel: false,
          includeColors: true,
          includeProgressBars: true
        };
    }
  }

  /**
   * Get current log format
   */
  static getCurrentLogFormat() {
    const mode = this.determineMode();
    return this.getLogFormat(mode);
  }

  /**
   * Check if we should show specific content based on mode
   */
  static shouldShowContent(contentType: 'errors' | 'warnings' | 'info' | 'debug' | 'stats'): boolean {
    const config = this.getCurrentConfig();
    const format = this.getCurrentLogFormat();

    switch (contentType) {
      case 'errors':
        return true; // Always show errors
      case 'warnings':
        return true; // Always show warnings
      case 'info':
        return config.shouldLogToConsole || config.shouldRedirectToUI;
      case 'debug':
        return config.shouldShowVerboseOutput;
      case 'stats':
        return config.shouldShowProgress;
      default:
        return true;
    }
  }

  /**
   * Get mode-specific console method overrides
   */
  static getModeSpecificBehavior(mode: ConsoleMode): {
    redirectConsole: boolean;
    showInlineProgress: boolean;
    enableColors: boolean;
    bufferedOutput: boolean;
  } {
    switch (mode) {
      case 'headless':
        return {
          redirectConsole: true,
          showInlineProgress: false,
          enableColors: false,
          bufferedOutput: false
        };

      case 'verbose':
        return {
          redirectConsole: false,
          showInlineProgress: true,
          enableColors: true,
          bufferedOutput: false
        };

      case 'blessed':
        return {
          redirectConsole: true,
          showInlineProgress: true,
          enableColors: true,
          bufferedOutput: true
        };

      case 'plain':
      default:
        return {
          redirectConsole: false,
          showInlineProgress: true,
          enableColors: true,
          bufferedOutput: false
        };
    }
  }

  /**
   * Get current mode-specific behavior
   */
  static getCurrentBehavior() {
    const mode = this.determineMode();
    return this.getModeSpecificBehavior(mode);
  }

  /**
   * Validate state configuration for logging
   */
  static validateLoggingState(): {
    isValid: boolean;
    warnings: string[];
    errors: string[];
  } {
    const state = getState();
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check for conflicting modes
    const modeCount = [
      state.useBlessed,
      state.useHeadless,
      state.useVerbose
    ].filter(Boolean).length;

    if (modeCount > 1) {
      warnings.push('Multiple console modes specified, using priority order: blessed > headless > verbose');
    }

    // Check for required state values
    if (!state.rootPath) {
      errors.push('rootPath is required for file logging');
    }

    if (!state.sourceGuid) {
      errors.push('sourceGuid is required for logging operations');
    }

    if (!state.locale) {
      errors.push('locale is required for logging operations');
    }

    return {
      isValid: errors.length === 0,
      warnings,
      errors
    };
  }

  /**
   * Get mode description for user feedback
   */
  static getModeDescription(mode: ConsoleMode): string {
    switch (mode) {
      case 'headless':
        return 'Headless mode - All output redirected to log file only';
      case 'verbose':
        return 'Verbose mode - Full console output with detailed progress information';
      case 'blessed':
        return 'Blessed mode - Interactive terminal UI with progress bars and real-time updates';
      case 'plain':
        return 'Plain mode - Standard console output with basic progress information';
      default:
        return 'Unknown mode';
    }
  }

  /**
   * Get current mode description
   */
  static getCurrentModeDescription(): string {
    const mode = this.determineMode();
    return this.getModeDescription(mode);
  }
} 