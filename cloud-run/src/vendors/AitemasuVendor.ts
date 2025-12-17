/**
 * Aitemasu Vendor Implementation
 * Automated login and invoice download for Aitemasu (aitemasu.me)
 *
 * Portal Information:
 * - Login URL: https://app.aitemasu.me/login
 * - Settings/Plan URL: https://app.aitemasu.me/settings/plan
 */
import { Page } from 'puppeteer';
import { BaseVendor } from './BaseVendor';
import { VendorCredentials, DownloadOptions, DownloadedFile } from './types';

/**
 * Aitemasu-specific selectors
 * These may need adjustment based on actual page structure
 */
const SELECTORS = {
  // Login page selectors
  emailInput: 'input[type="email"], input[name="email"], input[placeholder*="メール"], input[placeholder*="mail"]',
  passwordInput: 'input[type="password"], input[name="password"]',
  loginButton: 'button[type="submit"], button:has-text("ログイン"), button:has-text("Login"), input[type="submit"]',

  // Post-login indicators
  dashboardIndicator: '[class*="dashboard"], [class*="home"], nav, .sidebar, header[class*="app"]',
  userMenu: '[class*="user"], [class*="avatar"], [class*="profile"]',

  // Settings/Billing page selectors
  settingsLink: 'a[href*="settings"], a:has-text("設定"), a:has-text("Settings")',
  planLink: 'a[href*="plan"], a[href*="billing"], a:has-text("プラン"), a:has-text("Plan")',
  invoiceSection: '[class*="invoice"], [class*="billing"], [class*="payment"]',

  // Invoice download selectors
  invoiceList: '[class*="invoice-list"], [class*="billing-history"], table tbody tr',
  invoiceRow: 'tr, [class*="invoice-item"], [class*="billing-row"]',
  downloadButton: 'a[href*=".pdf"], a[download], button:has-text("ダウンロード"), button:has-text("Download"), a:has-text("PDF")',
  invoiceLink: 'a[href*="invoice"], a[href*="receipt"], a[href*="billing"]',
};

/**
 * Aitemasu vendor automation implementation
 */
export class AitemasuVendor extends BaseVendor {
  vendorKey = 'aitemasu';
  vendorName = 'Aitemasu';
  loginUrl = 'https://app.aitemasu.me/login';

  private readonly billingUrl = 'https://app.aitemasu.me/settings/plan';

  /**
   * Login to Aitemasu portal
   */
  async login(page: Page, credentials: VendorCredentials): Promise<void> {
    this.log('Starting login process');

    // Navigate to login page
    await this.navigateTo(page, this.loginUrl);

    // Wait for the page to fully load (SPA)
    await this.waitForSpaLoad(page);

    // Take screenshot before login
    await this.takeScreenshot(page, 'before-login');

    // Find and fill email field
    this.log('Filling email field');
    const emailSelector = await this.findSelector(page, SELECTORS.emailInput);
    if (!emailSelector) {
      throw new Error('Could not find email input field');
    }
    await this.typeWithDelay(page, emailSelector, credentials.username);

    // Find and fill password field
    this.log('Filling password field');
    const passwordSelector = await this.findSelector(page, SELECTORS.passwordInput);
    if (!passwordSelector) {
      throw new Error('Could not find password input field');
    }
    await this.typeWithDelay(page, passwordSelector, credentials.password);

    // Take screenshot after filling form
    await this.takeScreenshot(page, 'form-filled');

    // Find and click login button
    this.log('Clicking login button');
    const loginButtonSelector = await this.findSelector(page, SELECTORS.loginButton);
    if (!loginButtonSelector) {
      throw new Error('Could not find login button');
    }

    // Click login and wait for navigation
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {
        // Some SPAs don't trigger navigation event
        this.log('Navigation event not triggered, checking login status');
      }),
      page.click(loginButtonSelector),
    ]);

    // Wait for SPA to load after login
    await this.waitForSpaLoad(page);
    await this.wait(2000);

    // Take screenshot after login attempt
    await this.takeScreenshot(page, 'after-login');

    this.log('Login process completed');
  }

  /**
   * Check if successfully logged in
   */
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      // Check for dashboard indicators
      const dashboardExists = await this.findSelector(page, SELECTORS.dashboardIndicator);
      if (dashboardExists) {
        this.log('Dashboard indicator found - logged in');
        return true;
      }

      // Check for user menu
      const userMenuExists = await this.findSelector(page, SELECTORS.userMenu);
      if (userMenuExists) {
        this.log('User menu found - logged in');
        return true;
      }

      // Check if we're no longer on the login page
      const currentUrl = page.url();
      if (!currentUrl.includes('/login')) {
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

    // Try direct navigation to billing URL first
    await this.navigateTo(page, this.billingUrl);
    await this.waitForSpaLoad(page);

    // Check if we're on the billing page
    const currentUrl = page.url();
    if (currentUrl.includes('settings') || currentUrl.includes('plan') || currentUrl.includes('billing')) {
      this.log('Successfully navigated to billing section');
      await this.takeScreenshot(page, 'billing-page');
      return;
    }

    // If direct navigation failed, try clicking through settings
    this.log('Direct navigation failed, trying menu navigation');

    const settingsLink = await this.findSelector(page, SELECTORS.settingsLink);
    if (settingsLink) {
      await page.click(settingsLink);
      await this.wait(1500);
    }

    const planLink = await this.findSelector(page, SELECTORS.planLink);
    if (planLink) {
      await page.click(planLink);
      await this.wait(1500);
    }

    await this.takeScreenshot(page, 'billing-page');
    this.log('Navigation to billing section completed');
  }

  /**
   * Download invoices from the billing section
   */
  async downloadInvoices(page: Page, options?: DownloadOptions): Promise<DownloadedFile[]> {
    this.log('Starting invoice download');
    const files: DownloadedFile[] = [];

    // Take screenshot of billing page
    await this.takeScreenshot(page, 'before-download');

    // Try to find invoice section
    const invoiceSection = await this.findSelector(page, SELECTORS.invoiceSection);
    if (invoiceSection) {
      this.log('Found invoice section');
    }

    // Look for direct PDF download links
    const pdfLinks = await page.$$('a[href*=".pdf"], a[download]');
    this.log(`Found ${pdfLinks.length} potential PDF links`);

    for (const link of pdfLinks) {
      try {
        const href = await link.evaluate(el => el.getAttribute('href'));
        const text = await link.evaluate(el => el.textContent);

        if (href) {
          this.log(`Attempting to download: ${href}`);

          // Intercept the download
          const file = await this.interceptDownload(page, async () => {
            await link.click();
          });

          if (file) {
            file.documentType = this.detectDocumentType(file.filename);
            file.billingMonth = this.extractBillingMonth(text || file.filename);
            files.push(file);
            this.log(`Downloaded: ${file.filename}`);
          }
        }
      } catch (error) {
        this.log(`Error downloading file: ${error}`, 'warn');
      }

      // Apply limit if specified
      if (options?.limit && files.length >= options.limit) {
        this.log(`Reached download limit of ${options.limit}`);
        break;
      }
    }

    // If no PDF links found, look for invoice rows with download buttons
    if (files.length === 0) {
      this.log('No direct PDF links found, looking for invoice rows');

      const invoiceRows = await page.$$(SELECTORS.invoiceRow);
      this.log(`Found ${invoiceRows.length} invoice rows`);

      for (const row of invoiceRows) {
        try {
          const downloadBtn = await row.$(SELECTORS.downloadButton);
          if (downloadBtn) {
            const file = await this.interceptDownload(page, async () => {
              await downloadBtn.click();
            });

            if (file) {
              // Try to extract date from row
              const rowText = await row.evaluate(el => el.textContent);
              file.documentType = this.detectDocumentType(file.filename);
              file.billingMonth = this.extractBillingMonth(rowText || file.filename);
              files.push(file);
              this.log(`Downloaded: ${file.filename}`);
            }
          }
        } catch (error) {
          this.log(`Error processing invoice row: ${error}`, 'warn');
        }

        if (options?.limit && files.length >= options.limit) {
          break;
        }
      }
    }

    // If still no files, try to capture the billing page as PDF
    if (files.length === 0) {
      this.log('No downloadable invoices found, capturing page as PDF');

      try {
        const pagePdf = await this.pageToPdf(page);
        pagePdf.filename = `aitemasu-billing-${new Date().toISOString().slice(0, 10)}.pdf`;
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
    await this.wait(1000);

    // Wait for any loading indicators to disappear
    try {
      // The function runs in browser context where 'document' is available
      await page.waitForFunction(
        `!document.body.textContent.includes('Loading')`,
        { timeout: 5000 }
      );
    } catch {
      // Loading indicator might not exist or already gone
    }
  }

  /**
   * Find a working selector from a comma-separated list
   */
  private async findSelector(page: Page, selectorList: string): Promise<string | null> {
    const selectors = selectorList.split(',').map(s => s.trim());

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          return selector;
        }
      } catch {
        // Selector might be invalid, continue to next
      }
    }

    return null;
  }
}
