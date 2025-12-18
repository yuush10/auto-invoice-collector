/**
 * Aitemasu Vendor Implementation
 * Automated login and invoice download for Aitemasu (aitemasu.me)
 *
 * Portal Information:
 * - Login URL: https://app.aitemasu.me/login
 * - Settings/Plan URL: https://app.aitemasu.me/settings/plan
 *
 * Authentication:
 * - Aitemasu uses Google OAuth (no username/password)
 * - Use cookie-based authentication by storing session cookies
 * - Credentials format: { cookies: "[{...cookie JSON...}]" }
 */
import { Page, Protocol } from 'puppeteer';
import { BaseVendor } from './BaseVendor';
import { VendorCredentials, DownloadOptions, DownloadedFile } from './types';

/**
 * Extended credentials for cookie-based auth
 */
interface AitemasuCredentials extends VendorCredentials {
  /** JSON string of cookies from a manual login session */
  cookies?: string;
}

/**
 * Aitemasu-specific selectors
 * These may need adjustment based on actual page structure
 */
const SELECTORS = {
  // Login page selectors (standard CSS only - no Playwright :has-text())
  emailInput: 'input[type="email"], input[name="email"], input[placeholder*="メール"], input[placeholder*="mail"]',
  passwordInput: 'input[type="password"], input[name="password"]',
  loginButton: 'button[type="submit"], input[type="submit"]',
  // Google OAuth login button (green button with Google icon)
  googleLoginButton: 'button[class*="google"], a[class*="google"], button[class*="social"], a[href*="google"], [class*="login"] button',

  // Post-login indicators
  dashboardIndicator: '[class*="dashboard"], [class*="home"], nav, .sidebar, header[class*="app"]',
  userMenu: '[class*="user"], [class*="avatar"], [class*="profile"]',

  // Settings/Billing page selectors
  settingsLink: 'a[href*="settings"]',
  planLink: 'a[href*="plan"], a[href*="billing"]',
  invoiceSection: '[class*="invoice"], [class*="billing"], [class*="payment"]',

  // Invoice download selectors (standard CSS only)
  invoiceList: '[class*="invoice-list"], [class*="billing-history"], table tbody tr',
  invoiceRow: 'tr, [class*="invoice-item"], [class*="billing-row"]',
  downloadButton: 'a[href*=".pdf"], a[download]',
  invoiceLink: 'a[href*="invoice"], a[href*="receipt"], a[href*="billing"]',
};

/**
 * Aitemasu vendor automation implementation
 */
export class AitemasuVendor extends BaseVendor {
  vendorKey = 'aitemasu';
  vendorName = 'Aitemasu';
  loginUrl = 'https://app.aitemasu.me/index';

  private readonly billingUrl = 'https://app.aitemasu.me/settings';

  /**
   * Login to Aitemasu portal
   *
   * Aitemasu uses Google OAuth, so we support two authentication methods:
   * 1. Cookie-based: Provide cookies from a manual login session
   * 2. Username/password: For future compatibility if they add direct login
   */
  async login(page: Page, credentials: VendorCredentials): Promise<void> {
    const aitemasuCreds = credentials as AitemasuCredentials;

    // Check if cookies are provided (preferred method for OAuth)
    if (aitemasuCreds.cookies) {
      await this.loginWithCookies(page, aitemasuCreds.cookies);
      return;
    }

    // Fall back to username/password if no cookies (may not work with OAuth)
    this.log('Warning: Aitemasu uses Google OAuth. Cookie-based auth is recommended.');
    await this.loginWithCredentials(page, credentials);
  }

  /**
   * Login using stored session cookies
   * This is the recommended method for OAuth-based services
   */
  private async loginWithCookies(page: Page, cookiesJson: string): Promise<void> {
    this.log('Starting cookie-based login');

    try {
      // Parse cookies from JSON string
      const cookies: Protocol.Network.CookieParam[] = JSON.parse(cookiesJson);
      this.log(`Setting ${cookies.length} cookies`);

      // Set cookies before navigation
      await page.setCookie(...cookies);

      // Navigate to the app (should be logged in with cookies)
      await this.navigateTo(page, 'https://app.aitemasu.me');
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
   * Login using username/password (fallback, may not work with OAuth)
   */
  private async loginWithCredentials(page: Page, credentials: VendorCredentials): Promise<void> {
    this.log('Starting credential-based login');

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
      throw new Error('Could not find email input field. Aitemasu may require OAuth - use cookie-based auth instead.');
    }
    await this.typeWithDelay(page, emailSelector, credentials.username);

    // Find and fill password field
    this.log('Filling password field');
    const passwordSelector = await this.findSelector(page, SELECTORS.passwordInput);
    if (!passwordSelector) {
      throw new Error('Could not find password input field. Aitemasu may require OAuth - use cookie-based auth instead.');
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

    this.log('Credential-based login completed');
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
   * Flow: Settings → プラン・請求管理 → カスタマーポータル → カスタマーポータルに移動
   */
  async navigateToInvoices(page: Page): Promise<void> {
    this.log('Navigating to billing section');

    // Step 1: Navigate to settings page
    await this.navigateTo(page, this.billingUrl);
    await this.waitForSpaLoad(page);
    await this.takeScreenshot(page, 'settings-page');

    // Step 2: Click on "プラン・請求管理" in app-settings
    this.log('Step 2: Looking for プラン・請求管理 in app-settings...');
    const foundPlanLink = await page.evaluate(`
      (function() {
        var container = document.querySelector('app-settings');
        if (!container) return false;
        var items = container.querySelectorAll('ion-item');
        for (var i = 0; i < items.length; i++) {
          if (items[i].textContent && items[i].textContent.includes('プラン・請求管理')) {
            items[i].click();
            return true;
          }
        }
        return false;
      })()
    `);

    if (foundPlanLink) {
      this.log('Found and clicked プラン・請求管理');
      await this.wait(2000);
      await this.waitForSpaLoad(page);
      await this.takeScreenshot(page, 'plan-billing-page');
    } else {
      this.log('Could not find プラン・請求管理 in app-settings');
    }

    // Step 3: Click on "カスタマーポータル" button in app-plan
    this.log('Step 3: Looking for カスタマーポータル button in app-plan...');

    // Debug: Check if app-plan exists
    const appPlanExists = await page.evaluate(`!!document.querySelector('app-plan')`);
    this.log(`app-plan exists: ${appPlanExists}`);

    // Debug: List all buttons/items in app-plan
    const buttonsInPlan = await page.evaluate(`
      (function() {
        var container = document.querySelector('app-plan');
        if (!container) return [];
        var buttons = container.querySelectorAll('ion-button, ion-item');
        return Array.from(buttons).map(function(b) { return b.textContent.trim().substring(0, 50); });
      })()
    `) as string[];
    this.log(`Buttons in app-plan: ${JSON.stringify(buttonsInPlan)}`);

    const foundPortalButton = await page.evaluate(`
      (function() {
        var container = document.querySelector('app-plan');
        if (!container) return false;
        // Look specifically for ion-button with カスタマーポータル (not the description text)
        var buttons = container.querySelectorAll('ion-button');
        for (var i = 0; i < buttons.length; i++) {
          var text = buttons[i].textContent.trim();
          // Match button that is exactly or primarily "カスタマーポータル"
          if (text === 'カスタマーポータル' || text.endsWith('カスタマーポータル')) {
            console.log('Clicking button:', text);
            buttons[i].click();
            return text;
          }
        }
        return false;
      })()
    `);

    if (foundPortalButton) {
      this.log('Found and clicked カスタマーポータル button');
      await this.wait(3000); // Wait longer for modal to appear
      await this.waitForSpaLoad(page);
      await this.takeScreenshot(page, 'after-portal-click');
    } else {
      this.log('Could not find カスタマーポータル button in app-plan');
    }

    // Step 4: Click on "カスタマーポータルに移動" in the modal
    this.log('Step 4: Looking for カスタマーポータルに移動 in modal...');

    // Debug: Check if modal exists
    const modalExists = await page.evaluate(`!!document.querySelector('app-customer-portal-modal')`);
    this.log(`app-customer-portal-modal exists: ${modalExists}`);

    // Debug: List all ion-buttons on page
    const allButtons = await page.evaluate(`
      (function() {
        var buttons = document.querySelectorAll('ion-button');
        return Array.from(buttons).map(function(b) { return b.textContent.trim().substring(0, 50); });
      })()
    `) as string[];
    this.log(`All ion-buttons on page: ${JSON.stringify(allButtons)}`);

    // Set up a listener for new pages BEFORE clicking the button
    const browser = page.browser();
    let newPagePromise: Promise<Page> | null = null;

    if (browser) {
      newPagePromise = new Promise<Page>((resolve) => {
        const handler = (target: any) => {
          if (target.type() === 'page') {
            browser.off('targetcreated', handler);
            target.page().then(resolve);
          }
        };
        browser.on('targetcreated', handler);
        // Timeout after 15 seconds
        setTimeout(() => {
          browser.off('targetcreated', handler);
          resolve(null as any);
        }, 15000);
      });
    }

    // Find the button element (don't click yet)
    let foundModalButton = false;

    // Try to find the button in modal using XPath for text matching
    const buttonHandle = await page.evaluateHandle(`
      (function() {
        // First try in modal
        var modal = document.querySelector('app-customer-portal-modal');
        if (modal) {
          var buttons = modal.querySelectorAll('ion-button');
          for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent && buttons[i].textContent.includes('カスタマーポータルに移動')) {
              return buttons[i];
            }
          }
        }
        // Fallback: try any button on page
        var allBtns = document.querySelectorAll('ion-button');
        for (var i = 0; i < allBtns.length; i++) {
          if (allBtns[i].textContent && allBtns[i].textContent.includes('カスタマーポータルに移動')) {
            return allBtns[i];
          }
        }
        return null;
      })()
    `);

    if (buttonHandle) {
      const element = buttonHandle.asElement();
      if (element) {
        this.log('Found カスタマーポータルに移動 button, clicking with Puppeteer...');
        // Use Puppeteer's click method which handles popups better
        await element.click();
        foundModalButton = true;
      }
    }

    if (foundModalButton) {
      this.log(`Found and clicked カスタマーポータルに移動 (from ${foundModalButton})`);
      this.log('Waiting for Stripe billing portal...');

      const originalUrl = page.url();

      // First, wait for any new tab to be created (with short timeout)
      let newPage: Page | null = null;
      if (newPagePromise) {
        try {
          const result = await Promise.race([
            newPagePromise,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
          ]);
          newPage = result as Page | null;
        } catch {
          // Ignore errors
        }
      }

      if (newPage) {
        this.log(`New tab detected, waiting for it to load...`);

        // Wait for the new page to finish loading
        try {
          await newPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 });
        } catch {
          // Navigation might have already completed
        }

        const newUrl = newPage.url();
        this.log(`New tab loaded: ${newUrl}`);

        if (newUrl && newUrl !== 'about:blank') {
          await newPage.bringToFront();
          await this.wait(2000);
          await this.takeScreenshot(newPage, 'billing-portal-new-tab');
          (this as any)._billingPortalPage = newPage;
        }
      } else {
        // No new tab - check if the page navigated in the same window
        this.log('No new tab detected, waiting for navigation in current page...');

        try {
          // Wait for navigation in the current page
          await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
        } catch {
          // Navigation might not happen if it's an iframe or popup
        }

        await this.wait(3000);
        const currentUrl = page.url();
        this.log(`Current URL after wait: ${currentUrl}`);

        if (currentUrl !== originalUrl) {
          this.log(`Page navigated to: ${currentUrl}`);
          await this.takeScreenshot(page, 'billing-portal-same-tab');
        } else {
          // Check if there's an iframe with Stripe content
          this.log('URL did not change, checking for iframes...');
          const frameUrls = await page.evaluate(`
            (function() {
              var frames = document.querySelectorAll('iframe');
              return Array.from(frames).map(function(f) { return f.src; });
            })()
          `) as string[];
          this.log(`Iframes on page: ${JSON.stringify(frameUrls)}`);
        }
      }
    } else {
      this.log('Could not find カスタマーポータルに移動 button');
      await this.takeScreenshot(page, 'modal-not-found');
    }

    this.log('Navigation to billing section completed');
    this.log(`Current URL: ${page.url()}`);
  }

  /**
   * Download invoices from the billing section (Stripe Customer Portal)
   */
  async downloadInvoices(page: Page, options?: DownloadOptions): Promise<DownloadedFile[]> {
    this.log('Starting invoice download from billing portal');
    const files: DownloadedFile[] = [];

    // Use the billing portal page if it was opened in a new tab
    const billingPage = (this as any)._billingPortalPage || page;
    this.log(`Using page with URL: ${billingPage.url()}`);

    // Take screenshot of billing portal
    await this.takeScreenshot(billingPage, 'before-download');

    // Step 5: Click on the first invoice row using data-testid
    this.log('Step 5: Looking for invoice rows with data-testid="billing-portal-invoice-row"...');
    const invoiceRows = await billingPage.$$('[data-testid="billing-portal-invoice-row"]');
    this.log(`Found ${invoiceRows.length} invoice rows`);

    if (invoiceRows.length > 0) {
      // Click on the first invoice row to open invoice details
      this.log('Clicking on first invoice row...');
      await invoiceRows[0].click();
      await this.wait(3000);
      await this.waitForSpaLoad(billingPage);
      await this.takeScreenshot(billingPage, 'invoice-detail');

      // Look for invoice links (invoice.stripe.com URLs)
      this.log('Looking for invoice links...');
      const invoiceLinks = await billingPage.$$('a[href*="invoice.stripe.com"]');
      this.log(`Found ${invoiceLinks.length} invoice links`);

      if (invoiceLinks.length > 0) {
        // Get the first invoice URL and navigate to it
        const invoiceUrl = await invoiceLinks[0].evaluate((el: any) => el.getAttribute('href'));
        this.log(`Navigating to invoice page: ${invoiceUrl}`);
        await billingPage.goto(invoiceUrl, { waitUntil: 'networkidle0' });
        await this.wait(2000);
        await this.takeScreenshot(billingPage, 'invoice-page');

        // Look for the download button (請求書をダウンロード or 領収書をダウンロード)
        this.log('Looking for download button on invoice page...');
        const downloadButton = await billingPage.$('[data-testid="download-invoice-receipt-pdf-button"]');

        if (downloadButton) {
          this.log('Found download button, clicking...');

          // Intercept the response - clicking returns JSON with file_url
          const file = await this.interceptDownload(billingPage, async () => {
            await downloadButton.click();
          }, { timeout: 10000 });

          if (file) {
            // Check if the "file" is actually JSON with file_url
            try {
              const content = Buffer.from(file.base64, 'base64').toString('utf-8');
              if (content.startsWith('{') && content.includes('file_url')) {
                const json = JSON.parse(content);
                if (json.file_url) {
                  this.log(`Response contains file_url: ${json.file_url}`);

                  // Set up CDP to capture the downloaded file
                  const fs = await import('fs');
                  const path = await import('path');
                  const os = await import('os');

                  // Create temp download directory
                  const downloadDir = path.join(os.tmpdir(), `aitemasu-download-${Date.now()}`);
                  fs.mkdirSync(downloadDir, { recursive: true });

                  // Get CDP session
                  const client = await billingPage.createCDPSession();

                  // Set download behavior to save files
                  await client.send('Page.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath: downloadDir,
                  });

                  this.log(`Download directory: ${downloadDir}`);

                  // Navigate to the PDF URL - this will trigger download
                  try {
                    await billingPage.goto(json.file_url, { timeout: 30000 });
                  } catch {
                    // Navigation might be aborted when download starts - that's expected
                  }

                  // Wait for download to complete
                  await this.wait(5000);

                  // Check if file was downloaded
                  const files_in_dir = fs.readdirSync(downloadDir);
                  this.log(`Files in download dir: ${JSON.stringify(files_in_dir)}`);

                  if (files_in_dir.length > 0) {
                    const downloadedFile = files_in_dir[0];
                    const filePath = path.join(downloadDir, downloadedFile);
                    const buffer = fs.readFileSync(filePath);
                    const base64 = buffer.toString('base64');

                    // Generate a proper filename
                    const dateStr = new Date().toISOString().slice(0, 10);
                    files.push({
                      filename: `aitemasu-invoice-${dateStr}.pdf`,
                      base64,
                      mimeType: 'application/pdf',
                      documentType: 'invoice',
                      fileSize: buffer.length,
                    });
                    this.log(`Downloaded PDF: aitemasu-invoice-${dateStr}.pdf (${buffer.length} bytes)`);

                    // Cleanup
                    fs.unlinkSync(filePath);
                    fs.rmdirSync(downloadDir);
                  } else {
                    this.log('No file found in download directory');
                    // Cleanup
                    fs.rmdirSync(downloadDir);
                  }
                }
                // Don't fall through to add the JSON response as a file
              } else {
                // It's a direct PDF download
                file.documentType = 'invoice';
                files.push(file);
                this.log(`Downloaded: ${file.filename}`);
              }
            } catch (error) {
              this.log(`Error processing download response: ${error}`, 'warn');
              // If parsing fails, assume it's a PDF
              file.documentType = 'invoice';
              files.push(file);
              this.log(`Downloaded (fallback): ${file.filename}`);
            }
          } else {
            this.log('Download interception failed');
          }
        } else {
          this.log('Download button not found, listing all buttons...');
          const allButtons = await billingPage.evaluate(`
            (function() {
              var buttons = document.querySelectorAll('button');
              return Array.from(buttons).map(function(b) {
                return { text: b.textContent.trim().substring(0, 50), testid: b.getAttribute('data-testid') };
              });
            })()
          `) as Array<{ text: string; testid: string | null }>;
          this.log(`All buttons on invoice page: ${JSON.stringify(allButtons)}`);
        }
      }
    }

    // If no files downloaded yet, try looking for direct PDF links on the page
    if (files.length === 0) {
      this.log('No invoice downloaded from row, looking for direct PDF links...');

      const pdfLinks = await billingPage.$$('a[href*=".pdf"], a[download]');
      this.log(`Found ${pdfLinks.length} direct PDF links`);

      for (const link of pdfLinks) {
        try {
          const href = await link.evaluate((el: any) => el.getAttribute('href'));
          const text = await link.evaluate((el: any) => el.textContent);

          if (href) {
            this.log(`Attempting to download: ${href}`);

            const file = await this.interceptDownload(billingPage, async () => {
              await link.click();
            });

            if (file) {
              file.documentType = this.detectDocumentType(file.filename);
              file.billingMonth = this.extractBillingMonth(text || file.filename);
              files.push(file);
              this.log(`Downloaded: ${file.filename}`);
              break; // Just download first one
            }
          }
        } catch (error) {
          this.log(`Error downloading file: ${error}`, 'warn');
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
        const pagePdf = await this.pageToPdf(billingPage);
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
