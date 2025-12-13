/**
 * Cleanup utilities for debugging and re-processing emails
 *
 * These functions help when you need to:
 * - Retry failed messages after fixing errors
 * - Re-process specific service emails (e.g., after code changes)
 */

import { Config } from './config';
import { AppLogger } from './utils/logger';

/**
 * Remove the "processed" label from messages that had errors
 * This allows them to be retried on the next run
 *
 * Usage: Call this function after fixing code bugs or configuration issues
 * that caused processing errors. Then run main() to retry those messages.
 */
function cleanupFailedMessages(): void {
  AppLogger.info('Starting cleanup of failed messages');

  try {
    const spreadsheet = SpreadsheetApp.openById(Config.getLogSheetId());
    const sheet = spreadsheet.getSheetByName('ProcessingLog');

    if (!sheet) {
      AppLogger.error('ProcessingLog sheet not found', new Error('Sheet not found'));
      return;
    }

    const data = sheet.getDataRange().getValues();
    const messageIdsToRetry = new Set<string>();

    // Find all message IDs with error status
    for (let i = 1; i < data.length; i++) {
      const status = data[i][9]; // Status column
      const messageId = data[i][1]; // Message ID column

      if (status === 'error' && messageId) {
        messageIdsToRetry.add(messageId as string);
      }
    }

    AppLogger.info(`Found ${messageIdsToRetry.size} messages with errors to retry`);

    // Remove "processed" label from those messages
    const label = GmailApp.getUserLabelByName('processed');
    if (!label) {
      AppLogger.info('No "processed" label found, nothing to clean up');
      return;
    }

    let removedCount = 0;
    for (const messageId of messageIdsToRetry) {
      try {
        const message = GmailApp.getMessageById(messageId);
        if (message) {
          message.getThread().removeLabel(label);
          removedCount++;
          AppLogger.debug(`Removed "processed" label from message ${messageId}`);
        }
      } catch (error) {
        AppLogger.error(`Error removing label from message ${messageId}`, error as Error);
      }
    }

    AppLogger.info(`Successfully removed "processed" label from ${removedCount} messages`);
    AppLogger.info('You can now run main() again to retry processing these messages');

  } catch (error) {
    AppLogger.error('Error during cleanup', error as Error);
    throw error;
  }
}

/**
 * Remove "processed" label AND spreadsheet log entries for emails matching a Gmail query
 * This allows complete re-processing of those emails
 *
 * @param gmailQuery - Gmail search query (e.g., "from:mail.anthropic.com")
 * @param serviceName - Human-readable service name for logging (e.g., "Anthropic")
 *
 * Usage examples:
 * - cleanupProcessedEmails("from:mail.anthropic.com", "Anthropic")
 * - cleanupProcessedEmails("from:billing@zoom.us", "Zoom")
 * - cleanupProcessedEmails("from:feedback@slack.com", "Slack")
 *
 * This is useful when:
 * - You've updated document type detection logic and want to re-classify files
 * - You've changed filename generation and want to regenerate files
 * - You've added new extraction features and want to re-extract data
 */
function cleanupProcessedEmails(gmailQuery: string, serviceName: string): void {
  AppLogger.info(`Removing "processed" label and log entries for ${serviceName} emails`);

  try {
    // Step 1: Get message IDs matching the query
    const threads = GmailApp.search(gmailQuery);
    AppLogger.info(`Found ${threads.length} ${serviceName} email threads`);

    const messageIds = new Set<string>();
    threads.forEach(thread => {
      thread.getMessages().forEach(msg => {
        messageIds.add(msg.getId());
      });
    });

    AppLogger.info(`Found ${messageIds.size} ${serviceName} messages total`);

    // Step 2: Remove Gmail label
    const label = GmailApp.getUserLabelByName('processed');
    let removedLabelCount = 0;
    if (label) {
      threads.forEach(thread => {
        const hasLabel = thread.getLabels().some(l => l.getName() === 'processed');
        if (hasLabel) {
          thread.removeLabel(label);
          removedLabelCount++;
        }
      });
      AppLogger.info(`Removed "processed" label from ${removedLabelCount} threads`);
    } else {
      AppLogger.info('No "processed" label found');
    }

    // Step 3: Remove spreadsheet log entries
    const spreadsheet = SpreadsheetApp.openById(Config.getLogSheetId());
    const sheet = spreadsheet.getSheetByName('ProcessingLog');

    if (!sheet) {
      AppLogger.info('No ProcessingLog sheet found');
      return;
    }

    const data = sheet.getDataRange().getValues();
    const rowsToDelete: number[] = [];

    // Find rows with matching message IDs (iterate backwards to safely delete)
    for (let i = data.length - 1; i >= 1; i--) {
      const messageId = data[i][1]; // Message ID column
      if (messageIds.has(messageId)) {
        rowsToDelete.push(i + 1); // +1 because sheet rows are 1-indexed
      }
    }

    // Delete rows
    let deletedCount = 0;
    rowsToDelete.forEach(rowIndex => {
      sheet.deleteRow(rowIndex);
      deletedCount++;
    });

    AppLogger.info(`Deleted ${deletedCount} log entries from spreadsheet`);
    AppLogger.info(`Cleanup complete! You can now run main() to re-process ${serviceName} emails`);

  } catch (error) {
    AppLogger.error(`Error during ${serviceName} cleanup`, error as Error);
    throw error;
  }
}

// Export to global scope
(globalThis as any).cleanupFailedMessages = cleanupFailedMessages;
(globalThis as any).cleanupProcessedEmails = cleanupProcessedEmails;
