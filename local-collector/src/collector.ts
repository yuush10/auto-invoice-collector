import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer-core';

// Add stealth plugin to hide automation indicators from Cloudflare
puppeteer.use(StealthPlugin());
import ora from 'ora';
import { IBJCollector } from './ibj';
import { CanvaCollector } from './canva';
import { Uploader } from './uploader';
import { OtpService } from './otp';

export interface CollectorOptions {
  vendorKey: string;
  token?: string;
  targetMonth?: string;
  headless: boolean;
  skipUpload: boolean;
}

export interface CollectionResult {
  success: boolean;
  files: DownloadedFile[];
  error?: string;
}

export interface DownloadedFile {
  filename: string;
  data: Buffer;
  mimeType: string;
}

export class Collector {
  private options: CollectorOptions;
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(options: CollectorOptions) {
    this.options = options;
  }

  async run(): Promise<void> {
    const spinner = ora();

    try {
      // Validate options
      this.validateOptions();

      // Calculate target month
      const targetMonth = this.getTargetMonth();
      console.log(`\n📅 Target month: ${targetMonth}`);
      console.log(`🏢 Vendor: ${this.options.vendorKey.toUpperCase()}`);
      console.log('');

      // Launch browser
      spinner.start('Launching browser...');
      await this.launchBrowser();
      spinner.succeed('Browser launched');

      // Run vendor-specific collection
      spinner.start(`Starting ${this.options.vendorKey.toUpperCase()} collection...`);
      const result = await this.collectFromVendor(targetMonth);

      if (!result.success) {
        spinner.fail(`Collection failed: ${result.error}`);
        return;
      }

      spinner.succeed(`Downloaded ${result.files.length} file(s)`);

      // Upload to Google Drive
      if (!this.options.skipUpload && result.files.length > 0) {
        spinner.start('Uploading to Google Drive...');
        const uploader = new Uploader(this.options.token);

        for (const file of result.files) {
          await uploader.upload(file, this.options.vendorKey, targetMonth);
        }

        spinner.succeed('Files uploaded to Google Drive');
      }

      console.log('\n✅ Collection completed successfully!');

    } catch (error) {
      spinner.fail(`Error: ${(error as Error).message}`);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private validateOptions(): void {
    const supportedVendors = ['ibj', 'canva'];

    if (!supportedVendors.includes(this.options.vendorKey.toLowerCase())) {
      throw new Error(`Unsupported vendor: ${this.options.vendorKey}. Supported: ${supportedVendors.join(', ')}`);
    }
  }

  private getTargetMonth(): string {
    if (this.options.targetMonth) {
      // Validate format
      if (!/^\d{4}-\d{2}$/.test(this.options.targetMonth)) {
        throw new Error('Target month must be in YYYY-MM format');
      }
      return this.options.targetMonth;
    }

    // Default to previous month
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = prevMonth.getFullYear();
    const month = String(prevMonth.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private async launchBrowser(): Promise<void> {
    // Find Chrome executable path
    const chromePath = this.findChromePath();
    console.log(`Using Chrome at: ${chromePath}`);

    // Launch with stealth-friendly options
    // The stealth plugin handles user agent, webdriver flag, etc.
    this.browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: this.options.headless,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1280,720',
        '--start-maximized',
      ],
      defaultViewport: {
        width: 1280,
        height: 670,
      },
      ignoreDefaultArgs: ['--enable-automation'],
    });

    if (!this.browser) {
      throw new Error('Failed to launch browser');
    }
    this.page = await this.browser.newPage();
    // User agent is handled by stealth plugin - no manual override needed
  }

  private findChromePath(): string {
    const fs = require('fs');
    const possiblePaths = [
      // macOS Chrome paths
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      // macOS Brave
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      // macOS Edge
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];

    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        return path;
      }
    }

    throw new Error(
      'Chrome not found. Please install Google Chrome from https://www.google.com/chrome/'
    );
  }

  private async collectFromVendor(targetMonth: string): Promise<CollectionResult> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const vendorKey = this.options.vendorKey.toLowerCase();

    switch (vendorKey) {
      case 'ibj':
        const ibjCollector = new IBJCollector(this.page, new OtpService());
        return await ibjCollector.collect(targetMonth);

      case 'canva':
        const canvaCollector = new CanvaCollector(this.page);
        return await canvaCollector.collect(targetMonth);

      default:
        throw new Error(`Vendor ${vendorKey} not implemented`);
    }
  }

  private async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
