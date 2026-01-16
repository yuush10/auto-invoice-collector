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
   * Priority order (highest to lowest):
   * 1. PDF content (most authoritative - what the document actually is)
   * 2. Filename (second most authoritative)
   * 3. Email body
   * 4. Email subject (least authoritative - may mention both invoice and receipt)
   * Default to receipt if neither found
   */
  static determineDocType(flags: DocTypeDetectionFlags): DocumentType {
    // Priority 1: Check PDF content first (most authoritative)
    if (flags.hasInvoiceInContent && !flags.hasReceiptInContent) {
      AppLogger.debug('Document type detected as 請求書 (invoice) from PDF content');
      return 'invoice';
    }
    if (flags.hasReceiptInContent && !flags.hasInvoiceInContent) {
      AppLogger.debug('Document type detected as 領収書 (receipt) from PDF content');
      return 'receipt';
    }

    // Priority 2: Check filename
    if (flags.hasInvoiceInFilename && !flags.hasReceiptInFilename) {
      AppLogger.debug('Document type detected as 請求書 (invoice) from filename');
      return 'invoice';
    }
    if (flags.hasReceiptInFilename && !flags.hasInvoiceInFilename) {
      AppLogger.debug('Document type detected as 領収書 (receipt) from filename');
      return 'receipt';
    }

    // Priority 3: Check email body
    if (flags.hasInvoiceInBody && !flags.hasReceiptInBody) {
      AppLogger.debug('Document type detected as 請求書 (invoice) from email body');
      return 'invoice';
    }
    if (flags.hasReceiptInBody && !flags.hasInvoiceInBody) {
      AppLogger.debug('Document type detected as 領収書 (receipt) from email body');
      return 'receipt';
    }

    // Priority 4: Check email subject (lowest priority)
    if (flags.hasInvoiceInSubject && !flags.hasReceiptInSubject) {
      AppLogger.debug('Document type detected as 請求書 (invoice) from email subject');
      return 'invoice';
    }
    if (flags.hasReceiptInSubject && !flags.hasInvoiceInSubject) {
      AppLogger.debug('Document type detected as 領収書 (receipt) from email subject');
      return 'receipt';
    }

    // If both or neither keyword types found, check if any invoice keyword exists
    // (prefer invoice over receipt when ambiguous, as invoices are more important)
    const hasAnyInvoice =
      flags.hasInvoiceInContent ||
      flags.hasInvoiceInFilename ||
      flags.hasInvoiceInBody ||
      flags.hasInvoiceInSubject;

    if (hasAnyInvoice) {
      AppLogger.debug('Document type detected as 請求書 (invoice) - ambiguous case, preferring invoice');
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
      case 'unknown':
        return '不明';
      default:
        return '不明';
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
