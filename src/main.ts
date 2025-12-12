/**
 * Auto Invoice Collector - Main Entry Point
 *
 * This is the main entry point for the Google Apps Script application.
 * It contains the trigger functions that are called by GAS.
 */

import { Config, SERVICES } from './config';
import { GmailSearcher } from './modules/gmail/GmailSearcher';
import { AttachmentExtractor } from './modules/gmail/AttachmentExtractor';
import { GeminiOcrService } from './modules/ocr/GeminiOcrService';
import { FolderManager } from './modules/drive/FolderManager';
import { FileUploader } from './modules/drive/FileUploader';
import { FileNamingService } from './modules/naming/FileNamingService';
import { ProcessingLogger } from './modules/logging/ProcessingLogger';
import { Notifier } from './modules/notifications/Notifier';
import { ProcessingResult } from './types';
import { AppLogger } from './utils/logger';

/**
 * Main function that processes new invoices from Gmail
 * This function is called by the time-based trigger
 */
function main(): void {
  AppLogger.info('Auto Invoice Collector - Starting');

  try {
    const processor = new InvoiceProcessor();
    const result = processor.run();

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

  constructor() {
    this.gmailSearcher = new GmailSearcher();
    this.attachmentExtractor = new AttachmentExtractor();
    this.ocrService = new GeminiOcrService(Config.getGeminiApiKey());
    this.folderManager = new FolderManager(Config.getRootFolderId());
    this.fileUploader = new FileUploader();
    this.namingService = new FileNamingService();
    this.logger = new ProcessingLogger(Config.getLogSheetId());
  }

  /**
   * Run the invoice processing for all configured services
   */
  run(): ProcessingResult {
    const result: ProcessingResult = {
      success: true,
      processed: 0,
      errors: [],
      needsReview: []
    };

    // Process each configured service
    for (const service of SERVICES) {
      // Only process attachment-based services for MVP
      if (service.extractionType !== 'attachment') {
        AppLogger.info(`Skipping ${service.name} (extraction type: ${service.extractionType})`);
        continue;
      }

      try {
        AppLogger.info(`Processing service: ${service.name}`);
        const serviceResult = this.processService(service.name, service.searchQuery);

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
          subject: message.getSubject()
        };

        const extracted = this.ocrService.extract(attachment.data, context);

        // Check confidence
        const needsReview = extracted.confidence < 0.7;
        const status = needsReview ? 'needs-review' : 'success';

        // Generate file name
        const fileName = this.namingService.generate(
          extracted.serviceName,
          extracted.eventMonth
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
          docType: extracted.docType,
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
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  // Create new daily trigger at 6 AM
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  Logger.log('Daily trigger created successfully');
}

// Export functions to GAS global scope
// In Google Apps Script, 'this' at the top level refers to the global scope
(globalThis as any).main = main;
(globalThis as any).runManually = runManually;
(globalThis as any).setupTrigger = setupTrigger;
