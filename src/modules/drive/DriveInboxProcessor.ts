/**
 * Process files uploaded to Drive inbox folder
 * Automatically renames and organizes PDF files using OCR
 */

import { Config } from '../../config';
import { FolderManager } from './FolderManager';
import { DriveFileRenamer } from './DriveFileRenamer';
import { FileNamingService } from '../naming/FileNamingService';
import {
  DriveInboxLogger,
  DriveInboxLogRecord,
  InboxProcessingStatus,
} from '../logging/DriveInboxLogger';
import { DocTypeDetector } from '../../utils/docTypeDetector';
import { DocumentType, DocTypeDetectionFlags } from '../../types';
import { AppLogger } from '../../utils/logger';

/**
 * OCR response from Cloud Run
 */
interface OcrResult {
  serviceName: string;
  eventMonth: string;
  docType: DocumentType;
  confidence: number;
  hasReceiptInContent?: boolean;
  hasInvoiceInContent?: boolean;
  notes?: string;
}

export interface InboxProcessingResult {
  processed: number;
  errors: number;
  skipped: number;
  unknownKept: number;
}

const CONFIDENCE_THRESHOLD = 0.7;

export class DriveInboxProcessor {
  private folderManager: FolderManager;
  private fileRenamer: DriveFileRenamer;
  private namingService: FileNamingService;
  private logger: DriveInboxLogger;
  private inboxFolderId: string;
  private cloudRunOcrUrl: string;

  constructor() {
    this.folderManager = new FolderManager(Config.getRootFolderId());
    this.fileRenamer = new DriveFileRenamer();
    this.namingService = new FileNamingService();
    this.logger = new DriveInboxLogger(Config.getLogSheetId());
    this.inboxFolderId = Config.getInboxFolderId();
    this.cloudRunOcrUrl = Config.getVendorCloudRunUrl();
  }

  /**
   * Process all new files in inbox folder
   */
  processInbox(): InboxProcessingResult {
    const result: InboxProcessingResult = {
      processed: 0,
      errors: 0,
      skipped: 0,
      unknownKept: 0,
    };

    try {
      const inboxFolder = DriveApp.getFolderById(this.inboxFolderId);
      const files = inboxFolder.getFiles();

      while (files.hasNext()) {
        const file = files.next();
        const fileId = file.getId();

        // Skip if already processed
        if (this.logger.isProcessed(fileId)) {
          AppLogger.debug(`File ${fileId} already processed, skipping`);
          continue;
        }

        try {
          const status = this.processFile(file);

          switch (status) {
            case 'success':
              result.processed++;
              break;
            case 'skipped-non-pdf':
              result.skipped++;
              break;
            case 'unknown-kept-in-inbox':
            case 'low-confidence':
              result.unknownKept++;
              break;
            case 'error':
              result.errors++;
              break;
          }
        } catch (error) {
          AppLogger.error(`Error processing file ${fileId}`, error as Error);
          result.errors++;

          this.logger.log({
            timestamp: new Date(),
            driveFileId: fileId,
            originalFileName: file.getName(),
            status: 'error',
            errorMessage: (error as Error).message,
          });
        }
      }
    } catch (error) {
      AppLogger.error('Error processing inbox', error as Error);
    }

    return result;
  }

  /**
   * Process a single file
   */
  private processFile(file: GoogleAppsScript.Drive.File): InboxProcessingStatus {
    const fileId = file.getId();
    const originalName = file.getName();
    const mimeType = file.getMimeType();

    AppLogger.info(`Processing file: ${originalName} (${fileId})`);

    // Check if PDF
    if (!this.isPdf(originalName, mimeType)) {
      AppLogger.info(`Skipping non-PDF file: ${originalName}`);
      this.logger.log({
        timestamp: new Date(),
        driveFileId: fileId,
        originalFileName: originalName,
        status: 'skipped-non-pdf',
      });
      return 'skipped-non-pdf';
    }

    // Get PDF blob and convert to base64
    const pdfBlob = file.getBlob();
    const pdfBase64 = Utilities.base64Encode(pdfBlob.getBytes());

    // Call Cloud Run OCR
    let ocrResult: OcrResult;
    try {
      ocrResult = this.callCloudRunOcr(pdfBase64, originalName);
    } catch (error) {
      AppLogger.error(`OCR failed for ${originalName}`, error as Error);
      return this.handleUnknownFile(file, null, originalName, (error as Error).message);
    }

    // Check filename for docType keywords
    const hasReceiptInFilename = DocTypeDetector.hasReceiptKeywords(originalName);
    const hasInvoiceInFilename = DocTypeDetector.hasInvoiceKeywords(originalName);

    // Build detection flags
    const detectionFlags: DocTypeDetectionFlags = {
      hasReceiptInSubject: false,
      hasInvoiceInSubject: false,
      hasReceiptInBody: false,
      hasInvoiceInBody: false,
      hasReceiptInFilename,
      hasInvoiceInFilename,
      hasReceiptInContent: ocrResult.hasReceiptInContent || false,
      hasInvoiceInContent: ocrResult.hasInvoiceInContent || false,
    };

    // Determine doc type
    let docType: DocumentType;
    if (ocrResult.confidence < CONFIDENCE_THRESHOLD || !ocrResult.eventMonth) {
      docType = 'unknown';
    } else {
      docType = DocTypeDetector.determineDocType(detectionFlags);
    }

    // Handle unknown/low confidence - prefix and keep in inbox
    if (docType === 'unknown' || ocrResult.confidence < CONFIDENCE_THRESHOLD) {
      return this.handleUnknownFile(file, ocrResult, originalName);
    }

    // Generate new filename using GAS FileNamingService
    const newFileName = this.namingService.generate(
      ocrResult.serviceName,
      ocrResult.eventMonth,
      docType
    );

    // Get target folder
    const targetFolder = this.folderManager.getOrCreateMonthFolder(ocrResult.eventMonth);

    // Rename and move
    const finalName = this.fileRenamer.renameAndMove(file, newFileName, targetFolder);

    // Log success
    this.logger.log({
      timestamp: new Date(),
      driveFileId: fileId,
      originalFileName: originalName,
      newFileName: finalName,
      eventMonth: ocrResult.eventMonth,
      serviceName: ocrResult.serviceName,
      docType: DocTypeDetector.getDocTypeString(docType),
      confidence: ocrResult.confidence,
      status: 'success',
      targetFolderId: targetFolder.getId(),
    });

    AppLogger.info(`Successfully processed: ${originalName} -> ${finalName}`);
    return 'success';
  }

  /**
   * Handle files that couldn't be properly identified
   */
  private handleUnknownFile(
    file: GoogleAppsScript.Drive.File,
    ocrResult: OcrResult | null,
    originalName: string,
    errorMessage?: string
  ): InboxProcessingStatus {
    const fileId = file.getId();

    // Add "不明-" prefix if not already present
    let newName = originalName;
    if (!originalName.startsWith('不明-')) {
      newName = `不明-${originalName}`;
      file.setName(newName);
    }

    // Determine status based on reason
    const status: InboxProcessingStatus =
      !ocrResult
        ? 'error'
        : ocrResult.confidence < CONFIDENCE_THRESHOLD
          ? 'low-confidence'
          : 'unknown-kept-in-inbox';

    const logRecord: DriveInboxLogRecord = {
      timestamp: new Date(),
      driveFileId: fileId,
      originalFileName: originalName,
      newFileName: newName,
      eventMonth: ocrResult?.eventMonth || '',
      serviceName: ocrResult?.serviceName || '',
      docType: '不明',
      confidence: ocrResult?.confidence,
      status: status,
    };

    if (errorMessage) {
      logRecord.errorMessage = errorMessage;
    } else if (ocrResult) {
      logRecord.errorMessage = `Confidence: ${ocrResult.confidence}, EventMonth: ${ocrResult.eventMonth || 'not detected'}`;
    }

    this.logger.log(logRecord);

    AppLogger.info(`Marked as unknown, kept in inbox: ${newName}`);
    return status;
  }

  /**
   * Call Cloud Run OCR endpoint
   */
  private callCloudRunOcr(pdfBase64: string, filename: string): OcrResult {
    const url = `${this.cloudRunOcrUrl}/ocr`;

    // Get ID token for Cloud Run authentication
    const idToken = this.getCloudRunIdToken();

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        pdfBase64,
        context: { filename },
      }),
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      muteHttpExceptions: true,
    });

    const statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      throw new Error(`OCR request failed: ${statusCode} - ${response.getContentText()}`);
    }

    return JSON.parse(response.getContentText());
  }

  /**
   * Get ID token for Cloud Run authentication
   */
  private getCloudRunIdToken(): string {
    const serviceAccount = Config.getInvokerServiceAccount();
    const targetAudience = this.cloudRunOcrUrl;

    const idToken = ScriptApp.getIdentityToken();
    if (idToken) {
      return idToken;
    }

    // If no identity token available, generate one using service account
    const token = ScriptApp.getOAuthToken();
    const iamUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateIdToken`;

    const iamResponse = UrlFetchApp.fetch(iamUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: JSON.stringify({
        audience: targetAudience,
        includeEmail: true,
      }),
    });

    const iamResult = JSON.parse(iamResponse.getContentText());
    return iamResult.token;
  }

  /**
   * Check if file is a PDF
   */
  private isPdf(filename: string, mimeType: string): boolean {
    const pdfMimeTypes = ['application/pdf', 'application/x-pdf'];

    return (
      filename.toLowerCase().endsWith('.pdf') ||
      pdfMimeTypes.some((type) => mimeType.includes(type))
    );
  }
}
