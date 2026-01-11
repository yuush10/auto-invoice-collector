/**
 * Auto Invoice Collector - Main Entry Point
 *
 * This is the main entry point for the Google Apps Script application.
 * It contains the trigger functions that are called by GAS.
 */

import { Config, SERVICES, VENDOR_SCHEDULE, VENDOR_CONFIGS } from './config';
import { getPendingVendorQueueManager } from './modules/vendors/PendingVendorQueueManager';
import { GmailSearcher } from './modules/gmail/GmailSearcher';
import { AttachmentExtractor } from './modules/gmail/AttachmentExtractor';
import { EmailBodyExtractor } from './modules/gmail/EmailBodyExtractor';
import { GeminiOcrService } from './modules/ocr/GeminiOcrService';
import { FolderManager } from './modules/drive/FolderManager';
import { FileUploader } from './modules/drive/FileUploader';
import { FileNamingService } from './modules/naming/FileNamingService';
import { ProcessingLogger } from './modules/logging/ProcessingLogger';
import { Notifier } from './modules/notifications/Notifier';
import { CloudRunClient } from './modules/cloudrun/CloudRunClient';
import { ProcessingResult, DocTypeDetectionFlags } from './types';
import { AppLogger } from './utils/logger';
import { DocTypeDetector } from './utils/docTypeDetector';
import './cleanup'; // Include cleanup utilities

// Web App imports
import { WebAppApi } from './webapp/WebAppApi';
import { DraftUpdate, PromptConfigCreate, PromptConfigUpdate } from './webapp/types';
import { JournalEntry, DraftStatus } from './types/journal';
import { PromptType } from './types/prompt';

/**
 * Main function that processes new invoices from Gmail
 * This function is called by the time-based trigger
 *
 * Note: GAS trigger handlers must be synchronous. We use .catch() to ensure
 * any unhandled promise rejections are logged and notified.
 */
function main(): void {
  mainAsync().catch(error => {
    AppLogger.error('Unhandled error in main processing', error as Error);
    try {
      const notifier = new Notifier(Config.getAdminEmail());
      notifier.sendErrorNotification([{
        messageId: 'N/A',
        serviceName: 'System',
        error: `Unhandled error: ${error}`
      }]);
    } catch (notifyError) {
      AppLogger.error('Failed to send error notification', notifyError as Error);
    }
  });
}

/**
 * Async implementation of main processing logic
 * Separated from main() to ensure proper Promise handling in GAS triggers
 */
async function mainAsync(): Promise<void> {
  AppLogger.info('Auto Invoice Collector - Starting');

  try {
    const processor = new InvoiceProcessor();
    const result = await processor.run();

    AppLogger.info(`Processing complete: ${result.processed} processed, ${result.errors.length} errors, ${result.needsReview.length} needs review`);

    // Send notifications
    const notifier = new Notifier(Config.getAdminEmail());

    if (result.errors.length > 0) {
      notifier.sendErrorNotification(result.errors);
    }

    if (result.needsReview.length > 0) {
      notifier.sendNeedsReviewNotification(result.needsReview);
    }

    // Send summary if there was any activity
    if (result.processed > 0 || result.errors.length > 0) {
      notifier.sendProcessingSummary(result);
    }
  } catch (error) {
    AppLogger.error('Fatal error in main', error as Error);

    // Try to send error notification
    try {
      const notifier = new Notifier(Config.getAdminEmail());
      notifier.sendErrorNotification([{
        messageId: 'N/A',
        serviceName: 'System',
        error: `Fatal error: ${error}`
      }]);
    } catch (notifyError) {
      AppLogger.error('Failed to send error notification', notifyError as Error);
    }

    throw error;
  }
}

/**
 * Invoice processor class
 */
class InvoiceProcessor {
  private gmailSearcher: GmailSearcher;
  private attachmentExtractor: AttachmentExtractor;
  private ocrService: GeminiOcrService;
  private folderManager: FolderManager;
  private fileUploader: FileUploader;
  private namingService: FileNamingService;
  private logger: ProcessingLogger;
  private cloudRunClient: CloudRunClient | null;

  constructor() {
    this.gmailSearcher = new GmailSearcher();
    this.attachmentExtractor = new AttachmentExtractor();
    this.ocrService = new GeminiOcrService(Config.getGeminiApiKey());
    this.folderManager = new FolderManager(Config.getRootFolderId());
    this.fileUploader = new FileUploader();
    this.namingService = new FileNamingService();
    this.logger = new ProcessingLogger(Config.getLogSheetId());

    // Initialize Cloud Run client if URL is configured
    try {
      this.cloudRunClient = new CloudRunClient();
    } catch (error) {
      AppLogger.info('Cloud Run URL not configured, body extraction disabled');
      this.cloudRunClient = null;
    }
  }

  /**
   * Run the invoice processing for all configured services
   */
  async run(): Promise<ProcessingResult> {
    const result: ProcessingResult = {
      success: true,
      processed: 0,
      errors: [],
      needsReview: []
    };

    // Process each configured service
    for (const service of SERVICES) {
      try {
        AppLogger.info(`Processing service: ${service.name}`);

        let serviceResult: ProcessingResult;

        // Route to appropriate processor based on extraction type
        if (service.extractionType === 'attachment') {
          serviceResult = this.processService(service.name, service.searchQuery);
        } else if (service.extractionType === 'body') {
          if (!this.cloudRunClient) {
            AppLogger.warn(`Skipping ${service.name}: Cloud Run not configured`);
            continue;
          }
          serviceResult = await this.processServiceBody(service.name, service.searchQuery);
        } else {
          AppLogger.info(`Skipping ${service.name} (extraction type: ${service.extractionType} not yet supported)`);
          continue;
        }

        result.processed += serviceResult.processed;
        result.errors.push(...serviceResult.errors);
        result.needsReview.push(...serviceResult.needsReview);
      } catch (error) {
        AppLogger.error(`Error processing service ${service.name}`, error as Error);
        result.errors.push({
          messageId: 'N/A',
          serviceName: service.name,
          error: `Service processing failed: ${error}`
        });
      }
    }

    return result;
  }

  /**
   * Process a single service
   */
  private processService(serviceName: string, searchQuery: string): ProcessingResult {
    const result: ProcessingResult = {
      success: true,
      processed: 0,
      errors: [],
      needsReview: []
    };

    try {
      // Search for messages
      const messages = this.gmailSearcher.search(searchQuery, true);
      AppLogger.info(`Found ${messages.length} messages for ${serviceName}`);

      for (const message of messages) {
        const messageId = message.getId();

        // Check if already processed
        if (this.logger.isProcessed(messageId)) {
          AppLogger.debug(`Message ${messageId} already processed, skipping`);
          continue;
        }

        try {
          this.processMessage(message, serviceName, result);
          result.processed++;
        } catch (error) {
          AppLogger.error(`Error processing message ${messageId}`, error as Error);
          result.errors.push({
            messageId,
            serviceName,
            error: `${error}`
          });
        }
      }
    } catch (error) {
      AppLogger.error(`Error searching for ${serviceName}`, error as Error);
      throw error;
    }

    return result;
  }

  /**
   * Process a single message
   */
  private processMessage(
    message: GoogleAppsScript.Gmail.GmailMessage,
    serviceName: string,
    result: ProcessingResult
  ): void {
    const messageId = message.getId();
    const attachments = this.attachmentExtractor.extractPdfAttachments(message);

    if (attachments.length === 0) {
      AppLogger.info(`No PDF attachments found in message ${messageId}`);
      return;
    }

    // Extract email subject and body for docType detection
    const emailSubject = message.getSubject();
    const emailBody = message.getPlainBody().substring(0, 5000); // Limit to 5000 chars for performance

    // Check email subject and body for docType keywords
    const hasReceiptInSubject = DocTypeDetector.hasReceiptKeywords(emailSubject);
    const hasInvoiceInSubject = DocTypeDetector.hasInvoiceKeywords(emailSubject);
    const hasReceiptInBody = DocTypeDetector.hasReceiptKeywords(emailBody);
    const hasInvoiceInBody = DocTypeDetector.hasInvoiceKeywords(emailBody);

    AppLogger.info(`Processing ${attachments.length} attachments from message ${messageId}`);

    let successCount = 0;

    attachments.forEach((attachment, index) => {
      try {
        // Calculate hash for duplicate detection
        const sha256 = this.attachmentExtractor.calculateHash(attachment.data);

        if (this.logger.hashExists(sha256)) {
          AppLogger.info(`Attachment ${index} is duplicate (hash exists), skipping`);
          return;
        }

        // Extract data via OCR
        const context = {
          from: message.getFrom(),
          subject: emailSubject
        };

        const extracted = this.ocrService.extract(attachment.data, context);

        // Combine all docType detection flags
        const detectionFlags: DocTypeDetectionFlags = {
          hasReceiptInSubject,
          hasInvoiceInSubject,
          hasReceiptInBody,
          hasInvoiceInBody,
          hasReceiptInFilename: attachment.hasReceiptInFilename,
          hasInvoiceInFilename: attachment.hasInvoiceInFilename,
          hasReceiptInContent: extracted.hasReceiptInContent || false,
          hasInvoiceInContent: extracted.hasInvoiceInContent || false
        };

        // Determine final docType from all sources
        const finalDocType = DocTypeDetector.determineDocType(detectionFlags);
        DocTypeDetector.logDetectionDetails(detectionFlags, finalDocType);

        // Check confidence
        const needsReview = extracted.confidence < 0.7;
        const status = needsReview ? 'needs-review' : 'success';

        // Generate file name with docType
        const fileName = this.namingService.generate(
          extracted.serviceName,
          extracted.eventMonth,
          finalDocType
        );

        // Get or create month folder
        const folder = this.folderManager.getOrCreateMonthFolder(extracted.eventMonth);

        // Upload file with duplicate handling
        const fileId = this.fileUploader.uploadWithDuplicateHandling(
          folder,
          fileName,
          attachment.data
        );

        // Log processing
        this.logger.log({
          timestamp: new Date(),
          messageId,
          attachmentIndex: index,
          sha256,
          sourceType: 'attachment',
          docType: finalDocType,
          serviceName: extracted.serviceName,
          eventMonth: extracted.eventMonth,
          driveFileId: fileId,
          status,
          errorMessage: needsReview ? `Low confidence: ${extracted.confidence}` : undefined
        });

        if (needsReview) {
          result.needsReview.push(
            `${fileName} - Confidence: ${extracted.confidence.toFixed(2)} - ${extracted.notes}`
          );
        }

        AppLogger.info(`Successfully processed attachment ${index}: ${fileName}`);
        successCount++;
      } catch (error) {
        AppLogger.error(`Error processing attachment ${index} from message ${messageId}`, error as Error);

        // Log error
        this.logger.log({
          timestamp: new Date(),
          messageId,
          attachmentIndex: index,
          sha256: '',
          sourceType: 'attachment',
          docType: 'unknown',
          serviceName,
          eventMonth: '',
          driveFileId: '',
          status: 'error',
          errorMessage: `${error}`
        });

        result.errors.push({
          messageId,
          serviceName,
          error: `Attachment ${index}: ${error}`
        });
      }
    });

    // Only mark as processed if at least one attachment succeeded
    // This allows retry on next run if all attachments failed (e.g., transient server errors)
    if (successCount > 0) {
      this.gmailSearcher.markAsProcessed(message);
    } else {
      AppLogger.warn(`No attachments successfully processed for message ${messageId}, not marking as processed for retry`);
    }
  }

  /**
   * Process a service that uses email body extraction (Phase 2)
   */
  private async processServiceBody(serviceName: string, searchQuery: string): Promise<ProcessingResult> {
    const result: ProcessingResult = {
      success: true,
      processed: 0,
      errors: [],
      needsReview: []
    };

    try {
      // Search for messages
      const messages = this.gmailSearcher.search(searchQuery, true);
      AppLogger.info(`Found ${messages.length} messages for ${serviceName}`);

      for (const message of messages) {
        const messageId = message.getId();

        // Check if already processed
        if (this.logger.isProcessed(messageId)) {
          AppLogger.debug(`Message ${messageId} already processed, skipping`);
          continue;
        }

        try {
          await this.processBodyMessage(message, serviceName, result);
          result.processed++;
        } catch (error) {
          AppLogger.error(`Error processing message ${messageId}`, error as Error);
          result.errors.push({
            messageId,
            serviceName,
            error: `${error}`
          });
        }
      }
    } catch (error) {
      AppLogger.error(`Error searching for ${serviceName}`, error as Error);
      throw error;
    }

    return result;
  }

  /**
   * Process a single message with body extraction (Phase 2)
   */
  private async processBodyMessage(
    message: GoogleAppsScript.Gmail.GmailMessage,
    serviceName: string,
    result: ProcessingResult
  ): Promise<void> {
    const messageId = message.getId();

    if (!this.cloudRunClient) {
      throw new Error('Cloud Run client not initialized');
    }

    // Extract email subject and body for pre-validation
    const emailSubject = message.getSubject();
    const emailPlainBody = message.getPlainBody().substring(0, 5000);

    // Pre-validate: Check if email contains invoice/receipt keywords BEFORE calling Cloud Run
    // This saves API costs by not processing non-invoice emails
    const hasInvoiceKeyword = DocTypeDetector.hasInvoiceKeywords(emailSubject) ||
                             DocTypeDetector.hasInvoiceKeywords(emailPlainBody);
    const hasReceiptKeyword = DocTypeDetector.hasReceiptKeywords(emailSubject) ||
                             DocTypeDetector.hasReceiptKeywords(emailPlainBody);

    if (!hasInvoiceKeyword && !hasReceiptKeyword) {
      AppLogger.info(`Skipping message ${messageId}: No invoice/receipt keywords found in subject or body`);
      // Mark as processed to avoid re-processing
      this.gmailSearcher.markAsProcessed(message);
      return;
    }

    // Extract HTML body
    const htmlBody = EmailBodyExtractor.extractBody(message);

    if (!htmlBody) {
      AppLogger.warn(`No email body found in message ${messageId}`);
      return;
    }

    AppLogger.info(`Converting email body to PDF for message ${messageId}`);

    // Convert HTML to PDF via Cloud Run
    const convertResult = await this.cloudRunClient.convertEmailBodyToPdf(
      htmlBody,
      messageId,
      serviceName
    );

    if (!convertResult.success || !convertResult.pdfBlob) {
      throw new Error(
        `PDF conversion failed: ${convertResult.error?.message || 'Unknown error'}`
      );
    }

    const pdfBlob = convertResult.pdfBlob;

    // Calculate hash for duplicate detection
    const sha256 = this.attachmentExtractor.calculateHash(pdfBlob);

    if (this.logger.hashExists(sha256)) {
      AppLogger.info(`Email body PDF is duplicate (hash exists), skipping`);
      return;
    }

    // Reuse pre-validation keyword flags for docType detection
    const hasReceiptInSubject = DocTypeDetector.hasReceiptKeywords(emailSubject);
    const hasInvoiceInSubject = DocTypeDetector.hasInvoiceKeywords(emailSubject);
    const hasReceiptInBody = DocTypeDetector.hasReceiptKeywords(emailPlainBody);
    const hasInvoiceInBody = DocTypeDetector.hasInvoiceKeywords(emailPlainBody);

    // Extract data via OCR
    const context = {
      from: message.getFrom(),
      subject: emailSubject
    };

    const extracted = this.ocrService.extract(pdfBlob, context);

    // Validate: Skip if billing month is empty (couldn't extract date from content)
    if (!extracted.eventMonth || extracted.eventMonth.trim() === '') {
      AppLogger.info(`Skipping message ${messageId}: No billing month could be extracted`);
      // Mark as processed to avoid re-processing
      this.gmailSearcher.markAsProcessed(message);
      return;
    }

    // Combine all docType detection flags
    const detectionFlags: DocTypeDetectionFlags = {
      hasReceiptInSubject,
      hasInvoiceInSubject,
      hasReceiptInBody,
      hasInvoiceInBody,
      hasReceiptInFilename: false,
      hasInvoiceInFilename: false,
      hasReceiptInContent: extracted.hasReceiptInContent || false,
      hasInvoiceInContent: extracted.hasInvoiceInContent || false
    };

    // Determine final docType from all sources
    const finalDocType = DocTypeDetector.determineDocType(detectionFlags);
    DocTypeDetector.logDetectionDetails(detectionFlags, finalDocType);

    // Check confidence
    const needsReview = extracted.confidence < 0.7;
    const status = needsReview ? 'needs-review' : 'success';

    // Generate file name with docType
    const fileName = this.namingService.generate(
      extracted.serviceName,
      extracted.eventMonth,
      finalDocType
    );

    // Get or create month folder
    const folder = this.folderManager.getOrCreateMonthFolder(extracted.eventMonth);

    // Upload file with duplicate handling
    const fileId = this.fileUploader.uploadWithDuplicateHandling(
      folder,
      fileName,
      pdfBlob
    );

    // Log processing
    this.logger.log({
      timestamp: new Date(),
      messageId,
      attachmentIndex: 0,
      sha256,
      sourceType: 'body',
      docType: finalDocType,
      serviceName: extracted.serviceName,
      eventMonth: extracted.eventMonth,
      driveFileId: fileId,
      status,
      errorMessage: needsReview ? `Low confidence: ${extracted.confidence}` : undefined
    });

    if (needsReview) {
      result.needsReview.push(
        `${fileName} - Confidence: ${extracted.confidence.toFixed(2)} - ${extracted.notes}`
      );
    }

    AppLogger.info(`Successfully processed email body: ${fileName}`);

    // Mark message as processed
    this.gmailSearcher.markAsProcessed(message);
  }
}

/**
 * Manual trigger for testing
 */
function runManually(): void {
  main();
}

/**
 * Setup function to create the daily trigger
 * Run this once to set up automatic execution
 */
function setupTrigger(): void {
  // Remove existing triggers for main function only
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new daily trigger at 6 AM
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  Logger.log('Daily trigger created successfully');
}

/**
 * Setup function to create the monthly journal processing trigger
 * Run this once to set up automatic monthly journal entry generation
 * Runs on the 5th of each month at 9 AM JST
 */
function setupMonthlyJournalTrigger(): void {
  // Remove existing triggers for processMonthlyJournals function only
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processMonthlyJournals') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new monthly trigger on the 5th at 9 AM
  ScriptApp.newTrigger('processMonthlyJournals')
    .timeBased()
    .onMonthDay(5)
    .atHour(9)
    .create();

  Logger.log('Monthly journal trigger created successfully (5th of each month at 9 AM)');
}

/**
 * Monthly journal processing trigger handler
 * This function is called by the monthly time-based trigger
 *
 * Note: GAS trigger handlers must be synchronous. We use .catch() to ensure
 * any unhandled promise rejections are logged and notified.
 */
function processMonthlyJournals(): void {
  processMonthlyJournalsAsync().catch(error => {
    AppLogger.error('Unhandled error in monthly journal processing', error as Error);
    try {
      const notifier = new Notifier(Config.getAdminEmail());
      notifier.sendErrorNotification([{
        messageId: 'N/A',
        serviceName: 'MonthlyJournals',
        error: `Unhandled error: ${error}`
      }]);
    } catch (notifyError) {
      AppLogger.error('Failed to send error notification', notifyError as Error);
    }
  });
}

/**
 * Async implementation of monthly journal processing
 * Separated from processMonthlyJournals() to ensure proper Promise handling in GAS triggers
 *
 * TODO: Implement in Phase 4.2
 * 1. Get files from previous month's folder
 * 2. Process each file through Gemini OCR for journal extraction
 * 3. Match against dictionary for patterns
 * 4. Create draft entries in DraftSheet
 * 5. Send notification with summary
 */
async function processMonthlyJournalsAsync(): Promise<void> {
  AppLogger.info('Monthly journal processing started');

  // TODO: Implement actual processing logic

  AppLogger.info('Monthly journal processing completed (placeholder)');
}

// ============================================
// Web App Functions (Phase 4.3)
// ============================================

/**
 * Get WebAppApi instance (singleton pattern for performance)
 */
let webAppApiInstance: WebAppApi | null = null;

function getWebAppApi(): WebAppApi {
  if (!webAppApiInstance) {
    webAppApiInstance = new WebAppApi({
      spreadsheetId: Config.getLogSheetId(),
      geminiApiKey: Config.getGeminiApiKey()
    });
  }
  return webAppApiInstance;
}

/**
 * Web App entry point - serves the review UI
 */
function doGet(
  _e: GoogleAppsScript.Events.DoGet
): GoogleAppsScript.HTML.HtmlOutput {
  // GAS references files as 'dist/index' when pushed from dist/index.html
  const template = HtmlService.createTemplateFromFile('dist/index');
  const output = template.evaluate();

  output
    .setTitle('仕訳レビュー - Auto Invoice Collector')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');

  return output;
}

/**
 * Web App POST handler - handles local collector uploads
 */
function doPost(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  try {
    const data = JSON.parse(e.postData.contents);
    const { action, token, vendorKey, targetMonth, file } = data;

    AppLogger.info(`[doPost] Received action: ${action}`);

    let result: { success: boolean; message?: string; fileId?: string; error?: string };

    switch (action) {
      case 'uploadInvoice':
        result = getWebAppApi().uploadFromLocalCollector(token, vendorKey, targetMonth, file);
        break;

      case 'markVendorComplete':
        result = getWebAppApi().markVendorCompleteFromLocal(token, vendorKey, targetMonth);
        break;

      default:
        result = { success: false, error: `Unknown action: ${action}` };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    AppLogger.error('[doPost] Error processing request', error as Error);
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: (error as Error).message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

(globalThis as any).doPost = doPost;

/**
 * Include HTML file content (for templates)
 * @param filename - File name without extension (e.g., 'style.css' for dist/style.css.html)
 */
function include(filename: string): string {
  // GAS references files as 'dist/filename' when pushed from dist/filename.html
  return HtmlService.createHtmlOutputFromFile('dist/' + filename).getContent();
}

// ============================================
// Web App API Wrappers
// All functions return JSON strings for google.script.run
// ============================================

// Dashboard APIs
function api_getDraftSummary(yearMonth: string): string {
  try {
    const result = getWebAppApi().getDraftSummary(yearMonth);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_getDraftList(yearMonth: string, status?: string): string {
  try {
    const draftStatus = status as DraftStatus | undefined;
    const result = getWebAppApi().getDraftList(yearMonth, draftStatus);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_getYearMonthOptions(): string {
  try {
    const result = getWebAppApi().getYearMonthOptions();
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_bulkApprove(draftIdsJson: string): string {
  try {
    const draftIds = JSON.parse(draftIdsJson) as string[];
    const result = getWebAppApi().bulkApprove(draftIds);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

// Review APIs
function api_getDraftDetail(draftId: string): string {
  try {
    const result = getWebAppApi().getDraftDetail(draftId);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_getDraftHistory(draftId: string): string {
  try {
    const result = getWebAppApi().getDraftHistory(draftId);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_getDraftSnapshot(draftId: string, version: number): string {
  try {
    const result = getWebAppApi().getDraftSnapshot(draftId, version);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_updateDraft(draftId: string, updatesJson: string, reason?: string): string {
  try {
    const updates = JSON.parse(updatesJson) as DraftUpdate;
    const result = getWebAppApi().updateDraft(draftId, updates, reason);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_selectSuggestion(draftId: string, suggestionIndex: number): string {
  try {
    const result = getWebAppApi().selectSuggestion(draftId, suggestionIndex);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_setCustomEntry(draftId: string, entriesJson: string, reason: string): string {
  try {
    const entries = JSON.parse(entriesJson) as JournalEntry[];
    const result = getWebAppApi().setCustomEntry(draftId, entries, reason);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_approveDraft(
  draftId: string,
  selectedEntryJson: string,
  registerToDict: boolean,
  editReason?: string
): string {
  try {
    const selectedEntry = JSON.parse(selectedEntryJson) as JournalEntry[];
    const result = getWebAppApi().approveDraft(draftId, selectedEntry, registerToDict, editReason);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_getNextPendingDraft(currentDraftId: string, yearMonth: string): string {
  try {
    const result = getWebAppApi().getNextPendingDraft(currentDraftId, yearMonth);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

// Dictionary APIs
function api_getDictionaryHistory(dictId: string): string {
  try {
    const result = getWebAppApi().getDictionaryHistory(dictId);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_getDictionaryList(): string {
  try {
    const result = getWebAppApi().getDictionaryList();
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

// Prompt APIs
function api_getPromptList(): string {
  try {
    const result = getWebAppApi().getPromptList();
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_getPromptDetail(promptId: string): string {
  try {
    const result = getWebAppApi().getPromptDetail(promptId);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_createPrompt(configJson: string): string {
  try {
    const config = JSON.parse(configJson) as PromptConfigCreate;
    const result = getWebAppApi().createPrompt(config);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_updatePrompt(promptId: string, updatesJson: string): string {
  try {
    const updates = JSON.parse(updatesJson) as PromptConfigUpdate;
    const result = getWebAppApi().updatePrompt(promptId, updates);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_activatePrompt(promptId: string): string {
  try {
    const result = getWebAppApi().activatePrompt(promptId);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_deactivatePrompt(promptId: string): string {
  try {
    const result = getWebAppApi().deactivatePrompt(promptId);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_deletePrompt(promptId: string): string {
  try {
    getWebAppApi().deletePrompt(promptId);
    return JSON.stringify({ success: true });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_testPrompt(promptId: string, testFileId: string): string {
  try {
    const result = getWebAppApi().testPrompt(promptId, testFileId);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_getPromptVersionHistory(promptType: string): string {
  try {
    const type = promptType as PromptType;
    const result = getWebAppApi().getPromptVersionHistory(type);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_resetToDefaultPrompt(promptType: string): string {
  try {
    const type = promptType as PromptType;
    getWebAppApi().resetToDefaultPrompt(type);
    return JSON.stringify({ success: true });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

// ============================================
// Pending Vendor APIs (Phase 3.6)
// ============================================

function api_getPendingVendors(): string {
  try {
    const result = getWebAppApi().getPendingVendors();
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_getAllPendingVendorRecords(): string {
  try {
    const result = getWebAppApi().getAllPendingVendorRecords();
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_getPendingVendorById(id: string): string {
  try {
    const result = getWebAppApi().getPendingVendorById(id);
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_startVendorProcessing(id: string): string {
  try {
    const result = getWebAppApi().startVendorProcessing(id);
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_completePendingVendor(id: string): string {
  try {
    const result = getWebAppApi().completePendingVendor(id);
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_failPendingVendor(id: string, errorMessage: string): string {
  try {
    const result = getWebAppApi().failPendingVendor(id, errorMessage);
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

// Export pending vendor API functions
(globalThis as any).api_getPendingVendors = api_getPendingVendors;
(globalThis as any).api_getAllPendingVendorRecords = api_getAllPendingVendorRecords;
(globalThis as any).api_getPendingVendorById = api_getPendingVendorById;
(globalThis as any).api_startVendorProcessing = api_startVendorProcessing;
(globalThis as any).api_completePendingVendor = api_completePendingVendor;
(globalThis as any).api_failPendingVendor = api_failPendingVendor;

// ============================================
// Local Collector APIs (Phase 3.6 - Local Browser Automation)
// ============================================

function api_getLocalCollectorCommand(id: string): string {
  try {
    const result = getWebAppApi().getLocalCollectorCommand(id);
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_uploadFromLocalCollector(
  token: string,
  vendorKey: string,
  targetMonth: string,
  fileJson: string
): string {
  try {
    const file = JSON.parse(fileJson);
    const result = getWebAppApi().uploadFromLocalCollector(token, vendorKey, targetMonth, file);
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

function api_markVendorCompleteFromLocal(
  token: string,
  vendorKey: string,
  targetMonth: string
): string {
  try {
    const result = getWebAppApi().markVendorCompleteFromLocal(token, vendorKey, targetMonth);
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

// Export local collector API functions
(globalThis as any).api_getLocalCollectorCommand = api_getLocalCollectorCommand;
(globalThis as any).api_uploadFromLocalCollector = api_uploadFromLocalCollector;
(globalThis as any).api_markVendorCompleteFromLocal = api_markVendorCompleteFromLocal;

/**
 * Test function to get local collector command for IBJ
 * This will:
 * 1. Queue IBJ for manual processing (creates pending record)
 * 2. Get the local collector command with token
 * Run this from Apps Script editor to get a token for testing
 */
function testGetLocalCollectorCommand(): void {
  // First, queue IBJ for manual processing
  Logger.log('=== Queueing IBJ for Manual Processing ===');

  const queueManager = getPendingVendorQueueManager();
  const scheduledDate = new Date();
  const record = queueManager.addPendingVendor('ibj', scheduledDate);

  Logger.log('Created pending record: ' + record.id);

  Logger.log('');
  Logger.log('=== Getting Local Collector Command ===');
  const result = getWebAppApi().getLocalCollectorCommand(record.id);
  Logger.log(JSON.stringify(result, null, 2));

  if (result.success && result.command) {
    Logger.log('');
    Logger.log('Copy this command to run in terminal:');
    Logger.log(result.command);
  }
}

(globalThis as any).testGetLocalCollectorCommand = testGetLocalCollectorCommand;

// ============================================
// Test Data Generation (Development Only)
// ============================================

// Vendor Invoice Processing (Phase 3)
import { processVendorInvoices as processVendorInvoicesImpl, ProcessResult as VendorProcessResult } from './modules/vendors/VendorInvoiceProcessor';
import { DownloadOptions as VendorDownloadOptions } from './modules/vendors/VendorClient';
import { getCookieExpirationTracker } from './modules/vendors/CookieExpirationTracker';
import { VendorAuthNotification, getRecoveryInstructions } from './types/vendor';

/**
 * Process vendor invoices: download from Cloud Run and upload to Google Drive
 * @param vendorKey Vendor identifier (e.g., 'aitemasu', 'ibj', 'google-ads')
 * @param optionsJson Optional download options as JSON string
 * @returns Processing result as JSON string
 */
function downloadVendorInvoices(vendorKey: string, optionsJson?: string): string {
  try {
    AppLogger.info(`[Main] Processing vendor invoices for ${vendorKey}`);

    const options = optionsJson ? JSON.parse(optionsJson) as VendorDownloadOptions : undefined;
    const result = processVendorInvoicesImpl(vendorKey, options);

    AppLogger.info(`[Main] Vendor processing complete: ${result.filesUploaded.length} files uploaded`);

    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    AppLogger.error(`[Main] Vendor processing failed for ${vendorKey}`, error as Error);
    return JSON.stringify({ success: false, error: (error as Error).message });
  }
}

import { DraftSheetManager } from './modules/journal/DraftSheetManager';
import { SuggestedEntries } from './types/journal';

/**
 * Create test draft data for development/testing purposes
 * Run this function from Apps Script editor to populate DraftSheet
 */
function createTestDraftData(): void {
  AppLogger.info('Creating test draft data...');

  const draftManager = new DraftSheetManager(Config.getLogSheetId());

  // Test data: Various SaaS invoices for December 2024
  const testDrafts: Array<{
    fileId: string;
    fileName: string;
    filePath: string;
    docType: 'invoice' | 'receipt';
    storageType: 'electronic' | 'paper_scan';
    vendorName: string;
    serviceName: string;
    amount: number;
    taxAmount: number;
    issueDate: string;
    dueDate: string;
    eventMonth: string;
    paymentMonth: string;
    suggestedEntries: SuggestedEntries | null;
    selectedEntry: JournalEntry[] | null;
    dictionaryMatchId: string;
    status: DraftStatus;
    reviewedBy: string;
    reviewedAt: Date | null;
    notes: string;
  }> = [
    // 1. Slack - Pending (高信頼度)
    // Using a real PDF file for preview testing
    {
      fileId: '1bpZMdfuuNl9Z8A7PIr3I2XinDJ2gQyv4',
      fileName: 'Slack_2024-12_invoice.pdf',
      filePath: '/Invoices/2024-12/Slack_2024-12_invoice.pdf',
      docType: 'invoice',
      storageType: 'electronic',
      vendorName: 'Slack Technologies, LLC',
      serviceName: 'Slack Pro',
      amount: 1100,
      taxAmount: 100,
      issueDate: '2024-12-01',
      dueDate: '2024-12-31',
      eventMonth: '2024-12',
      paymentMonth: '2024-12',
      suggestedEntries: {
        suggestions: [
          {
            entries: [{
              entryNo: 1,
              transactionDate: '2024-12-01',
              debit: {
                accountName: '通信費',
                subAccountName: 'SaaS',
                taxClass: '課税仕入10%',
                amount: 1000,
                taxAmount: 100
              },
              credit: {
                accountName: '未払金',
                amount: 1100
              },
              description: 'Slack Pro利用料 2024年12月分'
            }],
            confidence: 0.95,
            reasoning: 'SaaSコミュニケーションツールの月額利用料のため通信費として計上'
          },
          {
            entries: [{
              entryNo: 1,
              transactionDate: '2024-12-01',
              debit: {
                accountName: '支払手数料',
                taxClass: '課税仕入10%',
                amount: 1000,
                taxAmount: 100
              },
              credit: {
                accountName: '未払金',
                amount: 1100
              },
              description: 'Slack Pro利用料 2024年12月分'
            }],
            confidence: 0.75,
            reasoning: 'クラウドサービス利用料として支払手数料で計上する方法'
          }
        ]
      },
      selectedEntry: null,
      dictionaryMatchId: '',
      status: 'pending',
      reviewedBy: '',
      reviewedAt: null,
      notes: ''
    },

    // 2. AWS - Pending (中信頼度、複数候補)
    {
      fileId: 'test-file-002',
      fileName: 'AWS_2024-12_invoice.pdf',
      filePath: '/Invoices/2024-12/AWS_2024-12_invoice.pdf',
      docType: 'invoice',
      storageType: 'electronic',
      vendorName: 'Amazon Web Services, Inc.',
      serviceName: 'AWS',
      amount: 55000,
      taxAmount: 5000,
      issueDate: '2024-12-03',
      dueDate: '2025-01-03',
      eventMonth: '2024-12',
      paymentMonth: '2025-01',
      suggestedEntries: {
        suggestions: [
          {
            entries: [{
              entryNo: 1,
              transactionDate: '2024-12-03',
              debit: {
                accountName: '通信費',
                subAccountName: 'クラウドインフラ',
                taxClass: '課税仕入10%',
                amount: 50000,
                taxAmount: 5000
              },
              credit: {
                accountName: '未払金',
                amount: 55000
              },
              description: 'AWS利用料 2024年12月分'
            }],
            confidence: 0.82,
            reasoning: 'クラウドインフラ利用料のため通信費として計上'
          },
          {
            entries: [{
              entryNo: 1,
              transactionDate: '2024-12-03',
              debit: {
                accountName: '賃借料',
                taxClass: '課税仕入10%',
                amount: 50000,
                taxAmount: 5000
              },
              credit: {
                accountName: '未払金',
                amount: 55000
              },
              description: 'AWS利用料 2024年12月分'
            }],
            confidence: 0.65,
            reasoning: 'サーバー利用料として賃借料で計上する方法'
          }
        ]
      },
      selectedEntry: null,
      dictionaryMatchId: '',
      status: 'pending',
      reviewedBy: '',
      reviewedAt: null,
      notes: '利用量に応じた従量課金のため金額が変動'
    },

    // 3. Google Workspace - Reviewed (選択済み)
    {
      fileId: 'test-file-003',
      fileName: 'GoogleWorkspace_2024-12_invoice.pdf',
      filePath: '/Invoices/2024-12/GoogleWorkspace_2024-12_invoice.pdf',
      docType: 'invoice',
      storageType: 'electronic',
      vendorName: 'Google LLC',
      serviceName: 'Google Workspace Business Standard',
      amount: 16500,
      taxAmount: 1500,
      issueDate: '2024-12-05',
      dueDate: '2024-12-20',
      eventMonth: '2024-12',
      paymentMonth: '2024-12',
      suggestedEntries: {
        suggestions: [
          {
            entries: [{
              entryNo: 1,
              transactionDate: '2024-12-05',
              debit: {
                accountName: '通信費',
                subAccountName: 'SaaS',
                taxClass: '課税仕入10%',
                amount: 15000,
                taxAmount: 1500
              },
              credit: {
                accountName: '未払金',
                amount: 16500
              },
              description: 'Google Workspace Business Standard 2024年12月分 (10名)'
            }],
            confidence: 0.92,
            reasoning: 'グループウェアサービスの月額利用料のため通信費として計上'
          }
        ]
      },
      selectedEntry: [{
        entryNo: 1,
        transactionDate: '2024-12-05',
        debit: {
          accountName: '通信費',
          subAccountName: 'SaaS',
          taxClass: '課税仕入10%',
          amount: 15000,
          taxAmount: 1500
        },
        credit: {
          accountName: '未払金',
          amount: 16500
        },
        description: 'Google Workspace Business Standard 2024年12月分 (10名)'
      }],
      dictionaryMatchId: '',
      status: 'reviewed',
      reviewedBy: 'test@example.com',
      reviewedAt: new Date('2024-12-10T10:00:00'),
      notes: '毎月定額'
    },

    // 4. Notion - Approved (承認済み)
    {
      fileId: 'test-file-004',
      fileName: 'Notion_2024-12_invoice.pdf',
      filePath: '/Invoices/2024-12/Notion_2024-12_invoice.pdf',
      docType: 'invoice',
      storageType: 'electronic',
      vendorName: 'Notion Labs, Inc.',
      serviceName: 'Notion Plus',
      amount: 2200,
      taxAmount: 200,
      issueDate: '2024-12-01',
      dueDate: '2024-12-15',
      eventMonth: '2024-12',
      paymentMonth: '2024-12',
      suggestedEntries: {
        suggestions: [
          {
            entries: [{
              entryNo: 1,
              transactionDate: '2024-12-01',
              debit: {
                accountName: '通信費',
                subAccountName: 'SaaS',
                taxClass: '課税仕入10%',
                amount: 2000,
                taxAmount: 200
              },
              credit: {
                accountName: '未払金',
                amount: 2200
              },
              description: 'Notion Plus 2024年12月分'
            }],
            confidence: 0.94,
            reasoning: 'ナレッジ管理SaaSの月額利用料'
          }
        ]
      },
      selectedEntry: [{
        entryNo: 1,
        transactionDate: '2024-12-01',
        debit: {
          accountName: '通信費',
          subAccountName: 'SaaS',
          taxClass: '課税仕入10%',
          amount: 2000,
          taxAmount: 200
        },
        credit: {
          accountName: '未払金',
          amount: 2200
        },
        description: 'Notion Plus 2024年12月分'
      }],
      dictionaryMatchId: 'dict-notion-001',
      status: 'approved',
      reviewedBy: 'test@example.com',
      reviewedAt: new Date('2024-12-10T11:00:00'),
      notes: ''
    },

    // 5. GitHub - Pending (低信頼度)
    {
      fileId: 'test-file-005',
      fileName: 'GitHub_2024-12_invoice.pdf',
      filePath: '/Invoices/2024-12/GitHub_2024-12_invoice.pdf',
      docType: 'invoice',
      storageType: 'electronic',
      vendorName: 'GitHub, Inc.',
      serviceName: 'GitHub Enterprise',
      amount: 44000,
      taxAmount: 4000,
      issueDate: '2024-12-02',
      dueDate: '2025-01-02',
      eventMonth: '2024-12',
      paymentMonth: '2025-01',
      suggestedEntries: {
        suggestions: [
          {
            entries: [{
              entryNo: 1,
              transactionDate: '2024-12-02',
              debit: {
                accountName: '支払手数料',
                taxClass: '課税仕入10%',
                amount: 40000,
                taxAmount: 4000
              },
              credit: {
                accountName: '未払金',
                amount: 44000
              },
              description: 'GitHub Enterprise 2024年12月分'
            }],
            confidence: 0.58,
            reasoning: '開発ツールのため支払手数料として計上（要確認）'
          },
          {
            entries: [{
              entryNo: 1,
              transactionDate: '2024-12-02',
              debit: {
                accountName: '通信費',
                taxClass: '課税仕入10%',
                amount: 40000,
                taxAmount: 4000
              },
              credit: {
                accountName: '未払金',
                amount: 44000
              },
              description: 'GitHub Enterprise 2024年12月分'
            }],
            confidence: 0.55,
            reasoning: 'クラウドサービスとして通信費計上も可'
          }
        ]
      },
      selectedEntry: null,
      dictionaryMatchId: '',
      status: 'pending',
      reviewedBy: '',
      reviewedAt: null,
      notes: '勘定科目の判断が必要'
    },

    // 6. Freee - Pending (紙スキャン)
    {
      fileId: 'test-file-006',
      fileName: 'Freee_2024-12_receipt.pdf',
      filePath: '/Invoices/2024-12/Freee_2024-12_receipt.pdf',
      docType: 'receipt',
      storageType: 'paper_scan',
      vendorName: 'freee株式会社',
      serviceName: 'freee会計',
      amount: 3278,
      taxAmount: 298,
      issueDate: '2024-12-01',
      dueDate: '',
      eventMonth: '2024-12',
      paymentMonth: '2024-12',
      suggestedEntries: {
        suggestions: [
          {
            entries: [{
              entryNo: 1,
              transactionDate: '2024-12-01',
              debit: {
                accountName: '支払手数料',
                subAccountName: '会計ソフト',
                taxClass: '課税仕入10%',
                amount: 2980,
                taxAmount: 298
              },
              credit: {
                accountName: '普通預金',
                amount: 3278
              },
              description: 'freee会計 スタンダードプラン 2024年12月分'
            }],
            confidence: 0.88,
            reasoning: '会計ソフト利用料のため支払手数料として計上'
          }
        ]
      },
      selectedEntry: null,
      dictionaryMatchId: '',
      status: 'pending',
      reviewedBy: '',
      reviewedAt: null,
      notes: '紙領収書からスキャン'
    }
  ];

  // Create drafts
  let created = 0;
  for (const draft of testDrafts) {
    try {
      draftManager.create(draft, 'test-data-generator');
      created++;
      AppLogger.info(`Created test draft: ${draft.vendorName} - ${draft.serviceName}`);
    } catch (error) {
      AppLogger.error(`Failed to create test draft for ${draft.vendorName}`, error as Error);
    }
  }

  AppLogger.info(`Test data creation complete: ${created}/${testDrafts.length} drafts created`);
  Logger.log(`Test data creation complete: ${created}/${testDrafts.length} drafts created`);
}

/**
 * Clear all test data from DraftSheet (for cleanup)
 */
function clearTestDraftData(): void {
  const spreadsheet = SpreadsheetApp.openById(Config.getLogSheetId());
  const sheet = spreadsheet.getSheetByName('DraftSheet');

  if (!sheet) {
    Logger.log('DraftSheet not found');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
    Logger.log(`Deleted ${lastRow - 1} rows from DraftSheet`);
  } else {
    Logger.log('DraftSheet is already empty');
  }
}

// Export functions to GAS global scope
// In Google Apps Script, 'this' at the top level refers to the global scope
(globalThis as any).main = main;
(globalThis as any).runManually = runManually;
(globalThis as any).setupTrigger = setupTrigger;
(globalThis as any).setupMonthlyJournalTrigger = setupMonthlyJournalTrigger;
(globalThis as any).processMonthlyJournals = processMonthlyJournals;

// Web App functions
(globalThis as any).doGet = doGet;
(globalThis as any).include = include;

// API wrapper functions
(globalThis as any).api_getDraftSummary = api_getDraftSummary;
(globalThis as any).api_getDraftList = api_getDraftList;
(globalThis as any).api_getYearMonthOptions = api_getYearMonthOptions;
(globalThis as any).api_bulkApprove = api_bulkApprove;
(globalThis as any).api_getDraftDetail = api_getDraftDetail;
(globalThis as any).api_getDraftHistory = api_getDraftHistory;
(globalThis as any).api_getDraftSnapshot = api_getDraftSnapshot;
(globalThis as any).api_updateDraft = api_updateDraft;
(globalThis as any).api_selectSuggestion = api_selectSuggestion;
(globalThis as any).api_setCustomEntry = api_setCustomEntry;
(globalThis as any).api_approveDraft = api_approveDraft;
(globalThis as any).api_getNextPendingDraft = api_getNextPendingDraft;
(globalThis as any).api_getDictionaryHistory = api_getDictionaryHistory;
(globalThis as any).api_getDictionaryList = api_getDictionaryList;
(globalThis as any).api_getPromptList = api_getPromptList;
(globalThis as any).api_getPromptDetail = api_getPromptDetail;
(globalThis as any).api_createPrompt = api_createPrompt;
(globalThis as any).api_updatePrompt = api_updatePrompt;
(globalThis as any).api_activatePrompt = api_activatePrompt;
(globalThis as any).api_deactivatePrompt = api_deactivatePrompt;
(globalThis as any).api_deletePrompt = api_deletePrompt;
(globalThis as any).api_testPrompt = api_testPrompt;
(globalThis as any).api_getPromptVersionHistory = api_getPromptVersionHistory;
(globalThis as any).api_resetToDefaultPrompt = api_resetToDefaultPrompt;

// Test data functions
(globalThis as any).createTestDraftData = createTestDraftData;
(globalThis as any).clearTestDraftData = clearTestDraftData;

// Vendor invoice functions (Phase 3)
(globalThis as any).downloadVendorInvoices = downloadVendorInvoices;

/**
 * Test function to download Aitemasu invoices
 * Run this from GAS editor dropdown
 */
function downloadAitemasuInvoices(): void {
  const result = downloadVendorInvoices('aitemasu');
  Logger.log(result);
}
(globalThis as any).downloadAitemasuInvoices = downloadAitemasuInvoices;

/**
 * Process vendors scheduled for today
 * This is called by the daily trigger at 8:00 AM JST
 * Checks VENDOR_SCHEDULE to determine which vendors to process
 *
 * Note: GAS trigger handlers must be synchronous. We use .catch() to ensure
 * any unhandled promise rejections are logged and notified.
 */

/**
 * Queue a vendor for manual processing
 * Called when a vendor has requiresManualTrigger=true
 * Stores pending task in sheet and sends notification email with one-click trigger
 */
function queueVendorForManualProcessing(vendorKey: string, scheduledDate: Date): void {
  const vendorConfig = VENDOR_CONFIGS.find(v => v.vendorKey === vendorKey);
  const vendorName = vendorConfig?.vendorName || vendorKey;

  AppLogger.info(`[Vendor] Queuing ${vendorKey} for manual processing`);

  // Store in PendingVendorQueueManager sheet
  const queueManager = getPendingVendorQueueManager();
  const record = queueManager.addPendingVendor(vendorKey, scheduledDate);
  AppLogger.info(`[Vendor] Created pending record: ${record.id}`);

  // Generate local collector command with token
  const commandResult = getWebAppApi().getLocalCollectorCommand(record.id);
  let localCollectorUrl = '';
  let localCollectorCommand = '';

  if (commandResult.success && commandResult.command) {
    localCollectorCommand = commandResult.command;
    // Parse command to build custom URL: invoicecollector://collect?vendor=X&month=Y&token=Z
    const vendorMatch = commandResult.command.match(/--vendor=(\S+)/);
    const monthMatch = commandResult.command.match(/--target-month=(\S+)/);
    const tokenMatch = commandResult.command.match(/--token=(\S+)/);
    if (vendorMatch && monthMatch && tokenMatch) {
      localCollectorUrl = `invoicecollector://collect?vendor=${vendorMatch[1]}&month=${monthMatch[1]}&token=${tokenMatch[1]}`;
    }
  }

  // Send notification email about pending vendor
  try {
    const dateStr = scheduledDate.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Tokyo'
    });
    const timeStr = scheduledDate.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo'
    });

    const subject = `[Auto Invoice Collector] ${vendorName} 請求書処理待機中`;

    // Plain text fallback
    const body = `${vendorName}の請求書処理が待機中です。

このベンダーはCAPTCHA認証が必要なため、自動処理ができません。
手動で処理を開始してください。

■ 詳細
- ベンダー: ${vendorName}
- 予定日時: ${dateStr} ${timeStr}
- ステータス: 待機中

■ ワンクリック実行（要URL Handler設定）
${localCollectorUrl || 'URL生成に失敗しました'}

■ 手動実行
ターミナルで以下のコマンドを実行:
${localCollectorCommand || 'コマンド生成に失敗しました'}

---
Auto Invoice Collector`;

    // HTML email with clickable link
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    h2 { color: #2c3e50; margin-bottom: 20px; }
    .section { margin-bottom: 24px; }
    .section-title { font-weight: bold; color: #34495e; margin-bottom: 8px; }
    .details { background: #f8f9fa; padding: 12px 16px; border-radius: 6px; }
    .details li { margin: 4px 0; }
    .btn { display: inline-block; padding: 12px 24px; background: #3498db; color: white !important; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 8px 0; }
    .btn:hover { background: #2980b9; }
    .command { background: #2c3e50; color: #ecf0f1; padding: 12px 16px; border-radius: 6px; font-family: 'Monaco', 'Menlo', monospace; font-size: 13px; overflow-x: auto; word-break: break-all; }
    .note { color: #7f8c8d; font-size: 14px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #ecf0f1; color: #95a5a6; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>${vendorName} 請求書処理待機中</h2>

    <p>このベンダーはCAPTCHA認証が必要なため、自動処理ができません。<br>手動で処理を開始してください。</p>

    <div class="section">
      <div class="section-title">詳細</div>
      <ul class="details">
        <li><strong>ベンダー:</strong> ${vendorName}</li>
        <li><strong>予定日時:</strong> ${dateStr} ${timeStr}</li>
        <li><strong>ステータス:</strong> 待機中</li>
      </ul>
    </div>

    ${localCollectorUrl ? `
    <div class="section">
      <div class="section-title">ワンクリック実行</div>
      <p class="note">下のボタンをクリックして処理を開始（要URL Handler設定）</p>
      <a href="${localCollectorUrl}" class="btn">処理を開始</a>
    </div>
    ` : ''}

    <div class="section">
      <div class="section-title">手動実行</div>
      <p class="note">ターミナルで以下のコマンドを実行:</p>
      <div class="command">${localCollectorCommand || 'コマンド生成に失敗しました'}</div>
    </div>

    <p>処理を開始すると、ブラウザが表示されCAPTCHA認証を行えます。<br>認証後は自動的にOTP処理と請求書ダウンロードが行われます。</p>

    <div class="footer">Auto Invoice Collector</div>
  </div>
</body>
</html>`;

    MailApp.sendEmail({
      to: Config.getAdminEmail(),
      subject,
      body,
      htmlBody
    });

    AppLogger.info(`[Vendor] Sent pending notification for ${vendorKey}`);
  } catch (error) {
    AppLogger.error(`[Vendor] Failed to send pending notification for ${vendorKey}`, error as Error);
    throw error;
  }
}
(globalThis as any).queueVendorForManualProcessing = queueVendorForManualProcessing;

function processScheduledVendors(): void {
  processScheduledVendorsAsync().catch(error => {
    AppLogger.error('Unhandled error in scheduled vendor processing', error as Error);
    try {
      const notifier = new Notifier(Config.getAdminEmail());
      notifier.sendErrorNotification([{
        messageId: 'N/A',
        serviceName: 'VendorScheduler',
        error: `Unhandled error: ${error}`
      }]);
    } catch (notifyError) {
      AppLogger.error('Failed to send error notification', notifyError as Error);
    }
  });
}

async function processScheduledVendorsAsync(): Promise<void> {
  const now = new Date();
  const today = now.getDate();
  const currentHour = now.getHours();

  AppLogger.info(`[Vendor] Checking scheduled vendors for day ${today} at ${currentHour}:00`);

  // Find vendors scheduled for today that are enabled
  const scheduledVendors = Object.entries(VENDOR_SCHEDULE)
    .filter(([_, schedule]) => schedule.day === today && schedule.enabled);

  // Separate auto-process and manual-trigger vendors
  const vendorsToProcess = scheduledVendors
    .filter(([_, schedule]) => !schedule.requiresManualTrigger)
    .map(([vendorKey, _]) => vendorKey);

  const manualTriggerVendors = scheduledVendors
    .filter(([_, schedule]) => schedule.requiresManualTrigger)
    .map(([vendorKey, _]) => vendorKey);

  if (vendorsToProcess.length === 0 && manualTriggerVendors.length === 0) {
    AppLogger.info(`[Vendor] No vendors scheduled for day ${today}`);
    Logger.log(`No vendors scheduled for day ${today}`);
    return;
  }

  // Queue manual-trigger vendors for later processing
  if (manualTriggerVendors.length > 0) {
    AppLogger.info(`[Vendor] Manual-trigger vendors scheduled for day ${today}: ${manualTriggerVendors.join(', ')}`);
    for (const vendorKey of manualTriggerVendors) {
      try {
        // Queue vendor for manual processing (implemented in Phase 2)
        queueVendorForManualProcessing(vendorKey, now);
        AppLogger.info(`[Vendor] Queued ${vendorKey} for manual processing`);
      } catch (error) {
        AppLogger.error(`[Vendor] Failed to queue ${vendorKey} for manual processing`, error as Error);
      }
    }
  }

  if (vendorsToProcess.length === 0) {
    AppLogger.info(`[Vendor] No auto-process vendors scheduled for day ${today}`);
    Logger.log(`No auto-process vendors scheduled for day ${today} (manual-trigger vendors queued)`);
    return;
  }

  AppLogger.info(`[Vendor] Processing vendors scheduled for day ${today}: ${vendorsToProcess.join(', ')}`);

  const results: Array<{ vendor: string; result: string; processResult?: VendorProcessResult }> = [];
  const notifier = new Notifier(Config.getAdminEmail());
  const cookieTracker = getCookieExpirationTracker();

  for (const vendorKey of vendorsToProcess) {
    try {
      AppLogger.info(`[Vendor] Processing vendor: ${vendorKey}`);
      const processResult = processVendorInvoicesImpl(vendorKey);

      if (processResult.success) {
        results.push({
          vendor: vendorKey,
          result: `Success: ${processResult.filesUploaded?.length || 0} files uploaded`,
          processResult
        });
        // Record successful auth for cookie tracking
        cookieTracker.recordSuccessfulAuth(vendorKey);
      } else {
        results.push({
          vendor: vendorKey,
          result: `Failed: ${processResult.errors.join(', ')}`,
          processResult
        });

        // Send auth failure notification if applicable
        if (processResult.vendorError?.isAuthFailure) {
          const vendorConfig = VENDOR_CONFIGS.find(v => v.vendorKey === vendorKey);
          const authNotification: VendorAuthNotification = {
            vendorKey,
            vendorName: vendorConfig?.vendorName || vendorKey,
            failureType: processResult.vendorError.authFailure?.failureType || 'unknown',
            errorMessage: processResult.vendorError.message,
            screenshots: processResult.debug?.screenshots,
            currentUrl: processResult.debug?.currentUrl,
            failedAt: new Date(),
            recoveryInstructions: processResult.vendorError.recoveryInstructions ||
              getRecoveryInstructions(
                processResult.vendorError.authFailure?.failureType || 'unknown',
                vendorConfig?.vendorName || vendorKey
              ),
          };
          notifier.sendVendorAuthFailureNotification(authNotification);
          AppLogger.info(`[Vendor] Sent auth failure notification for ${vendorKey}`);
        }
      }
    } catch (error) {
      AppLogger.error(`[Vendor] Error processing ${vendorKey}`, error as Error);
      results.push({
        vendor: vendorKey,
        result: `Error: ${(error as Error).message}`
      });
    }
  }

  // Check for cookie expiration warnings
  try {
    const vendorsNeedingWarning = cookieTracker.getVendorsNeedingWarning();
    for (const status of vendorsNeedingWarning) {
      const vendorConfig = VENDOR_CONFIGS.find(v => v.vendorKey === status.vendorKey);
      if (vendorConfig && status.daysUntilExpiration !== undefined) {
        notifier.sendCookieExpirationWarning(
          status.vendorKey,
          vendorConfig.vendorName,
          status.daysUntilExpiration
        );
        cookieTracker.markWarningSent(status.vendorKey);
        AppLogger.info(`[Vendor] Sent cookie expiration warning for ${status.vendorKey}`);
      }
    }
  } catch (error) {
    AppLogger.error('[Vendor] Error checking cookie expirations', error as Error);
  }

  // Log summary
  AppLogger.info('[Vendor] Scheduled vendor processing complete');
  for (const r of results) {
    AppLogger.info(`[Vendor] ${r.vendor}: ${r.result}`);
    Logger.log(`${r.vendor}: ${r.result}`);
  }

  // Send notification email with results
  if (results.length > 0) {
    try {
      const summary = results.map(r => `• ${r.vendor}: ${r.result}`).join('\n');
      MailApp.sendEmail({
        to: Config.getAdminEmail(),
        subject: `[Auto Invoice Collector] Vendor Invoice Processing - Day ${today}`,
        body: `ベンダー請求書処理が完了しました。\n\n処理対象: ${vendorsToProcess.join(', ')}\n\n処理結果:\n${summary}`
      });
    } catch (error) {
      AppLogger.error('[Vendor] Failed to send notification', error as Error);
    }
  }
}
(globalThis as any).processScheduledVendors = processScheduledVendors;
(globalThis as any).processScheduledVendorsAsync = processScheduledVendorsAsync;

/**
 * Process a specific vendor manually (regardless of schedule)
 * Useful for testing or manual intervention
 * @param vendorKey Vendor identifier (e.g., 'aitemasu', 'ibj', 'google-ads')
 */
function processVendorManually(vendorKey: string): string {
  AppLogger.info(`[Vendor] Manual processing requested for: ${vendorKey}`);

  // Verify vendor exists in schedule
  if (!VENDOR_SCHEDULE[vendorKey]) {
    const message = `Unknown vendor: ${vendorKey}. Available vendors: ${Object.keys(VENDOR_SCHEDULE).join(', ')}`;
    Logger.log(message);
    return message;
  }

  try {
    const processResult = processVendorInvoicesImpl(vendorKey);

    if (processResult.success) {
      const message = `Success: ${processResult.filesUploaded?.length || 0} files uploaded`;
      Logger.log(`[${vendorKey}] ${message}`);
      return message;
    } else {
      const message = `Failed: ${processResult.errors.join(', ')}`;
      Logger.log(`[${vendorKey}] ${message}`);
      return message;
    }
  } catch (error) {
    const message = `Error: ${(error as Error).message}`;
    AppLogger.error(`[Vendor] Manual processing failed for ${vendorKey}`, error as Error);
    Logger.log(`[${vendorKey}] ${message}`);
    return message;
  }
}
(globalThis as any).processVendorManually = processVendorManually;

/**
 * Show current vendor schedule configuration
 */
function showVendorSchedule(): void {
  Logger.log('=== Vendor Schedule Configuration ===');
  Logger.log('');
  for (const [vendorKey, schedule] of Object.entries(VENDOR_SCHEDULE)) {
    const vendorConfig = VENDOR_CONFIGS.find(v => v.vendorKey === vendorKey);
    const vendorName = vendorConfig?.vendorName || vendorKey;
    const status = schedule.enabled ? '✓ Enabled' : '✗ Disabled';
    Logger.log(`${vendorName} (${vendorKey}):`);
    Logger.log(`  Day: ${schedule.day} of each month`);
    Logger.log(`  Time: ${schedule.hour}:00 JST`);
    Logger.log(`  Status: ${status}`);
    Logger.log('');
  }
}
(globalThis as any).showVendorSchedule = showVendorSchedule;

/**
 * Setup daily trigger for scheduled vendor invoice downloads
 * Run this once to set up automatic daily vendor processing
 * Runs daily at 8:00 AM JST and processes vendors based on VENDOR_SCHEDULE
 *
 * Schedule:
 *   - Day 1: Aitemasu
 *   - Day 4: Google Ads
 *   - Day 11: IBJ
 */
function setupDailyVendorTrigger(): void {
  // Remove existing triggers for vendor processing
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    const handlerFunction = trigger.getHandlerFunction();
    if (handlerFunction === 'processScheduledVendors' ||
        handlerFunction === 'processAllVendorInvoices') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new daily trigger at 8 AM
  ScriptApp.newTrigger('processScheduledVendors')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  Logger.log('Daily vendor trigger created successfully (8:00 AM JST)');
  Logger.log('Schedule:');
  for (const [vendorKey, schedule] of Object.entries(VENDOR_SCHEDULE)) {
    if (schedule.enabled) {
      Logger.log(`  Day ${schedule.day}: ${vendorKey}`);
    }
  }
}
(globalThis as any).setupDailyVendorTrigger = setupDailyVendorTrigger;

/**
 * @deprecated Use setupDailyVendorTrigger instead
 * Kept for backward compatibility
 */
function setupMonthlyVendorTrigger(): void {
  Logger.log('WARNING: setupMonthlyVendorTrigger is deprecated. Use setupDailyVendorTrigger instead.');
  setupDailyVendorTrigger();
}
(globalThis as any).setupMonthlyVendorTrigger = setupMonthlyVendorTrigger;

/**
 * Check cookie status for all vendors
 * Run this manually to see cookie expiration status
 */
function checkVendorCookieStatus(): void {
  Logger.log('=== Vendor Cookie Status Check ===');
  const cookieTracker = getCookieExpirationTracker();
  const statuses = cookieTracker.checkAllCookieStatus();

  for (const status of statuses) {
    const vendorConfig = VENDOR_CONFIGS.find(v => v.vendorKey === status.vendorKey);
    const vendorName = vendorConfig?.vendorName || status.vendorKey;
    Logger.log(`\n${vendorName} (${status.vendorKey}):`);
    Logger.log(`  Valid: ${status.isValid}`);
    Logger.log(`  Days until expiration: ${status.daysUntilExpiration ?? 'unknown'}`);
    Logger.log(`  Should warn: ${status.shouldWarn}`);
    Logger.log(`  Status: ${status.statusMessage}`);
  }
}
(globalThis as any).checkVendorCookieStatus = checkVendorCookieStatus;

/**
 * Update cookie metadata for a vendor after manual cookie refresh
 * @param vendorKey Vendor identifier
 * @param expirationDays Days until cookie expires (optional)
 */
function updateVendorCookieMetadata(vendorKey: string, expirationDays?: number): void {
  const cookieTracker = getCookieExpirationTracker();
  const expiresAt = expirationDays
    ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000)
    : undefined;

  cookieTracker.recordCookieUpdate(vendorKey, expiresAt);
  Logger.log(`Updated cookie metadata for ${vendorKey}`);
  if (expiresAt) {
    Logger.log(`  Expires: ${expiresAt.toISOString()}`);
  }
}
(globalThis as any).updateVendorCookieMetadata = updateVendorCookieMetadata;

/**
 * Send test auth failure notification
 * Useful for verifying notification format and delivery
 */
function testAuthFailureNotification(vendorKey: string): void {
  const vendorConfig = VENDOR_CONFIGS.find(v => v.vendorKey === vendorKey);
  if (!vendorConfig) {
    Logger.log(`Vendor not found: ${vendorKey}`);
    return;
  }

  const notifier = new Notifier(Config.getAdminEmail());
  const testNotification: VendorAuthNotification = {
    vendorKey,
    vendorName: vendorConfig.vendorName,
    failureType: 'session_expired',
    errorMessage: 'This is a test notification. Your session has expired.',
    currentUrl: vendorConfig.portalUrl || `https://${vendorConfig.domainPatterns[0]}/`,
    failedAt: new Date(),
    recoveryInstructions: getRecoveryInstructions('session_expired', vendorConfig.vendorName),
  };

  notifier.sendVendorAuthFailureNotification(testNotification);
  Logger.log(`Sent test auth failure notification for ${vendorKey} to ${Config.getAdminEmail()}`);
}
(globalThis as any).testAuthFailureNotification = testAuthFailureNotification;

/**
 * Test auth failure notification for Aitemasu vendor
 * Run this from Apps Script editor to verify notification works
 */
function testAuthFailureNotification_Aitemasu(): void {
  testAuthFailureNotification('aitemasu');
}
(globalThis as any).testAuthFailureNotification_Aitemasu = testAuthFailureNotification_Aitemasu;

/**
 * Test vendor notification email for Canva
 * Run this from Apps Script editor to verify MailApp.sendEmail works
 */
function testVendorNotification_Canva(): void {
  queueVendorForManualProcessing('canva', new Date());
  Logger.log('Canva vendor notification test complete - check your email');
}
(globalThis as any).testVendorNotification_Canva = testVendorNotification_Canva;

/**
 * Test vendor notification email for IBJ
 * Run this from Apps Script editor to verify MailApp.sendEmail works
 */
function testVendorNotification_IBJ(): void {
  queueVendorForManualProcessing('ibj', new Date());
  Logger.log('IBJ vendor notification test complete - check your email');
}
(globalThis as any).testVendorNotification_IBJ = testVendorNotification_IBJ;

/**
 * Update Aitemasu cookie metadata (30 day expiration)
 * Run after manually refreshing cookies
 */
function updateCookie_Aitemasu_30days(): void {
  updateVendorCookieMetadata('aitemasu', 30);
}
(globalThis as any).updateCookie_Aitemasu_30days = updateCookie_Aitemasu_30days;

// Debug function to diagnose data issues
function debugDraftData(): void {
  const spreadsheetId = Config.getLogSheetId();
  Logger.log('=== DEBUG DRAFT DATA ===');
  Logger.log(`SpreadsheetId: ${spreadsheetId}`);

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  Logger.log(`Spreadsheet name: ${spreadsheet.getName()}`);

  // List all sheets
  const sheets = spreadsheet.getSheets();
  Logger.log(`Total sheets: ${sheets.length}`);
  for (const s of sheets) {
    Logger.log(`  - Sheet: "${s.getName()}" (rows: ${s.getLastRow()})`);
  }

  // Check DraftSheet specifically
  const draftSheet = spreadsheet.getSheetByName('DraftSheet');
  if (!draftSheet) {
    Logger.log('ERROR: DraftSheet not found!');
    return;
  }

  const lastRow = draftSheet.getLastRow();
  Logger.log(`DraftSheet last row: ${lastRow}`);

  if (lastRow > 1) {
    // Get first data row
    const headers = draftSheet.getRange(1, 1, 1, 18).getValues()[0];
    const firstRow = draftSheet.getRange(2, 1, 1, 18).getValues()[0];
    Logger.log(`Headers: ${JSON.stringify(headers)}`);
    Logger.log(`First data row: ${JSON.stringify(firstRow)}`);

    // Find event_month column
    const eventMonthIdx = headers.indexOf('event_month');
    Logger.log(`event_month column index: ${eventMonthIdx}`);
    if (eventMonthIdx >= 0) {
      const eventMonthValue = firstRow[eventMonthIdx];
      Logger.log(`First event_month value: "${eventMonthValue}" (type: ${typeof eventMonthValue})`);
    }
  }

  // Test WebAppApi directly
  Logger.log('--- Testing WebAppApi ---');
  const api = new WebAppApi({
    spreadsheetId: spreadsheetId,
    geminiApiKey: Config.getGeminiApiKey()
  });
  const options = api.getYearMonthOptions();
  Logger.log(`YearMonthOptions: ${JSON.stringify(options)}`);
}
(globalThis as any).debugDraftData = debugDraftData;
