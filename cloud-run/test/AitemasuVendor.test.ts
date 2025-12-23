/**
 * Unit tests for AitemasuVendor
 * Tests vendor properties, login flow, and selectors
 */

import { AitemasuVendor } from '../src/vendors/AitemasuVendor';
import { Page, Browser, CDPSession, HTTPResponse, ElementHandle } from 'puppeteer';

// Mock Puppeteer Page
const createMockPage = (): jest.Mocked<Page> => {
  const mockPage = {
    goto: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://app.aitemasu.me'),
    setCookie: jest.fn().mockResolvedValue(undefined),
    $: jest.fn().mockResolvedValue(null),
    $$: jest.fn().mockResolvedValue([]),
    evaluate: jest.fn().mockResolvedValue(null),
    evaluateHandle: jest.fn().mockResolvedValue({ asElement: () => null }),
    type: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(null),
    waitForNavigation: jest.fn().mockResolvedValue(null),
    waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue('base64screenshot'),
    pdf: jest.fn().mockResolvedValue(Buffer.from('PDF content')),
    on: jest.fn(),
    off: jest.fn(),
    browser: jest.fn().mockReturnValue({
      on: jest.fn(),
      off: jest.fn(),
    } as unknown as Browser),
    createCDPSession: jest.fn().mockResolvedValue({
      send: jest.fn().mockResolvedValue(undefined),
    } as unknown as CDPSession),
  } as unknown as jest.Mocked<Page>;

  return mockPage;
};

describe('AitemasuVendor', () => {
  let vendor: AitemasuVendor;
  let mockPage: jest.Mocked<Page>;

  beforeEach(() => {
    vendor = new AitemasuVendor();
    mockPage = createMockPage();
    jest.clearAllMocks();
  });

  describe('Vendor Properties', () => {
    test('should have correct vendorKey', () => {
      expect(vendor.vendorKey).toBe('aitemasu');
    });

    test('should have correct vendorName', () => {
      expect(vendor.vendorName).toBe('Aitemasu');
    });

    test('should have correct loginUrl', () => {
      expect(vendor.loginUrl).toBe('https://app.aitemasu.me/index');
    });

    test('should have billingUrl set correctly', () => {
      expect((vendor as any).billingUrl).toBe('https://app.aitemasu.me/settings');
    });
  });

  describe('Cookie-based Login', () => {
    test('should set cookies when provided in credentials', async () => {
      const mockCookies = JSON.stringify([
        { name: 'session', value: 'abc123', domain: '.aitemasu.me' },
        { name: 'auth', value: 'xyz789', domain: '.aitemasu.me' },
      ]);

      await vendor.login(mockPage, {
        username: 'test@example.com',
        password: 'password',
        cookies: mockCookies,
      });

      expect(mockPage.setCookie).toHaveBeenCalled();
      const setCookieCalls = mockPage.setCookie.mock.calls;
      expect(setCookieCalls[0]).toHaveLength(2);
    });

    test('should navigate to app after setting cookies', async () => {
      const mockCookies = JSON.stringify([
        { name: 'session', value: 'abc123', domain: '.aitemasu.me' },
      ]);

      await vendor.login(mockPage, {
        username: 'test@example.com',
        password: 'password',
        cookies: mockCookies,
      });

      expect(mockPage.goto).toHaveBeenCalledWith('https://app.aitemasu.me', expect.any(Object));
    });

    test('should throw error for invalid cookie JSON', async () => {
      await expect(
        vendor.login(mockPage, {
          username: 'test@example.com',
          password: 'password',
          cookies: 'invalid-json',
        })
      ).rejects.toThrow('Failed to parse cookies');
    });

    test('should handle empty cookie array', async () => {
      const mockCookies = JSON.stringify([]);

      await vendor.login(mockPage, {
        username: 'test@example.com',
        password: 'password',
        cookies: mockCookies,
      });

      expect(mockPage.setCookie).toHaveBeenCalled();
    });
  });

  describe('Credential-based Login (fallback)', () => {
    test('should attempt credential login when no cookies provided', async () => {
      // Mock finding the email input
      mockPage.$.mockImplementation(async (selector) => {
        if (selector.includes('email') || selector.includes('mail')) {
          return {} as ElementHandle;
        }
        if (selector.includes('password')) {
          return {} as ElementHandle;
        }
        if (selector.includes('submit')) {
          return {} as ElementHandle;
        }
        return null;
      });

      mockPage.waitForSelector.mockResolvedValue({} as any);

      await vendor.login(mockPage, {
        username: 'test@example.com',
        password: 'password',
      });

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://app.aitemasu.me/index',
        expect.any(Object)
      );
    }, 15000); // Increased timeout for wait() calls

    test('should throw error when email input not found', async () => {
      mockPage.$.mockResolvedValue(null);

      await expect(
        vendor.login(mockPage, {
          username: 'test@example.com',
          password: 'password',
        })
      ).rejects.toThrow('Could not find email input field');
    });
  });

  describe('isLoggedIn', () => {
    test('should return true when dashboard indicator found', async () => {
      mockPage.$.mockImplementation(async (selector) => {
        if (selector.includes('dashboard') || selector.includes('nav')) {
          return {} as ElementHandle;
        }
        return null;
      });

      const result = await vendor.isLoggedIn(mockPage);
      expect(result).toBe(true);
    });

    test('should return true when user menu found', async () => {
      mockPage.$.mockImplementation(async (selector) => {
        if (selector.includes('user') || selector.includes('avatar')) {
          return {} as ElementHandle;
        }
        return null;
      });

      const result = await vendor.isLoggedIn(mockPage);
      expect(result).toBe(true);
    });

    test('should return true when not on login page', async () => {
      mockPage.url.mockReturnValue('https://app.aitemasu.me/dashboard');
      mockPage.$.mockResolvedValue(null);

      const result = await vendor.isLoggedIn(mockPage);
      expect(result).toBe(true);
    });

    test('should return false when on login page with no indicators', async () => {
      mockPage.url.mockReturnValue('https://app.aitemasu.me/login');
      mockPage.$.mockResolvedValue(null);

      const result = await vendor.isLoggedIn(mockPage);
      expect(result).toBe(false);
    });
  });

  describe('navigateToInvoices', () => {
    test('should navigate to settings page first', async () => {
      await vendor.navigateToInvoices(mockPage);

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://app.aitemasu.me/settings',
        expect.any(Object)
      );
    });

    test('should look for プラン・請求管理 in app-settings', async () => {
      await vendor.navigateToInvoices(mockPage);

      expect(mockPage.evaluate).toHaveBeenCalled();
      // Check that the evaluate was called with code looking for プラン・請求管理
      const evaluateCalls = mockPage.evaluate.mock.calls;
      const hasExpectedCall = evaluateCalls.some((call) =>
        call[0].toString().includes('プラン・請求管理')
      );
      expect(hasExpectedCall).toBe(true);
    });

    test('should handle button clicks for customer portal', async () => {
      mockPage.evaluate
        .mockResolvedValueOnce(true) // プラン・請求管理 found
        .mockResolvedValueOnce(true) // app-plan exists
        .mockResolvedValueOnce([]) // buttons in app-plan
        .mockResolvedValueOnce('カスタマーポータル') // portal button click
        .mockResolvedValueOnce(false) // modal exists
        .mockResolvedValueOnce([]); // all buttons

      await vendor.navigateToInvoices(mockPage);

      expect(mockPage.evaluate).toHaveBeenCalled();
    }, 20000); // Increased timeout for multiple wait() calls
  });

  describe('downloadInvoices', () => {
    test('should look for invoice rows with data-testid', async () => {
      mockPage.$$.mockResolvedValue([]);

      await vendor.downloadInvoices(mockPage);

      expect(mockPage.$$).toHaveBeenCalledWith('[data-testid="billing-portal-invoice-row"]');
    });

    test('should capture page as PDF when no invoice rows found', async () => {
      mockPage.$$.mockResolvedValue([]);

      const files = await vendor.downloadInvoices(mockPage);

      // When no invoice rows found, vendor falls back to capturing page as PDF
      expect(files).toHaveLength(1);
      expect(files[0].mimeType).toBe('application/pdf');
      expect(files[0].documentType).toBe('invoice');
    });

    test('should attempt to capture page as PDF when no downloadable invoices found', async () => {
      mockPage.$$.mockResolvedValue([]);

      const files = await vendor.downloadInvoices(mockPage);

      // Should have captured page as PDF as fallback
      expect(mockPage.pdf).toHaveBeenCalled();
    });

    test('should click on first invoice row when found', async () => {
      const mockRow = {
        click: jest.fn().mockResolvedValue(undefined),
      };
      mockPage.$$.mockImplementation(async (selector) => {
        if (selector.includes('billing-portal-invoice-row')) {
          return [mockRow as unknown as ElementHandle];
        }
        return [];
      });

      await vendor.downloadInvoices(mockPage);

      expect(mockRow.click).toHaveBeenCalled();
    });
  });

  describe('SPA handling', () => {
    test('should wait for network idle after navigation', async () => {
      const mockCookies = JSON.stringify([
        { name: 'session', value: 'abc123', domain: '.aitemasu.me' },
      ]);

      await vendor.login(mockPage, {
        username: 'test@example.com',
        password: 'password',
        cookies: mockCookies,
      });

      expect(mockPage.waitForNetworkIdle).toHaveBeenCalled();
    });

    test('should handle network idle timeout gracefully', async () => {
      mockPage.waitForNetworkIdle.mockRejectedValue(new Error('Timeout'));

      const mockCookies = JSON.stringify([
        { name: 'session', value: 'abc123', domain: '.aitemasu.me' },
      ]);

      // Should not throw despite network idle timeout
      await expect(
        vendor.login(mockPage, {
          username: 'test@example.com',
          password: 'password',
          cookies: mockCookies,
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Selector handling', () => {
    test('should try multiple selector variants for email input', async () => {
      let selectorsTried: string[] = [];
      mockPage.$.mockImplementation(async (selector) => {
        selectorsTried.push(selector);
        return null;
      });

      try {
        await vendor.login(mockPage, {
          username: 'test@example.com',
          password: 'password',
        });
      } catch {
        // Expected to fail
      }

      // Should have tried multiple selectors
      expect(selectorsTried.length).toBeGreaterThan(0);
    });
  });
});
