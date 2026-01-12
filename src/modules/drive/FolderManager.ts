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
   * Search for a folder by name recursively using breadth-first search.
   * Returns the shallowest match (root > child > grandchild).
   * @param parentFolder Folder to start searching from
   * @param folderName Name of the folder to find
   * @param maxDepth Maximum depth to search (0 = only immediate children)
   */
  private searchFolderRecursively(
    parentFolder: GoogleAppsScript.Drive.Folder,
    folderName: string,
    maxDepth: number
  ): GoogleAppsScript.Drive.Folder | null {
    // Use BFS to find shallowest match first
    const queue: { folder: GoogleAppsScript.Drive.Folder; depth: number }[] = [
      { folder: parentFolder, depth: 0 }
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Check current folder's immediate children for the target
      const matchingFolders = current.folder.getFoldersByName(folderName);
      if (matchingFolders.hasNext()) {
        const found = matchingFolders.next();
        if (current.depth > 0) {
          AppLogger.debug(`Found folder "${folderName}" at depth ${current.depth} under "${current.folder.getName()}"`);
        }
        return found;
      }

      // Add children to queue if we haven't reached max depth
      if (current.depth < maxDepth) {
        const childFolders = current.folder.getFolders();
        while (childFolders.hasNext()) {
          queue.push({ folder: childFolders.next(), depth: current.depth + 1 });
        }
      }
    }

    return null;
  }

  /**
   * Get or create a folder by year-month (YYYY-MM)
   * Searches recursively up to 2 levels deep to support custom folder hierarchies
   * (e.g., FY2025-12/2025-04/)
   * @param yearMonth Format: YYYY-MM
   */
  getOrCreateMonthFolder(yearMonth: string): GoogleAppsScript.Drive.Folder {
    return this.withRetry(() => {
      const rootFolder = DriveApp.getFolderById(this.rootFolderId);

      // Search recursively up to 2 levels deep (child + grandchild)
      const existingFolder = this.searchFolderRecursively(rootFolder, yearMonth, 2);
      if (existingFolder) {
        AppLogger.debug(`Found existing folder: ${yearMonth}`);
        return existingFolder;
      }

      // Create at root if not found anywhere
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
