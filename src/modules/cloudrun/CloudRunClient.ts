import { AppLogger } from '../../utils/logger';
import { Config } from '../../config';

export interface ConvertOptions {
  format?: 'A4' | 'Letter';
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  printBackground?: boolean;
}

export interface ConvertResult {
  success: boolean;
  pdfBlob?: GoogleAppsScript.Base.Blob;
  error?: {
    code: string;
    message: string;
  };
  metadata?: {
    pageCount: number;
    fileSize: number;
    processingTime: number;
  };
}

/**
 * Client for calling Cloud Run email-to-pdf service directly using ID tokens
 *
 * Architecture:
 * Apps Script (OAuth) -> IAMCredentials.generateIdToken -> Cloud Run (ID token)
 *
 * This approach uses the IAM Credentials API to mint an ID token for a service
 * account that has roles/run.invoker permission on the Cloud Run service.
 * The Apps Script user must have roles/iam.serviceAccountTokenCreator on the
 * service account.
 */
export class CloudRunClient {
  private serviceUrl: string;
  private invokerServiceAccount: string;
  private maxRetries = 3;
  private retryDelayMs = 2000;

  constructor() {
    this.serviceUrl = Config.getCloudRunUrl();
    this.invokerServiceAccount = Config.getInvokerServiceAccount();
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): void {
    Utilities.sleep(ms);
  }

  /**
   * Generate an ID token for the invoker service account
   * Uses the IAM Credentials API with the current user's OAuth token
   * @param audience The target audience (Cloud Run service URL)
   * @returns ID token string
   */
  private generateIdToken(audience: string): string {
    const accessToken = ScriptApp.getOAuthToken();

    const iamUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(this.invokerServiceAccount)}:generateIdToken`;

    const response = UrlFetchApp.fetch(iamUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      payload: JSON.stringify({
        audience: audience,
        includeEmail: true
      }),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode !== 200) {
      throw new Error(`Failed to generate ID token (status ${statusCode}): ${responseText}`);
    }

    const responseData = JSON.parse(responseText);
    if (!responseData.token) {
      throw new Error(`No token in response: ${responseText}`);
    }

    return responseData.token;
  }

  /**
   * Check if error is retryable (503 Service Unavailable, etc.)
   */
  private isRetryableError(statusCode: number, responseText: string): boolean {
    return statusCode === 503 ||
           statusCode === 502 ||
           statusCode === 504 ||
           responseText.includes('Service Unavailable');
  }

  /**
   * Convert HTML email body to PDF
   * @param html HTML content to convert
   * @param messageId Gmail message ID for logging
   * @param serviceName Service name for logging
   * @param options PDF rendering options
   * @returns ConvertResult with PDF blob or error
   */
  async convertEmailBodyToPdf(
    html: string,
    messageId?: string,
    serviceName?: string,
    options?: ConvertOptions
  ): Promise<ConvertResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        AppLogger.debug(`Calling Cloud Run service at ${this.serviceUrl} (attempt ${attempt}/${this.maxRetries})`);

        // Generate ID token for Cloud Run
        const idToken = this.generateIdToken(this.serviceUrl);

        // Prepare request payload
        const payload = {
          html,
          options: options || {
            format: 'A4',
            printBackground: true,
            margin: {
              top: '10mm',
              right: '10mm',
              bottom: '10mm',
              left: '10mm'
            }
          },
          metadata: {
            messageId,
            serviceName
          }
        };

        // Call Cloud Run directly with ID token
        const response = UrlFetchApp.fetch(`${this.serviceUrl}/convert`, {
          method: 'post',
          headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
          },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        const statusCode = response.getResponseCode();
        const responseText = response.getContentText();

        // Check for retryable errors
        if (this.isRetryableError(statusCode, responseText)) {
          lastError = new Error(`Service Unavailable (status ${statusCode})`);
          if (attempt < this.maxRetries) {
            const delay = this.retryDelayMs * attempt;
            AppLogger.info(`Cloud Run returned ${statusCode}, retrying in ${delay}ms...`);
            this.sleep(delay);
            continue;
          }
        }

        // Parse response
        let responseData: any;
        try {
          responseData = JSON.parse(responseText);
        } catch (e) {
          // If JSON parse fails and it's retryable, continue
          if (this.isRetryableError(statusCode, responseText) && attempt < this.maxRetries) {
            lastError = new Error(`Invalid JSON response: ${responseText}`);
            const delay = this.retryDelayMs * attempt;
            AppLogger.info(`Invalid response, retrying in ${delay}ms...`);
            this.sleep(delay);
            continue;
          }
          throw new Error(`Invalid JSON response from Cloud Run: ${responseText}`);
        }

        // Handle error response
        if (statusCode !== 200 || !responseData.success) {
          AppLogger.error(
            `Cloud Run conversion failed (status ${statusCode})`,
            new Error(responseData.error?.message || 'Unknown error')
          );

          return {
            success: false,
            error: {
              code: responseData.error?.code || 'UNKNOWN_ERROR',
              message: responseData.error?.message || 'Unknown error from Cloud Run'
            }
          };
        }

        // Decode base64 PDF
        const pdfBase64 = responseData.pdf;
        const pdfBytes = Utilities.base64Decode(pdfBase64);
        const pdfBlob = Utilities.newBlob(pdfBytes, 'application/pdf');

        AppLogger.info(
          `PDF conversion successful: ${(responseData.metadata.fileSize / 1024).toFixed(2)}KB, ` +
          `${responseData.metadata.pageCount} pages, ${responseData.metadata.processingTime}ms`
        );

        return {
          success: true,
          pdfBlob,
          metadata: responseData.metadata
        };
      } catch (error) {
        lastError = error as Error;
        AppLogger.error(`Error calling Cloud Run service (attempt ${attempt})`, lastError);

        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * attempt;
          AppLogger.info(`Retrying in ${delay}ms...`);
          this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: lastError?.message || 'Unknown error after retries'
      }
    };
  }

  /**
   * Check if Cloud Run service is healthy
   * @returns true if service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const idToken = this.generateIdToken(this.serviceUrl);
      const response = UrlFetchApp.fetch(`${this.serviceUrl}/health`, {
        method: 'get',
        headers: {
          'Authorization': `Bearer ${idToken}`
        },
        muteHttpExceptions: true
      });

      const statusCode = response.getResponseCode();
      return statusCode === 200;
    } catch (error) {
      AppLogger.error('Health check failed', error as Error);
      return false;
    }
  }
}
