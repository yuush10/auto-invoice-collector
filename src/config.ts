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
  {
    name: 'AWS',
    searchQuery: 'from:aws-billing@amazon.com subject:請求書',
    extractionType: 'attachment'
  },
  {
    name: 'Google Cloud',
    searchQuery: 'from:billing-noreply@google.com',
    extractionType: 'attachment'
  },
  {
    name: 'Azure',
    searchQuery: 'from:azure-noreply@microsoft.com',
    extractionType: 'attachment'
  },
  {
    name: 'Slack',
    searchQuery: 'from:feedback@slack.com subject:領収書',
    extractionType: 'url',
    urlPattern: /https:\/\/slack\.com\/billing\/.*invoice/,
    loginRequired: true
  },
  {
    name: 'GitHub',
    searchQuery: 'from:billing@github.com',
    extractionType: 'attachment'
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
}
