/**
 * Vendor Client Module
 * Calls Cloud Run download endpoint for vendor portal automation
 */

import { Config, VendorConfig, VENDOR_CONFIGS } from '../../config';
import {
  AuthStatus,
  VendorError,
  VendorErrorCode,
  authFailureToErrorCode,
  detectAuthFailureFromMessage,
  getRecoveryInstructions,
} from '../../types/vendor';
import { AppLogger } from '../../utils/logger';

/**
 * Download options
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
 * Download response from Cloud Run
 */
export interface DownloadResponse {
  success: boolean;
  vendorKey: string;
  files: DownloadedFile[];
  error?: string;
  /** Parsed vendor error with categorization */
  vendorError?: VendorError;
  debug?: {
    screenshots?: string[];
    logs?: string[];
    duration?: number;
    /** Auth status from Cloud Run (if provided) */
    authStatus?: AuthStatus;
    /** URL when error occurred */
    currentUrl?: string;
  };
}

/**
 * Vendor Client for calling Cloud Run download endpoint
 */
export class VendorClient {
  private cloudRunUrl: string;
  private invokerServiceAccount: string;

  constructor() {
    this.cloudRunUrl = Config.getVendorCloudRunUrl();
    this.invokerServiceAccount = Config.getInvokerServiceAccount();
  }

  /**
   * Download invoices from a vendor portal
   */
  downloadInvoices(
    vendorKey: string,
    options?: DownloadOptions,
    targetUrl?: string
  ): DownloadResponse {
    // Validate vendor
    const vendorConfig = this.getVendorConfig(vendorKey);
    if (!vendorConfig) {
      return {
        success: false,
        vendorKey,
        files: [],
        error: `Vendor '${vendorKey}' is not configured`,
      };
    }

    // Generate ID token for Cloud Run authentication
    const idToken = this.generateIdToken();

    // Prepare request payload
    const payload = {
      vendorKey,
      targetUrl,
      options,
    };

    // Call Cloud Run endpoint
    const url = `${this.cloudRunUrl}/download`;
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      muteHttpExceptions: true,
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode >= 200 && responseCode < 300) {
      const response = JSON.parse(responseText) as DownloadResponse;
      // Even successful responses might have auth issues in debug info
      return this.enrichResponseWithErrorAnalysis(response, vendorConfig);
    }

    // Handle error response
    try {
      const errorResponse = JSON.parse(responseText) as DownloadResponse;
      return this.enrichResponseWithErrorAnalysis(errorResponse, vendorConfig);
    } catch {
      const errorResponse: DownloadResponse = {
        success: false,
        vendorKey,
        files: [],
        error: `HTTP ${responseCode}: ${responseText}`,
      };
      return this.enrichResponseWithErrorAnalysis(errorResponse, vendorConfig);
    }
  }

  /**
   * Enrich response with detailed error analysis for auth failures
   */
  private enrichResponseWithErrorAnalysis(
    response: DownloadResponse,
    vendorConfig: VendorConfig
  ): DownloadResponse {
    // If success, no need to analyze errors
    if (response.success) {
      return response;
    }

    // Analyze error message for auth failure patterns
    const errorMessage = response.error || '';
    let authFailureType = detectAuthFailureFromMessage(errorMessage);

    // Also check auth status from Cloud Run if provided
    if (!authFailureType && response.debug?.authStatus?.failureType) {
      authFailureType = response.debug.authStatus.failureType;
    }

    // Check HTTP-level auth failures
    if (!authFailureType && errorMessage.includes('HTTP 401')) {
      authFailureType = 'session_expired';
    } else if (!authFailureType && errorMessage.includes('HTTP 403')) {
      authFailureType = 'credentials_invalid';
    }

    // If auth failure detected, create detailed error object
    if (authFailureType) {
      const vendorError: VendorError = {
        code: authFailureToErrorCode(authFailureType),
        message: errorMessage,
        isAuthFailure: true,
        authFailure: {
          authenticated: false,
          failureType: authFailureType,
          message: errorMessage,
          currentUrl: response.debug?.currentUrl,
        },
        recoveryInstructions: getRecoveryInstructions(
          authFailureType,
          vendorConfig.vendorName
        ),
      };

      AppLogger.warn(
        `[VendorClient] Auth failure detected for ${vendorConfig.vendorKey}: ${authFailureType}`
      );

      return {
        ...response,
        vendorError,
      };
    }

    // Non-auth error
    const errorCode = this.categorizeNonAuthError(errorMessage);
    const vendorError: VendorError = {
      code: errorCode,
      message: errorMessage,
      isAuthFailure: false,
    };

    return {
      ...response,
      vendorError,
    };
  }

  /**
   * Categorize non-auth errors
   */
  private categorizeNonAuthError(errorMessage: string): VendorErrorCode {
    if (/timeout|timed out/i.test(errorMessage)) {
      return 'TIMEOUT';
    }
    if (/network|connection|socket/i.test(errorMessage)) {
      return 'NETWORK_ERROR';
    }
    if (/download.*fail/i.test(errorMessage)) {
      return 'DOWNLOAD_FAILED';
    }
    if (/parse|json|format/i.test(errorMessage)) {
      return 'PARSE_ERROR';
    }
    return 'UNKNOWN_ERROR';
  }

  /**
   * Check download service status
   */
  getServiceStatus(): { status: string; vendors: string[] } | null {
    try {
      const idToken = this.generateIdToken();
      const url = `${this.cloudRunUrl}/download/status`;
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        muteHttpExceptions: true,
      });

      if (response.getResponseCode() === 200) {
        return JSON.parse(response.getContentText());
      }
      return null;
    } catch (error) {
      Logger.log(`Failed to get service status: ${error}`);
      return null;
    }
  }

  /**
   * Test vendor connection without downloading
   */
  testVendorConnection(vendorKey: string): boolean {
    try {
      const idToken = this.generateIdToken();
      const url = `${this.cloudRunUrl}/download/test`;
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ vendorKey }),
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        muteHttpExceptions: true,
      });

      return response.getResponseCode() === 200;
    } catch (error) {
      Logger.log(`Failed to test vendor connection: ${error}`);
      return false;
    }
  }

  /**
   * Get vendor configuration by key
   */
  private getVendorConfig(vendorKey: string): VendorConfig | undefined {
    return VENDOR_CONFIGS.find(v => v.vendorKey === vendorKey);
  }

  /**
   * Generate ID token for Cloud Run authentication
   * Uses ScriptApp.getIdentityToken() with service account impersonation
   */
  private generateIdToken(): string {
    try {
      // Use OAuth2 to get an ID token for the invoker service account
      const tokenUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${this.invokerServiceAccount}:generateIdToken`;

      const accessToken = ScriptApp.getOAuthToken();

      const payload = {
        audience: this.cloudRunUrl,
        includeEmail: true,
      };

      const response = UrlFetchApp.fetch(tokenUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        muteHttpExceptions: true,
      });

      if (response.getResponseCode() !== 200) {
        throw new Error(`Failed to generate ID token: ${response.getContentText()}`);
      }

      const result = JSON.parse(response.getContentText());
      return result.token;
    } catch (error) {
      Logger.log(`Error generating ID token: ${error}`);
      throw new Error(`Failed to authenticate with Cloud Run: ${error}`);
    }
  }
}

// Export singleton instance
let clientInstance: VendorClient | null = null;

export function getVendorClient(): VendorClient {
  if (!clientInstance) {
    clientInstance = new VendorClient();
  }
  return clientInstance;
}
