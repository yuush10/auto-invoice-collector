/**
 * Type definitions for the Auto Invoice Collector
 */

// Re-export vendor types
export * from './vendor';

export type DocumentType = 'invoice' | 'receipt' | 'unknown';

export type ProcessingStatus = 'success' | 'error' | 'needs-review';

export interface ExtractedData {
  docType: DocumentType;
  serviceName: string;
  eventDates: string[];
  eventMonth: string;
  confidence: number;
  notes: string;
  hasReceiptInContent?: boolean;
  hasInvoiceInContent?: boolean;
}

export interface EmailContext {
  from: string;
  subject: string;
  body: string;
}

export interface DocTypeDetectionFlags {
  hasReceiptInSubject: boolean;
  hasInvoiceInSubject: boolean;
  hasReceiptInBody: boolean;
  hasInvoiceInBody: boolean;
  hasReceiptInFilename: boolean;
  hasInvoiceInFilename: boolean;
  hasReceiptInContent: boolean;
  hasInvoiceInContent: boolean;
}

export interface ProcessingLog {
  timestamp: Date;
  messageId: string;
  attachmentIndex?: number;
  sha256: string;
  sourceType: 'attachment' | 'body' | 'url';
  docType: DocumentType;
  serviceName: string;
  eventMonth: string;
  driveFileId: string;
  status: ProcessingStatus;
  errorMessage?: string;
}

export interface ProcessingResult {
  success: boolean;
  processed: number;
  errors: ProcessingError[];
  needsReview: string[];
}

export interface ProcessingError {
  messageId: string;
  serviceName: string;
  error: string;
}
