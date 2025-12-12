/**
 * Type definitions for the Auto Invoice Collector
 */

export type DocumentType = 'invoice' | 'receipt' | 'unknown';

export type ProcessingStatus = 'success' | 'error' | 'needs-review';

export interface ExtractedData {
  docType: DocumentType;
  serviceName: string;
  eventDates: string[];
  eventMonth: string;
  confidence: number;
  notes: string;
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
