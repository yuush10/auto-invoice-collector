/**
 * Download route for vendor invoice automation
 * POST /download - Download invoices from a vendor portal
 */
import { Router, Request, Response } from 'express';
import puppeteer, { Browser, Page } from 'puppeteer';
// Import vendors module to trigger vendor registration
import '../vendors';

import {
  DownloadRequest,
  DownloadResponse,
  VendorCredentials,
  isVendorWhitelisted,
  getVendorConfig,
} from '../vendors/types';
import { getVendorRegistry } from '../vendors/VendorRegistry';
import { getSecretManager } from '../services/SecretManager';

const router = Router();

// Browser instance (reused across requests for performance)
let browserInstance: Browser | null = null;
let currentProfilePath: string | null = null;

/**
 * Get or create browser instance
 * @param profilePath Optional Chrome profile path for pre-authenticated sessions
 */
async function getBrowser(profilePath?: string): Promise<Browser> {
  // If profile path changed or provided, close existing browser
  if (profilePath && currentProfilePath !== profilePath) {
    await closeBrowser();
    currentProfilePath = profilePath;
  }

  if (!browserInstance || !browserInstance.isConnected()) {
    console.log('[Download] Launching browser...');

    const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
      headless: 'new', // Use new headless mode
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-sync',
        '--disable-default-apps',
      ],
    };

    // Use Chrome profile if provided (for OAuth-based services)
    if (profilePath) {
      console.log(`[Download] Using Chrome profile: ${profilePath}`);
      launchOptions.userDataDir = profilePath;
      // Use system Chrome instead of Puppeteer's bundled Chromium for profile compatibility
      launchOptions.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      launchOptions.headless = false; // System Chrome with profile works better non-headless
      console.log('[Download] Using system Chrome for profile compatibility');
    }

    browserInstance = await puppeteer.launch(launchOptions);
  }
  return browserInstance;
}

/**
 * Close browser instance
 */
async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * POST /download
 * Download invoices from a vendor portal
 */
router.post('/download', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const request = req.body as DownloadRequest;
  const logs: string[] = [];
  const screenshots: string[] = [];

  const log = (message: string) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    logs.push(logMessage);
  };

  log(`Received download request for vendor: ${request.vendorKey}`);

  // Validate request
  if (!request.vendorKey) {
    const response: DownloadResponse = {
      success: false,
      vendorKey: request.vendorKey || 'unknown',
      files: [],
      error: 'vendorKey is required',
    };
    return res.status(400).json(response);
  }

  // Check whitelist
  if (!isVendorWhitelisted(request.vendorKey)) {
    log(`Vendor ${request.vendorKey} is not in whitelist`);
    const response: DownloadResponse = {
      success: false,
      vendorKey: request.vendorKey,
      files: [],
      error: `Vendor '${request.vendorKey}' is not whitelisted`,
    };
    return res.status(403).json(response);
  }

  // Get vendor config
  const vendorConfig = getVendorConfig(request.vendorKey);
  if (!vendorConfig) {
    const response: DownloadResponse = {
      success: false,
      vendorKey: request.vendorKey,
      files: [],
      error: `Vendor config not found for '${request.vendorKey}'`,
    };
    return res.status(404).json(response);
  }

  // Get vendor implementation
  const registry = getVendorRegistry();
  const vendor = registry.get(request.vendorKey);

  if (!vendor) {
    log(`Vendor ${request.vendorKey} is whitelisted but not implemented`);
    const response: DownloadResponse = {
      success: false,
      vendorKey: request.vendorKey,
      files: [],
      error: `Vendor '${request.vendorKey}' is not yet implemented`,
      debug: { logs },
    };
    return res.status(501).json(response);
  }

  // Get credentials
  let credentials: VendorCredentials;

  if (request.credentials) {
    // Use provided credentials (fallback)
    log('Using provided credentials');
    credentials = request.credentials;
  } else {
    // Fetch from Secret Manager
    try {
      const secretManager = getSecretManager();
      credentials = await secretManager.getCredentials(vendorConfig.secretName);
      log('Retrieved credentials from Secret Manager');
    } catch (error) {
      log(`Failed to get credentials: ${(error as Error).message}`);
      const response: DownloadResponse = {
        success: false,
        vendorKey: request.vendorKey,
        files: [],
        error: `Failed to retrieve credentials: ${(error as Error).message}`,
        debug: { logs },
      };
      return res.status(500).json(response);
    }
  }

  // Execute vendor automation
  let page: Page | null = null;
  const useProfileAuth = !!credentials.chromeProfilePath;

  try {
    const browser = await getBrowser(credentials.chromeProfilePath);
    page = await browser.newPage();

    // Set viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    if (useProfileAuth) {
      // Chrome profile auth: navigate to login page first to trigger OAuth redirect if needed
      log('Using Chrome profile authentication');

      // Navigate to login page with retry logic
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          log(`Navigation attempt ${attempt} to login page...`);
          await page.goto(vendor.loginUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          // Wait for OAuth redirect or page load
          await new Promise(resolve => setTimeout(resolve, 3000));
          log('Navigation successful');
          break;
        } catch (navError) {
          log(`Navigation attempt ${attempt} failed: ${(navError as Error).message}`);
          if (attempt === 3) {
            throw navError;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Check current URL - if redirected away from login, we're logged in
      const currentUrl = page.url();
      log(`Current URL after login page: ${currentUrl}`);

      // Take screenshot to verify state
      const initialScreenshot = await page.screenshot({ encoding: 'base64' });
      screenshots.push(initialScreenshot as string);

      // Check if we're on a login/index page and need to click Google login
      if (currentUrl.includes('/index') || currentUrl.includes('/login')) {
        log('On login page, looking for Google login button...');

        // Look for Google login button
        const googleButtonSelectors = [
          'button[class*="google"]',
          'a[class*="google"]',
          'button[class*="social"]',
          'a[href*="google"]',
          '[class*="sign"] button',
          'button[class*="btn"]',
        ];

        for (const selector of googleButtonSelectors) {
          try {
            const button = await page.$(selector);
            if (button) {
              log(`Found Google login button with selector: ${selector}`);
              await button.click();
              // Wait for OAuth redirect to complete
              await new Promise(resolve => setTimeout(resolve, 5000));
              log(`Current URL after clicking: ${page.url()}`);

              // Take screenshot after clicking
              const afterClickScreenshot = await page.screenshot({ encoding: 'base64' });
              screenshots.push(afterClickScreenshot as string);
              break;
            }
          } catch (err) {
            // Continue trying other selectors
          }
        }
      }

      // Verify login success
      const isLoggedIn = await vendor.isLoggedIn(page);
      if (!isLoggedIn) {
        throw new Error('Chrome profile not logged in. Please login manually in Chrome first.');
      }
      log('Chrome profile authentication successful');
    } else {
      // Standard login flow
      log(`Navigating to login page: ${vendor.loginUrl}`);
      await page.goto(vendor.loginUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      // Take screenshot before login
      const loginScreenshot = await page.screenshot({ encoding: 'base64' });
      screenshots.push(loginScreenshot as string);

      // Perform login
      log('Performing login...');
      await vendor.login(page, credentials);

      // Verify login success
      const isLoggedIn = await vendor.isLoggedIn(page);
      if (!isLoggedIn) {
        throw new Error('Login verification failed');
      }
      log('Login successful');
    }

    // Take screenshot after login
    const afterLoginScreenshot = await page.screenshot({ encoding: 'base64' });
    screenshots.push(afterLoginScreenshot as string);

    // Navigate to invoices
    log('Navigating to invoices...');
    await vendor.navigateToInvoices(page);

    // Take screenshot of invoice page
    const invoiceScreenshot = await page.screenshot({ encoding: 'base64' });
    screenshots.push(invoiceScreenshot as string);

    // Download invoices
    log('Downloading invoices...');
    const files = await vendor.downloadInvoices(page, request.options);
    log(`Downloaded ${files.length} file(s)`);

    const duration = Date.now() - startTime;
    log(`Completed in ${duration}ms`);

    const response: DownloadResponse = {
      success: true,
      vendorKey: request.vendorKey,
      files,
      debug: {
        screenshots,
        logs,
        duration,
      },
    };

    return res.json(response);
  } catch (error) {
    const errorMessage = (error as Error).message;
    log(`Error: ${errorMessage}`);

    // Take error screenshot
    if (page) {
      try {
        const errorScreenshot = await page.screenshot({ encoding: 'base64' });
        screenshots.push(errorScreenshot as string);
      } catch {
        // Ignore screenshot errors
      }
    }

    const duration = Date.now() - startTime;

    const response: DownloadResponse = {
      success: false,
      vendorKey: request.vendorKey,
      files: [],
      error: errorMessage,
      debug: {
        screenshots,
        logs,
        duration,
      },
    };

    return res.status(500).json(response);
  } finally {
    // Close the page (keep browser for reuse)
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
  }
});

/**
 * GET /download/status
 * Get download service status
 */
router.get('/download/status', async (_req: Request, res: Response) => {
  const registry = getVendorRegistry();
  const secretManager = getSecretManager();

  const status = {
    service: 'vendor-download',
    status: 'healthy',
    browser: browserInstance ? 'running' : 'not started',
    secretManager: await secretManager.isAvailable() ? 'available' : 'unavailable',
    vendors: {
      registered: registry.getAllKeys(),
      available: registry.getAvailableVendors().map(v => v.vendorKey),
      pending: registry.getPendingVendors().map(v => v.vendorKey),
    },
  };

  res.json(status);
});

/**
 * POST /download/test
 * Test vendor connection without downloading
 */
router.post('/download/test', async (req: Request, res: Response) => {
  const { vendorKey } = req.body;

  if (!vendorKey) {
    return res.status(400).json({ error: 'vendorKey is required' });
  }

  if (!isVendorWhitelisted(vendorKey)) {
    return res.status(403).json({ error: `Vendor '${vendorKey}' is not whitelisted` });
  }

  const registry = getVendorRegistry();
  const vendor = registry.get(vendorKey);

  if (!vendor) {
    return res.status(501).json({ error: `Vendor '${vendorKey}' is not implemented` });
  }

  const vendorConfig = getVendorConfig(vendorKey);

  res.json({
    vendorKey,
    vendorName: vendor.vendorName,
    loginUrl: vendor.loginUrl,
    secretName: vendorConfig?.secretName,
    status: 'ready',
  });
});

// Cleanup on process exit
process.on('SIGTERM', async () => {
  console.log('[Download] Received SIGTERM, closing browser...');
  await closeBrowser();
});

export default router;
