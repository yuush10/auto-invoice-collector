/**
 * Vendor Invoice Processor
 * Downloads invoices from vendors via Cloud Run and uploads to Google Drive
 */

import { AppLogger } from '../../utils/logger';
import { FolderManager } from '../drive/FolderManager';
import { FileUploader } from '../drive/FileUploader';
import { getVendorClient, DownloadedFile, DownloadOptions, DownloadResponse } from './VendorClient';
import { Config } from '../../config';
import { VendorError } from '../../types/vendor';

export interface ProcessResult {
  success: boolean;
  vendorKey: string;
  filesProcessed: number;
  filesUploaded: UploadedFileInfo[];
  errors: string[];
  /** Detailed vendor error if download failed */
  vendorError?: VendorError;
  /** Debug info from Cloud Run (screenshots, logs) */
  debug?: DownloadResponse['debug'];
}

export interface UploadedFileInfo {
  originalFilename: string;
  uploadedFilename: string;
  fileId: string;
  billingMonth: string;
  serviceName: string;
  documentType: string;
}

/**
 * Process vendor invoices: download from Cloud Run and upload to Google Drive
 */
export class VendorInvoiceProcessor {
  private folderManager: FolderManager;
  private fileUploader: FileUploader;

  constructor() {
    const rootFolderId = Config.getRootFolderId();
    this.folderManager = new FolderManager(rootFolderId);
    this.fileUploader = new FileUploader();
  }

  /**
   * Download and process invoices from a vendor
   * @param vendorKey Vendor identifier (e.g., 'aitemasu')
   * @param options Download options
   * @returns Processing result
   */
  processVendorInvoices(vendorKey: string, options?: DownloadOptions): ProcessResult {
    const result: ProcessResult = {
      success: false,
      vendorKey,
      filesProcessed: 0,
      filesUploaded: [],
      errors: [],
    };

    try {
      AppLogger.info(`[VendorProcessor] Starting invoice processing for ${vendorKey}`);

      // Step 1: Download invoices from Cloud Run
      const vendorClient = getVendorClient();
      const downloadResponse = vendorClient.downloadInvoices(vendorKey, options);

      if (!downloadResponse.success) {
        result.errors.push(`Download failed: ${downloadResponse.error}`);
        result.vendorError = downloadResponse.vendorError;
        result.debug = downloadResponse.debug;
        AppLogger.error(`[VendorProcessor] Download failed for ${vendorKey}`, new Error(downloadResponse.error));
        return result;
      }

      const files = downloadResponse.files;
      result.filesProcessed = files.length;
      AppLogger.info(`[VendorProcessor] Downloaded ${files.length} file(s) from ${vendorKey}`);

      // Step 2: Upload each file to Google Drive
      for (const file of files) {
        try {
          const uploadInfo = this.uploadFileToDrive(file);
          result.filesUploaded.push(uploadInfo);
          AppLogger.info(`[VendorProcessor] Uploaded: ${uploadInfo.uploadedFilename} to folder ${uploadInfo.billingMonth}`);
        } catch (error) {
          const errorMsg = `Failed to upload ${file.filename}: ${(error as Error).message}`;
          result.errors.push(errorMsg);
          AppLogger.error(`[VendorProcessor] ${errorMsg}`, error as Error);
        }
      }

      result.success = result.errors.length === 0;
      AppLogger.info(`[VendorProcessor] Completed: ${result.filesUploaded.length}/${files.length} files uploaded`);

      return result;
    } catch (error) {
      result.errors.push(`Processing error: ${(error as Error).message}`);
      AppLogger.error(`[VendorProcessor] Error processing ${vendorKey}`, error as Error);
      return result;
    }
  }

  /**
   * Upload a downloaded file to Google Drive
   * Uses suggestedFilename from OCR if available, otherwise generates one
   */
  private uploadFileToDrive(file: DownloadedFile): UploadedFileInfo {
    // Determine billing month (from OCR or default to current month)
    const billingMonth = file.billingMonth || this.getCurrentMonth();

    // Determine filename (from OCR suggestion or original)
    const uploadFilename = file.suggestedFilename || file.filename;

    // Get or create the year-month folder
    const folder = this.folderManager.getOrCreateMonthFolder(billingMonth);

    // Convert base64 to blob
    const pdfBytes = Utilities.base64Decode(file.base64);
    const blob = Utilities.newBlob(pdfBytes, file.mimeType || 'application/pdf');

    // Upload with duplicate handling
    const fileId = this.fileUploader.uploadWithDuplicateHandling(folder, uploadFilename, blob);

    return {
      originalFilename: file.filename,
      uploadedFilename: uploadFilename,
      fileId,
      billingMonth,
      serviceName: file.serviceName || 'Unknown',
      documentType: file.documentType || 'unknown',
    };
  }

  /**
   * Get current month in YYYY-MM format
   */
  private getCurrentMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
}

// Export singleton instance
let processorInstance: VendorInvoiceProcessor | null = null;

export function getVendorInvoiceProcessor(): VendorInvoiceProcessor {
  if (!processorInstance) {
    processorInstance = new VendorInvoiceProcessor();
  }
  return processorInstance;
}

/**
 * Convenience function to process vendor invoices
 * Can be called from main.ts or triggered manually
 */
export function processVendorInvoices(vendorKey: string, options?: DownloadOptions): ProcessResult {
  const processor = getVendorInvoiceProcessor();
  return processor.processVendorInvoices(vendorKey, options);
}
