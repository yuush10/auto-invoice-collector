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

      gmailAttachments.forEach(attachment => {
        const contentType = attachment.getContentType();

        if (this.isPdfContentType(contentType)) {
          attachments.push({
            name: attachment.getName(),
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
   */
  private isPdfContentType(contentType: string): boolean {
    return contentType.includes('application/pdf');
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
