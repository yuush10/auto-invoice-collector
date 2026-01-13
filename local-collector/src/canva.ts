/**
 * Canva Local Collector
 * Automated invoice download for Canva (canva.com) using local browser
 *
 * Flow:
 * 1. Navigate to login page
 * 2. User manually completes Google OAuth login
 * 3. Automation navigates to billing page
 * 4. Downloads invoice PDF
 */
import { Page } from 'puppeteer-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CollectionResult, DownloadedFile } from './collector';

const LOGIN_URL = 'https://www.canva.com/login';
const PURCHASE_HISTORY_URL = 'https://www.canva.com/settings/purchase-history';

/**
 * Canva Collector for local browser automation
 */
export class CanvaCollector {
  private page: Page;
  private debug: boolean;
  private debugDir: string;

  constructor(page: Page, debug: boolean = false) {
    this.page = page;
    this.debug = debug;
    this.debugDir = path.join(os.tmpdir(), 'canva-debug');
  }

  /**
   * Main collection method
   */
  async collect(targetMonth: string): Promise<CollectionResult> {
    try {
      // Initialize debug directory if needed
      if (this.debug) {
        fs.mkdirSync(this.debugDir, { recursive: true });
        console.log(`[Canva] Debug mode enabled. Output: ${this.debugDir}`);
      }

      // Step 1: Navigate to login page
      console.log('\n[Canva] Navigating to login page...');
      await this.page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

      // Step 2: Wait for manual login
      console.log('');
      console.log('='.repeat(60));
      console.log('MANUAL ACTION REQUIRED:');
      console.log('');
      console.log('1. Click "Continue with Google"');
      console.log('2. Sign in with your Google account');
      console.log('3. Complete any 2FA if prompted');
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

      console.log('[Canva] Login successful!');

      // Step 3: Navigate to purchase history page
      await this.navigateToPurchaseHistory();

      // Step 4: Download invoice via "More actions" menu
      const files = await this.downloadInvoiceViaMenu(targetMonth);

      if (files.length === 0) {
        return {
          success: false,
          files: [],
          error: 'No invoice found for the target month',
        };
      }

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
      if (!currentUrl.includes('/login') && !currentUrl.includes('accounts.google.com')) {
        console.log('[Canva] Detected page change - login completed');
        await this.wait(2000); // Wait for page to stabilize
        return true;
      }

      // Check for dashboard indicators
      const dashboardExists = await this.elementExists('[class*="home"], [class*="dashboard"]');
      if (dashboardExists) {
        console.log('[Canva] Detected dashboard - logged in');
        return true;
      }

      await this.wait(pollInterval);
    }

    return false;
  }

  /**
   * Navigate to purchase history page
   */
  private async navigateToPurchaseHistory(): Promise<void> {
    console.log('[Canva] Navigating to purchase history page...');

    await this.page.goto(PURCHASE_HISTORY_URL, { waitUntil: 'networkidle2' });
    await this.wait(3000);

    // Dismiss cookie consent dialog if present
    await this.dismissCookieDialog();

    console.log('[Canva] On purchase history page');

    // Take screenshot for debugging
    await this.dumpPageState('01-purchase-history');
  }

  /**
   * Dismiss cookie consent dialog if present
   */
  private async dismissCookieDialog(): Promise<void> {
    try {
      // Check for cookie dialog
      const cookieDialog = await this.page.$('[role="dialog"]');
      if (!cookieDialog) return;

      // Check if it's a cookie consent dialog
      const dialogText = await this.page.evaluate((el) => el?.textContent || '', cookieDialog);
      if (!dialogText.toLowerCase().includes('cookie')) return;

      console.log('[Canva] Cookie consent dialog detected, dismissing...');

      // Try to click "Accept all cookies" button
      const accepted = await this.page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = (btn.textContent || '').toLowerCase();
          if (text.includes('accept') && text.includes('cookie')) {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      });

      if (accepted) {
        console.log('[Canva] Clicked "Accept all cookies"');
        await this.wait(1000); // Wait for dialog to close
      } else {
        // Try clicking any close button or outside the dialog
        const closed = await this.page.evaluate(() => {
          // Try close button
          const closeBtn = document.querySelector('[aria-label="Close"], [aria-label="close"], button[class*="close"]');
          if (closeBtn) {
            (closeBtn as HTMLElement).click();
            return true;
          }
          return false;
        });
        if (closed) {
          console.log('[Canva] Closed cookie dialog via close button');
          await this.wait(1000);
        }
      }
    } catch (e) {
      console.log(`[Canva] Cookie dialog handling error: ${(e as Error).message}`);
    }
  }

  /**
   * Dump page state for debugging
   */
  private async dumpPageState(context: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(this.debugDir, `${timestamp}-${context}.png`);

    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[Canva] Screenshot saved: ${screenshotPath}`);

    if (!this.debug) return;

    // Dump all button elements with their attributes
    const buttonInfo = await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.map((btn) => ({
        ariaLabel: btn.getAttribute('aria-label'),
        className: btn.className,
        textContent: (btn.textContent || '').trim().substring(0, 50),
        dataAttributes: Array.from(btn.attributes)
          .filter((attr) => attr.name.startsWith('data-'))
          .map((attr) => `${attr.name}="${attr.value}"`),
      }));
    });

    const buttonDumpPath = path.join(this.debugDir, `${timestamp}-${context}-buttons.json`);
    fs.writeFileSync(buttonDumpPath, JSON.stringify(buttonInfo, null, 2));
    console.log(`[Canva] Button dump saved: ${buttonDumpPath}`);
  }

  /**
   * Dump menu structure for debugging
   */
  private async dumpMenuStructure(): Promise<void> {
    if (!this.debug) return;

    const menuInfo = await this.page.evaluate(() => {
      const menuContainers = document.querySelectorAll(
        '[role="menu"], [role="listbox"], [role="dialog"], ' +
          '[data-radix-popper-content-wrapper], [data-floating-ui-portal], ' +
          '[class*="dropdown"], [class*="menu"], [class*="popover"]'
      );

      return Array.from(menuContainers).map((container) => ({
        role: container.getAttribute('role'),
        className: container.className,
        isVisible: window.getComputedStyle(container).display !== 'none',
        children: Array.from(container.querySelectorAll('*'))
          .map((child) => ({
            tagName: child.tagName,
            role: child.getAttribute('role'),
            textContent: (child.textContent || '').trim().substring(0, 100),
            ariaLabel: child.getAttribute('aria-label'),
          }))
          .slice(0, 50),
      }));
    });

    console.log('[Canva] Menu structures found:', JSON.stringify(menuInfo, null, 2));
  }

  /**
   * Find and click "More actions" button using multiple strategies
   */
  private async findMoreActionsButton(): Promise<boolean> {
    const strategies: Array<{ name: string; fn: () => Promise<boolean> }> = [
      // Strategy 1: Original aria-label with Puppeteer click (more reliable)
      {
        name: 'aria-label="More actions" (Puppeteer click)',
        fn: async () => {
          const btn = await this.page.$('button[aria-label="More actions"]');
          if (btn) {
            // Scroll button into view to ensure it's clickable and menu appears in viewport
            await btn.evaluate((el) => {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            await this.wait(500);

            // Use Puppeteer's click which simulates real mouse events
            await btn.click();
            await this.wait(1000); // Longer wait for menu animation

            // Verify menu opened by checking for new elements
            const menuOpened = await this.page.evaluate(() => {
              const menus = document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]');
              return menus.length > 0;
            });
            if (menuOpened) return true;
            // If menu didn't open, try clicking again
            console.log('[Canva] First click did not open menu, retrying...');
            await btn.click();
            await this.wait(1000);
            return true;
          }
          return false;
        },
      },

      // Strategy 2: Localized aria-label variants
      {
        name: 'localized aria-labels',
        fn: async () => {
          const locales = ['More actions', 'その他の操作', 'More', 'Options', 'Actions', '...'];
          for (const label of locales) {
            const btn = await this.page.$(`button[aria-label="${label}"]`);
            if (btn) {
              await btn.click();
              return true;
            }
          }
          return false;
        },
      },

      // Strategy 3: Three-dot icon by SVG content pattern
      {
        name: 'three-dot SVG icon',
        fn: async () => {
          const clicked = await this.page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
              const svg = btn.querySelector('svg');
              if (svg) {
                // Check for common "more" patterns: 3 circles or ellipses
                const circles = svg.querySelectorAll('circle, ellipse');
                if (circles.length === 3) {
                  (btn as HTMLElement).click();
                  return true;
                }
                // Check for path-based three dots
                const svgContent = svg.innerHTML;
                if (
                  svgContent.includes('M') &&
                  (svgContent.match(/circle/gi) || []).length >= 3
                ) {
                  (btn as HTMLElement).click();
                  return true;
                }
              }
            }
            return false;
          });
          return clicked;
        },
      },

      // Strategy 4: Button containing only SVG (likely icon button) near invoice row
      {
        name: 'icon-only button in table row',
        fn: async () => {
          const clicked = await this.page.evaluate(() => {
            // Find buttons that appear to be icon-only buttons
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
              const hasOnlySvg = btn.children.length === 1 && btn.children[0].tagName === 'SVG';
              const hasSvgWithSmallText =
                btn.querySelector('svg') &&
                (btn.textContent || '').trim().length < 3;

              if (hasOnlySvg || hasSvgWithSmallText) {
                // Check if it's near a table or list structure
                const parent = btn.closest('tr, [role="row"], li, [class*="row"]');
                if (parent) {
                  (btn as HTMLElement).click();
                  return true;
                }
              }
            }
            return false;
          });
          return clicked;
        },
      },

      // Strategy 5: XPath by partial aria-label match
      {
        name: 'XPath partial aria-label',
        fn: async () => {
          const buttons = await this.page.$x(
            "//button[contains(@aria-label, 'action') or contains(@aria-label, 'Action') or contains(@aria-label, 'more') or contains(@aria-label, 'More') or contains(@aria-label, 'menu') or contains(@aria-label, 'Menu')]"
          );
          if (buttons.length > 0) {
            await (buttons[0] as any).click();
            return true;
          }
          return false;
        },
      },

      // Strategy 6: Button with kebab/ellipsis class patterns
      {
        name: 'class pattern (kebab/ellipsis)',
        fn: async () => {
          const selectors = [
            'button[class*="kebab"]',
            'button[class*="ellipsis"]',
            'button[class*="more"]',
            'button[class*="action"]',
            'button[class*="dropdown"]',
            'button[class*="menu-trigger"]',
          ];
          for (const selector of selectors) {
            const btn = await this.page.$(selector);
            if (btn) {
              await btn.click();
              return true;
            }
          }
          return false;
        },
      },
    ];

    for (const strategy of strategies) {
      console.log(`[Canva] Trying button strategy: ${strategy.name}...`);
      try {
        if (await strategy.fn()) {
          console.log(`[Canva] Button found via: ${strategy.name}`);
          return true;
        }
      } catch (e) {
        console.log(`[Canva] Strategy "${strategy.name}" failed: ${(e as Error).message}`);
      }
    }

    return false;
  }

  /**
   * Wait for menu to appear using multiple detection methods
   * Specifically looks for dropdown menus with download-related items
   */
  private async waitForMenuToAppear(): Promise<boolean> {
    // Short wait for menu animation - need to be fast!
    await this.wait(500);

    // Look for actual dropdown menu items (role="menuitem" or role="option") with download text
    const hasMenuWithDownload = await this.page.evaluate(() => {
      // Check for menuitem or option elements with download text
      const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"]');
      for (const item of menuItems) {
        const text = (item.textContent || '').toLowerCase();
        if (text.includes('download')) {
          return true;
        }
      }

      // Check for high z-index elements that look like dropdown menus
      const floatingElements = document.querySelectorAll(
        '[data-radix-popper-content-wrapper], [data-floating-ui-portal], ' +
        '[class*="popover"]:not([class*="sidebar"]), [role="menu"]'
      );
      for (const el of floatingElements) {
        const style = window.getComputedStyle(el);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
        const text = (el.textContent || '').toLowerCase();
        // Must be visible and contain download-related text
        if (isVisible && text.includes('download') && text.length < 500) {
          return true;
        }
      }

      return false;
    });

    if (hasMenuWithDownload) {
      console.log('[Canva] Dropdown menu with download option detected');
      return true;
    }

    // Check for any visible menu structure
    const menuSelectors = [
      '[role="menu"]',
      '[role="listbox"]',
      '[data-radix-popper-content-wrapper]',
    ];

    for (const selector of menuSelectors) {
      const found = await this.page.$(selector);
      if (found) {
        // Count menuitem children to verify it's a real dropdown
        const menuItemCount = await this.page.evaluate((sel) => {
          const menu = document.querySelector(sel);
          if (!menu) return 0;
          return menu.querySelectorAll('[role="menuitem"], [role="option"], button, a').length;
        }, selector);

        if (menuItemCount > 0) {
          console.log(`[Canva] Menu appeared with ${menuItemCount} items (selector: ${selector})`);
          return true;
        }
      }
    }

    console.log('[Canva] No dropdown menu detected');
    return false;
  }

  /**
   * Find and click "Download invoice" menu item using multiple strategies
   */
  private async findAndClickDownloadInvoice(): Promise<boolean> {
    const textVariants = [
      'Download invoice',
      '請求書をダウンロード',
      'Download Invoice',
      'download invoice',
      'Invoice',
      'Download PDF',
      'Download',
      'ダウンロード',
    ];

    const strategies: Array<{ name: string; fn: () => Promise<boolean> }> = [
      // Strategy 1: role="menuitem" with text
      {
        name: 'menuitem with text',
        fn: async () => {
          for (const text of textVariants) {
            const items = await this.page.$x(
              `//*[@role="menuitem"][contains(text(), "${text}")]`
            );
            if (items.length > 0) {
              await (items[0] as any).click();
              return true;
            }
          }
          return false;
        },
      },

      // Strategy 2: XPath exact text match
      {
        name: 'XPath exact text',
        fn: async () => {
          const xpathQueries = textVariants.map(
            (text) =>
              `//p[normalize-space(text())='${text}'] | //span[normalize-space(text())='${text}'] | //*[normalize-space(text())='${text}']`
          );
          for (const xpath of xpathQueries) {
            try {
              const elements = await this.page.$x(xpath);
              if (elements.length > 0) {
                await (elements[0] as any).click();
                return true;
              }
            } catch {
              // Continue
            }
          }
          return false;
        },
      },

      // Strategy 3: Any clickable element in menu container with matching text
      {
        name: 'text in menu container',
        fn: async () => {
          const clicked = await this.page.evaluate((texts: string[]) => {
            const lowerTexts = texts.map((t) => t.toLowerCase());

            // Find menu containers
            const menuContainers = document.querySelectorAll(
              '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], ' +
                '[data-floating-ui-portal], [class*="dropdown"], [class*="popover"]'
            );

            for (const container of menuContainers) {
              const elements = container.querySelectorAll('*');
              for (const el of elements) {
                const text = (el.textContent || '').trim().toLowerCase();
                if (
                  lowerTexts.some(
                    (t) =>
                      text === t ||
                      (text.includes('download') && text.includes('invoice'))
                  )
                ) {
                  (el as HTMLElement).click();
                  return true;
                }
              }
            }
            return false;
          }, textVariants);
          return clicked;
        },
      },

      // Strategy 4: Element with download icon (SVG) + invoice text nearby
      {
        name: 'download icon + invoice text',
        fn: async () => {
          const clicked = await this.page.evaluate(() => {
            const menuItems = document.querySelectorAll(
              '[role="menuitem"], [role="option"], [class*="menu"] > *, [class*="dropdown"] > *'
            );
            for (const item of menuItems) {
              const text = (item.textContent || '').toLowerCase();
              const hasSvg = item.querySelector('svg');
              if (hasSvg && (text.includes('invoice') || text.includes('download'))) {
                (item as HTMLElement).click();
                return true;
              }
            }
            return false;
          });
          return clicked;
        },
      },

      // Strategy 5: First download option in any visible menu
      {
        name: 'first download option',
        fn: async () => {
          const clicked = await this.page.evaluate(() => {
            const items = document.querySelectorAll('[role="menuitem"], [role="option"]');
            for (const item of items) {
              const text = (item.textContent || '').toLowerCase();
              if (text.includes('download')) {
                (item as HTMLElement).click();
                return true;
              }
            }
            return false;
          });
          return clicked;
        },
      },

      // Strategy 6: Direct text content scan (leaf nodes)
      {
        name: 'direct text content scan',
        fn: async () => {
          const clicked = await this.page.evaluate((texts: string[]) => {
            const lowerTexts = texts.map((t) => t.toLowerCase());
            const all = document.querySelectorAll('*');

            for (const el of all) {
              // Check direct text content (not including children)
              const directText = Array.from(el.childNodes)
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent?.trim())
                .join('');

              if (
                directText &&
                lowerTexts.some((t) => directText.toLowerCase() === t)
              ) {
                (el as HTMLElement).click();
                return true;
              }

              // Also check full text content for leaf nodes
              if (el.children.length === 0) {
                const text = (el.textContent || '').trim().toLowerCase();
                if (lowerTexts.some((t) => text === t)) {
                  (el as HTMLElement).click();
                  return true;
                }
              }
            }
            return false;
          }, textVariants);
          return clicked;
        },
      },
    ];

    // Try strategies immediately - menu may close quickly!
    for (const strategy of strategies) {
      console.log(`[Canva] Trying download strategy: ${strategy.name}...`);
      try {
        if (await strategy.fn()) {
          console.log(`[Canva] Download clicked via: ${strategy.name}`);
          return true;
        }
      } catch (e) {
        console.log(`[Canva] Strategy "${strategy.name}" failed: ${(e as Error).message}`);
      }
    }

    return false;
  }

  /**
   * Download invoice via "More actions" dropdown menu
   */
  private async downloadInvoiceViaMenu(targetMonth: string): Promise<DownloadedFile[]> {
    console.log(`[Canva] Looking for invoices for ${targetMonth}...`);
    const files: DownloadedFile[] = [];
    const downloadDir = path.join(os.tmpdir(), `canva-download-${Date.now()}`);
    fs.mkdirSync(downloadDir, { recursive: true });

    try {
      // Configure CDP for download
      const client = await this.page.createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
      });

      // Step 1: Find and click "More actions" button with retry
      console.log('[Canva] Looking for "More actions" button...');

      let menuAppeared = false;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`[Canva] Attempt ${attempt}/${maxRetries} to open menu and click download...`);

        const moreActionsClicked = await this.findMoreActionsButton();

        if (!moreActionsClicked) {
          console.log('[Canva] ERROR: "More actions" button not found');
          await this.dumpPageState('02-no-more-actions-button');
          // Fallback to page capture
          const pagePdf = await this.capturePageAsPdf(targetMonth);
          if (pagePdf) files.push(pagePdf);
          return files;
        }

        console.log('[Canva] Clicked "More actions" button, waiting for menu...');

        // Step 2: Wait for menu to appear
        menuAppeared = await this.waitForMenuToAppear();

        if (!menuAppeared) {
          console.log(`[Canva] Menu did not open on attempt ${attempt}, will retry...`);
          await this.wait(500);
          // Click elsewhere to close any partially opened menu
          await this.page.click('body');
          await this.wait(500);
          continue;
        }

        console.log('[Canva] Menu opened, immediately clicking download...');

        // IMMEDIATELY try to click download - menu may close quickly!
        const downloadClicked = await this.findAndClickDownloadInvoice();

        if (downloadClicked) {
          console.log('[Canva] Successfully clicked "Download invoice"');
          // Debug: Take screenshot after successful click
          await this.dumpPageState('03-after-download-click');

          // Wait for download to initiate
          await this.wait(5000);

          // Log download directory contents
          const initialFiles = fs.readdirSync(downloadDir);
          console.log(`[Canva] Files in download dir: ${initialFiles.join(', ') || '(none)'}`);

          // Wait for download to complete
          const file = await this.waitForDownload(downloadDir, targetMonth);
          if (file) {
            files.push(file);
            console.log(`[Canva] Downloaded: ${file.filename}`);
            return files; // Success!
          } else {
            console.log('[Canva] Download did not complete');
            await this.dumpPageState('04-download-failed');
          }
          break; // Exit retry loop even if download failed
        }

        console.log(`[Canva] Could not click download on attempt ${attempt}`);
        await this.dumpPageState(`03-attempt-${attempt}-failed`);

        // Click elsewhere to close menu before retry
        await this.page.click('body');
        await this.wait(500);
      }

      // If we get here, all attempts failed - use fallback
      if (files.length === 0) {
        console.log('[Canva] All attempts failed, capturing page as fallback...');
        const pagePdf = await this.capturePageAsPdf(targetMonth);
        if (pagePdf) files.push(pagePdf);
      }

      return files;
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
   * Wait for download to complete
   */
  private async waitForDownload(
    downloadDir: string,
    targetMonth: string
  ): Promise<DownloadedFile | null> {
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

    // Generate proper filename (YYYY-MM-ServiceName-DocType format)
    const filename = `${targetMonth}-Canva-請求書.pdf`;

    // Clean up
    fs.unlinkSync(filePath);

    return {
      filename,
      data: buffer,
      mimeType: 'application/pdf',
    };
  }

  /**
   * Capture current page as PDF (fallback)
   */
  private async capturePageAsPdf(targetMonth: string): Promise<DownloadedFile | null> {
    try {
      const buffer = await this.page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      });

      return {
        filename: `${targetMonth}-Canva-billing.pdf`,
        data: Buffer.from(buffer),
        mimeType: 'application/pdf',
      };
    } catch (error) {
      console.log(`[Canva] Page PDF capture failed: ${(error as Error).message}`);
      return null;
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
   * Sleep utility
   */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
