/**
 * File naming service
 */

import { AppLogger } from '../../utils/logger';

export class FileNamingService {
  /**
   * Generate file name from event month and service name
   * Format: YYYY-MM-ServiceName.pdf
   */
  generate(serviceName: string, eventMonth: string): string {
    try {
      const normalizedName = this.normalizeServiceName(serviceName);
      const fileName = `${eventMonth}-${normalizedName}.pdf`;

      AppLogger.debug(`Generated file name: ${fileName}`);

      return fileName;
    } catch (error) {
      AppLogger.error('Error generating file name', error as Error);
      throw error;
    }
  }

  /**
   * Normalize service name for file naming
   * - Remove invalid file name characters
   * - Limit length to 40 characters
   */
  private normalizeServiceName(name: string): string {
    // Remove or replace invalid characters: \/:*?"<>|
    let normalized = name.replace(/[\\/:*?"<>|]/g, '_');

    // Trim whitespace
    normalized = normalized.trim();

    // Limit to 40 characters
    if (normalized.length > 40) {
      normalized = normalized.substring(0, 40);
    }

    return normalized;
  }
}
