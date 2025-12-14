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
 * Client for calling Cloud Run email-to-pdf service
 */
export class CloudRunClient {
  private serviceUrl: string;

  constructor() {
    this.serviceUrl = Config.getCloudRunUrl();
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
    try {
      AppLogger.debug(`Calling Cloud Run service at ${this.serviceUrl}`);

      // Get identity token for IAM authentication
      const token = ScriptApp.getIdentityToken();

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

      // Call Cloud Run service
      const response = UrlFetchApp.fetch(`${this.serviceUrl}/convert`, {
        method: 'post',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const statusCode = response.getResponseCode();
      const responseText = response.getContentText();

      // Parse response
      let responseData: any;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
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
      AppLogger.error('Error calling Cloud Run service', error as Error);

      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Check if Cloud Run service is healthy
   * @returns true if service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = UrlFetchApp.fetch(`${this.serviceUrl}/health`, {
        method: 'get',
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
