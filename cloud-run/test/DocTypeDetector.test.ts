/**
 * Unit tests for DocTypeDetector
 * Tests document type detection logic with priority handling
 */

import { DocTypeDetector } from '../src/services/GeminiOcrService';

describe('DocTypeDetector', () => {
  describe('determineDocType', () => {
    describe('priority 1: Gemini classification', () => {
      it('should return receipt when Gemini says receipt', () => {
        const result = DocTypeDetector.determineDocType({
          geminiDocType: 'receipt',
          hasReceiptInContent: false,
          hasInvoiceInContent: true,
        });
        expect(result).toBe('receipt');
      });

      it('should return invoice when Gemini says invoice', () => {
        const result = DocTypeDetector.determineDocType({
          geminiDocType: 'invoice',
          hasReceiptInContent: true,
          hasInvoiceInContent: false,
        });
        expect(result).toBe('invoice');
      });

      it('should prioritize Gemini over both content keywords', () => {
        const result = DocTypeDetector.determineDocType({
          geminiDocType: 'receipt',
          hasReceiptInContent: true,
          hasInvoiceInContent: true,
        });
        expect(result).toBe('receipt');
      });

      it('should ignore unknown Gemini classification and fall through', () => {
        const result = DocTypeDetector.determineDocType({
          geminiDocType: 'unknown',
          hasReceiptInContent: true,
          hasInvoiceInContent: false,
        });
        expect(result).toBe('receipt');
      });

      it('should handle undefined Gemini classification', () => {
        const result = DocTypeDetector.determineDocType({
          geminiDocType: undefined,
          hasReceiptInContent: false,
          hasInvoiceInContent: true,
        });
        expect(result).toBe('invoice');
      });
    });

    describe('priority 2: exclusive content match', () => {
      it('should return receipt when only receipt keyword in content', () => {
        const result = DocTypeDetector.determineDocType({
          hasReceiptInContent: true,
          hasInvoiceInContent: false,
        });
        expect(result).toBe('receipt');
      });

      it('should return invoice when only invoice keyword in content', () => {
        const result = DocTypeDetector.determineDocType({
          hasReceiptInContent: false,
          hasInvoiceInContent: true,
        });
        expect(result).toBe('invoice');
      });
    });

    describe('priority 3: exclusive filename match', () => {
      it('should return receipt when only receipt keyword in filename', () => {
        const result = DocTypeDetector.determineDocType({
          hasReceiptInContent: false,
          hasInvoiceInContent: false,
          hasReceiptInFilename: true,
          hasInvoiceInFilename: false,
        });
        expect(result).toBe('receipt');
      });

      it('should return invoice when only invoice keyword in filename', () => {
        const result = DocTypeDetector.determineDocType({
          hasReceiptInContent: false,
          hasInvoiceInContent: false,
          hasReceiptInFilename: false,
          hasInvoiceInFilename: true,
        });
        expect(result).toBe('invoice');
      });
    });

    describe('priority 4: default to receipt', () => {
      it('should default to receipt when both keywords in content', () => {
        const result = DocTypeDetector.determineDocType({
          hasReceiptInContent: true,
          hasInvoiceInContent: true,
        });
        expect(result).toBe('receipt');
      });

      it('should default to receipt when neither keyword found', () => {
        const result = DocTypeDetector.determineDocType({
          hasReceiptInContent: false,
          hasInvoiceInContent: false,
        });
        expect(result).toBe('receipt');
      });

      it('should default to receipt when both filename keywords present', () => {
        const result = DocTypeDetector.determineDocType({
          hasReceiptInContent: false,
          hasInvoiceInContent: false,
          hasReceiptInFilename: true,
          hasInvoiceInFilename: true,
        });
        expect(result).toBe('receipt');
      });
    });

    describe('bug fix verification: issue #62', () => {
      it('should correctly identify receipt when Gemini returns receipt', () => {
        // This is the actual bug scenario: Gemini correctly identified 領収書
        // but the old code ignored it and defaulted to invoice
        const result = DocTypeDetector.determineDocType({
          geminiDocType: 'receipt',
          hasReceiptInContent: true, // prompt contains both keywords
          hasInvoiceInContent: true, // prompt contains both keywords
          hasReceiptInFilename: false,
          hasInvoiceInFilename: false,
        });
        expect(result).toBe('receipt');
      });
    });
  });

  describe('hasReceiptKeywords', () => {
    it('should detect Japanese receipt keyword', () => {
      expect(DocTypeDetector.hasReceiptKeywords('この領収書は...')).toBe(true);
    });

    it('should detect English receipt keyword (case insensitive)', () => {
      expect(DocTypeDetector.hasReceiptKeywords('This is a Receipt')).toBe(true);
      expect(DocTypeDetector.hasReceiptKeywords('RECEIPT')).toBe(true);
    });

    it('should return false when no receipt keywords', () => {
      expect(DocTypeDetector.hasReceiptKeywords('この請求書は...')).toBe(false);
    });
  });

  describe('hasInvoiceKeywords', () => {
    it('should detect Japanese invoice keyword', () => {
      expect(DocTypeDetector.hasInvoiceKeywords('この請求書は...')).toBe(true);
    });

    it('should detect English invoice keyword (case insensitive)', () => {
      expect(DocTypeDetector.hasInvoiceKeywords('This is an Invoice')).toBe(true);
      expect(DocTypeDetector.hasInvoiceKeywords('INVOICE')).toBe(true);
    });

    it('should return false when no invoice keywords', () => {
      expect(DocTypeDetector.hasInvoiceKeywords('この領収書は...')).toBe(false);
    });
  });

  describe('getDocTypeString', () => {
    it('should return 領収書 for receipt', () => {
      expect(DocTypeDetector.getDocTypeString('receipt')).toBe('領収書');
    });

    it('should return 請求書 for invoice', () => {
      expect(DocTypeDetector.getDocTypeString('invoice')).toBe('請求書');
    });

    it('should return 領収書 for unknown', () => {
      expect(DocTypeDetector.getDocTypeString('unknown')).toBe('領収書');
    });
  });
});
