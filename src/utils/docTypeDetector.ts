/**
 * Document type detection utilities
 * Determines whether a document is an invoice (請求書) or receipt (領収書)
 * based on keywords found in email subject, body, filename, and PDF content
 */

import { DocumentType, DocTypeDetectionFlags } from '../types';
import { AppLogger } from './logger';

export class DocTypeDetector {
  // Keywords for receipt detection
  private static readonly RECEIPT_KEYWORDS = {
    en: ['receipt'],
    ja: ['領収書']
  };

  // Keywords for invoice detection
  private static readonly INVOICE_KEYWORDS = {
    en: ['invoice'],
    ja: ['請求書']
  };

  /**
   * Check if text contains receipt keywords
   */
  static hasReceiptKeywords(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Check English keywords (case-insensitive)
    const hasEnglish = this.RECEIPT_KEYWORDS.en.some(keyword =>
      lowerText.includes(keyword)
    );

    // Check Japanese keywords (case-sensitive)
    const hasJapanese = this.RECEIPT_KEYWORDS.ja.some(keyword =>
      text.includes(keyword)
    );

    return hasEnglish || hasJapanese;
  }

  /**
   * Check if text contains invoice keywords
   */
  static hasInvoiceKeywords(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Check English keywords (case-insensitive)
    const hasEnglish = this.INVOICE_KEYWORDS.en.some(keyword =>
      lowerText.includes(keyword)
    );

    // Check Japanese keywords (case-sensitive)
    const hasJapanese = this.INVOICE_KEYWORDS.ja.some(keyword =>
      text.includes(keyword)
    );

    return hasEnglish || hasJapanese;
  }

  /**
   * Determine document type from detection flags
   * Receipt takes precedence if found in any source
   * Default to receipt if neither found
   */
  static determineDocType(flags: DocTypeDetectionFlags): DocumentType {
    // Receipt takes precedence
    const hasReceipt =
      flags.hasReceiptInSubject ||
      flags.hasReceiptInBody ||
      flags.hasReceiptInFilename ||
      flags.hasReceiptInContent;

    if (hasReceipt) {
      AppLogger.debug('Document type detected as 領収書 (receipt)');
      return 'receipt';
    }

    // Check for invoice
    const hasInvoice =
      flags.hasInvoiceInSubject ||
      flags.hasInvoiceInBody ||
      flags.hasInvoiceInFilename ||
      flags.hasInvoiceInContent;

    if (hasInvoice) {
      AppLogger.debug('Document type detected as 請求書 (invoice)');
      return 'invoice';
    }

    // Default to receipt
    AppLogger.debug('No doc type keywords found, defaulting to 領収書 (receipt)');
    return 'receipt';
  }

  /**
   * Get human-readable docType string for filename
   */
  static getDocTypeString(docType: DocumentType): string {
    switch (docType) {
      case 'receipt':
        return '領収書';
      case 'invoice':
        return '請求書';
      default:
        return '領収書'; // Default
    }
  }

  /**
   * Log detection details for debugging
   */
  static logDetectionDetails(flags: DocTypeDetectionFlags, docType: DocumentType): void {
    const sources: string[] = [];

    if (flags.hasReceiptInSubject || flags.hasInvoiceInSubject) {
      sources.push('subject');
    }
    if (flags.hasReceiptInBody || flags.hasInvoiceInBody) {
      sources.push('body');
    }
    if (flags.hasReceiptInFilename || flags.hasInvoiceInFilename) {
      sources.push('filename');
    }
    if (flags.hasReceiptInContent || flags.hasInvoiceInContent) {
      sources.push('content');
    }

    if (sources.length > 0) {
      AppLogger.info(`DocType ${this.getDocTypeString(docType)} detected from: ${sources.join(', ')}`);
    } else {
      AppLogger.info(`DocType ${this.getDocTypeString(docType)} (default, no keywords found)`);
    }
  }
}
