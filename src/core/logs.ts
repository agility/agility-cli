import ansiColors from 'ansi-colors';
import { getState, setState } from './state';
import * as fs from 'fs';
import * as path from 'path';
import { generateLogHeader } from '../lib/shared';

export type OperationType = 'pull' | 'push' | 'sync';

export type EntityType =
  | 'model'
  | 'container'
  | 'list'
  | 'content'
  | 'page'
  | 'asset'
  | 'gallery'
  | 'template'
  | 'sitemap'
  | 'auth'
  | 'system'
  | 'summary';

export type Action =
  | 'downloaded'
  | 'uploaded'
  | 'skipped'
  | 'exists'
  | 'reset'
  | 'synced'
  | 'update'
  | 'updated'
  | 'up-to-date'
  | 'created'
  | 'deleted'
  | 'validated'
  | 'authenticated'
  | 'started'
  | 'ended'
  | 'failed'
  | 'error'
  | 'progressed';

export type Status =
  | 'success'
  | 'failed'
  | 'skipped'
  | 'conflict'
  | 'pending'
  | 'in_progress'
  | 'info';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  logLevel: LogLevel;
  message: string;
  timestamp: string;
  entity?: any;
}

export interface LogConfig {
  logToConsole: boolean;
  logToFile: boolean;
  showColors: boolean;
  useStructuredFormat: boolean;
}

export interface StructuredLogSummary {
  entityType: EntityType;
  successful: number;
  failed: number;
  skipped: number;
  total: number;
}

export class Logs {
  private logs: LogEntry[] = [];
  private config: LogConfig;
  private operationType: OperationType;
  private startTime: Date;
  private endTime?: Date;
  private guidColorMap: Map<string, string> = new Map();
  private entityType?: EntityType; // Store the entity type for this logger
  private guid?: string; // Store the GUID for this logger instance
  private availableColors: string[] = [
    'magenta',
    'cyan',
    'yellow',
    'blue',
    'green',
    'gray',
    'blackBright',
    'redBright',
    'greenBright',
    'yellowBright',
    'blueBright',
    'magentaBright',
    'cyanBright',
  ];

  constructor(operationType: OperationType, entityType?: EntityType, guid?: string) {
    this.operationType = operationType;
    this.entityType = entityType;
    this.guid = guid;
    this.startTime = new Date();

    // Default configuration
    this.config = {
      logToConsole: true,
      logToFile: true,
      showColors: true,
      useStructuredFormat: true,
    };

    this.initializeGuidColors();
  }

  /**
   * Set the GUID for this logger instance (for cases where it's set after construction)
   */
  setGuid(guid: string): void {
    this.guid = guid;
  }

  /**
   * Get the GUID for this logger instance
   */
  getGuid(): string | undefined {
    return this.guid;
  }

  /**
   * Configure logging behavior
   */
  configure(config: Partial<LogConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Single logging function - handles everything based on configuration
   */
  log(logLevel: LogLevel, message: string, entity?: any): void {
    // Check if we should log this level
    const logEntry: LogEntry = {
      logLevel,
      message,
      timestamp: new Date().toISOString(),
      entity,
    };

    // Store the log
    this.logs.push(logEntry);

    // Output to console if configured
    if (this.config.logToConsole) {
      this.outputToConsole(logEntry);
    }
  }

  /**
   * Log a summary of the operation, including counts and proper formatting.
   * Handles empty results, pluralization, and avoids type errors.
   */
  changeDetectionSummary(entityType: EntityType, successful: number, skipped: number): void {
    const parts: string[] = [];

    const successFormat =
      successful > 0
        ? `${ansiColors.green(successful.toString())}`
        : `${ansiColors.gray(successful.toString())}`;
    const skippedFormat =
      skipped > 0
        ? `${ansiColors.yellow(skipped.toString())}`
        : `${ansiColors.gray(skipped.toString())}`;
    const circle = this.config.showColors ? ansiColors.yellow('○ ') : '○ ';
    const halfCircle = this.config.showColors ? ansiColors.green('◐ ') : '◐ ';
    const icon = successful > 0 ? halfCircle : circle;
    //    const fullCircle = this.config.showColors ? ansiColors.yellow("") : "◑ ";

    // Pluralize and always show zero counts for clarity
    parts.push(successFormat + ansiColors.gray(' to download'));
    parts.push(skippedFormat + ansiColors.gray(' unchanged'));

    const capitalizedEntityType = entityType.charAt(0).toUpperCase() + entityType.slice(1);
    const message =
      ansiColors.gray(`${icon}${capitalizedEntityType} change detection summary:`) +
      ' ' +
      parts.join(' ');
    this.info(message);
  }

  syncOperationsSummary(entityType: EntityType, successful: number, skipped: number): void {
    const parts: string[] = [];
    const successFormat =
      successful > 0
        ? `${ansiColors.green(successful.toString())}`
        : `${ansiColors.gray(successful.toString())}`;
    const skippedFormat =
      skipped > 0
        ? `${ansiColors.yellow(skipped.toString())}`
        : `${ansiColors.gray(skipped.toString())}`;
    const circle = this.config.showColors ? ansiColors.yellow('○ ') : '○ ';
    const halfCircle = this.config.showColors ? ansiColors.green('◐ ') : '◐ ';
    const icon = successful > 0 ? halfCircle : circle;
    const capitalizedEntityType = entityType.charAt(0).toUpperCase() + entityType.slice(1);
    const message =
      ansiColors.gray(`${icon}${capitalizedEntityType} sync operations summary:`) +
      ' ' +
      parts.join(' ');
    this.info(message);
  }

  /**
   * Simple info logging method
   */
  info(message: string): void {
    const logEntry: LogEntry = {
      logLevel: 'INFO',
      message,
      timestamp: new Date().toISOString(),
    };

    this.logs.push(logEntry);

    if (this.config.logToConsole) {
      this.outputToConsole(logEntry);
    }
  }

  /**
   * Log to file only (no console output)
   */
  fileOnly(message: string): void {
    const logEntry: LogEntry = {
      logLevel: 'INFO',
      message,
      timestamp: new Date().toISOString(),
    };

    this.logs.push(logEntry);
    // Intentionally skip outputToConsole - file only
  }

  /**
   * Quick convenience methods for common patterns
   */
  success(message: string, entity?: any): void {
    this.info(message);
  }

  error(message: string, entity?: any): void {
    this.log('ERROR', message);
  }

  warning(message: string, entity?: any): void {
    this.log('WARN', message);
  }

  debug(message: string, entity?: any): void {
    this.log('DEBUG', message);
  }

  /**
   * Log a structured data element with consistent formatting
   */
  logDataElement(
    entityType: EntityType,
    action: Action,
    status: Status,
    itemName: string,
    guid?: string,
    details?: string,
    locale?: string,
    channel?: string
  ): void {
    // const entityType = this.entityType || "";
    let message: string;
    let symbol: string = '';

    // Set symbols based on status
    switch (status) {
      case 'success':
        symbol = this.config.showColors ? ansiColors.green('● ') : '● ';
        break;
      case 'failed':
        symbol = this.config.showColors ? ansiColors.red('✗ ') : '✗ ';
        break;
      case 'skipped':
        symbol = this.config.showColors ? ansiColors.yellow('○ ') : '○ ';
        break;
      case 'conflict':
        symbol = this.config.showColors ? ansiColors.magenta('⚠ ') : '⚠ ';
        break;
      case 'pending':
        symbol = this.config.showColors ? ansiColors.gray('◐ ') : '◐ ';
        break;
      case 'in_progress':
        symbol = this.config.showColors ? ansiColors.blue('◑ ') : '◑ ';
        break;
      default:
        symbol = this.config.showColors ? ansiColors.blue('ℹ ') : 'ℹ ';
        break;
    }

    if (this.config.useStructuredFormat) {
      const guidDisplay = guid
        ? status === 'success'
          ? ansiColors.green(this.formatGuidWithColor(guid))
          : status === 'failed'
            ? ansiColors.red(`[${guid}]`)
            : this.formatGuidWithColor(guid)
        : '';
      const styledItemName =
        itemName && this.config.showColors
          ? status === 'success'
            ? ansiColors.cyan.underline(itemName)
            : status === 'failed'
              ? ansiColors.red.underline(itemName)
              : ansiColors.cyan.underline(itemName)
          : itemName;
      const styledDetails =
        details && this.config.showColors ? ansiColors.gray(`${details}`) : details;
      const detailsDisplay = styledDetails ? `${styledDetails}` : '';
      const actionDisplay = this.config.showColors
        ? status === 'success'
          ? ansiColors.gray(action)
          : status === 'failed'
            ? ansiColors.red(action)
            : ansiColors.gray(action)
        : action;
      const localeDisplay =
        locale && this.config.showColors
          ? ansiColors.gray(`[${locale}]`)
          : locale
            ? `[${locale}]`
            : '';
      const channelDisplay =
        channel && this.config.showColors
          ? ansiColors.gray(`[${channel}]`)
          : channel
            ? `[${channel}]`
            : '';
      const styledEntityType =
        entityType && this.config.showColors
          ? status === 'success'
            ? ansiColors.white(entityType)
            : status === 'failed'
              ? ansiColors.red(entityType)
              : ansiColors.white(entityType)
          : entityType;

      const entityTypeDisplay =
        (message = `${symbol}${guidDisplay}${localeDisplay ? `${localeDisplay}` : ''}${
          channelDisplay ? `${channelDisplay}` : ''
        } ${styledEntityType} ${styledItemName} ${detailsDisplay ? `${detailsDisplay}` : `${actionDisplay}`}`);
    } else {
      const localeDisplay = locale ? ` [${locale}]` : '';
      message = `${status}: ${entityType}${localeDisplay} ${itemName}${details ? ` ${details}` : ''} ${
        action ? `,${action}` : ''
      }`;
    }

    this.log('INFO', message);
  }

  /**
   * Single summary function - takes entity type and counts
   */
  /**
   * Logs a summary of the operation, including counts and proper formatting.
   * Handles empty results, pluralization, and avoids type errors.
   */
  summary(operationType: OperationType, successful: number, failed: number, skipped: number): void {
    const total = successful + failed + skipped;
    const parts: string[] = [];

    // Pluralize and always show zero counts for clarity
    parts.push(`${successful} successful`);
    parts.push(`${failed} failed`);
    parts.push(`${skipped} skipped`);

    // Capitalize operationType for display
    const opLabel = operationType.charAt(0).toUpperCase() + operationType.slice(1);

    let message = `${opLabel} Summary: ${parts.join(', ')} (Total: ${total})`;

    if (this.config.useStructuredFormat && this.config.showColors) {
      message = ansiColors.cyan(message);
    }

    // Always use a valid EntityType for the log function, not OperationType
    // Use "logs" as a generic entity type for summary logs
    // this.log("INFO", "push", "summary", "success", message, { successful, failed, skipped, total, operationType });
  }

  /**
   * Save logs to file and return the file path (don't log it immediately)
   */
  saveLogs(): string | null {
    if (!this.config.logToFile || this.logs.length === 0) {
      this.logs = [];
      return null;
    }

    try {
      // Create logs directory
      const logsDir = path.join(process.cwd(), 'agility-files', 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // Generate filename based on operation type and GUIDs
      const timestamp = this.generateTimestamp();
      let filename: string;

      // For per-GUID loggers, we need to determine which GUID this logger is for
      // We can do this by checking which GUID appears most in the logs
      const state = getState();
      let guidForFilename = '';

      if (this.logs.length > 0) {
        // Count GUID occurrences in log messages to identify which GUID this logger belongs to
        const guidCounts = new Map<string, number>();
        const allGuids = [...(state.sourceGuid || []), ...(state.targetGuid || [])];

        this.logs.forEach((log) => {
          allGuids.forEach((guid) => {
            if (log.message.includes(`[${guid}]`)) {
              guidCounts.set(guid, (guidCounts.get(guid) || 0) + 1);
            }
          });
        });

        // Find the GUID with the most occurrences (this logger's GUID)
        let maxCount = 0;
        guidCounts.forEach((count, guid) => {
          if (count > maxCount) {
            maxCount = count;
            guidForFilename = guid;
          }
        });
      }

      // Build filename with GUID
      if (this.operationType === 'push' || this.operationType === 'sync') {
        const sourceGuid = state.sourceGuid?.[0] || 'unknown';
        const targetGuid = state.targetGuid?.[0] || 'unknown';
        filename = `${sourceGuid}-${targetGuid}-${this.operationType}-${timestamp}.txt`;
      } else {
        // For pull operations, use the specific GUID this logger is for
        const guidPrefix = guidForFilename ? `${guidForFilename}-` : '';
        filename = `${guidPrefix}${this.operationType}-${timestamp}.txt`;
      }

      const filePath = path.join(logsDir, filename);

      // Format all logs for file output (with ANSI stripping)
      const logContent = this.logs
        .map((log) => this.stripAnsiCodes(this.formatLogForFile(log)))
        .join('');

      // Write to file
      fs.writeFileSync(filePath, logContent);

      // Clear logs
      const logCount = this.logs.length;
      this.clearLogs();

      return filePath;
    } catch (error) {
      console.error('Error saving logs:', error);
      this.clearLogs();
      return null;
    }
  }

  /**
   * Clear logs without saving
   */
  clearLogs(): void {
    this.logs = [];
    setState({ logs: this.logs });
  }

  /**
   * Get current log count
   */
  getLogCount(): number {
    return this.logs.length;
  }

  /**
   * Get logs by level (for debugging)
   */
  //   getLogsByLevel(level: LogLevel): LogEntry[] {
  //     return this.logs.filter((log) => log.logLevel === level);
  //   }

  // Private helper methods
  //   private shouldLog(level: LogLevel): boolean {
  //     const levels = ["DEBUG", "INFO", "WARN", "ERROR"];
  //     const currentLevelIndex = levels.indexOf(this.config.minLevel);
  //     const logLevelIndex = levels.indexOf(level);
  //     return logLevelIndex >= currentLevelIndex;
  //   }

  private outputToConsole(log: LogEntry): void {
    let output = log.message;

    // Only apply color formatting if the message doesn't already contain ANSI codes
    // This preserves custom styling from logDataElement
    const hasAnsiCodes = /\x1b\[[0-9;]*m/.test(log.message);

    if (this.config.showColors && !hasAnsiCodes) {
      switch (log.logLevel) {
        case 'ERROR':
          output = ansiColors.red(log.message);
          break;
        case 'WARN':
          output = ansiColors.yellow(log.message);
          break;
        case 'INFO':
          output = log.logLevel === 'INFO' ? ansiColors.green(log.message) : log.message;
          break;
        case 'DEBUG':
          output = ansiColors.gray(log.message);
          break;
      }
    }

    console.log(output);
  }

  private formatLogForFile(log: LogEntry): string {
    return `[${this.operationType}][${log.timestamp}] [${log.logLevel}] ${log.message}\n`;
  }

  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}-${hour}-${minute}-${second}`;
  }

  private stripAnsiCodes(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Initialize color mapping for all GUIDs from state
   */
  private initializeGuidColors(): void {
    const state = getState();
    const allGuids = [...(state.sourceGuid || []), ...(state.targetGuid || [])];

    // Assign unique colors to each GUID
    allGuids.forEach((guid, index) => {
      if (guid && !this.guidColorMap.has(guid)) {
        const colorIndex = index % this.availableColors.length;
        this.guidColorMap.set(guid, this.availableColors[colorIndex]);
      }
    });
  }

  /**
   * Format GUID with its assigned color
   */
  private formatGuidWithColor(guid: string): string {
    if (!this.config.showColors) {
      return `[${guid}]`;
    }

    const colorName = this.guidColorMap.get(guid) || 'gray';
    const colorFunction = (ansiColors as any)[colorName];

    if (colorFunction) {
      return colorFunction(`[${guid}]`);
    }

    return `[${guid}]`;
  }

  // Legacy methods for compatibility
  initializeLogsInState(logs: LogEntry[]): void {
    setState({ logs: logs });
  }

  displayLogs(): void {
    const formattedLogs = this.logs.map((log) => this.formatLogForFile(log));
    console.log(ansiColors.green(formattedLogs.join('')));
  }

  displayLog(log: LogEntry): void {
    const formatted = this.formatLogForFile(log);
    console.log(ansiColors.green(formatted));
  }

  startTimer(): void {
    this.startTime = new Date();
    // this.info(`\nStart time: ${this.startTime.toISOString().toLocaleString()}`);
  }

  endTimer(): void {
    this.endTime = new Date();
    // this.info(`\nEnd time: ${this.endTime.toISOString().toLocaleString()}`);
    const duration = this.endTime.getTime() - this.startTime.getTime();
    // this.info(`Duration: ${duration > 60000 ? `${Math.floor(duration/1000/60)}m ${Math.floor(duration/1000)%60}s` : `${Math.floor(duration/1000)}s`}\n`);
  }

  /**
   * Structured entity logging - each entity type has its own methods
   */

  // Asset logging methods
  asset = {
    downloaded: (entity: any, details?: string) => {
      const itemName = entity?.fileName || entity?.name || `Asset ${entity?.mediaID || 'Unknown'}`;
      this.logDataElement('asset', 'downloaded', 'success', itemName, this.guid, details);
    },

    uploaded: (entity: any, details?: string, targetGuid?: string) => {
      const itemName = entity?.fileName || entity?.name || `Asset ${entity?.mediaID || 'Unknown'}`;
      this.logDataElement('asset', 'uploaded', 'success', itemName, targetGuid, details);
    },

    skipped: (entity: any, details?: string, targetGuid?: string) => {
      const itemName = entity?.fileName || entity?.name || `Asset ${entity?.mediaID || 'Unknown'}`;
      this.logDataElement(
        'asset',
        'skipped',
        'skipped',
        itemName,
        targetGuid || this.guid,
        details
      );
    },

    error: (payload: any, apiError: any, targetGuid?: string) => {
      const itemName =
        payload?.fileName || payload?.name || `Asset ${payload?.mediaID || 'Unknown'}`;
      const errorDetails = apiError?.message || apiError || 'Unknown error';
      // we need a better error logger for data elements
      this.logDataElement(
        'asset',
        'failed',
        'failed',
        itemName,
        targetGuid || this.guid,
        errorDetails
      );

      const asset = payload?.asset || payload;
      console.log('error', asset);
    },
  };

  // Model logging methods
  model = {
    downloaded: (entity: any, details?: string) => {
      const itemName =
        entity?.referenceName || entity?.displayName || `Model ${entity?.id || 'Unknown'}`;
      this.logDataElement('model', 'downloaded', 'success', itemName, this.guid, details);
    },
    created: (entity: any, details?: string, targetGuid?: string) => {
      const itemName =
        entity?.referenceName || entity?.displayName || `Model ${entity?.id || 'Unknown'}`;
      this.logDataElement('model', 'created', 'success', itemName, targetGuid, details);
    },

    updated: (entity: any, details?: string, targetGuid?: string) => {
      const itemName =
        entity?.referenceName || entity?.displayName || `Model ${entity?.id || 'Unknown'}`;
      this.logDataElement('model', 'updated', 'success', itemName, targetGuid, details);
    },

    uploaded: (entity: any, details?: string) => {
      const itemName =
        entity?.referenceName || entity?.displayName || `Model ${entity?.id || 'Unknown'}`;
      this.logDataElement('model', 'uploaded', 'success', itemName, this.guid, details);
    },

    skipped: (entity: any, details?: string, targetGuid?: string) => {
      const itemName =
        entity?.referenceName || entity?.displayName || `Model ${entity?.id || 'Unknown'}`;
      this.logDataElement(
        'model',
        `skipped`,
        'skipped',
        itemName,
        targetGuid || this.guid,
        details
      );
    },

    error: (payload: any, apiError: any, targetGuid?: string) => {
      const itemName =
        payload?.referenceName || payload?.displayName || `Model ${payload?.id || 'Unknown'}`;
      const errorDetails = apiError?.message || apiError || 'Unknown error';
      // we need a better error logger for data elements
      this.logDataElement(
        'model',
        'error',
        'failed',
        itemName,
        targetGuid || this.guid,
        errorDetails
      );
    },
  };

  // Container logging methods
  container = {
    downloaded: (entity: any, details?: string) => {
      const itemName =
        entity?.referenceName || entity?.name || `Container ${entity?.contentViewID || 'Unknown'}`;
      this.logDataElement('container', 'downloaded', 'success', itemName, this.guid, details);
    },

    created: (entity: any, details?: string, targetGuid?: string) => {
      const itemName =
        entity?.referenceName || entity?.name || `Container ${entity?.contentViewID || 'Unknown'}`;
      this.logDataElement('container', 'created', 'success', itemName, targetGuid, details);
    },

    updated: (entity: any, details?: string, targetGuid?: string) => {
      const itemName =
        entity?.referenceName || entity?.name || `Container ${entity?.contentViewID || 'Unknown'}`;
      this.logDataElement('container', 'updated', 'success', itemName, targetGuid, details);
    },

    uploaded: (entity: any, details?: string) => {
      const itemName =
        entity?.referenceName || entity?.name || `Container ${entity?.contentViewID || 'Unknown'}`;
      this.logDataElement('container', 'uploaded', 'success', itemName, this.guid, details);
    },

    skipped: (entity: any, details?: string, targetGuid?: string) => {
      //   console.log(ansiColors.yellow('skipped'), entity)
      const itemName =
        entity?.referenceName || entity?.name || `Container ${entity?.contentViewID || 'Unknown'}`;
      this.logDataElement(
        'container',
        'skipped',
        'skipped',
        itemName,
        targetGuid || this.guid,
        details
      );
    },

    error: (payload: any, apiError: any, targetGuid?: string) => {
      const itemName =
        payload?.referenceName ||
        payload?.name ||
        `Container ${payload?.contentViewID || 'Unknown'}`;
      const errorDetails = apiError?.message || apiError || 'Unknown error';
      // we need a better error logger for data elements
      this.logDataElement(
        'container',
        'error',
        'failed',
        itemName,
        targetGuid || this.guid,
        errorDetails
      );
    },
  };

  // Content Item logging methods
  content = {
    downloaded: (entity: any, details?: string, locale?: string) => {
      const itemName = entity?.properties?.referenceName || `${entity?.contentID || 'Unknown'}`;
      this.logDataElement('content', 'downloaded', 'success', itemName, this.guid, details, locale);
    },

    uploaded: (entity: any, details?: string, locale?: string, targetGuid?: string) => {
      const itemName =
        entity?.properties?.referenceName ||
        entity?.fields?.title ||
        entity?.fields?.name ||
        `Content ${entity?.contentID || 'Unknown'}`;
      this.logDataElement(
        'content',
        'uploaded',
        'success',
        itemName,
        targetGuid || this.guid,
        details,
        locale
      );
    },

    created: (entity: any, details?: string, locale?: string, targetGuid?: string) => {
      const itemName =
        entity?.properties?.referenceName ||
        entity?.fields?.title ||
        entity?.fields?.name ||
        `Content ${entity?.contentID || 'Unknown'}`;
      this.logDataElement(
        'content',
        'created',
        'success',
        itemName,
        targetGuid || this.guid,
        details,
        locale
      );
    },

    updated: (entity: any, details?: string, locale?: string, targetGuid?: string) => {
      const itemName =
        entity?.properties?.referenceName ||
        entity?.fields?.title ||
        entity?.fields?.name ||
        `Content ${entity?.contentID || 'Unknown'}`;
      this.logDataElement(
        'content',
        'updated',
        'success',
        itemName,
        targetGuid || this.guid,
        details,
        locale
      );
    },

    skipped: (entity: any, details?: string, locale?: string, targetGuid?: string) => {
      const itemName =
        entity?.properties?.referenceName ||
        entity?.fields?.title ||
        entity?.fields?.name ||
        `Content ${entity?.contentID || 'Unknown'}`;
      this.logDataElement(
        'content',
        'skipped',
        'skipped',
        itemName,
        targetGuid || this.guid,
        details,
        locale
      );
    },

    error: (payload: any, apiError: any, locale?: string, targetGuid?: string) => {
      const itemName =
        payload?.properties?.referenceName ||
        payload?.fields?.title ||
        payload?.fields?.name ||
        `Content ${payload?.contentID || 'Unknown'}`;
      const errorDetails = apiError?.message || apiError || 'Unknown error';
      // we need a better error logger for data elements
      this.logDataElement(
        'content',
        'error',
        'failed',
        itemName,
        targetGuid || this.guid,
        errorDetails,
        locale
      );
    },
  };

  // Template logging methods
  template = {
    downloaded: (entity: any, details?: string) => {
      const itemName =
        entity?.pageTemplateName ||
        entity?.name ||
        `Template ${entity?.pageTemplateID || 'Unknown'}`;
      this.logDataElement('template', 'downloaded', 'success', itemName, this.guid, details);
    },

    uploaded: (entity: any, details?: string) => {
      const itemName =
        entity?.pageTemplateName ||
        entity?.name ||
        `Template ${entity?.pageTemplateID || 'Unknown'}`;
      this.logDataElement('template', 'uploaded', 'success', itemName, this.guid, details);
    },

    created: (entity: any, details?: string, targetGuid?: string) => {
      const itemName =
        entity?.pageTemplateName ||
        entity?.name ||
        `Template ${entity?.pageTemplateID || 'Unknown'}`;
      this.logDataElement('template', 'created', 'success', itemName, targetGuid, details);
    },

    updated: (entity: any, details?: string, targetGuid?: string) => {
      const itemName =
        entity?.pageTemplateName ||
        entity?.name ||
        `Template ${entity?.pageTemplateID || 'Unknown'}`;
      this.logDataElement('template', 'updated', 'success', itemName, targetGuid, details);
    },

    skipped: (entity: any, details?: string, targetGuid?: string) => {
      const itemName =
        entity?.pageTemplateName ||
        entity?.name ||
        `Template ${entity?.pageTemplateID || 'Unknown'}`;
      this.logDataElement(
        'template',
        'skipped',
        'skipped',
        itemName,
        targetGuid || this.guid,
        details
      );
    },

    error: (payload: any, apiError: any, targetGuid?: string) => {
      const itemName =
        payload?.pageTemplateName ||
        payload?.name ||
        `Template ${payload?.pageTemplateID || 'Unknown'}`;
      const errorDetails = apiError?.message || apiError || 'Unknown error';
      // we need a better error logger for data elements
      this.logDataElement(
        'template',
        'failed',
        'failed',
        itemName,
        targetGuid || this.guid,
        errorDetails
      );
    },
  };

  // Page logging methods
  page = {
    downloaded: (entity: any, details?: string, locale?: string) => {
      const itemName = entity?.name || entity?.menuText || `Page ${entity?.pageID || 'Unknown'}`;
      this.logDataElement('page', 'downloaded', 'success', itemName, this.guid, details, locale);
    },

    uploaded: (entity: any, details?: string, locale?: string, targetGuid?: string) => {
      const itemName = entity?.name || entity?.menuText || `Page ${entity?.pageID || 'Unknown'}`;
      this.logDataElement(
        'page',
        'uploaded',
        'success',
        itemName,
        targetGuid || this.guid,
        details,
        locale
      );
    },

    updated: (
      entity: any,
      details?: string,
      locale?: string,
      channel?: string,
      targetGuid?: string
    ) => {
      const itemName = entity?.name || entity?.menuText || `Page ${entity?.pageID || 'Unknown'}`;
      this.logDataElement(
        'page',
        'updated',
        'success',
        itemName,
        targetGuid || this.guid,
        details,
        locale,
        channel
      );
    },
    created: (
      entity: any,
      details?: string,
      locale?: string,
      channel?: string,
      targetGuid?: string
    ) => {
      const itemName = entity?.name || entity?.menuText || `Page ${entity?.pageID || 'Unknown'}`;
      this.logDataElement(
        'page',
        'created',
        'success',
        itemName,
        targetGuid || this.guid,
        details,
        locale,
        channel
      );
    },
    skipped: (
      entity: any,
      details?: string,
      locale?: string,
      channel?: string,
      targetGuid?: string
    ) => {
      const itemName = entity?.name || entity?.menuText || `Page ${entity?.pageID || 'Unknown'}`;
      this.logDataElement(
        'page',
        'skipped',
        'skipped',
        itemName,
        targetGuid || this.guid,
        details,
        locale,
        channel
      );
    },

    error: (
      payload: any,
      apiError: any,
      locale?: string,
      channel?: string,
      targetGuid?: string
    ) => {
      const itemName = payload?.name || payload?.menuText || `Page ${payload?.pageID || 'Unknown'}`;
      const errorDetails = apiError?.message || apiError || 'Unknown error';
      // we need a better error logger for data elements
      this.logDataElement(
        'page',
        'error',
        'failed',
        itemName,
        targetGuid || this.guid,
        errorDetails,
        locale,
        channel
      );
    },
  };

  // Gallery logging methods
  gallery = {
    downloaded: (entity: any, details?: string) => {
      const itemName = entity?.name || `Gallery ${entity?.id || 'Unknown'}`;
      this.logDataElement('gallery', 'downloaded', 'success', itemName, this.guid, details);
    },

    created: (entity: any, details?: string, targetGuid?: string) => {
      const itemName = entity?.name || `Gallery ${entity?.id || 'Unknown'}`;
      this.logDataElement('gallery', 'created', 'success', itemName, targetGuid, details);
    },

    updated: (entity: any, details?: string, targetGuid?: string) => {
      const itemName = entity?.name || `Gallery ${entity?.id || 'Unknown'}`;
      this.logDataElement('gallery', 'updated', 'success', itemName, targetGuid, details);
    },

    skipped: (entity: any, details?: string, targetGuid?: string) => {
      const itemName = entity?.name || `Gallery`;
      this.logDataElement(
        'gallery',
        'skipped',
        'skipped',
        itemName,
        targetGuid || this.guid,
        details
      );
    },

    exists: (entity: any, details?: string) => {
      const itemName = entity?.name || `Gallery`;
      this.logDataElement('gallery', 'up-to-date', 'skipped', itemName, this.guid, details);
    },

    error: (gallery: any, apiError: any, payload?: any, targetGuid?: string) => {
      const itemName = gallery?.name || `Gallery ${gallery?.id || 'Unknown'}`;
      const errorDetails = apiError?.message || apiError || 'Unknown error';
      // we need a better error logger for data elements
      this.logDataElement(
        'gallery',
        'failed',
        'failed',
        itemName,
        targetGuid || this.guid,
        errorDetails
      );

      console.log(gallery.mediaGroupingID, gallery.name);
      console.log(ansiColors.red(JSON.stringify(apiError, null, 2)));
      console.log(ansiColors.red(JSON.stringify(payload, null, 2)));
    },
  };

  // Sitemap logging methods
  sitemap = {
    downloaded: (entity: any, details?: string) => {
      const itemName = entity?.name || 'sitemap.json';
      this.logDataElement('sitemap', 'downloaded', 'success', itemName, this.guid, details);
    },

    uploaded: (entity: any, details?: string) => {
      const itemName = entity?.name || 'sitemap.json';
      this.logDataElement('sitemap', 'uploaded', 'success', itemName, this.guid, details);
    },

    skipped: (entity: any, details?: string) => {
      const itemName = entity?.name || 'sitemap.json';
      this.logDataElement('sitemap', 'skipped', 'skipped', itemName, this.guid, details);
    },

    error: (payload: any, apiError: any) => {
      const itemName = payload?.name || 'sitemap.json';
      const errorDetails = apiError?.message || apiError || 'Unknown error';
      // we need a better error logger for data elements
      // this.logDataElement("failed", "failed", itemName, this.guid, errorDetails);
    },
  };

  /**
   * Log operation header with state information
   */
  logOperationHeader(): void {
    // Get current state information
    const state = require('./state').getState();

    const additionalInfo: Record<string, any> = {
      GUID: this.guid || 'Not specified',
      'Operation Type': this.operationType,
      'Entity Type': this.entityType || 'All entities',
      'Source GUIDs': state.sourceGuid?.join(', ') || 'None',
      'Target GUIDs': state.targetGuid?.join(', ') || 'None',
      Locales: this.guid
        ? state.guidLocaleMap?.get(this.guid)?.join(', ') || 'Not specified'
        : 'Multiple',
      Channel: state.channel || 'Not specified',
      Elements: state.elements || 'All',
      'Reset Mode': state.reset ? 'Full reset' : 'Incremental',
      Verbose: state.verbose ? 'Enabled' : 'Disabled',
      'Preview Mode': state.isPreview ? 'Preview' : 'Live',
    };

    const header = generateLogHeader(this.operationType, additionalInfo);
    this.fileOnly(header);
  }

  /**
   * Log orchestrator summary with timing, counts, and completion status
   */
  orchestratorSummary(
    results: any[],
    elapsedTime: number,
    success: boolean,
    logFilePaths?: string[]
  ): void {
    const ansiColors = require('ansi-colors');

    // Calculate time display
    const totalElapsedSeconds = Math.floor(elapsedTime / 1000);
    const minutes = Math.floor(totalElapsedSeconds / 60);
    const seconds = totalElapsedSeconds % 60;
    const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    // Calculate success/failure counts
    let totalSuccessful = 0;
    let totalFailed = 0;

    results.forEach((res) => {
      if (res.failed?.length > 0) {
        totalFailed++;
      } else {
        totalSuccessful++;
      }
    });

    // Log to file using logger summary
    this.summary(this.operationType, totalSuccessful, totalFailed, 0);

    // Console output
    console.log(ansiColors.cyan('\nSummary:'));
    console.log(`Processed ${results.length} GUID/locale combinations`);
    console.log(`${totalSuccessful} successful, ${totalFailed} failed`);
    console.log(`Total time: ${timeDisplay}`);

    // Success/failure message
    if (success) {
      console.log(
        ansiColors.green(
          `\n✓ ${this.operationType.charAt(0).toUpperCase() + this.operationType.slice(1)} completed successfully`
        )
      );

      // Display log file paths if provided
      if (logFilePaths && logFilePaths.length > 0) {
        console.log(ansiColors.cyan('\nLog Files:'));
        logFilePaths.forEach((path) => {
          console.log(`${path}`);
        });
      }
    } else {
      console.log(
        ansiColors.red(
          `\n✗ ${this.operationType.charAt(0).toUpperCase() + this.operationType.slice(1)} completed with errors`
        )
      );

      // Display log file paths even on errors
      if (logFilePaths && logFilePaths.length > 0) {
        console.log(ansiColors.cyan('\nLog Files:'));
        logFilePaths.forEach((path) => {
          console.log(`  ${path}`);
        });
      }
    }
  }
}
