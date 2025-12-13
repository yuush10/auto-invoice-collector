/**
 * Extract attachments from Gmail messages
 */

import { AppLogger } from '../../utils/logger';

export interface Attachment {
  name: string;
  data: GoogleAppsScript.Base.Blob;
  contentType: string;
}

export class AttachmentExtractor {
  /**
   * Extract PDF attachments from a Gmail message
   */
  extractPdfAttachments(message: GoogleAppsScript.Gmail.GmailMessage): Attachment[] {
    try {
      const attachments: Attachment[] = [];
      const gmailAttachments = message.getAttachments();

      // Log all attachments for debugging
      AppLogger.debug(`Message ${message.getId()} has ${gmailAttachments.length} total attachments`);

      gmailAttachments.forEach((attachment, index) => {
        const contentType = attachment.getContentType();
        const name = attachment.getName();

        AppLogger.debug(`Attachment ${index}: name="${name}", contentType="${contentType}"`);

        // Check both content type and filename for PDF detection
        const isPdfByContentType = this.isPdfContentType(contentType);
        const isPdfByFilename = this.isPdfFilename(name);

        if (isPdfByContentType || isPdfByFilename) {
          if (isPdfByFilename && !isPdfByContentType) {
            AppLogger.info(`Detected PDF by filename despite non-PDF MIME type: ${name} (${contentType})`);
          }

          attachments.push({
            name: name,
            data: attachment.getAs('application/pdf'),
            contentType: contentType
          });
        }
      });

      AppLogger.info(`Extracted ${attachments.length} PDF attachments from message ${message.getId()}`);

      return attachments;
    } catch (error) {
      AppLogger.error('Error extracting attachments', error as Error);
      throw error;
    }
  }

  /**
   * Check if content type is PDF
   * Handles various MIME types that might indicate a PDF
   */
  private isPdfContentType(contentType: string): boolean {
    const pdfTypes = [
      'application/pdf',
      'application/x-pdf',
      'application/acrobat',
      'application/vnd.pdf',
      'text/pdf',
      'text/x-pdf'
    ];

    const lowerContentType = contentType.toLowerCase();
    return pdfTypes.some(type => lowerContentType.includes(type));
  }

  /**
   * Check if attachment filename suggests it's a PDF
   */
  private isPdfFilename(filename: string): boolean {
    return filename.toLowerCase().endsWith('.pdf');
  }

  /**
   * Calculate SHA256 hash of attachment data
   */
  calculateHash(data: GoogleAppsScript.Base.Blob): string {
    try {
      const bytes = data.getBytes();
      const hash = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        bytes
      );

      return hash.map(byte => {
        const v = (byte < 0 ? byte + 256 : byte).toString(16);
        return v.length === 1 ? '0' + v : v;
      }).join('');
    } catch (error) {
      AppLogger.error('Error calculating hash', error as Error);
      throw error;
    }
  }
}
