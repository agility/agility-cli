import { fileOperations } from '../../../core/fileOperations';
import { getState } from '../../../core/state';
import ansiColors from 'ansi-colors';

export interface FileLoggerConfig {
  rootPath: string;
  guid: string;
  locale: string;
  preview: boolean;
  operationType: 'pull' | 'push' | 'sync';
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'ERROR' | 'WARNING' | 'SUCCESS';
  message: string;
  context?: string;
}

export class FileLogger {
  private fileOps: fileOperations;
  private config: FileLoggerConfig;
  private logEntries: LogEntry[] = [];

  constructor(config: FileLoggerConfig) {
    this.config = config;
    this.fileOps = new fileOperations(
      config.rootPath,
      config.guid,
      config.locale,
      config.preview
    );
  }

  /**
   * Create FileLogger from current state
   */
  static fromState(operationType: 'pull' | 'push' | 'sync', guid?: string): FileLogger {
    const state = getState();
    const targetGuid = guid || state.sourceGuid;
    
    return new FileLogger({
      rootPath: state.rootPath,
      guid: targetGuid[0],
      locale: state.locale[0],
      preview: state.preview,
      operationType
    });
  }

  /**
   * Log a message with specific level
   */
  log(level: LogEntry['level'], message: string, context?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };

    this.logEntries.push(entry);
    
    // Use existing fileOperations.appendLogFile (handles ANSI stripping)
    const formattedMessage = this.formatLogEntry(entry);
    this.fileOps.appendLogFile(formattedMessage);
  }

  /**
   * Format log entry for file output
   */
  private formatLogEntry(entry: LogEntry): string {
    const contextPart = entry.context ? ` [${entry.context}]` : '';
    return `[${entry.timestamp}] [${entry.level}]${contextPart} ${entry.message}\n`;
  }

  /**
   * Log info message
   */
  logInfo(message: string, context?: string): void {
    this.log('INFO', message, context);
  }

  /**
   * Log error message
   */
  logError(message: string, context?: string): void {
    this.log('ERROR', message, context);
  }

  /**
   * Log warning message
   */
  logWarning(message: string, context?: string): void {
    this.log('WARNING', message, context);
  }

  /**
   * Log success message
   */
  logSuccess(message: string, context?: string): void {
    this.log('SUCCESS', message, context);
  }

  /**
   * Log step start
   */
  logStepStart(stepName: string, details?: string): void {
    const message = details ? `Starting ${stepName} - ${details}` : `Starting ${stepName}`;
    this.logInfo(message, 'STEP');
  }

  /**
   * Log step completion
   */
  logStepComplete(stepName: string, details?: string): void {
    const message = details ? `Completed ${stepName} - ${details}` : `Completed ${stepName}`;
    this.logSuccess(message, 'STEP');
  }

  /**
   * Log step error
   */
  logStepError(stepName: string, error: string): void {
    this.logError(`Failed ${stepName}: ${error}`, 'STEP');
  }

  /**
   * Log progress update
   */
  logProgress(stepName: string, progress: { current: number; total: number; details?: string }): void {
    const percentage = Math.round((progress.current / progress.total) * 100);
    const details = progress.details ? ` - ${progress.details}` : '';
    const message = `${stepName}: ${progress.current}/${progress.total} (${percentage}%)${details}`;
    this.logInfo(message, 'PROGRESS');
  }

  /**
   * Log download statistics
   */
  logDownloadStats(stepName: string, stats: { 
    total: number; 
    successful: number; 
    failed: number; 
    skipped: number; 
    duration?: number;
  }): void {
    const { total, successful, failed, skipped, duration } = stats;
    const durationText = duration ? ` in ${(duration / 1000).toFixed(1)}s` : '';
    const message = `${stepName} completed: ${successful}/${total} successful, ${failed} failed, ${skipped} skipped${durationText}`;
    this.logInfo(message, 'STATS');
  }

  /**
   * Log upload statistics
   */
  logUploadStats(stepName: string, stats: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
    duration?: number;
  }): void {
    const { total, successful, failed, skipped, duration } = stats;
    const durationText = duration ? ` in ${(duration / 1000).toFixed(1)}s` : '';
    const message = `${stepName} uploaded: ${successful}/${total} successful, ${failed} failed, ${skipped} skipped${durationText}`;
    this.logInfo(message, 'STATS');
  }

  /**
   * Log summary information
   */
  logSummary(operation: string, summary: {
    startTime: Date;
    endTime: Date;
    totalSteps: number;
    successfulSteps: number;
    failedSteps: number;
    entityCounts?: Record<string, number>;
  }): void {
    const duration = (summary.endTime.getTime() - summary.startTime.getTime()) / 1000;
    const message = `${operation} Summary: ${summary.successfulSteps}/${summary.totalSteps} steps completed in ${duration.toFixed(1)}s`;
    this.logInfo(message, 'SUMMARY');

    if (summary.entityCounts) {
      const entitySummary = Object.entries(summary.entityCounts)
        .map(([type, count]) => `${type}: ${count}`)
        .join(', ');
      this.logInfo(`Entity counts: ${entitySummary}`, 'SUMMARY');
    }
  }

  /**
   * Log API operation
   */
  logApiOperation(operation: string, details: {
    method: string;
    endpoint?: string;
    success: boolean;
    duration?: number;
    error?: string;
  }): void {
    const { method, endpoint, success, duration, error } = details;
    const endpointText = endpoint ? ` ${endpoint}` : '';
    const durationText = duration ? ` (${duration}ms)` : '';
    const level = success ? 'SUCCESS' : 'ERROR';
    const statusText = success ? 'succeeded' : 'failed';
    const errorText = error ? `: ${error}` : '';
    
    const message = `${operation} ${method}${endpointText} ${statusText}${durationText}${errorText}`;
    this.log(level, message, 'API');
  }

  /**
   * Log configuration details
   */
  logConfig(config: Record<string, any>): void {
    const configEntries = Object.entries(config)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    this.logInfo(`Configuration: ${configEntries}`, 'CONFIG');
  }

  /**
   * Log system information
   */
  logSystemInfo(): void {
    const info = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      timestamp: new Date().toISOString(),
      guid: this.config.guid,
      locale: this.config.locale,
      operationType: this.config.operationType
    };

    this.logInfo('System Information:', 'SYSTEM');
    Object.entries(info).forEach(([key, value]) => {
      this.logInfo(`  ${key}: ${value}`, 'SYSTEM');
    });
  }

  /**
   * Get all log entries
   */
  getLogEntries(): LogEntry[] {
    return [...this.logEntries];
  }

  /**
   * Get log entries by level
   */
  getLogEntriesByLevel(level: LogEntry['level']): LogEntry[] {
    return this.logEntries.filter(entry => entry.level === level);
  }

  /**
   * Get log entries by context
   */
  getLogEntriesByContext(context: string): LogEntry[] {
    return this.logEntries.filter(entry => entry.context === context);
  }

  /**
   * Get log statistics
   */
  getLogStats(): Record<LogEntry['level'], number> {
    const stats = {
      INFO: 0,
      ERROR: 0,
      WARNING: 0,
      SUCCESS: 0
    };

    this.logEntries.forEach(entry => {
      stats[entry.level]++;
    });

    return stats;
  }

  /**
   * Clear log entries (keeps file contents)
   */
  clearLogEntries(): void {
    this.logEntries = [];
  }

  /**
   * Finalize log file and return path
   */
  finalize(): string {
    const finalStats = this.getLogStats();
    this.logInfo(`Log finalized with ${this.logEntries.length} entries: ${JSON.stringify(finalStats)}`, 'FINALIZE');
    return this.fileOps.finalizeLogFile(this.config.operationType);
  }

  /**
   * Get underlying fileOperations instance
   */
  getFileOps(): fileOperations {
    return this.fileOps;
  }
} 