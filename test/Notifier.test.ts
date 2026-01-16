import { Notifier } from '../src/modules/notifications/Notifier';
import { DriveInboxLogRecord } from '../src/modules/logging/DriveInboxLogger';

describe('Notifier', () => {
  let notifier: Notifier;

  beforeEach(() => {
    notifier = new Notifier('test@example.com');
  });

  describe('formatTimeOnly', () => {
    it('should format morning time correctly', () => {
      // 10:30 AM in Asia/Tokyo (UTC+9)
      // Create a date that will be 10:30 AM in Asia/Tokyo
      const date = new Date('2025-01-15T01:30:00Z'); // 10:30 AM JST
      const result = notifier.formatTimeOnly(date);
      expect(result).toBe('10:30 AM');
    });

    it('should format afternoon time correctly', () => {
      // 3:45 PM in Asia/Tokyo (UTC+9)
      const date = new Date('2025-01-15T06:45:00Z'); // 3:45 PM JST
      const result = notifier.formatTimeOnly(date);
      expect(result).toBe('3:45 PM');
    });

    it('should format noon correctly', () => {
      // 12:00 PM in Asia/Tokyo (UTC+9)
      const date = new Date('2025-01-15T03:00:00Z'); // 12:00 PM JST
      const result = notifier.formatTimeOnly(date);
      expect(result).toBe('12:00 PM');
    });

    it('should format midnight correctly', () => {
      // 12:00 AM in Asia/Tokyo (UTC+9)
      const date = new Date('2025-01-14T15:00:00Z'); // 12:00 AM JST next day
      const result = notifier.formatTimeOnly(date);
      expect(result).toBe('12:00 AM');
    });
  });

  describe('categorizeInboxErrors', () => {
    it('should categorize OCR failures', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'),
          driveFileId: 'file1',
          originalFileName: 'invoice.pdf',
          status: 'error',
          errorMessage: 'OCR request failed: 500 - Internal server error',
        },
      ];

      const result = notifier.categorizeInboxErrors(errorRecords, []);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('ocr_failure');
      expect(result[0].label).toBe('OCR Failures');
      expect(result[0].records).toHaveLength(1);
    });

    it('should categorize authentication errors', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'),
          driveFileId: 'file1',
          originalFileName: 'invoice.pdf',
          status: 'error',
          errorMessage: 'Error: 401 Unauthorized',
        },
        {
          timestamp: new Date('2025-01-15T02:30:00Z'),
          driveFileId: 'file2',
          originalFileName: 'receipt.pdf',
          status: 'error',
          errorMessage: 'Token expired',
        },
      ];

      const result = notifier.categorizeInboxErrors(errorRecords, []);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('authentication');
      expect(result[0].records).toHaveLength(2);
    });

    it('should categorize network/timeout errors', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'),
          driveFileId: 'file1',
          originalFileName: 'invoice.pdf',
          status: 'error',
          errorMessage: 'Connection timeout after 30000ms',
        },
      ];

      const result = notifier.categorizeInboxErrors(errorRecords, []);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('network_timeout');
    });

    it('should categorize file access errors', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'),
          driveFileId: 'file1',
          originalFileName: 'invoice.pdf',
          status: 'error',
          errorMessage: 'File not found in Drive',
        },
      ];

      const result = notifier.categorizeInboxErrors(errorRecords, []);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('file_access');
    });

    it('should categorize low confidence records', () => {
      const unknownRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T00:45:00Z'),
          driveFileId: 'file1',
          originalFileName: 'unknown_doc.pdf',
          status: 'low-confidence',
          confidence: 0.45,
          eventMonth: undefined,
        },
      ];

      const result = notifier.categorizeInboxErrors([], unknownRecords);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('low_confidence');
      expect(result[0].label).toBe('Low Confidence / Unknown');
    });

    it('should categorize unknown errors as "other"', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'),
          driveFileId: 'file1',
          originalFileName: 'invoice.pdf',
          status: 'error',
          errorMessage: 'Something unexpected happened',
        },
      ];

      const result = notifier.categorizeInboxErrors(errorRecords, []);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('other');
    });

    it('should group multiple error types correctly', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'),
          driveFileId: 'file1',
          originalFileName: 'invoice1.pdf',
          status: 'error',
          errorMessage: 'OCR request failed',
        },
        {
          timestamp: new Date('2025-01-15T02:30:00Z'),
          driveFileId: 'file2',
          originalFileName: 'invoice2.pdf',
          status: 'error',
          errorMessage: 'OCR request failed',
        },
        {
          timestamp: new Date('2025-01-15T03:30:00Z'),
          driveFileId: 'file3',
          originalFileName: 'receipt.pdf',
          status: 'error',
          errorMessage: '403 Forbidden',
        },
      ];
      const unknownRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T00:45:00Z'),
          driveFileId: 'file4',
          originalFileName: 'unknown.pdf',
          status: 'low-confidence',
          confidence: 0.3,
        },
      ];

      const result = notifier.categorizeInboxErrors(errorRecords, unknownRecords);
      expect(result).toHaveLength(3);

      // Categories should be in order: ocr_failure, authentication, low_confidence
      expect(result[0].category).toBe('ocr_failure');
      expect(result[0].records).toHaveLength(2);

      expect(result[1].category).toBe('authentication');
      expect(result[1].records).toHaveLength(1);

      expect(result[2].category).toBe('low_confidence');
      expect(result[2].records).toHaveLength(1);
    });

    it('should return empty array when no records', () => {
      const result = notifier.categorizeInboxErrors([], []);
      expect(result).toHaveLength(0);
    });

    it('should handle undefined error message', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'),
          driveFileId: 'file1',
          originalFileName: 'invoice.pdf',
          status: 'error',
          errorMessage: undefined,
        },
      ];

      const result = notifier.categorizeInboxErrors(errorRecords, []);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('other');
    });
  });

  describe('formatInboxErrorSection', () => {
    it('should return empty string for no issues', () => {
      const result = notifier.formatInboxErrorSection([], []);
      expect(result).toBe('');
    });

    it('should format single error with timestamp and action', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'), // 10:30 AM JST
          driveFileId: 'file1',
          originalFileName: 'invoice_jan.pdf',
          status: 'error',
          errorMessage: 'OCR request failed: 500 - Internal server error',
        },
      ];

      const result = notifier.formatInboxErrorSection(errorRecords, []);

      expect(result).toContain('=== Drive Inbox Issues (1) ===');
      expect(result).toContain('[OCR Failures] (1 file)');
      expect(result).toContain('10:30 AM: invoice_jan.pdf');
      expect(result).toContain('Error: OCR request failed: 500 - Internal server error');
      expect(result).toContain('Action: Retry later. If persistent, check Cloud Run service status.');
      expect(result).toContain('Need help? Files remain in inbox for manual review.');
    });

    it('should format low confidence with confidence and event month', () => {
      const unknownRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T00:45:00Z'), // 9:45 AM JST
          driveFileId: 'file1',
          originalFileName: 'unknown_doc.pdf',
          status: 'low-confidence',
          confidence: 0.45,
          eventMonth: undefined,
        },
      ];

      const result = notifier.formatInboxErrorSection([], unknownRecords);

      expect(result).toContain('[Low Confidence / Unknown] (1 file)');
      expect(result).toContain('9:45 AM: unknown_doc.pdf');
      expect(result).toContain('Confidence: 45%, EventMonth: not detected');
      expect(result).toContain('Action: Manually review and rename in Drive inbox folder.');
    });

    it('should format multiple categories correctly', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'),
          driveFileId: 'file1',
          originalFileName: 'invoice_jan.pdf',
          status: 'error',
          errorMessage: 'OCR request failed: 500',
        },
        {
          timestamp: new Date('2025-01-15T02:15:00Z'),
          driveFileId: 'file2',
          originalFileName: 'receipt_feb.pdf',
          status: 'error',
          errorMessage: 'OCR request failed: 503',
        },
      ];
      const unknownRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T00:45:00Z'),
          driveFileId: 'file3',
          originalFileName: 'unknown_doc.pdf',
          status: 'low-confidence',
          confidence: 0.45,
        },
      ];

      const result = notifier.formatInboxErrorSection(errorRecords, unknownRecords);

      expect(result).toContain('=== Drive Inbox Issues (3) ===');
      expect(result).toContain('[OCR Failures] (2 files)');
      expect(result).toContain('[Low Confidence / Unknown] (1 file)');
    });

    it('should use singular "file" for single record', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'),
          driveFileId: 'file1',
          originalFileName: 'invoice.pdf',
          status: 'error',
          errorMessage: 'OCR request failed',
        },
      ];

      const result = notifier.formatInboxErrorSection(errorRecords, []);
      expect(result).toContain('(1 file)');
    });

    it('should use plural "files" for multiple records', () => {
      const errorRecords: DriveInboxLogRecord[] = [
        {
          timestamp: new Date('2025-01-15T01:30:00Z'),
          driveFileId: 'file1',
          originalFileName: 'invoice1.pdf',
          status: 'error',
          errorMessage: 'OCR request failed',
        },
        {
          timestamp: new Date('2025-01-15T02:30:00Z'),
          driveFileId: 'file2',
          originalFileName: 'invoice2.pdf',
          status: 'error',
          errorMessage: 'OCR request failed',
        },
      ];

      const result = notifier.formatInboxErrorSection(errorRecords, []);
      expect(result).toContain('(2 files)');
    });
  });
});
