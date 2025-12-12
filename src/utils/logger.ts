/**
 * Logging utilities
 */

export class AppLogger {
  private static formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  static info(message: string): void {
    Logger.log(this.formatMessage('INFO', message));
  }

  static warn(message: string): void {
    Logger.log(this.formatMessage('WARN', message));
  }

  static error(message: string, error?: Error): void {
    const errorDetails = error ? `\n${error.stack}` : '';
    Logger.log(this.formatMessage('ERROR', message + errorDetails));
  }

  static debug(message: string): void {
    Logger.log(this.formatMessage('DEBUG', message));
  }
}
