/**
 * Canva Vendor Implementation
 * Automated login and invoice download for Canva (canva.com)
 *
 * Portal Information:
 * - Login URL: https://www.canva.com/login
 * - Billing URL: https://www.canva.com/settings/billing
 *
 * Authentication:
 * - Canva uses Google OAuth (no username/password)
 * - Use cookie-based authentication by storing session cookies
 * - Credentials format: { cookies: "[{...cookie JSON...}]" }
 */
import { Page, Protocol } from 'puppeteer';
import { BaseVendor } from './BaseVendor';
import { VendorCredentials, DownloadOptions, DownloadedFile } from './types';

/**
 * Extended credentials for cookie-based auth
 */
interface CanvaCredentials extends VendorCredentials {
  /** JSON string of cookies from a manual login session */
  cookies?: string;
}

/**
 * Canva-specific selectors
 * These may need adjustment based on actual page structure
 */
const SELECTORS = {
  // Login page selectors
  googleLoginButton: '[data-testid*="google"], button[class*="google"], a[href*="google"]',

  // Post-login indicators (Canva uses React SPA)
  dashboardIndicator: '[class*="home"], [class*="dashboard"], [data-testid="sidebar"], nav[class*="nav"]',
  userMenu: '[class*="avatar"], [class*="profile"], [class*="user-menu"], [data-testid="user-menu"]',
  sidebarNav: '[class*="sidebar"], [role="navigation"]',

  // Billing page selectors
  billingHistory: '[class*="billing-history"], [class*="payment-history"], [class*="invoice-list"]',
  invoiceRow: '[class*="invoice"], [class*="payment"], tr[class*="billing"]',
  downloadInvoiceButton: 'button:has-text("Download invoice"), a:has-text("Download invoice"), [data-testid*="download"]',
  viewReceiptLink: 'a:has-text("View receipt"), button:has-text("View receipt")',
};

/**
 * Canva vendor automation implementation
 */
export class CanvaVendor extends BaseVendor {
  vendorKey = 'canva';
  vendorName = 'Canva';
  loginUrl = 'https://www.canva.com/login';

  private readonly billingUrl = 'https://www.canva.com/settings/billing';

  /**
   * Login to Canva portal
   *
   * Canva uses Google OAuth, so we support cookie-based authentication only.
   * The cookies should be captured via the manual login endpoint.
   */
  async login(page: Page, credentials: VendorCredentials): Promise<void> {
    const canvaCreds = credentials as CanvaCredentials;

    // Check if cookies are provided (required for OAuth)
    if (canvaCreds.cookies) {
      await this.loginWithCookies(page, canvaCreds.cookies);
      return;
    }

    // Canva requires Google OAuth - cannot use username/password
    throw new Error('Canva uses Google OAuth. Cookie-based auth is required. Use POST /download/login to capture cookies first.');
  }

  /**
   * Login using stored session cookies
   * This is the required method for OAuth-based services
   */
  private async loginWithCookies(page: Page, cookiesJson: string): Promise<void> {
    this.log('Starting cookie-based login');

    try {
      // Parse cookies from JSON string
      const cookies: Protocol.Network.CookieParam[] = JSON.parse(cookiesJson);
      this.log(`Setting ${cookies.length} cookies`);

      // Set cookies before navigation
      await page.setCookie(...cookies);

      // Navigate to Canva (should be logged in with cookies)
      await this.navigateTo(page, 'https://www.canva.com');
      await this.waitForSpaLoad(page);

      // Take screenshot to verify login
      await this.takeScreenshot(page, 'after-cookie-login');

      this.log('Cookie-based login completed');
    } catch (error) {
      this.log(`Cookie parsing failed: ${error}`, 'error');
      throw new Error(`Failed to parse cookies: ${error}`);
    }
  }

  /**
   * Check if successfully logged in
   */
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      // Check for dashboard indicators
      const dashboardExists = await this.elementExists(page, SELECTORS.dashboardIndicator);
      if (dashboardExists) {
        this.log('Dashboard indicator found - logged in');
        return true;
      }

      // Check for user menu/avatar
      const userMenuExists = await this.elementExists(page, SELECTORS.userMenu);
      if (userMenuExists) {
        this.log('User menu found - logged in');
        return true;
      }

      // Check for sidebar navigation (logged-in users see this)
      const sidebarExists = await this.elementExists(page, SELECTORS.sidebarNav);
      if (sidebarExists) {
        this.log('Sidebar navigation found - logged in');
        return true;
      }

      // Check if we're no longer on the login page
      const currentUrl = page.url();
      if (!currentUrl.includes('/login') && !currentUrl.includes('accounts.google.com')) {
        this.log(`No longer on login page (${currentUrl}) - likely logged in`);
        return true;
      }

      this.log('Login verification failed');
      return false;
    } catch (error) {
      this.log(`Error checking login status: ${error}`, 'error');
      return false;
    }
  }

  /**
   * Navigate to the invoices/billing section
   */
  async navigateToInvoices(page: Page): Promise<void> {
    this.log('Navigating to billing section');

    // Navigate directly to billing page
    await this.navigateTo(page, this.billingUrl);
    await this.waitForSpaLoad(page);
    await this.takeScreenshot(page, 'billing-page');

    // Wait for billing history to load
    this.log('Waiting for billing history to load...');
    try {
      // Try multiple selectors for billing content
      await Promise.race([
        page.waitForSelector(SELECTORS.billingHistory, { timeout: 10000 }),
        page.waitForSelector(SELECTORS.invoiceRow, { timeout: 10000 }),
        page.waitForSelector('[class*="billing"]', { timeout: 10000 }),
      ]);
      this.log('Billing content loaded');
    } catch {
      this.log('Billing history selector not found, page may use different structure');
    }

    // Debug: List all main elements on the page
    const pageStructure = await page.evaluate(`
      (function() {
        var main = document.querySelector('main') || document.body;
        var elements = main.querySelectorAll('h1, h2, h3, button, a[href*="invoice"], a[href*="download"]');
        return Array.from(elements).slice(0, 20).map(function(el) {
          return { tag: el.tagName, text: el.textContent.trim().substring(0, 50), href: el.getAttribute('href') };
        });
      })()
    `) as Array<{ tag: string; text: string; href: string | null }>;
    this.log(`Page structure: ${JSON.stringify(pageStructure)}`);

    this.log('Navigation to billing section completed');
    this.log(`Current URL: ${page.url()}`);
  }

  /**
   * Download invoices from the billing section
   */
  async downloadInvoices(page: Page, options?: DownloadOptions): Promise<DownloadedFile[]> {
    this.log('Starting invoice download');
    const files: DownloadedFile[] = [];

    // Take screenshot of billing page
    await this.takeScreenshot(page, 'before-download');

    // Look for download buttons or invoice links
    this.log('Looking for invoice download elements...');

    // Strategy 1: Look for "Download invoice" buttons
    const downloadButtons = await this.findDownloadButtons(page);
    if (downloadButtons.length > 0) {
      this.log(`Found ${downloadButtons.length} download button(s)`);

      for (const button of downloadButtons) {
        if (options?.limit && files.length >= options.limit) {
          break;
        }

        try {
          const file = await this.downloadFromButton(page, button);
          if (file) {
            files.push(file);
          }
        } catch (error) {
          this.log(`Error downloading from button: ${error}`, 'warn');
        }
      }
    }

    // Strategy 2: Look for invoice rows with view/download links
    if (files.length === 0) {
      this.log('No download buttons found, looking for invoice rows...');
      const invoiceFiles = await this.downloadFromInvoiceRows(page, options);
      files.push(...invoiceFiles);
    }

    // Strategy 3: Look for direct PDF links
    if (files.length === 0) {
      this.log('Looking for direct PDF links...');
      const pdfFiles = await this.downloadFromPdfLinks(page, options);
      files.push(...pdfFiles);
    }

    // Strategy 4: Capture page as PDF (fallback)
    if (files.length === 0) {
      this.log('No downloadable invoices found, capturing page as PDF');
      try {
        const pagePdf = await this.pageToPdf(page);
        pagePdf.filename = `canva-billing-${new Date().toISOString().slice(0, 10)}.pdf`;
        pagePdf.documentType = 'invoice';
        files.push(pagePdf);
        this.log('Captured billing page as PDF');
      } catch (error) {
        this.log(`Error capturing page as PDF: ${error}`, 'error');
      }
    }

    this.log(`Download complete: ${files.length} file(s)`);
    return files;
  }

  /**
   * Find download buttons on the page
   */
  private async findDownloadButtons(page: Page): Promise<any[]> {
    // Look for buttons or links with download-related text
    const buttons = await page.$$eval(
      'button, a',
      (elements) => {
        const downloadKeywords = ['download invoice', 'download receipt', 'view invoice', 'view receipt'];
        return elements
          .filter((el) => {
            const text = (el.textContent || '').toLowerCase();
            return downloadKeywords.some((keyword) => text.includes(keyword));
          })
          .map((el, index) => ({
            index,
            text: (el.textContent || '').trim().substring(0, 50),
            tag: el.tagName,
          }));
      }
    );

    this.log(`Found download-related elements: ${JSON.stringify(buttons)}`);
    return buttons;
  }

  /**
   * Download PDF from a button click
   */
  private async downloadFromButton(page: Page, buttonInfo: { index: number; text: string; tag: string }): Promise<DownloadedFile | null> {
    this.log(`Clicking download button: ${buttonInfo.text}`);

    // Re-find the button by index
    const selector = buttonInfo.tag.toLowerCase();
    const elements = await page.$$(selector);

    // Find the element that matches our text
    for (const element of elements) {
      const text = await element.evaluate((el) => (el.textContent || '').toLowerCase());
      if (text.includes('download') || text.includes('invoice') || text.includes('receipt')) {
        // Try to intercept the download
        const file = await this.interceptDownload(page, async () => {
          await element.click();
        }, { timeout: 15000 });

        if (file) {
          file.documentType = this.detectDocumentType(file.filename);
          this.log(`Downloaded: ${file.filename} (${file.fileSize} bytes)`);
          return file;
        }
      }
    }

    return null;
  }

  /**
   * Download invoices from invoice row elements
   */
  private async downloadFromInvoiceRows(page: Page, options?: DownloadOptions): Promise<DownloadedFile[]> {
    const files: DownloadedFile[] = [];

    // Look for rows that might contain invoice information
    const rows = await page.$$('[class*="invoice"], [class*="payment"], [class*="transaction"], tr');
    this.log(`Found ${rows.length} potential invoice rows`);

    for (const row of rows) {
      if (options?.limit && files.length >= options.limit) {
        break;
      }

      try {
        // Look for a download link within the row
        const downloadLink = await row.$('a[href*="download"], a[href*="invoice"], a[href*=".pdf"]');
        if (downloadLink) {
          const file = await this.interceptDownload(page, async () => {
            await downloadLink.click();
          }, { timeout: 10000 });

          if (file) {
            file.documentType = 'invoice';
            files.push(file);
            this.log(`Downloaded from row: ${file.filename}`);
          }
        }
      } catch (error) {
        this.log(`Error processing row: ${error}`, 'warn');
      }
    }

    return files;
  }

  /**
   * Download from direct PDF links
   */
  private async downloadFromPdfLinks(page: Page, options?: DownloadOptions): Promise<DownloadedFile[]> {
    const files: DownloadedFile[] = [];

    const pdfLinks = await page.$$('a[href*=".pdf"], a[download]');
    this.log(`Found ${pdfLinks.length} direct PDF links`);

    for (const link of pdfLinks) {
      if (options?.limit && files.length >= options.limit) {
        break;
      }

      try {
        const href = await link.evaluate((el) => el.getAttribute('href'));
        this.log(`Attempting to download: ${href}`);

        const file = await this.interceptDownload(page, async () => {
          await link.click();
        }, { timeout: 10000 });

        if (file) {
          file.documentType = this.detectDocumentType(file.filename);
          files.push(file);
          this.log(`Downloaded: ${file.filename}`);
        }
      } catch (error) {
        this.log(`Error downloading PDF: ${error}`, 'warn');
      }
    }

    return files;
  }

  /**
   * Wait for SPA to finish loading
   */
  private async waitForSpaLoad(page: Page): Promise<void> {
    try {
      // Wait for network to be idle
      await page.waitForNetworkIdle({ timeout: 10000 });
    } catch {
      // Network might not become completely idle in some SPAs
    }

    // Additional wait for JavaScript rendering
    await this.wait(1500);

    // Wait for any loading indicators to disappear
    try {
      await page.waitForFunction(
        `!document.body.textContent.includes('Loading')`,
        { timeout: 5000 }
      );
    } catch {
      // Loading indicator might not exist or already gone
    }
  }
}
