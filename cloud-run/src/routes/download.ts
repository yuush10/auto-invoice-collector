/**
 * Download route for vendor invoice automation
 * POST /download - Download invoices from a vendor portal
 * POST /download/login - Manual login for OAuth services (headful mode)
 */
import { Router, Request, Response } from 'express';
import puppeteer, { Browser, Page, Protocol } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
// Import vendors module to trigger vendor registration
import '../vendors';

import {
  DownloadRequest,
  DownloadResponse,
  VendorCredentials,
  DownloadedFile,
  isVendorWhitelisted,
  getVendorConfig,
} from '../vendors/types';
import { getVendorRegistry } from '../vendors/VendorRegistry';
import { getSecretManager } from '../services/SecretManager';
import {
  GeminiOcrService,
  DocTypeDetector,
  FileNamingService,
  DocumentType,
} from '../services/GeminiOcrService';

const router = Router();

// Browser instance (reused across requests for performance)
let browserInstance: Browser | null = null;
let currentProfilePath: string | null = null;

// Cookie storage directory
const COOKIE_DIR = process.env.COOKIE_DIR || '/tmp/vendor-cookies';

/**
 * Get cookie file path for a vendor
 */
function getCookieFilePath(vendorKey: string): string {
  return path.join(COOKIE_DIR, `${vendorKey}-cookies.json`);
}

/**
 * Save cookies for a vendor
 */
async function saveCookies(vendorKey: string, cookies: Protocol.Network.Cookie[]): Promise<void> {
  // Ensure directory exists
  if (!fs.existsSync(COOKIE_DIR)) {
    fs.mkdirSync(COOKIE_DIR, { recursive: true });
  }
  const filePath = getCookieFilePath(vendorKey);
  fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
  console.log(`[Download] Saved ${cookies.length} cookies for ${vendorKey}`);
}

/**
 * Auth data structure (cookies + localStorage)
 */
interface AuthData {
  cookies: Protocol.Network.Cookie[];
  localStorage?: Record<string, string>;
}

/**
 * Load auth data for a vendor
 */
function loadAuthData(vendorKey: string): AuthData | null {
  const filePath = getCookieFilePath(vendorKey);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);

    // Handle both old format (array of cookies) and new format (object with cookies + localStorage)
    if (Array.isArray(parsed)) {
      console.log(`[Download] Loaded ${parsed.length} cookies for ${vendorKey} (legacy format)`);
      return { cookies: parsed };
    } else {
      console.log(`[Download] Loaded ${parsed.cookies?.length || 0} cookies and ${Object.keys(parsed.localStorage || {}).length} localStorage items for ${vendorKey}`);
      return parsed as AuthData;
    }
  } catch (error) {
    console.log(`[Download] Failed to load auth data: ${error}`);
    return null;
  }
}

/**
 * Get or create browser instance
 * @param profilePath Optional Chrome profile path for pre-authenticated sessions
 */
async function getBrowser(profilePath?: string, demoMode = false): Promise<Browser> {
  // If profile path changed or provided, close existing browser
  if (profilePath && currentProfilePath !== profilePath) {
    await closeBrowser();
    currentProfilePath = profilePath;
  }

  // For demo mode, always create a new browser in headful mode
  if (demoMode) {
    await closeBrowser();
  }

  if (!browserInstance || !browserInstance.isConnected()) {
    console.log('[Download] Launching browser...');

    const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
      headless: demoMode ? false : 'new', // Headful for demo mode
      protocolTimeout: 120000, // 2 minutes for CDP operations
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

    // Demo mode: smaller window
    if (demoMode) {
      launchOptions.args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1200,800',
        '--window-position=100,100',
      ];
      launchOptions.defaultViewport = { width: 1200, height: 800 };
      console.log('[Download] Demo mode: using headful browser');
    }

    // Set Chrome executable path based on environment
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      console.log(`[Download] Using Chrome from env: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
    } else if (process.platform === 'darwin') {
      launchOptions.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      console.log('[Download] Using system Chrome on macOS');
    }

    // Use Chrome profile if provided (for OAuth-based services)
    if (profilePath) {
      console.log(`[Download] Using Chrome profile: ${profilePath}`);
      launchOptions.userDataDir = profilePath;
      launchOptions.headless = false; // System Chrome with profile works better non-headless
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
  const demoMode = req.body.demo === true; // Demo mode shows browser
  const logs: string[] = [];
  const screenshots: string[] = [];

  const log = (message: string) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    logs.push(logMessage);
  };

  log(`Received download request for vendor: ${request.vendorKey}${demoMode ? ' (DEMO MODE)' : ''}`);

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
  let useStoredAuth = false;
  let storedAuth: AuthData | null = null;

  if (request.credentials) {
    // Use provided credentials (fallback)
    log('Using provided credentials');
    credentials = request.credentials;
  } else {
    // First, check for stored auth data from manual login
    storedAuth = loadAuthData(request.vendorKey);
    if (storedAuth && storedAuth.cookies && storedAuth.cookies.length > 0) {
      log(`Found ${storedAuth.cookies.length} stored cookies for ${request.vendorKey}`);
      if (storedAuth.localStorage) {
        log(`Found ${Object.keys(storedAuth.localStorage).length} localStorage items`);
      }
      useStoredAuth = true;
      credentials = { username: '', password: '' }; // Placeholder, won't be used
    } else {
      // Fetch from Secret Manager
      try {
        const secretManager = getSecretManager();
        credentials = await secretManager.getCredentials(vendorConfig.secretName);
        log('Retrieved credentials from Secret Manager');
      } catch (error) {
        log(`Failed to get credentials: ${(error as Error).message}`);
        log('Tip: Use POST /download/login to manually login and save cookies');
        const response: DownloadResponse = {
          success: false,
          vendorKey: request.vendorKey,
          files: [],
          error: `Failed to retrieve credentials. Use POST /download/login to manually login first.`,
          debug: { logs },
        };
        return res.status(500).json(response);
      }
    }
  }

  // Execute vendor automation
  let page: Page | null = null;
  const useProfileAuth = !!credentials.chromeProfilePath;

  try {
    const browser = await getBrowser(credentials.chromeProfilePath, demoMode);
    page = await browser.newPage();

    // Set viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    if (useStoredAuth && storedAuth) {
      // Cookie-based auth using stored cookies from manual login
      log('Using stored auth data for authentication');

      // Set cookies before navigation
      await page.setCookie(...storedAuth.cookies);
      log(`Set ${storedAuth.cookies.length} cookies`);

      // Navigate to the app first (need page context for localStorage)
      const baseUrl = 'https://' + new URL(vendor.loginUrl).hostname;
      await page.goto(baseUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Restore localStorage if available
      if (storedAuth.localStorage && Object.keys(storedAuth.localStorage).length > 0) {
        log(`Restoring ${Object.keys(storedAuth.localStorage).length} localStorage items`);
        await page.evaluate(`
          (function(items) {
            for (const [key, value] of Object.entries(items)) {
              localStorage.setItem(key, value);
            }
          })(${JSON.stringify(storedAuth.localStorage)})
        `);

        // Reload page to apply localStorage (some SPAs need this)
        await page.reload({ waitUntil: 'networkidle2' });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Take screenshot to verify logged-in state
      const cookieScreenshot = await page.screenshot({ encoding: 'base64' });
      screenshots.push(cookieScreenshot as string);

      // Verify login success
      const isLoggedIn = await vendor.isLoggedIn(page);
      if (!isLoggedIn) {
        log('Stored auth expired or invalid. Please run POST /download/login again.');
        throw new Error('Stored auth expired. Please run POST /download/login to re-authenticate.');
      }
      log('Cookie-based authentication successful');

    } else if (useProfileAuth) {
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

    // OCR processing for metadata extraction
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (geminiApiKey && files.length > 0) {
      log('Processing files with OCR for metadata extraction...');
      const ocrService = new GeminiOcrService(geminiApiKey);
      const fileNamingService = new FileNamingService();

      for (const file of files) {
        try {
          log(`OCR processing: ${file.filename}`);
          const extracted = await ocrService.extract(file.base64, {
            filename: file.filename,
          });

          // Determine document type using detector (prioritize Gemini's classification)
          const docType = DocTypeDetector.determineDocType({
            geminiDocType: extracted.docType,
            hasReceiptInContent: extracted.hasReceiptInContent || false,
            hasInvoiceInContent: extracted.hasInvoiceInContent || false,
            hasReceiptInFilename: DocTypeDetector.hasReceiptKeywords(file.filename),
            hasInvoiceInFilename: DocTypeDetector.hasInvoiceKeywords(file.filename),
          });

          // Update file metadata
          file.serviceName = extracted.serviceName;
          file.billingMonth = extracted.eventMonth;
          file.documentType = docType;
          file.ocrConfidence = extracted.confidence;
          file.ocrNotes = extracted.notes;

          // Generate suggested filename
          if (extracted.eventMonth && extracted.serviceName) {
            file.suggestedFilename = fileNamingService.generate(
              extracted.serviceName,
              extracted.eventMonth,
              docType
            );
            log(`Suggested filename: ${file.suggestedFilename}`);
          }

          log(`OCR complete: ${extracted.serviceName} (${extracted.eventMonth}) - ${docType}`);
        } catch (ocrError) {
          log(`OCR failed for ${file.filename}: ${(ocrError as Error).message}`);
          // Continue with other files even if OCR fails for one
        }
      }
    } else if (!geminiApiKey) {
      log('GEMINI_API_KEY not set, skipping OCR processing');
    }

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

/**
 * POST /download/login
 * Manual login for OAuth services (opens headful browser)
 *
 * Use this endpoint to manually login to OAuth-based vendors like Aitemasu.
 * The browser will open in non-headless mode, allowing you to complete the
 * Google OAuth flow. Once logged in, cookies are saved for automated use.
 *
 * Request body: { vendorKey: string, timeout?: number }
 * - vendorKey: The vendor to login to
 * - timeout: Max wait time in seconds (default: 120)
 */
router.post('/download/login', async (req: Request, res: Response) => {
  const { vendorKey, timeout = 120 } = req.body;
  const logs: string[] = [];

  const log = (message: string) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    logs.push(logMessage);
  };

  log(`Manual login request for vendor: ${vendorKey}`);

  // Validate request
  if (!vendorKey) {
    return res.status(400).json({ success: false, error: 'vendorKey is required' });
  }

  if (!isVendorWhitelisted(vendorKey)) {
    return res.status(403).json({ success: false, error: `Vendor '${vendorKey}' is not whitelisted` });
  }

  const registry = getVendorRegistry();
  const vendor = registry.get(vendorKey);

  if (!vendor) {
    return res.status(501).json({ success: false, error: `Vendor '${vendorKey}' is not implemented` });
  }

  // Close any existing browser to ensure clean state
  await closeBrowser();

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    log('Launching headful browser for manual login...');

    // Launch browser in headful (non-headless) mode using system Chrome
    browser = await puppeteer.launch({
      headless: false,
      protocolTimeout: 120000, // 2 minutes for CDP operations
      executablePath: process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined, // Use default on other platforms
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1200,800',
        '--window-position=100,100',
      ],
      defaultViewport: { width: 1200, height: 800 },
    });

    page = await browser.newPage();

    // Navigate to vendor login page
    log(`Navigating to login page: ${vendor.loginUrl}`);
    await page.goto(vendor.loginUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    log('Browser opened. Please complete the login manually.');
    log(`Waiting up to ${timeout} seconds for login to complete...`);
    log('The browser will stay open until you login and navigate away from the login page.');

    // Record the initial URL to detect navigation
    const initialUrl = page.url();
    log(`Initial URL: ${initialUrl}`);

    // Poll for login success - require URL change first
    const startTime = Date.now();
    const timeoutMs = timeout * 1000;
    let loggedIn = false;

    while (Date.now() - startTime < timeoutMs) {
      const currentUrl = page.url();

      // Only check login status if URL has changed away from login/index/google pages
      const isOnLoginPage = currentUrl.includes('/login') ||
                           currentUrl.includes('/index') ||
                           currentUrl.includes('accounts.google.com');

      if (!isOnLoginPage && currentUrl !== initialUrl) {
        log(`URL changed to: ${currentUrl}`);
        // Give the page time to load
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Now check login status
        loggedIn = await vendor.isLoggedIn(page);
        if (loggedIn) {
          log('Login confirmed after URL change');
          break;
        }
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!loggedIn) {
      log('Login timeout - user did not complete login in time');
      return res.status(408).json({
        success: false,
        error: 'Login timeout. Please try again and complete the login faster.',
        logs,
      });
    }

    // Get ALL cookies from the browser using CDP (includes httpOnly)
    const client = await page.createCDPSession();
    const { cookies: allCookies } = await client.send('Network.getAllCookies');
    log(`Captured ${allCookies.length} cookies (including httpOnly)`);

    // Log cookie domains for debugging
    const domains = [...new Set(allCookies.map((c: Protocol.Network.Cookie) => c.domain))];
    log(`Cookie domains: ${domains.join(', ')}`);

    // Also capture localStorage (some SPAs store auth tokens here)
    const localStorageData = await page.evaluate(`
      (function() {
        var items = {};
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key) {
            items[key] = localStorage.getItem(key) || '';
          }
        }
        return items;
      })()
    `) as Record<string, string>;
    log(`LocalStorage keys: ${Object.keys(localStorageData || {}).join(', ')}`);

    // Save ALL cookies (not just vendor domain - auth might be on different domain)
    log(`Saving all ${allCookies.length} cookies`);

    // Save cookies and localStorage together
    const authData = {
      cookies: allCookies,
      localStorage: localStorageData,
    };
    await saveCookies(vendorKey, authData as unknown as Protocol.Network.Cookie[]);

    // Take a screenshot as confirmation
    const screenshot = await page.screenshot({ encoding: 'base64' });

    log('Manual login completed successfully!');
    log('Browser will close in 5 seconds...');

    // Keep browser open for a few seconds so user can see the result
    await new Promise(resolve => setTimeout(resolve, 5000));

    return res.json({
      success: true,
      vendorKey,
      message: 'Login successful! Cookies saved for automated use.',
      cookieCount: allCookies.length,
      screenshot,
      logs,
    });

  } catch (error) {
    const errorMessage = (error as Error).message;
    log(`Error during manual login: ${errorMessage}`);
    return res.status(500).json({
      success: false,
      error: errorMessage,
      logs,
    });
  } finally {
    // Close the browser
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }
  }
});

// Cleanup on process exit
process.on('SIGTERM', async () => {
  console.log('[Download] Received SIGTERM, closing browser...');
  await closeBrowser();
});

export default router;
