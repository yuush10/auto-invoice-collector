/**
 * Configuration and service definitions
 */

export type ExtractionType = 'attachment' | 'body' | 'url';

export interface ServiceConfig {
  name: string;
  searchQuery: string;
  extractionType: ExtractionType;
  urlPattern?: RegExp;
  loginRequired?: boolean;
}

/**
 * Vendor configuration for portal automation (Phase 3)
 */
export interface VendorConfig {
  /** Unique vendor identifier */
  vendorKey: string;
  /** Vendor display name */
  vendorName: string;
  /** Domain patterns for URL matching */
  domainPatterns: string[];
  /** URL pattern for more specific matching */
  urlPattern?: RegExp;
  /** Whether this vendor requires login */
  loginRequired: boolean;
  /** Special handling type */
  specialHandling?: 'api' | 'oauth' | 'mfa-required';
  /** Portal URL for login/access */
  portalUrl?: string;
}

/**
 * Service configurations for invoice collection
 * Add new services here as needed
 */
export const SERVICES: ServiceConfig[] = [
  // MVP Phase 1: Attachment-based services
  {
    name: 'Anthropic',
    searchQuery: 'from:mail.anthropic.com',
    extractionType: 'attachment'
  },
  {
    name: 'Studio',
    searchQuery: 'from:invoice+statements+acct_19TMcIBXp4blWMEQ@stripe.com',
    extractionType: 'attachment'
  },
  {
    name: 'IVRy',
    searchQuery: 'from:invoice+statements@ivry.jp',
    extractionType: 'attachment'
  },
  {
    name: 'Slack',
    searchQuery: 'from:feedback@slack.com',
    extractionType: 'attachment'
  },
  {
    name: 'AWS',
    searchQuery: 'from:no-reply@tax-and-invoicing.us-east-1.amazonaws.com',
    extractionType: 'attachment'
  },
  {
    name: 'Zoom',
    searchQuery: 'from:billing@zoom.us',
    extractionType: 'attachment'
  },
  {
    name: 'Zapier',
    searchQuery: 'from:billing@mail.zapier.com',
    extractionType: 'attachment'
  },
  {
    name: 'Google Workspace',
    searchQuery: 'from:payments-noreply@google.com',
    extractionType: 'attachment'
  },

  // Phase 2: Email body to PDF conversion (not yet implemented)
  {
    name: 'Canva',
    searchQuery: 'from:no-reply@account.canva.com',
    extractionType: 'body'
  },
  {
    name: 'Mailchimp',
    searchQuery: 'from:no-reply@mailchimp.com',
    extractionType: 'body'
  }
];

/**
 * Vendor schedule configuration for automated processing
 * Each vendor is triggered on a specific day of the month
 */
export interface VendorSchedule {
  /** Day of month to trigger (1-31) */
  day: number;
  /** Hour to trigger (0-23, JST) */
  hour: number;
  /** Whether this vendor is enabled for automated processing */
  enabled: boolean;
  /**
   * Whether this vendor requires manual trigger (e.g., CAPTCHA solving).
   * If true, the vendor will be queued as "pending" on scheduled date
   * instead of auto-executing. User must manually initiate via Web App.
   */
  requiresManualTrigger?: boolean;
}

/**
 * Vendor schedule mapping
 * Key: vendorKey, Value: schedule configuration
 */
export const VENDOR_SCHEDULE: Record<string, VendorSchedule> = {
  'aitemasu': { day: 1, hour: 8, enabled: true },
  'google-ads': { day: 4, hour: 8, enabled: true },
  'ibj': { day: 11, hour: 8, enabled: true, requiresManualTrigger: true },
};

/**
 * Vendor configurations for portal automation (Phase 3)
 * These vendors require login automation to download invoices
 */
export const VENDOR_CONFIGS: VendorConfig[] = [
  {
    vendorKey: 'ibj',
    vendorName: 'IBJ',
    domainPatterns: ['ibjapan.com'],
    loginRequired: true,
    portalUrl: 'https://www.ibjapan.com/div/logins',
  },
  {
    vendorKey: 'aitemasu',
    vendorName: 'Aitemasu',
    domainPatterns: ['aitemasu.me'],
    loginRequired: true,
    portalUrl: 'https://app.aitemasu.me/',
  },
  {
    vendorKey: 'google-ads',
    vendorName: 'Google Ads',
    domainPatterns: ['ads.google.com'],
    urlPattern: /ads\.google\.com\/aw\/billing/,
    loginRequired: true,
    specialHandling: 'api',
    portalUrl: 'https://ads.google.com/',
  },
];

/**
 * Get configuration from Script Properties
 */
export class Config {
  private static getProperty(key: string): string {
    const value = PropertiesService.getScriptProperties().getProperty(key);
    if (!value) {
      throw new Error(`Configuration not found: ${key}`);
    }
    return value;
  }

  static getRootFolderId(): string {
    return this.getProperty('ROOT_FOLDER_ID');
  }

  static getGeminiApiKey(): string {
    return this.getProperty('GEMINI_API_KEY');
  }

  static getLogSheetId(): string {
    return this.getProperty('LOG_SHEET_ID');
  }

  static getAdminEmail(): string {
    return this.getProperty('ADMIN_EMAIL');
  }

  /**
   * Get Cloud Run service URL for email-to-pdf conversion
   */
  static getCloudRunUrl(): string {
    return this.getProperty('CLOUD_RUN_URL');
  }

  /**
   * Get the service account email used for invoking Cloud Run
   * This service account must have roles/run.invoker on the Cloud Run service
   * The Apps Script user must have roles/iam.serviceAccountTokenCreator on this SA
   */
  static getInvokerServiceAccount(): string {
    return this.getProperty('INVOKER_SERVICE_ACCOUNT');
  }

  /**
   * Get Cloud Run URL for vendor invoice automation (Phase 3)
   * Falls back to CLOUD_RUN_URL if not set
   */
  static getVendorCloudRunUrl(): string {
    try {
      return this.getProperty('VENDOR_CLOUD_RUN_URL');
    } catch {
      return this.getCloudRunUrl();
    }
  }
}
