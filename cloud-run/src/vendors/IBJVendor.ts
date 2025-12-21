/**
 * IBJ Vendor Implementation
 * Automated login and invoice download for IBJ (ibjapan.com)
 *
 * Portal Information:
 * - Login URL: https://www.ibjapan.com/div/logins
 * - Vendor Key: ibj
 *
 * Authentication Flow (Hybrid Manual/Automated with OTP):
 * IBJ uses reCAPTCHA Enterprise, so we use a hybrid approach:
 *
 * MANUAL STEPS (user interaction required):
 * 1. Navigate to login page (automated)
 * 2. User enters credentials manually
 * 3. User solves reCAPTCHA
 * 4. User clicks login button
 *
 * AUTOMATED STEPS (after user logs in):
 * 5. Detect OTP request page, click submit to send OTP email
 * 6. Fetch OTP from Gmail API
 * 7. Enter OTP code automatically
 * 8. Submit OTP for verification
 *
 * Note: IBJ does not support cookie-based session persistence.
 * Each login requires fresh credentials and OTP verification.
 */
import { Page } from 'puppeteer';
import { BaseVendor } from './BaseVendor';
import { VendorCredentials, DownloadOptions, DownloadedFile } from './types';
import { GmailOtpService, IBJ_OTP_CONFIG } from '../services/GmailOtpService';

/**
 * Extended credentials for IBJ (includes OTP email address)
 */
interface IBJCredentials extends VendorCredentials {
  /** Email address where OTP will be sent (e.g., info@executive-bridal.com) */
  otpEmail?: string;
}

/**
 * IBJ-specific selectors
 */
const SELECTORS = {
  // Login page
  loginUserId: 'input#login_user_cd',
  loginPassword: 'input#login_password',
  loginButton: 'a#login',

  // OTP request page
  otpSendButton: 'input[type="submit"][value="送信"]',

  // OTP verification page
  otpInput: 'input#verification_code',
  otpSubmitButton: 'input[type="submit"][value="送信"]',

  // Post-login - My page menu
  myPageMenu: 'div#open_my_page',
  myPageMenuContent: '.agency-gnav_mypage_menu_content',

  // Business management section
  businessManagement: '.agency-gnav_mypage_menu_content__lists_business_management',
  businessManagementTitle: '.agency-gnav_mypage_menu_content__lists_business_management_title_left h3',

  // Invoice download link
  invoiceDownloadLink: 'a[href*="agency_billing"]',

  // Invoice download page
  targetMonthSelect: 'select#target_ym',
  downloadButton: 'input[type="submit"][value="ダウンロード"]',

  // Login verification (elements that indicate successful login)
  userNameDisplay: '.agency-gnav_mypage_names_username',
  agencyNameDisplay: '.agency-gnav_mypage_names_agency_name',
};

/**
 * IBJ vendor automation implementation
 */
export class IBJVendor extends BaseVendor {
  vendorKey = 'ibj';
  vendorName = 'IBJ';
  loginUrl = 'https://www.ibjapan.com/div/logins';

  private gmailOtpService: GmailOtpService | null = null;
  private readonly defaultOtpEmail = 'info@executive-bridal.com';

  /**
   * Login to IBJ portal with OTP verification (Hybrid Manual/Automated)
   *
   * IBJ uses reCAPTCHA Enterprise, requiring manual user interaction for:
   * - Entering credentials
   * - Solving CAPTCHA
   * - Clicking login button
   *
   * Automation handles:
   * - Navigation to login page
   * - Detecting when user has logged in
   * - OTP request and entry
   * - Invoice download
   */
  async login(page: Page, credentials: VendorCredentials): Promise<void> {
    const ibjCreds = credentials as IBJCredentials;
    const otpEmail = ibjCreds.otpEmail || this.defaultOtpEmail;

    this.log('Starting IBJ login (Hybrid Manual/Automated mode)');
    this.log(`OTP will be sent to: ${otpEmail}`);
    this.log('');
    this.log('='.repeat(60));
    this.log('MANUAL ACTION REQUIRED:');
    this.log('1. Enter your IBJ credentials in the browser');
    this.log('2. Solve the reCAPTCHA if prompted');
    this.log('3. Click the green "ログイン" button');
    this.log('Automation will continue after you complete login...');
    this.log('='.repeat(60));
    this.log('');

    // Initialize Gmail OTP service
    this.gmailOtpService = new GmailOtpService(otpEmail);

    // Step 1: Navigate to login page
    this.log('Step 1: Navigating to login page');
    try {
      await page.goto(this.loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await this.wait(2000);
    } catch (error) {
      this.log(`Navigation warning: ${(error as Error).message}`, 'warn');
    }
    await this.takeScreenshot(page, 'login-page');

    // Step 2: Wait for user to complete manual login
    // We detect this by waiting for the URL to change away from /logins
    // or for the OTP send button to appear
    this.log('Step 2: Waiting for user to complete manual login...');
    this.log('(You have 120 seconds to enter credentials and click login)');

    const loginStartTime = Date.now();
    const loginTimeout = 120000; // 2 minutes for manual login
    let userLoggedIn = false;

    while (Date.now() - loginStartTime < loginTimeout) {
      const currentUrl = page.url();

      // Check if we've moved past the login page
      if (!currentUrl.includes('/logins')) {
        this.log(`Detected page change: ${currentUrl}`);
        userLoggedIn = true;
        break;
      }

      // Also check if OTP send button appeared (means login succeeded)
      const otpButtonExists = await this.elementExists(page, SELECTORS.otpSendButton);
      if (otpButtonExists) {
        this.log('Detected OTP request page');
        userLoggedIn = true;
        break;
      }

      // Check if we're already fully logged in (my page visible)
      const myPageExists = await this.elementExists(page, SELECTORS.myPageMenu);
      if (myPageExists) {
        this.log('Detected main dashboard - already logged in');
        return; // Already fully logged in, no OTP needed
      }

      await this.wait(2000);
    }

    if (!userLoggedIn) {
      await this.takeScreenshot(page, 'login-timeout');
      throw new Error('Login timeout: Please complete the manual login within 120 seconds');
    }

    await this.takeScreenshot(page, 'after-manual-login');
    await this.wait(2000);

    // Step 3: Click submit to send OTP email (if on OTP request page)
    const currentUrl = page.url();
    this.log(`Current URL after login: ${currentUrl}`);

    // Check if we need to request OTP
    const otpSendButtonExists = await this.elementExists(page, SELECTORS.otpSendButton);
    if (otpSendButtonExists) {
      this.log('Step 3: Requesting OTP via email');
      await page.click(SELECTORS.otpSendButton);
      await this.wait(3000);
      await this.takeScreenshot(page, 'otp-requested');
    }

    // Step 4: Check if we're on OTP input page
    const otpInputExists = await this.elementExists(page, SELECTORS.otpInput);
    if (otpInputExists) {
      this.log('Step 4: Waiting for OTP email');

      let otpCode: string;
      try {
        const otpResult = await this.gmailOtpService.waitForOtp(
          IBJ_OTP_CONFIG,
          90000, // 90 seconds timeout
          5000   // Check every 5 seconds
        );
        otpCode = otpResult.code;
        this.log(`OTP received: ${otpCode} (from email at ${otpResult.timestamp.toISOString()})`);
      } catch (error) {
        this.log(`Failed to get OTP: ${(error as Error).message}`, 'error');
        await this.takeScreenshot(page, 'otp-timeout');
        throw new Error(`OTP verification failed: ${(error as Error).message}`);
      }

      // Step 5: Enter OTP code
      this.log('Step 5: Entering OTP code');
      await this.typeWithDelay(page, SELECTORS.otpInput, otpCode, 100);
      await this.takeScreenshot(page, 'otp-entered');

      // Step 6: Submit OTP
      this.log('Step 6: Submitting OTP');
      // Find the submit button on OTP verification page
      const submitButtons = await page.$$('input[type="submit"]');
      if (submitButtons.length > 0) {
        await submitButtons[0].click();
      }

      // Wait for login to complete
      await this.wait(5000);
      await this.takeScreenshot(page, 'after-otp-submit');
    }

    // Verify login success
    const loggedIn = await this.isLoggedIn(page);
    if (!loggedIn) {
      throw new Error('Login failed after OTP verification');
    }

    this.log('Login completed successfully');
  }

  /**
   * Check if successfully logged in
   */
  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      // Check for user name display (indicates logged-in state)
      const userNameExists = await this.elementExists(page, SELECTORS.myPageMenu);
      if (userNameExists) {
        this.log('My page menu found - logged in');
        return true;
      }

      // Alternative: check for agency name
      const agencyNameExists = await this.elementExists(page, SELECTORS.agencyNameDisplay);
      if (agencyNameExists) {
        this.log('Agency name found - logged in');
        return true;
      }

      // Check URL - should not be on login page
      const currentUrl = page.url();
      if (!currentUrl.includes('/logins') && !currentUrl.includes('/verification')) {
        this.log(`Not on login/verification page (${currentUrl}) - likely logged in`);
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
   *
   * Flow:
   * 1. Click on My Page menu to expand it
   * 2. Find "業務管理" section
   * 3. Click "請求書ダウンロード" link
   */
  async navigateToInvoices(page: Page): Promise<void> {
    this.log('Navigating to invoice download section');

    // Step 1: Click on My Page menu
    this.log('Step 1: Opening My Page menu');
    await this.waitForSelector(page, SELECTORS.myPageMenu);
    await page.click(SELECTORS.myPageMenu);
    await this.wait(1000);
    await this.takeScreenshot(page, 'mypage-menu-open');

    // Step 2: Wait for menu content to appear
    this.log('Step 2: Waiting for menu content');
    try {
      await this.waitForSelector(page, SELECTORS.myPageMenuContent, { timeout: 5000 });
    } catch {
      this.log('Menu content selector not found, continuing...');
    }

    // Step 3: Find and click "請求書ダウンロード" link
    this.log('Step 3: Looking for 請求書ダウンロード link');

    // Use evaluate to find the link by text content
    const invoiceLinkFound = await page.evaluate(`
      (function() {
        var links = document.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) {
          var link = links[i];
          if (link.textContent && link.textContent.includes('請求書ダウンロード')) {
            link.click();
            return true;
          }
        }
        return false;
      })()
    `);

    if (invoiceLinkFound) {
      this.log('Found and clicked 請求書ダウンロード link');
    } else {
      // Fallback: try the href selector
      this.log('Trying href selector for invoice download link');
      try {
        await this.waitForSelector(page, SELECTORS.invoiceDownloadLink, { timeout: 5000 });
        await page.click(SELECTORS.invoiceDownloadLink);
        this.log('Clicked invoice download link via href');
      } catch (error) {
        this.log('Could not find invoice download link', 'error');
        await this.takeScreenshot(page, 'invoice-link-not-found');
        throw new Error('Could not navigate to invoice download page');
      }
    }

    // Wait for navigation to complete
    await this.wait(3000);
    await this.takeScreenshot(page, 'invoice-download-page');

    this.log('Navigation to invoice download section completed');
    this.log(`Current URL: ${page.url()}`);
  }

  /**
   * Download invoices from the billing section
   *
   * Flow:
   * 1. Verify we're on the invoice download page
   * 2. Select the target month (defaults to last month in dropdown)
   * 3. Click download button
   * 4. Capture the downloaded PDF
   */
  async downloadInvoices(page: Page, options?: DownloadOptions): Promise<DownloadedFile[]> {
    this.log('Starting invoice download');
    const files: DownloadedFile[] = [];

    await this.takeScreenshot(page, 'before-download');

    // Step 1: Find the month selector
    this.log('Step 1: Finding month selector');
    try {
      await this.waitForSelector(page, SELECTORS.targetMonthSelect, { timeout: 10000 });
    } catch {
      this.log('Month selector not found', 'error');
      await this.takeScreenshot(page, 'no-month-selector');
      throw new Error('Invoice download page not loaded correctly');
    }

    // Step 2: Get available months and determine target
    const monthsInfo = await page.evaluate(`
      (function() {
        var select = document.querySelector('${SELECTORS.targetMonthSelect}');
        if (!select) return null;

        var options = Array.from(select.options);
        var values = options.map(function(opt) { return opt.value; });
        var selectedValue = select.value;
        var selectedIndex = select.selectedIndex;

        return {
          values: values,
          selectedValue: selectedValue,
          selectedIndex: selectedIndex,
          optionsCount: options.length
        };
      })()
    `) as { values: string[]; selectedValue: string; selectedIndex: number; optionsCount: number } | null;

    if (!monthsInfo) {
      throw new Error('Could not read month selector');
    }

    this.log(`Available months: ${monthsInfo.values.join(', ')}`);
    this.log(`Currently selected: ${monthsInfo.selectedValue} (index ${monthsInfo.selectedIndex})`);

    // Determine target month
    let targetMonth: string = options?.targetMonth || '';
    if (!targetMonth) {
      // Default to the last month in the dropdown (which is usually the most recent)
      targetMonth = monthsInfo.values[monthsInfo.values.length - 1] || '';
    }

    // Format targetMonth if provided in YYYY-MM format
    if (targetMonth && targetMonth.includes('-')) {
      // Convert YYYY-MM to YYYYMM format
      targetMonth = targetMonth.replace('-', '');
    }

    this.log(`Target month: ${targetMonth}`);

    // Step 3: Select the target month if different from current
    if (targetMonth && targetMonth !== monthsInfo.selectedValue) {
      this.log(`Selecting month: ${targetMonth}`);
      await page.select(SELECTORS.targetMonthSelect, targetMonth);
      await this.wait(1000);
    }

    await this.takeScreenshot(page, 'month-selected');

    // Step 4: Click download button
    this.log('Step 4: Clicking download button');
    await this.waitForSelector(page, SELECTORS.downloadButton);

    // Intercept the download
    const file = await this.interceptDownload(
      page,
      async () => {
        await page.click(SELECTORS.downloadButton);
      },
      {
        urlPatterns: [/\.pdf$/i, /download/i, /billing/i, /invoice/i],
        mimeTypes: ['application/pdf', 'application/octet-stream'],
        timeout: 30000,
      }
    );

    if (file) {
      // Format billing month as YYYY-MM
      const billingMonth = targetMonth
        ? `${targetMonth.substring(0, 4)}-${targetMonth.substring(4, 6)}`
        : undefined;

      file.billingMonth = billingMonth;
      file.documentType = 'invoice';
      file.serviceName = 'IBJ';

      // Generate a proper filename
      if (billingMonth) {
        file.filename = `IBJ-請求書-${billingMonth}.pdf`;
      }

      files.push(file);
      this.log(`Downloaded: ${file.filename} (${file.fileSize} bytes)`);
    } else {
      this.log('Download interception failed, trying alternative method');

      // Alternative: Check if the page itself is the PDF
      const contentType = await page.evaluate(`document.contentType`) as string | undefined;
      if (contentType === 'application/pdf') {
        this.log('Page is a PDF, capturing directly');
        try {
          const pagePdf = await this.pageToPdf(page);
          const billingMonth = targetMonth
            ? `${targetMonth.substring(0, 4)}-${targetMonth.substring(4, 6)}`
            : new Date().toISOString().slice(0, 7);

          pagePdf.billingMonth = billingMonth;
          pagePdf.documentType = 'invoice';
          pagePdf.serviceName = 'IBJ';
          pagePdf.filename = `IBJ-請求書-${billingMonth}.pdf`;

          files.push(pagePdf);
          this.log(`Captured PDF: ${pagePdf.filename}`);
        } catch (error) {
          this.log(`Failed to capture PDF: ${error}`, 'error');
        }
      }
    }

    await this.takeScreenshot(page, 'after-download');

    this.log(`Download complete: ${files.length} file(s)`);
    return files;
  }
}
