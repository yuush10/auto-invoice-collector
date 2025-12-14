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
   * This is optional - if not configured, body extraction will be disabled
   */
  static getCloudRunUrl(): string {
    return this.getProperty('CLOUD_RUN_URL');
  }
}
