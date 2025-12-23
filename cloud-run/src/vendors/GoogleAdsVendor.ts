/**
 * Google Ads Vendor Implementation
 * Uses Google Ads API for invoice download (not browser automation)
 *
 * Portal Information:
 * - Billing URL: https://ads.google.com/aw/billing/documents
 * - Vendor Key: google-ads
 *
 * Authentication:
 * - Uses OAuth2 with refresh token
 * - Requires Google Ads API developer token
 * - No browser automation needed
 *
 * Prerequisites:
 * - Monthly invoicing must be enabled on the Google Ads account
 * - Google Ads API access must be approved
 */
import { Page } from 'puppeteer';
import { GoogleAdsApi, enums, services } from 'google-ads-api';
import { BaseVendor } from './BaseVendor';
import { VendorCredentials, DownloadOptions, DownloadedFile } from './types';

/**
 * Extended credentials for Google Ads API
 */
interface GoogleAdsCredentials extends VendorCredentials {
  /** Google Ads API developer token */
  developerToken: string;
  /** OAuth2 client ID */
  clientId: string;
  /** OAuth2 client secret */
  clientSecret: string;
  /** OAuth2 refresh token */
  refreshToken: string;
  /** Google Ads customer ID (10-digit number without dashes) */
  customerId: string;
  /** Billing setup ID for invoice queries */
  billingSetupId: string;
  /** Login customer ID for manager accounts (optional) */
  loginCustomerId?: string;
}

/**
 * Month name enum mapping
 */
const MONTH_NAMES: { [key: number]: keyof typeof enums.MonthOfYear } = {
  1: 'JANUARY',
  2: 'FEBRUARY',
  3: 'MARCH',
  4: 'APRIL',
  5: 'MAY',
  6: 'JUNE',
  7: 'JULY',
  8: 'AUGUST',
  9: 'SEPTEMBER',
  10: 'OCTOBER',
  11: 'NOVEMBER',
  12: 'DECEMBER',
};

/**
 * Google Ads vendor implementation using API
 */
export class GoogleAdsVendor extends BaseVendor {
  vendorKey = 'google-ads';
  vendorName = 'Google Ads';
  loginUrl = 'https://ads.google.com/aw/billing/documents';

  private credentials: GoogleAdsCredentials | null = null;
  private apiClient: GoogleAdsApi | null = null;

  /**
   * Store credentials for API access
   * No browser login needed - uses API with OAuth tokens
   */
  async login(page: Page, credentials: VendorCredentials): Promise<void> {
    this.credentials = credentials as GoogleAdsCredentials;

    // Validate required fields
    if (!this.credentials.developerToken) {
      throw new Error('Google Ads developer token is required');
    }
    if (!this.credentials.clientId || !this.credentials.clientSecret) {
      throw new Error('Google Ads OAuth2 client credentials are required');
    }
    if (!this.credentials.refreshToken) {
      throw new Error('Google Ads refresh token is required');
    }
    if (!this.credentials.customerId) {
      throw new Error('Google Ads customer ID is required');
    }
    if (!this.credentials.billingSetupId) {
      throw new Error('Google Ads billing setup ID is required');
    }

    // Initialize API client
    this.apiClient = new GoogleAdsApi({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      developer_token: this.credentials.developerToken,
    });

    this.log('API client initialized');
  }

  /**
   * Check if credentials are set (API is always "logged in" with valid credentials)
   */
  async isLoggedIn(page: Page): Promise<boolean> {
    return this.credentials !== null && this.apiClient !== null;
  }

  /**
   * No navigation needed for API-based vendor
   */
  async navigateToInvoices(page: Page): Promise<void> {
    // No-op: API access doesn't require navigation
    this.log('Using API access - no navigation needed');
  }

  /**
   * Download invoices using Google Ads API
   */
  async downloadInvoices(page: Page, options?: DownloadOptions): Promise<DownloadedFile[]> {
    if (!this.credentials || !this.apiClient) {
      throw new Error('Not authenticated. Call login() first.');
    }

    const files: DownloadedFile[] = [];

    // Determine target month
    const { year, month, monthName } = this.getTargetMonth(options?.targetMonth);
    this.log(`Fetching invoices for ${year}-${month.toString().padStart(2, '0')}`);

    try {
      // Create customer instance
      const customer = this.apiClient.Customer({
        customer_id: this.credentials.customerId,
        refresh_token: this.credentials.refreshToken,
        login_customer_id: this.credentials.loginCustomerId,
      });

      // Build billing setup resource name
      const billingSetup = `customers/${this.credentials.customerId}/billingSetups/${this.credentials.billingSetupId}`;

      // List invoices for the specified month
      this.log(`Querying invoices for billing setup: ${billingSetup}`);
      const request = {
        customer_id: this.credentials.customerId,
        billing_setup: billingSetup,
        issue_year: year,
        issue_month: enums.MonthOfYear[monthName],
      } as unknown as services.ListInvoicesRequest;
      const response = await customer.invoices.listInvoices(request);

      const invoices = response.invoices || [];
      this.log(`Found ${invoices.length} invoice(s)`);

      // Download each invoice PDF
      for (const invoice of invoices) {
        if (!invoice.pdf_url) {
          this.log(`Invoice ${invoice.id} has no PDF URL, skipping`);
          continue;
        }

        try {
          // Get OAuth access token for PDF download
          const accessToken = await this.getAccessToken();

          // Download PDF from pdf_url
          const pdfBuffer = await this.downloadPdf(invoice.pdf_url, accessToken);

          // Format billing month
          const billingMonth = `${year}-${month.toString().padStart(2, '0')}`;

          // Create downloaded file object
          const downloadedFile: DownloadedFile = {
            filename: `GoogleAds-請求書-${billingMonth}.pdf`,
            base64: pdfBuffer.toString('base64'),
            mimeType: 'application/pdf',
            fileSize: pdfBuffer.length,
            documentType: 'invoice',
            billingMonth,
            serviceName: 'Google Ads',
          };

          files.push(downloadedFile);
          this.log(`Downloaded: ${downloadedFile.filename} (${downloadedFile.fileSize} bytes)`);
        } catch (error) {
          this.log(`Error downloading invoice ${invoice.id}: ${(error as Error).message}`, 'error');
        }
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.log(`API error: ${errorMessage}`, 'error');

      // Provide helpful error messages
      if (errorMessage.includes('PERMISSION_DENIED')) {
        throw new Error('Permission denied. Check if the account has invoice access enabled.');
      } else if (errorMessage.includes('INVALID_ARGUMENT')) {
        throw new Error('Invalid argument. Check customer ID and billing setup ID.');
      } else if (errorMessage.includes('UNAUTHENTICATED')) {
        throw new Error('Authentication failed. Refresh token may be expired.');
      } else {
        throw new Error(`Google Ads API error: ${errorMessage}`);
      }
    }

    this.log(`Download complete: ${files.length} file(s)`);
    return files;
  }

  /**
   * Get target month for invoice query
   * Defaults to previous month if not specified
   */
  private getTargetMonth(targetMonth?: string): {
    year: string;
    month: number;
    monthName: keyof typeof enums.MonthOfYear;
  } {
    let date: Date;

    if (targetMonth) {
      // Parse YYYY-MM format
      const [yearStr, monthStr] = targetMonth.split('-');
      date = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
    } else {
      // Default to previous month
      date = new Date();
      date.setMonth(date.getMonth() - 1);
    }

    const year = date.getFullYear().toString();
    const month = date.getMonth() + 1;
    const monthName = MONTH_NAMES[month];

    return { year, month, monthName };
  }

  /**
   * Get OAuth2 access token for API requests
   */
  private async getAccessToken(): Promise<string> {
    if (!this.credentials) {
      throw new Error('Credentials not set');
    }

    // Exchange refresh token for access token
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get access token: ${error}`);
    }

    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  /**
   * Download PDF from URL with authentication
   */
  private async downloadPdf(pdfUrl: string, accessToken: string): Promise<Buffer> {
    this.log(`Downloading PDF from: ${pdfUrl}`);

    const response = await fetch(pdfUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('PDF download authentication failed. Access token may be invalid.');
      } else if (response.status === 404) {
        throw new Error('PDF not found. Invoice may not be available yet.');
      } else {
        throw new Error(`PDF download failed with status ${response.status}`);
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Log message with vendor prefix
   */
  protected log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = `[${this.vendorKey}]`;
    if (level === 'error') {
      console.error(`${prefix} ${message}`);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }
}
