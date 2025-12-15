/**
 * Google Drive folder management
 */

import { AppLogger } from '../../utils/logger';

export class FolderManager {
  private rootFolderId: string;
  private maxRetries = 3;
  private retryDelayMs = 2000;

  constructor(rootFolderId: string) {
    this.rootFolderId = rootFolderId;
  }

  /**
   * Check if error is a transient Google API error that should be retried
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message || '';
    return message.includes('server error occurred') ||
           message.includes('Service invoked too many times') ||
           message.includes('Rate Limit Exceeded') ||
           message.includes('Internal error');
  }

  /**
   * Execute a function with retry logic for transient errors
   */
  private withRetry<T>(operation: () => T, operationName: string): T {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return operation();
      } catch (error) {
        lastError = error as Error;

        if (this.isRetryableError(lastError) && attempt < this.maxRetries) {
          const delay = this.retryDelayMs * attempt;
          AppLogger.info(`${operationName} failed with transient error, retrying in ${delay}ms (attempt ${attempt}/${this.maxRetries})`);
          Utilities.sleep(delay);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Get or create a folder by year-month (YYYY-MM)
   * @param yearMonth Format: YYYY-MM
   */
  getOrCreateMonthFolder(yearMonth: string): GoogleAppsScript.Drive.Folder {
    return this.withRetry(() => {
      const rootFolder = DriveApp.getFolderById(this.rootFolderId);
      const folders = rootFolder.getFoldersByName(yearMonth);

      if (folders.hasNext()) {
        const folder = folders.next();
        AppLogger.debug(`Found existing folder: ${yearMonth}`);
        return folder;
      }

      const newFolder = rootFolder.createFolder(yearMonth);
      AppLogger.info(`Created new folder: ${yearMonth}`);
      return newFolder;
    }, `getOrCreateMonthFolder(${yearMonth})`);
  }

  /**
   * Check if file exists in folder
   */
  fileExistsInFolder(folder: GoogleAppsScript.Drive.Folder, fileName: string): boolean {
    const files = folder.getFilesByName(fileName);
    return files.hasNext();
  }

  /**
   * Get the root folder
   */
  getRootFolder(): GoogleAppsScript.Drive.Folder {
    try {
      return DriveApp.getFolderById(this.rootFolderId);
    } catch (error) {
      AppLogger.error('Error getting root folder', error as Error);
      throw error;
    }
  }
}
