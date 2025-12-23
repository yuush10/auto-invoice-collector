/**
 * Unit tests for BaseVendor
 * Tests helper methods, extractBillingMonth, and detectDocumentType
 */

import { BaseVendor } from '../src/vendors/BaseVendor';
import { Page } from 'puppeteer';
import { VendorCredentials, DownloadOptions, DownloadedFile } from '../src/vendors/types';

/**
 * Concrete implementation of BaseVendor for testing
 * Exposes protected methods for testing purposes
 */
class TestVendor extends BaseVendor {
  vendorKey = 'test-vendor';
  vendorName = 'Test Vendor';
  loginUrl = 'https://example.com/login';

  async login(_page: Page, _credentials: VendorCredentials): Promise<void> {
    // No-op for testing
  }

  async navigateToInvoices(_page: Page): Promise<void> {
    // No-op for testing
  }

  async downloadInvoices(_page: Page, _options?: DownloadOptions): Promise<DownloadedFile[]> {
    return [];
  }

  async isLoggedIn(_page: Page): Promise<boolean> {
    return true;
  }

  // Expose protected methods for testing
  public testExtractBillingMonth(text: string): string | undefined {
    return this.extractBillingMonth(text);
  }

  public testDetectDocumentType(text: string): 'invoice' | 'receipt' | 'unknown' {
    return this.detectDocumentType(text);
  }

  public async testWait(ms: number): Promise<void> {
    return this.wait(ms);
  }

  public testLog(message: string, level?: 'info' | 'warn' | 'error'): void {
    return this.log(message, level);
  }
}

describe('BaseVendor', () => {
  let vendor: TestVendor;

  beforeEach(() => {
    vendor = new TestVendor();
    jest.clearAllMocks();
  });

  describe('Vendor Properties', () => {
    test('should have correct vendorKey', () => {
      expect(vendor.vendorKey).toBe('test-vendor');
    });

    test('should have correct vendorName', () => {
      expect(vendor.vendorName).toBe('Test Vendor');
    });

    test('should have correct loginUrl', () => {
      expect(vendor.loginUrl).toBe('https://example.com/login');
    });

    test('should have defaultTimeout of 30000ms', () => {
      expect((vendor as any).defaultTimeout).toBe(30000);
    });

    test('should have navigationWait of 2000ms', () => {
      expect((vendor as any).navigationWait).toBe(2000);
    });
  });

  describe('extractBillingMonth', () => {
    describe('YYYY-MM format', () => {
      test('should extract billing month from YYYY-MM format', () => {
        expect(vendor.testExtractBillingMonth('Invoice for 2024-11')).toBe('2024-11');
      });

      test('should extract billing month at start of text', () => {
        expect(vendor.testExtractBillingMonth('2024-01 Monthly Bill')).toBe('2024-01');
      });

      test('should extract billing month from middle of text', () => {
        expect(vendor.testExtractBillingMonth('Report: 2023-12 Sales')).toBe('2023-12');
      });

      test('should handle December correctly', () => {
        expect(vendor.testExtractBillingMonth('Bill for 2024-12')).toBe('2024-12');
      });

      test('should handle January correctly', () => {
        expect(vendor.testExtractBillingMonth('Bill for 2025-01')).toBe('2025-01');
      });
    });

    describe('Japanese date format (YYYY年MM月)', () => {
      test('should extract billing month from Japanese format', () => {
        expect(vendor.testExtractBillingMonth('2024年11月の請求書')).toBe('2024-11');
      });

      test('should handle single digit month in Japanese format', () => {
        expect(vendor.testExtractBillingMonth('2024年1月分')).toBe('2024-01');
      });

      test('should pad single digit month with zero', () => {
        expect(vendor.testExtractBillingMonth('2023年3月')).toBe('2023-03');
      });

      test('should handle December in Japanese format', () => {
        expect(vendor.testExtractBillingMonth('2024年12月分請求書')).toBe('2024-12');
      });
    });

    describe('English month format', () => {
      test('should extract billing month from "November 2024"', () => {
        expect(vendor.testExtractBillingMonth('November 2024 Invoice')).toBe('2024-11');
      });

      test('should extract billing month from "January 2025"', () => {
        expect(vendor.testExtractBillingMonth('January 2025 Statement')).toBe('2025-01');
      });

      test('should extract billing month from abbreviated "Nov 2024"', () => {
        expect(vendor.testExtractBillingMonth('Nov 2024 Bill')).toBe('2024-11');
      });

      test('should extract billing month from "Dec 2024"', () => {
        expect(vendor.testExtractBillingMonth('Dec 2024 Receipt')).toBe('2024-12');
      });

      test('should handle case insensitivity', () => {
        expect(vendor.testExtractBillingMonth('DECEMBER 2024')).toBe('2024-12');
      });

      test('should handle mixed case', () => {
        expect(vendor.testExtractBillingMonth('JaNuArY 2025')).toBe('2025-01');
      });
    });

    describe('Edge cases', () => {
      test('should return undefined for text without date', () => {
        expect(vendor.testExtractBillingMonth('No date here')).toBeUndefined();
      });

      test('should return undefined for empty string', () => {
        expect(vendor.testExtractBillingMonth('')).toBeUndefined();
      });

      test('should return undefined for partial date format', () => {
        expect(vendor.testExtractBillingMonth('2024 invoice')).toBeUndefined();
      });

      test('should prioritize YYYY-MM format when multiple formats present', () => {
        const result = vendor.testExtractBillingMonth('2024-11 (November 2024)');
        expect(result).toBe('2024-11');
      });
    });
  });

  describe('detectDocumentType', () => {
    describe('Invoice detection', () => {
      test('should detect "invoice" keyword', () => {
        expect(vendor.testDetectDocumentType('Monthly Invoice')).toBe('invoice');
      });

      test('should detect "Invoice" with capital letter', () => {
        expect(vendor.testDetectDocumentType('Invoice #12345')).toBe('invoice');
      });

      test('should detect "INVOICE" in uppercase', () => {
        expect(vendor.testDetectDocumentType('INVOICE DETAILS')).toBe('invoice');
      });

      test('should detect Japanese invoice (請求書)', () => {
        expect(vendor.testDetectDocumentType('2024年11月請求書')).toBe('invoice');
      });

      test('should detect "billing" keyword', () => {
        expect(vendor.testDetectDocumentType('Billing Statement')).toBe('invoice');
      });
    });

    describe('Receipt detection', () => {
      test('should detect "receipt" keyword', () => {
        expect(vendor.testDetectDocumentType('Payment Receipt')).toBe('receipt');
      });

      test('should detect "Receipt" with capital letter', () => {
        expect(vendor.testDetectDocumentType('Receipt #12345')).toBe('receipt');
      });

      test('should detect "RECEIPT" in uppercase', () => {
        expect(vendor.testDetectDocumentType('RECEIPT FOR PAYMENT')).toBe('receipt');
      });

      test('should detect Japanese receipt (領収書)', () => {
        expect(vendor.testDetectDocumentType('2024年11月領収書')).toBe('receipt');
      });

      test('should detect "payment confirmation" keyword', () => {
        expect(vendor.testDetectDocumentType('Payment Confirmation')).toBe('receipt');
      });
    });

    describe('Unknown type', () => {
      test('should return unknown for generic text', () => {
        expect(vendor.testDetectDocumentType('Monthly Report')).toBe('unknown');
      });

      test('should return unknown for empty string', () => {
        expect(vendor.testDetectDocumentType('')).toBe('unknown');
      });

      test('should return unknown for filename without keywords', () => {
        expect(vendor.testDetectDocumentType('document-2024-11.pdf')).toBe('unknown');
      });
    });

    describe('Priority when multiple keywords present', () => {
      test('should detect invoice when both invoice and receipt in text', () => {
        // Invoice keywords are checked first
        expect(vendor.testDetectDocumentType('Invoice and Receipt')).toBe('invoice');
      });
    });
  });

  describe('wait helper', () => {
    test('should wait for specified milliseconds', async () => {
      const start = Date.now();
      await vendor.testWait(100);
      const elapsed = Date.now() - start;

      // Allow some tolerance for timing
      expect(elapsed).toBeGreaterThanOrEqual(95);
      expect(elapsed).toBeLessThan(200);
    });

    test('should handle 0ms wait', async () => {
      const start = Date.now();
      await vendor.testWait(0);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('log helper', () => {
    let consoleSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    test('should log info messages with vendor prefix', () => {
      vendor.testLog('Test message');
      expect(consoleSpy).toHaveBeenCalledWith('[test-vendor] Test message');
    });

    test('should log info messages when level is info', () => {
      vendor.testLog('Info message', 'info');
      expect(consoleSpy).toHaveBeenCalledWith('[test-vendor] Info message');
    });

    test('should log warning messages', () => {
      vendor.testLog('Warning message', 'warn');
      expect(consoleWarnSpy).toHaveBeenCalledWith('[test-vendor] Warning message');
    });

    test('should log error messages', () => {
      vendor.testLog('Error message', 'error');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[test-vendor] Error message');
    });
  });
});
