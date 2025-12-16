/**
 * Auto Invoice Collector - Main Entry Point
 *
 * This is the main entry point for the Google Apps Script application.
 * It contains the trigger functions that are called by GAS.
 */

import { Config, SERVICES } from './config';
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
 * Note: GAS trigger handlers should be synchronous. The internal async work
 * is handled by mainAsync() which is awaited properly.
 */
function main(): void {
  mainAsync();
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

    // Mark message as processed
    this.gmailSearcher.markAsProcessed(message);
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
 * Note: GAS trigger handlers should be synchronous. The internal async work
 * is handled by processMonthlyJournalsAsync() which is awaited properly.
 */
function processMonthlyJournals(): void {
  processMonthlyJournalsAsync();
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
  e: GoogleAppsScript.Events.DoGet
): GoogleAppsScript.HTML.HtmlOutput {
  const template = HtmlService.createTemplateFromFile('index');
  const output = template.evaluate();

  output
    .setTitle('仕訳レビュー - Auto Invoice Collector')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');

  return output;
}

/**
 * Include HTML file content (for templates)
 */
function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
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
(globalThis as any).api_testPrompt = api_testPrompt;
(globalThis as any).api_getPromptVersionHistory = api_getPromptVersionHistory;
(globalThis as any).api_resetToDefaultPrompt = api_resetToDefaultPrompt;
