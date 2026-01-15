/**
 * Drive file renaming and moving operations
 */

import { AppLogger } from '../../utils/logger';

export class DriveFileRenamer {
  /**
   * Rename a file in place
   */
  renameFile(file: GoogleAppsScript.Drive.File, newName: string): void {
    try {
      file.setName(newName);
      AppLogger.info(`Renamed file to: ${newName}`);
    } catch (error) {
      AppLogger.error(`Error renaming file to ${newName}`, error as Error);
      throw error;
    }
  }

  /**
   * Move file to target folder
   * In Drive, files can be in multiple folders. This removes from current
   * folder and adds to target folder.
   */
  moveFileToFolder(
    file: GoogleAppsScript.Drive.File,
    targetFolder: GoogleAppsScript.Drive.Folder
  ): void {
    try {
      // Get current parent folders
      const parents = file.getParents();

      // Add to new folder first
      targetFolder.addFile(file);

      // Remove from old folders
      while (parents.hasNext()) {
        const parent = parents.next();
        parent.removeFile(file);
      }

      AppLogger.info(`Moved file ${file.getName()} to folder ${targetFolder.getName()}`);
    } catch (error) {
      AppLogger.error(`Error moving file ${file.getName()}`, error as Error);
      throw error;
    }
  }

  /**
   * Rename and move file with duplicate handling
   * Returns the final filename (may have -N suffix if duplicate existed)
   */
  renameAndMove(
    file: GoogleAppsScript.Drive.File,
    newName: string,
    targetFolder: GoogleAppsScript.Drive.Folder
  ): string {
    const finalName = this.getUniqueFilename(targetFolder, newName);
    this.renameFile(file, finalName);
    this.moveFileToFolder(file, targetFolder);
    return finalName;
  }

  /**
   * Get unique filename in folder (append -N if exists)
   */
  private getUniqueFilename(
    folder: GoogleAppsScript.Drive.Folder,
    baseName: string
  ): string {
    let fileName = baseName;
    let counter = 2;

    while (this.fileExistsInFolder(folder, fileName)) {
      // Split filename into name and extension
      const lastDotIndex = baseName.lastIndexOf('.');
      if (lastDotIndex > 0) {
        const nameWithoutExt = baseName.substring(0, lastDotIndex);
        const extension = baseName.substring(lastDotIndex);
        fileName = `${nameWithoutExt}-${counter}${extension}`;
      } else {
        fileName = `${baseName}-${counter}`;
      }
      counter++;
    }

    return fileName;
  }

  /**
   * Check if file exists in folder
   */
  private fileExistsInFolder(
    folder: GoogleAppsScript.Drive.Folder,
    fileName: string
  ): boolean {
    const files = folder.getFilesByName(fileName);
    return files.hasNext();
  }
}
