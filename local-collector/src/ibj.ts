/**
 * IBJ Local Collector
 * Automated invoice download for IBJ (ibjapan.com) using local browser
 *
 * Flow:
 * 1. Navigate to login page
 * 2. User manually enters credentials and solves reCAPTCHA
 * 3. Automation detects login success and handles OTP
 * 4. Navigates to invoice download page
 * 5. Downloads PDF for target month
 */
import { Page } from 'puppeteer-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OtpService, IBJ_OTP_CONFIG } from './otp';
import { CollectionResult, DownloadedFile } from './collector';

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

  // Invoice download
  targetMonthSelect: 'select#target_ym',
  downloadButton: 'input[type="submit"][value="ダウンロード"]',
};

const LOGIN_URL = 'https://www.ibjapan.com/div/logins';

/**
 * IBJ Collector for local browser automation
 */
export class IBJCollector {
  private page: Page;
  private otpService: OtpService;

  constructor(page: Page, otpService: OtpService) {
    this.page = page;
    this.otpService = otpService;
  }

  /**
   * Main collection method
   */
  async collect(targetMonth: string): Promise<CollectionResult> {
    try {
      // Step 1: Navigate to login page
      console.log('\n[IBJ] Navigating to login page...');
      await this.page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

      // Step 2: Wait for manual login
      console.log('');
      console.log('='.repeat(60));
      console.log('MANUAL ACTION REQUIRED:');
      console.log('');
      console.log('1. Enter your IBJ credentials');
      console.log('2. Solve the reCAPTCHA');
      console.log('3. Click the green "ログイン" button');
      console.log('');
      console.log('Waiting for you to complete login...');
      console.log('='.repeat(60));
      console.log('');

      const loginSuccess = await this.waitForLogin(120000);
      if (!loginSuccess) {
        return {
          success: false,
          files: [],
          error: 'Login timeout - please complete login within 2 minutes',
        };
      }

      // Step 3: Handle OTP if required
      await this.handleOtpIfNeeded();

      // Step 4: Verify logged in
      const loggedIn = await this.isLoggedIn();
      if (!loggedIn) {
        return {
          success: false,
          files: [],
          error: 'Login verification failed',
        };
      }

      console.log('[IBJ] Login successful!');

      // Step 5: Navigate to invoice download page
      await this.navigateToInvoices();

      // Step 6: Download invoice
      const files = await this.downloadInvoice(targetMonth);

      return {
        success: true,
        files,
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Wait for user to complete manual login
   */
  private async waitForLogin(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      const currentUrl = this.page.url();

      // Check if we've moved past the login page
      if (!currentUrl.includes('/logins')) {
        console.log('[IBJ] Detected page change - login submitted');
        return true;
      }

      // Check if OTP send button appeared (login succeeded)
      const otpButtonExists = await this.elementExists(SELECTORS.otpSendButton);
      if (otpButtonExists) {
        console.log('[IBJ] Detected OTP request page');
        return true;
      }

      // Check if already fully logged in
      const myPageExists = await this.elementExists(SELECTORS.myPageMenu);
      if (myPageExists) {
        console.log('[IBJ] Detected main dashboard - already logged in');
        return true;
      }

      await this.wait(pollInterval);
    }

    return false;
  }

  /**
   * Handle OTP verification if required
   */
  private async handleOtpIfNeeded(): Promise<void> {
    await this.wait(2000);

    // Check if we need to request OTP
    const otpSendButtonExists = await this.elementExists(SELECTORS.otpSendButton);
    if (otpSendButtonExists) {
      console.log('[IBJ] Requesting OTP via email...');
      await this.page.click(SELECTORS.otpSendButton);
      await this.wait(3000);
    }

    // Check if we're on OTP input page
    const otpInputExists = await this.elementExists(SELECTORS.otpInput);
    if (otpInputExists) {
      console.log('[IBJ] OTP verification required');

      // Get OTP (Gmail API or manual)
      const otpCode = await this.otpService.getOtp(IBJ_OTP_CONFIG);

      // Enter OTP
      console.log('[IBJ] Entering OTP code...');
      await this.page.type(SELECTORS.otpInput, otpCode, { delay: 100 });

      // Submit OTP
      console.log('[IBJ] Submitting OTP...');
      const submitButtons = await this.page.$$('input[type="submit"]');
      if (submitButtons.length > 0) {
        await submitButtons[0].click();
      }

      await this.wait(5000);
    }
  }

  /**
   * Check if successfully logged in
   */
  private async isLoggedIn(): Promise<boolean> {
    const myPageExists = await this.elementExists(SELECTORS.myPageMenu);
    if (myPageExists) {
      return true;
    }

    const currentUrl = this.page.url();
    if (!currentUrl.includes('/logins') && !currentUrl.includes('/verification')) {
      return true;
    }

    return false;
  }

  /**
   * Navigate to invoice download page
   */
  private async navigateToInvoices(): Promise<void> {
    console.log('[IBJ] Navigating to invoice download...');

    // Click My Page menu
    await this.waitForSelector(SELECTORS.myPageMenu);
    await this.page.click(SELECTORS.myPageMenu);
    await this.wait(1000);

    // Find and click invoice download link
    const invoiceLinkFound = await this.page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const link of links) {
        if (link.textContent && link.textContent.includes('請求書ダウンロード')) {
          link.click();
          return true;
        }
      }
      return false;
    });

    if (!invoiceLinkFound) {
      throw new Error('Could not find invoice download link');
    }

    await this.wait(3000);
    console.log('[IBJ] On invoice download page');
  }

  /**
   * Download invoice for target month
   */
  private async downloadInvoice(targetMonth: string): Promise<DownloadedFile[]> {
    console.log(`[IBJ] Downloading invoice for ${targetMonth}...`);
    const files: DownloadedFile[] = [];

    // Wait for month selector
    await this.waitForSelector(SELECTORS.targetMonthSelect);

    // Get available months
    const monthsInfo = await this.page.evaluate((selector: string) => {
      const select = document.querySelector(selector) as HTMLSelectElement | null;
      if (!select) return null;

      const options = Array.from(select.options) as HTMLOptionElement[];
      return {
        values: options.map((opt) => opt.value),
        selectedValue: select.value,
      };
    }, SELECTORS.targetMonthSelect);

    if (!monthsInfo) {
      throw new Error('Could not read month selector');
    }

    console.log(`[IBJ] Available months: ${monthsInfo.values.join(', ')}`);

    // Format target month (YYYY-MM to YYYYMM)
    let targetMonthValue = targetMonth.replace('-', '');

    // Select month if needed
    if (targetMonthValue !== monthsInfo.selectedValue) {
      if (monthsInfo.values.includes(targetMonthValue)) {
        await this.page.select(SELECTORS.targetMonthSelect, targetMonthValue);
        await this.wait(1000);
      } else {
        console.log(`[IBJ] Target month ${targetMonth} not available, using ${monthsInfo.selectedValue}`);
        targetMonthValue = monthsInfo.selectedValue;
      }
    }

    // Download using CDP
    const file = await this.captureDownload(targetMonthValue);
    if (file) {
      files.push(file);
      console.log(`[IBJ] Downloaded: ${file.filename}`);
    } else {
      throw new Error('Download failed');
    }

    return files;
  }

  /**
   * Capture download using CDP
   */
  private async captureDownload(targetMonth: string): Promise<DownloadedFile | null> {
    const downloadDir = path.join(os.tmpdir(), `ibj-download-${Date.now()}`);
    fs.mkdirSync(downloadDir, { recursive: true });

    try {
      // Configure CDP for download
      const client = await this.page.createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
      });

      // Click download button
      await this.page.click(SELECTORS.downloadButton);

      // Wait for file to appear
      const maxWaitTime = 30000;
      const pollInterval = 500;
      let elapsedTime = 0;
      let downloadedFilename: string | null = null;

      while (elapsedTime < maxWaitTime) {
        const filesInDir = fs.readdirSync(downloadDir);
        const pdfFiles = filesInDir.filter((f) => f.endsWith('.pdf'));

        if (pdfFiles.length > 0) {
          downloadedFilename = pdfFiles[0];
          break;
        }

        const completedFiles = filesInDir.filter((f) => !f.endsWith('.crdownload'));
        if (completedFiles.length > 0) {
          downloadedFilename = completedFiles[0];
          break;
        }

        await this.wait(pollInterval);
        elapsedTime += pollInterval;
      }

      if (!downloadedFilename) {
        return null;
      }

      // Read the downloaded file
      const filePath = path.join(downloadDir, downloadedFilename);
      const buffer = fs.readFileSync(filePath);

      // Generate proper filename
      const billingMonth = `${targetMonth.substring(0, 4)}-${targetMonth.substring(4, 6)}`;
      const filename = `IBJ-請求書-${billingMonth}.pdf`;

      // Clean up
      fs.unlinkSync(filePath);

      return {
        filename,
        data: buffer,
        mimeType: 'application/pdf',
      };
    } finally {
      // Clean up temp directory
      try {
        if (fs.existsSync(downloadDir)) {
          fs.rmSync(downloadDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Check if element exists
   */
  private async elementExists(selector: string): Promise<boolean> {
    try {
      const element = await this.page.$(selector);
      return element !== null;
    } catch {
      return false;
    }
  }

  /**
   * Wait for selector with timeout
   */
  private async waitForSelector(selector: string, timeout: number = 10000): Promise<void> {
    await this.page.waitForSelector(selector, { timeout });
  }

  /**
   * Sleep utility
   */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
