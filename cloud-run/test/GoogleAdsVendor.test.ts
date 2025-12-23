/**
 * Unit tests for GoogleAdsVendor
 * Run with: npm test
 */

import { GoogleAdsVendor } from '../src/vendors/GoogleAdsVendor';

// Mock google-ads-api
jest.mock('google-ads-api', () => ({
  GoogleAdsApi: jest.fn().mockImplementation(() => ({
    Customer: jest.fn().mockReturnValue({
      invoices: {
        listInvoices: jest.fn(),
      },
    }),
  })),
  enums: {
    MonthOfYear: {
      JANUARY: 1,
      FEBRUARY: 2,
      MARCH: 3,
      APRIL: 4,
      MAY: 5,
      JUNE: 6,
      JULY: 7,
      AUGUST: 8,
      SEPTEMBER: 9,
      OCTOBER: 10,
      NOVEMBER: 11,
      DECEMBER: 12,
    },
  },
  services: {},
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('GoogleAdsVendor', () => {
  let vendor: GoogleAdsVendor;
  const mockPage = {} as any; // Page is not used for API-based vendor

  beforeEach(() => {
    vendor = new GoogleAdsVendor();
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('Vendor Properties', () => {
    test('should have correct vendorKey', () => {
      expect(vendor.vendorKey).toBe('google-ads');
    });

    test('should have correct vendorName', () => {
      expect(vendor.vendorName).toBe('Google Ads');
    });

    test('should have correct loginUrl', () => {
      expect(vendor.loginUrl).toBe('https://ads.google.com/aw/billing/documents');
    });
  });

  describe('Credential Validation', () => {
    const baseCredentials = {
      username: 'test@example.com',
      password: 'password',
      developerToken: 'dev-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      customerId: '1234567890',
      billingSetupId: '9876543210',
    };

    test('should throw error when developerToken is missing', async () => {
      const credentials = { ...baseCredentials, developerToken: '' };
      await expect(vendor.login(mockPage, credentials)).rejects.toThrow(
        'Google Ads developer token is required'
      );
    });

    test('should throw error when clientId is missing', async () => {
      const credentials = { ...baseCredentials, clientId: '' };
      await expect(vendor.login(mockPage, credentials)).rejects.toThrow(
        'Google Ads OAuth2 client credentials are required'
      );
    });

    test('should throw error when clientSecret is missing', async () => {
      const credentials = { ...baseCredentials, clientSecret: '' };
      await expect(vendor.login(mockPage, credentials)).rejects.toThrow(
        'Google Ads OAuth2 client credentials are required'
      );
    });

    test('should throw error when refreshToken is missing', async () => {
      const credentials = { ...baseCredentials, refreshToken: '' };
      await expect(vendor.login(mockPage, credentials)).rejects.toThrow(
        'Google Ads refresh token is required'
      );
    });

    test('should throw error when customerId is missing', async () => {
      const credentials = { ...baseCredentials, customerId: '' };
      await expect(vendor.login(mockPage, credentials)).rejects.toThrow(
        'Google Ads customer ID is required'
      );
    });

    test('should throw error when billingSetupId is missing', async () => {
      const credentials = { ...baseCredentials, billingSetupId: '' };
      await expect(vendor.login(mockPage, credentials)).rejects.toThrow(
        'Google Ads billing setup ID is required'
      );
    });

    test('should initialize API client with valid credentials', async () => {
      await vendor.login(mockPage, baseCredentials);
      expect(await vendor.isLoggedIn(mockPage)).toBe(true);
    });
  });

  describe('isLoggedIn', () => {
    test('should return false before login', async () => {
      expect(await vendor.isLoggedIn(mockPage)).toBe(false);
    });

    test('should return true after login', async () => {
      const credentials = {
        username: 'test@example.com',
        password: 'password',
        developerToken: 'dev-token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
        customerId: '1234567890',
        billingSetupId: '9876543210',
      };

      await vendor.login(mockPage, credentials);
      expect(await vendor.isLoggedIn(mockPage)).toBe(true);
    });
  });

  describe('navigateToInvoices', () => {
    test('should be a no-op for API-based vendor', async () => {
      // Should not throw
      await expect(vendor.navigateToInvoices(mockPage)).resolves.not.toThrow();
    });
  });

  describe('downloadInvoices', () => {
    const validCredentials = {
      username: 'test@example.com',
      password: 'password',
      developerToken: 'dev-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      customerId: '1234567890',
      billingSetupId: '9876543210',
    };

    test('should throw error when not authenticated', async () => {
      await expect(vendor.downloadInvoices(mockPage)).rejects.toThrow(
        'Not authenticated. Call login() first.'
      );
    });

    test('should return empty array when no invoices found', async () => {
      // Login first (no fetch calls during login for API-based vendor)
      await vendor.login(mockPage, validCredentials);

      // Mock the listInvoices response
      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockResolvedValueOnce({ invoices: [] });

      const files = await vendor.downloadInvoices(mockPage, { targetMonth: '2024-11' });
      expect(files).toEqual([]);
    });

    test('should download invoice PDF successfully', async () => {
      // Login first
      await vendor.login(mockPage, validCredentials);

      // Mock the listInvoices response
      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockResolvedValueOnce({
        invoices: [
          {
            id: 'INV-001',
            pdf_url: 'https://example.com/invoice.pdf',
          },
        ],
      });

      // Setup mock for OAuth token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'test-access-token' }),
      });

      // Setup mock for PDF download
      const pdfContent = '%PDF-1.4 test content';
      const pdfBuffer = new ArrayBuffer(pdfContent.length);
      const view = new Uint8Array(pdfBuffer);
      for (let i = 0; i < pdfContent.length; i++) {
        view[i] = pdfContent.charCodeAt(i);
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(pdfBuffer),
      });

      const files = await vendor.downloadInvoices(mockPage, { targetMonth: '2024-11' });

      expect(files).toHaveLength(1);
      expect(files[0].filename).toBe('GoogleAds-請求書-2024-11.pdf');
      expect(files[0].mimeType).toBe('application/pdf');
      expect(files[0].documentType).toBe('invoice');
      expect(files[0].billingMonth).toBe('2024-11');
      expect(files[0].serviceName).toBe('Google Ads');
    });

    test('should skip invoice without PDF URL', async () => {
      // Setup mock for OAuth token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-access-token' }),
      });

      // Login first
      await vendor.login(mockPage, validCredentials);

      // Mock the listInvoices response
      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockResolvedValueOnce({
        invoices: [
          {
            id: 'INV-001',
            pdf_url: null,
          },
        ],
      });

      const files = await vendor.downloadInvoices(mockPage, { targetMonth: '2024-11' });
      expect(files).toHaveLength(0);
    });

    test('should default to previous month when targetMonth not specified', async () => {
      // Setup mock for OAuth token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-access-token' }),
      });

      // Login first
      await vendor.login(mockPage, validCredentials);

      // Mock the listInvoices response
      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockResolvedValueOnce({ invoices: [] });

      await vendor.downloadInvoices(mockPage);

      // Verify that listInvoices was called (we can't easily verify the month without more mocking)
      expect(mockCustomer.invoices.listInvoices).toHaveBeenCalled();
    });
  });

  describe('API Error Handling', () => {
    const validCredentials = {
      username: 'test@example.com',
      password: 'password',
      developerToken: 'dev-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      customerId: '1234567890',
      billingSetupId: '9876543210',
    };

    test('should handle PERMISSION_DENIED error', async () => {
      await vendor.login(mockPage, validCredentials);

      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockRejectedValueOnce(
        new Error('PERMISSION_DENIED: Access denied')
      );

      await expect(vendor.downloadInvoices(mockPage)).rejects.toThrow(
        'Permission denied. Check if the account has invoice access enabled.'
      );
    });

    test('should handle INVALID_ARGUMENT error', async () => {
      await vendor.login(mockPage, validCredentials);

      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockRejectedValueOnce(
        new Error('INVALID_ARGUMENT: Bad request')
      );

      await expect(vendor.downloadInvoices(mockPage)).rejects.toThrow(
        'Invalid argument. Check customer ID and billing setup ID.'
      );
    });

    test('should handle UNAUTHENTICATED error', async () => {
      await vendor.login(mockPage, validCredentials);

      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockRejectedValueOnce(
        new Error('UNAUTHENTICATED: Token expired')
      );

      await expect(vendor.downloadInvoices(mockPage)).rejects.toThrow(
        'Authentication failed. Refresh token may be expired.'
      );
    });

    test('should handle generic API error', async () => {
      await vendor.login(mockPage, validCredentials);

      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockRejectedValueOnce(
        new Error('Some unknown error')
      );

      await expect(vendor.downloadInvoices(mockPage)).rejects.toThrow(
        'Google Ads API error: Some unknown error'
      );
    });
  });

  describe('PDF Download Error Handling', () => {
    const validCredentials = {
      username: 'test@example.com',
      password: 'password',
      developerToken: 'dev-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      customerId: '1234567890',
      billingSetupId: '9876543210',
    };

    test('should handle failed access token request', async () => {
      await vendor.login(mockPage, validCredentials);

      // Mock failed token response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Invalid grant',
      });

      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockResolvedValueOnce({
        invoices: [{ id: 'INV-001', pdf_url: 'https://example.com/invoice.pdf' }],
      });

      const files = await vendor.downloadInvoices(mockPage);
      // Should continue without throwing, but file won't be added
      expect(files).toHaveLength(0);
    });

    test('should handle 401 response when downloading PDF', async () => {
      await vendor.login(mockPage, validCredentials);

      // Mock successful token response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token' }),
      });

      // Mock 401 PDF download response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockResolvedValueOnce({
        invoices: [{ id: 'INV-001', pdf_url: 'https://example.com/invoice.pdf' }],
      });

      const files = await vendor.downloadInvoices(mockPage);
      // Should continue without throwing, but file won't be added
      expect(files).toHaveLength(0);
    });

    test('should handle 404 response when downloading PDF', async () => {
      await vendor.login(mockPage, validCredentials);

      // Mock successful token response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token' }),
      });

      // Mock 404 PDF download response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockResolvedValueOnce({
        invoices: [{ id: 'INV-001', pdf_url: 'https://example.com/invoice.pdf' }],
      });

      const files = await vendor.downloadInvoices(mockPage);
      // Should continue without throwing, but file won't be added
      expect(files).toHaveLength(0);
    });
  });

  describe('Target Month Calculation', () => {
    const validCredentials = {
      username: 'test@example.com',
      password: 'password',
      developerToken: 'dev-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      customerId: '1234567890',
      billingSetupId: '9876543210',
    };

    test('should parse YYYY-MM format correctly', async () => {
      await vendor.login(mockPage, validCredentials);

      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockResolvedValueOnce({ invoices: [] });

      await vendor.downloadInvoices(mockPage, { targetMonth: '2024-03' });

      expect(mockCustomer.invoices.listInvoices).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_year: '2024',
          issue_month: 3, // MARCH
        })
      );
    });

    test('should handle December correctly', async () => {
      await vendor.login(mockPage, validCredentials);

      const { GoogleAdsApi } = require('google-ads-api');
      const mockCustomer = GoogleAdsApi.mock.results[0].value.Customer();
      mockCustomer.invoices.listInvoices.mockResolvedValueOnce({ invoices: [] });

      await vendor.downloadInvoices(mockPage, { targetMonth: '2024-12' });

      expect(mockCustomer.invoices.listInvoices).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_year: '2024',
          issue_month: 12, // DECEMBER
        })
      );
    });
  });
});
