/**
 * Upload files to Google Drive
 */

import { AppLogger } from '../../utils/logger';

export class FileUploader {
  /**
   * Upload a file to a folder
   * @param folder Target folder
   * @param fileName File name
   * @param data File data blob
   * @returns File ID
   */
  upload(
    folder: GoogleAppsScript.Drive.Folder,
    fileName: string,
    data: GoogleAppsScript.Base.Blob
  ): string {
    try {
      // Set the blob name to the desired file name
      data.setName(fileName);

      const file = folder.createFile(data);
      const fileId = file.getId();

      AppLogger.info(`Uploaded file: ${fileName} (ID: ${fileId})`);

      return fileId;
    } catch (error) {
      AppLogger.error(`Error uploading file: ${fileName}`, error as Error);
      throw error;
    }
  }

  /**
   * Upload with duplicate handling
   * If file exists, append -2, -3, etc.
   */
  uploadWithDuplicateHandling(
    folder: GoogleAppsScript.Drive.Folder,
    baseName: string,
    data: GoogleAppsScript.Base.Blob
  ): string {
    try {
      let fileName = baseName;
      let counter = 2;

      // Check for existing files and generate unique name
      while (this.fileExists(folder, fileName)) {
        const nameParts = baseName.split('.');
        const extension = nameParts.pop();
        const nameWithoutExt = nameParts.join('.');
        fileName = `${nameWithoutExt}-${counter}.${extension}`;
        counter++;
      }

      return this.upload(folder, fileName, data);
    } catch (error) {
      AppLogger.error('Error uploading with duplicate handling', error as Error);
      throw error;
    }
  }

  /**
   * Check if file exists in folder
   */
  private fileExists(folder: GoogleAppsScript.Drive.Folder, fileName: string): boolean {
    const files = folder.getFilesByName(fileName);
    return files.hasNext();
  }
}
