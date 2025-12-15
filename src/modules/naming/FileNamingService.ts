/**
 * File naming service
 */

import { DocumentType } from '../../types';
import { AppLogger } from '../../utils/logger';
import { DocTypeDetector } from '../../utils/docTypeDetector';

export class FileNamingService {
  // Service name mapping for normalization
  private static readonly SERVICE_NAME_MAPPING: { [key: string]: string } = {
    'Personal 月額': 'Studio',
    '電話自動応答サービスIVRy': 'IVRy',
    'IVRy 電話自動応答サービス': 'IVRy',
  };

  /**
   * Generate file name from event month, document type, and service name
   * Format: YYYY-MM-ServiceName-{請求書|領収書}.pdf
   */
  generate(serviceName: string, eventMonth: string, docType: DocumentType): string {
    try {
      const docTypeString = DocTypeDetector.getDocTypeString(docType);
      const normalizedName = this.normalizeServiceName(serviceName);
      const fileName = `${eventMonth}-${normalizedName}-${docTypeString}.pdf`;

      AppLogger.debug(`Generated file name: ${fileName}`);

      return fileName;
    } catch (error) {
      AppLogger.error('Error generating file name', error as Error);
      throw error;
    }
  }

  /**
   * Normalize service name for file naming
   * - Map known service names to canonical forms
   * - Remove invalid file name characters
   * - Limit length to 40 characters
   */
  private normalizeServiceName(name: string): string {
    // Check if service name needs mapping
    let normalized = FileNamingService.SERVICE_NAME_MAPPING[name] || name;

    // Remove or replace invalid characters: \/:*?"<>|
    normalized = normalized.replace(/[\\/:*?"<>|]/g, '_');

    // Trim whitespace
    normalized = normalized.trim();

    // Limit to 40 characters
    if (normalized.length > 40) {
      normalized = normalized.substring(0, 40);
    }

    return normalized;
  }
}
