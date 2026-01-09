/**
 * Vendor automation types for Phase 3
 */
import { Page } from 'puppeteer';

/**
 * Vendor credentials retrieved from Secret Manager (browser-based vendors)
 */
export interface VendorCredentials {
  username: string;
  password: string;
  // Optional fields for vendors with additional auth requirements
  mfaSecret?: string;
  apiKey?: string;
  accountId?: string;
  // Cookie-based auth (for OAuth services)
  cookies?: string;
  // Chrome profile path (for services requiring existing login session)
  chromeProfilePath?: string;
}

/**
 * Google Ads API credentials (API-based vendor)
 * These are OAuth2 credentials, not username/password
 */
export interface GoogleAdsCredentials {
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
 * Options for invoice download
 */
export interface DownloadOptions {
  /** Target month to download (YYYY-MM format) */
  targetMonth?: string;
  /** Maximum number of invoices to download */
  limit?: number;
  /** Include receipts in addition to invoices */
  includeReceipts?: boolean;
}

/**
 * Downloaded file information
 */
export interface DownloadedFile {
  /** Original filename from the vendor */
  filename: string;
  /** Base64 encoded file content */
  base64: string;
  /** MIME type of the file */
  mimeType: string;
  /** File size in bytes */
  fileSize: number;
  /** Document type if detectable */
  documentType?: 'invoice' | 'receipt' | 'unknown';
  /** Billing month if detectable (YYYY-MM) */
  billingMonth?: string;
  /** Service name extracted from OCR */
  serviceName?: string;
  /** Suggested filename (YYYY-MM-ServiceName-{請求書|領収書}.pdf) */
  suggestedFilename?: string;
  /** OCR confidence score (0-1) */
  ocrConfidence?: number;
  /** OCR notes/reasoning */
  ocrNotes?: string;
}

/**
 * Request payload for download endpoint
 */
export interface DownloadRequest {
  /** Vendor identifier (must be in whitelist) */
  vendorKey: string;
  /** Optional target URL to navigate to */
  targetUrl?: string;
  /** Download options */
  options?: DownloadOptions;
  /** Optional credentials (fallback if Secret Manager unavailable) */
  credentials?: VendorCredentials;
}

/**
 * Response from download endpoint
 */
export interface DownloadResponse {
  success: boolean;
  vendorKey: string;
  files: DownloadedFile[];
  error?: string;
  /** Debug information */
  debug?: {
    screenshots?: string[];
    logs?: string[];
    duration?: number;
  };
}

/**
 * Vendor automation interface
 * Each vendor implementation must implement this interface
 */
export interface VendorAutomation {
  /** Unique vendor identifier */
  vendorKey: string;

  /** Vendor display name */
  vendorName: string;

  /** Login page URL */
  loginUrl: string;

  /**
   * Perform login to the vendor portal
   * @param page Puppeteer page instance
   * @param credentials Vendor credentials
   * @throws Error if login fails
   */
  login(page: Page, credentials: VendorCredentials): Promise<void>;

  /**
   * Navigate to the invoices/billing section
   * @param page Puppeteer page instance
   */
  navigateToInvoices(page: Page): Promise<void>;

  /**
   * Download invoices from the vendor portal
   * @param page Puppeteer page instance
   * @param options Download options
   * @returns Array of downloaded files
   */
  downloadInvoices(page: Page, options?: DownloadOptions): Promise<DownloadedFile[]>;

  /**
   * Verify successful login
   * @param page Puppeteer page instance
   * @returns true if logged in successfully
   */
  isLoggedIn(page: Page): Promise<boolean>;
}

/**
 * Vendor configuration stored in whitelist
 */
export interface VendorConfig {
  /** Unique vendor identifier */
  vendorKey: string;

  /** Vendor display name */
  vendorName: string;

  /** Secret Manager secret name for credentials */
  secretName: string;

  /** Whether this vendor is enabled */
  enabled: boolean;

  /** Domain patterns for URL matching */
  domainPatterns: string[];

  /** Special handling required (e.g., 'api' for Google Ads) */
  specialHandling?: 'api' | 'oauth' | 'mfa-required';
}

/**
 * Whitelist of approved vendors
 */
export const VENDOR_WHITELIST: VendorConfig[] = [
  {
    vendorKey: 'ibj',
    vendorName: 'IBJ',
    secretName: 'vendor-ibj-credentials',
    enabled: true,
    domainPatterns: ['ibjapan.com'],
  },
  {
    vendorKey: 'aitemasu',
    vendorName: 'Aitemasu',
    secretName: 'vendor-aitemasu-credentials',
    enabled: true,
    domainPatterns: ['aitemasu.me'],
  },
  {
    vendorKey: 'google-ads',
    vendorName: 'Google Ads',
    secretName: 'vendor-google-ads-credentials',
    enabled: true,
    domainPatterns: ['ads.google.com'],
    specialHandling: 'api',
  },
  {
    vendorKey: 'canva',
    vendorName: 'Canva',
    secretName: 'vendor-canva-credentials',
    enabled: true,
    domainPatterns: ['canva.com'],
    specialHandling: 'oauth',
  },
];

/**
 * Get vendor config by key
 */
export function getVendorConfig(vendorKey: string): VendorConfig | undefined {
  return VENDOR_WHITELIST.find(v => v.vendorKey === vendorKey && v.enabled);
}

/**
 * Get vendor config by domain
 */
export function getVendorConfigByDomain(domain: string): VendorConfig | undefined {
  return VENDOR_WHITELIST.find(
    v => v.enabled && v.domainPatterns.some(pattern => domain.includes(pattern))
  );
}

/**
 * Check if a vendor is in the whitelist
 */
export function isVendorWhitelisted(vendorKey: string): boolean {
  return VENDOR_WHITELIST.some(v => v.vendorKey === vendorKey && v.enabled);
}
