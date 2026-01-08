/**
 * Uploader Service
 * Uploads collected invoices to Google Drive via GAS Web App
 */
import { DownloadedFile } from './collector';

/**
 * GAS Web App response
 */
interface UploadResponse {
  success: boolean;
  message?: string;
  fileId?: string;
  error?: string;
}

/**
 * Uploader service for sending files to GAS
 */
export class Uploader {
  private token?: string;
  private gasWebAppUrl: string;

  constructor(token?: string) {
    this.token = token;
    // GAS Web App URL - this would be configured
    this.gasWebAppUrl =
      process.env.GAS_WEBAPP_URL ||
      'https://script.google.com/macros/s/AKfycbxxxxxxxxx/exec';
  }

  /**
   * Upload a file to Google Drive via GAS
   */
  async upload(file: DownloadedFile, vendorKey: string, targetMonth: string): Promise<void> {
    console.log(`[Upload] Uploading ${file.filename} to Google Drive...`);

    try {
      const response = await fetch(this.gasWebAppUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'uploadInvoice',
          token: this.token,
          vendorKey,
          targetMonth,
          file: {
            filename: file.filename,
            data: file.data.toString('base64'),
            mimeType: file.mimeType,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = (await response.json()) as UploadResponse;

      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      console.log(`[Upload] Success: ${result.message || 'File uploaded'}`);
      if (result.fileId) {
        console.log(`[Upload] File ID: ${result.fileId}`);
      }
    } catch (error) {
      console.error(`[Upload] Error: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Mark pending vendor as complete
   */
  async markComplete(vendorKey: string, targetMonth: string): Promise<void> {
    console.log(`[Upload] Marking ${vendorKey} as complete for ${targetMonth}...`);

    try {
      const response = await fetch(this.gasWebAppUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'markVendorComplete',
          token: this.token,
          vendorKey,
          targetMonth,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = (await response.json()) as UploadResponse;

      if (!result.success) {
        throw new Error(result.error || 'Failed to mark as complete');
      }

      console.log(`[Upload] Vendor marked as complete`);
    } catch (error) {
      console.error(`[Upload] Error marking complete: ${(error as Error).message}`);
      // Don't throw - this is not critical
    }
  }
}
